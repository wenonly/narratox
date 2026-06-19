import { Injectable, Optional, Inject } from '@nestjs/common';
import { AgentLoggerService } from '../logging/agent-logger.service';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { WRITER_AGENT_PROMPT } from './agent-prompts';
import { makeTrimHook, extractDelta } from './agent-tools';
import type { StreamableAgent } from './streamable-agent';
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeAppendSectionTool } from './tools/append-section.tool';
import { makeGetChapterTool } from './tools/get-chapter.tool';
import { makeUpdateNovelTool } from './tools/update-novel.tool';
import { makeGetNovelInfoTool } from './tools/get-novel-info.tool';
import { ResourceRegistry } from '../resources/resource-registry';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalystService } from './analyst.service';
import { makeQueryMemoryTool } from './tools/query-memory.tool';

/**
 * 工作台 swarm:每本小说一个,按 (userId,novelId,systemPrompt) 缓存。主 Agent(路由)+ 写作 Agent(handoff)。
 * 主 Agent 的 prompt 完全来自 per-novel ContextAssembler 输出(含状态指令:CONCEPT→update_novel / ACTIVE→transfer_to_writer)。
 * 主 Agent 自带 update_novel + transfer_to_writer。
 * 写作 Agent 自带 list_chapters + write_chapter:按 **章节序号** 写(代理无法习得真实 cuid),
 * writer 的 system prompt 与 main 独立,故必须自带 list_chapters 才能知道有哪些章节。
 */
@Injectable()
export class WorkspaceSwarmService {
  private readonly swarms = new Map<string, StreamableAgent>();

  constructor(
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
    private readonly registry?: ResourceRegistry,
    private readonly chapters?: ChapterService,
    private readonly novels?: NovelService,
    private readonly analyst?: AnalystService,
    private readonly prisma?: PrismaService,
    private readonly agentLog?: AgentLoggerService,
  ) {}

  /**
   * 按 (userId,novelId,systemPrompt) 复用/构建 swarm。
   * novelId 闭包注入 writer 工具(list_chapters/write_chapter 按 order 定位章节),
   * userId 闭包注入所有工具(防伪造/越权)。
   */
  async getSwarm(
    userId: string,
    novelId: string,
    systemPrompt: string,
  ): Promise<StreamableAgent> {
    const cacheKey = `${userId}:${novelId}:${systemPrompt}`;
    const cached = this.swarms.get(cacheKey);
    if (cached) return cached;

    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) {
      throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.');
    }
    if (!this.registry) {
      throw new Error('ResourceRegistry not wired');
    }
    if (!this.chapters) {
      throw new Error('ChapterService not wired');
    }
    if (!this.novels) {
      throw new Error('NovelService not wired');
    }
    if (!this.prisma) {
      throw new Error('PrismaService not wired');
    }

    // 动态 import:仅 ESM / 仅运行时需要的包推到真正构建 swarm 时加载,
    // 保持 Jest 收集阶段干净(与 deep-agent/creation-agent 同源)。
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
    const { createSwarm, createHandoffTool } =
      await import('@langchain/langgraph-swarm');

    // DEBUG(临时):包一层 fetch,在 GLM 返回非 2xx 时把【请求体】(消息数组)落盘,
    // 定位 "Role information cannot be empty" 到底是哪条消息触发的。
    const debugFetch = async (
      url: string,
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      } = {},
    ) => {
      const res = await fetch(url, init);
      if (!res.ok) {
        try {
          const body = init.body ?? '';
          // 只取 messages 部分,避免日志过大
          const parsed = JSON.parse(body) as { messages?: unknown[] };
          const msgs = (parsed.messages ?? []).map((m) => {
            const x = m as {
              role?: string;
              content?: unknown;
              tool_calls?: unknown[];
              tool_call_id?: string;
            };
            const c = x.content;
            const cd =
              typeof c === 'string'
                ? `str(${c.length})`
                : Array.isArray(c)
                  ? `arr(${c.length})`
                  : c == null
                    ? 'null'
                    : typeof c;
            return {
              role: x.role,
              content: cd,
              tool_calls: x.tool_calls,
              tool_call_id: x.tool_call_id,
            };
          });
          const fs = await import('node:fs');
          fs.appendFileSync(
            'logs/llm-payload.log',
            `[GLM ${res.status}] ${JSON.stringify(msgs)}\n`,
          );
        } catch {
          /* ignore */
        }
      }
      return res;
    };

    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL, fetch: debugFetch },
    });

    const main = createReactAgent({
      llm: model,
      name: 'main',
      // 主 Agent 的 prompt 现在完全来自 ContextAssembler(含状态指令:
      // CONCEPT→update_novel 引导 / ACTIVE→transfer_to_writer 路由)。
      prompt: systemPrompt,
      tools: [
        // 与 writer/creation-agent 同源的双包类型摩擦,边界窄化。
        makeGetNovelInfoTool({
          userId,
          novelId,
          novels: this.novels,
        }) as never,
        makeUpdateNovelTool({
          userId,
          novelId,
          novels: this.novels,
        }) as never,
        createHandoffTool({
          agentName: 'writer',
          description: '转交给写作 Agent 来写/续写章节正文',
        }),
      ],
      preModelHook: makeTrimHook(model),
    });

    const writer = createReactAgent({
      llm: model,
      name: 'writer',
      prompt: WRITER_AGENT_PROMPT,
      tools: [
        // 与 creation-agent 同源的双包摩擦:DynamicStructuredTool 的 func 签名
        // 与 prebuilt 期望的 ServerTool | ClientTool 联合不兼容(CommonJS 解析
        // 下两份声明分别校验)。运行期同一类型,边界窄化。schema 仍受 zod 约束。
        makeListChaptersTool({
          userId,
          novelId,
          chapters: this.chapters,
        }) as never,
        makeAppendSectionTool({
          userId,
          novelId,
          chapters: this.chapters,
          novels: this.novels,
        }) as never,
        makeGetChapterTool({
          userId,
          novelId,
          chapters: this.chapters,
        }) as never,
        makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
        createHandoffTool({ agentName: 'main' }),
      ],
      preModelHook: makeTrimHook(model),
    });

    const workflow = createSwarm({
      // createReactAgent 在本包解析下返回的 CompiledStateGraph 类型与
      // createSwarm 期望的同名类型分走两份声明(同 deep-agent 的 checkpointer
      // 摩擦,扩展到整条 agent 图)。运行期是同一组对象,边界窄化消除误报。
      agents: [main, writer] as never,
      defaultActiveAgent: 'main',
    });
    // 双包类型摩擦:createReactAgent 的 tools 数组(含 DynamicStructuredTool 与
    // createHandoffTool 返回的 Command-tool)与 prebuilt 期望的 tool 联合在
    // CommonJS 解析下分走两份声明,运行期是同一组类型。compile 的 checkpointer
    // 入参也复刻 deep-agent.service.ts 的边界窄化。tool() / createHandoffTool 的
    // schema 本身仍是强类型,只在调用边界用 as never 消除误报。
    const checkpointer = (this.checkpointer ?? false) as never;
    const compiled = workflow.compile({
      checkpointer,
    }) as unknown as StreamableAgent;
    this.swarms.set(cacheKey, compiled);
    return compiled;
  }

  /** 在 thread(=novel.sessionId)上推进一轮,逐块产出文本增量(仅非空)与写作章节信号。 */
  async *streamTurn({
    userId,
    novelId,
    threadId,
    userMessage,
    systemPrompt,
  }: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    systemPrompt: string;
  }): AsyncGenerator<string | { type: 'writing-chapter'; order: number }> {
    const startedAt = Date.now();
    const log = this.agentLog?.forContext({ sessionId: threadId, novelId });
    log?.info(
      { phase: 'streamTurn.start', userMessageLen: userMessage.length },
      'streamTurn',
    );
    const editedOrders = new Set<number>();
    // 最多重试 2 次:GLM 间歇报 "Role information cannot be empty"(checkpointer 攒了
    // 它不认的消息结构)。该错总是发生在首个模型调用前(请求被拒,无内容流出),故清掉该
    // thread 的 checkpoint 后重试是干净的——正文/设定/记忆都在 DB,Agent 能凭小说状态恢复,
    // 只丢失聊天上下文。用户不再看到这个 400。
    for (let attempt = 1; attempt <= 2; attempt++) {
      editedOrders.clear();
      const swarm = await this.getSwarm(userId, novelId, systemPrompt);
      const stream = await swarm.stream(
        { messages: [{ role: 'user', content: userMessage }] },
        { configurable: { thread_id: threadId }, streamMode: 'messages' },
      );
      try {
        for await (const chunk of stream) {
          const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
            tool_calls?: Array<{
              name: string;
              args?: { chapterOrder?: number };
            }>;
            name?: string;
            content?: string;
            _getType?: () => string;
          };

          // append_section 决定写一节 → 通知前端(骨架 + 刷新)。
          if (msg?.tool_calls) {
            for (const tc of msg.tool_calls) {
              if (
                tc.name === 'append_section' &&
                typeof tc.args?.chapterOrder === 'number'
              ) {
                yield { type: 'writing-chapter', order: tc.args.chapterOrder };
              }
            }
          }

          // append_section 返回 ok → 记下本章本轮被编辑(供轮末结算)。
          if (
            msg?.name === 'append_section' &&
            typeof msg.content === 'string'
          ) {
            try {
              const parsed = JSON.parse(msg.content) as {
                ok?: boolean;
                chapterOrder?: number;
              };
              if (
                parsed.ok === true &&
                typeof parsed.chapterOrder === 'number'
              ) {
                editedOrders.add(parsed.chapterOrder);
                log?.info(
                  {
                    phase: 'append_section.detected',
                    chapterOrder: parsed.chapterOrder,
                  },
                  'agent',
                );
              }
            } catch {
              /* 非 JSON,忽略 */
            }
          }

          // 工具结果(ToolMessage)不是聊天正文 —— 跳过,不泄漏工具 JSON。
          if (
            typeof msg?._getType === 'function' &&
            msg._getType() === 'tool'
          ) {
            continue;
          }
          const delta = extractDelta(chunk);
          if (delta) yield delta;
        }
        break; // 流正常结束 → 跳出重试循环
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (
          attempt === 1 &&
          errMsg.includes('Role information cannot be empty')
        ) {
          log?.info({ phase: 'role_empty.clear_retry' }, 'agent');
          await this.clearThreadCheckpoints(threadId).catch(() => {
            /* 清理失败则放弃重试降级 */
          });
          continue; // 清掉 checkpoint,干净重试一次
        }
        throw err; // 其它错误,或二次仍失败 → 上抛给 controller
      }
    }

    // 轮末:对本轮每个被编辑的章异步结算(per-novel 锁去重)。
    if (editedOrders.size > 0 && this.analyst) {
      for (const order of editedOrders) {
        log?.info({ phase: 'settle.dispatch', chapterOrder: order }, 'agent');
        void this.analyst
          .settle({ userId, novelId, chapterOrder: order })
          .catch((e) => {
            log?.error(
              {
                phase: 'settle.dispatch_failed',
                chapterOrder: order,
                err: e instanceof Error ? e : new Error(String(e)),
              },
              'agent',
            );
          });
      }
    }
    log?.info(
      { phase: 'streamTurn.end', latencyMs: Date.now() - startedAt },
      'streamTurn',
    );
  }

  /** 清掉某 thread 在 agent_memory 的 checkpoint 消息状态(用于 400 自愈重试)。 */
  private async clearThreadCheckpoints(threadId: string): Promise<void> {
    if (!this.prisma) return;
    await this.prisma
      .$executeRaw`DELETE FROM agent_memory.checkpoints WHERE thread_id = ${threadId}`;
  }
}

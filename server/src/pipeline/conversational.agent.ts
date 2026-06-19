import { Injectable, Optional, Inject } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from '../agentos/checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from '../agentos/agentos.constants';
import { makeTrimHook } from '../agentos/agent-tools';
import { makeUpdateNovelTool } from '../agentos/tools/update-novel.tool';
import { makeGetNovelInfoTool } from '../agentos/tools/get-novel-info.tool';
import { NovelService } from '../novel/novel.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoggerService } from '../logging/agent-logger.service';
import { createActivityEmitter } from './stateless-agent';
import { PipelineRunner, type Pipeline } from './pipeline-runner';
import type { WriterAgent } from './writer.agent';
import type { SettlerAgent } from './settler.agent';
import type { ActivityEvent } from './activity.types';

/**
 * 会话 agent(spec §3.1):单个 createReactAgent **带 checkpointer**(Deep Agent 记忆卖点)。
 * 状态感知 prompt(CONCEPT→收集 via update_novel / ACTIVE→写作 via run_pipeline)。
 * 不再用 swarm 握手 —— 干净线程,400 风险大降。
 *
 * run_pipeline 工具触发写章流水线:closure 捕获【每请求】的 emit,运行 PipelineRunner 并把
 * 流水线活动事件直接吐到同一个 emit(res 汇)。会话 agent 自身的 think/content/tool 事件经
 * createActivityEmitter 翻译到 emit —— 两者共享 emit,单条扁平流按时间顺序交织
 * (tool-Act → 流水线事件 → tool-ActResult),controller 的 for-await 被工具调用阻塞期间
 * 工具自己往 res flush,事件仍实时到达。
 */
@Injectable()
export class ConversationalAgentService {
  private readonly models = new Map<string, unknown>();

  constructor(
    private readonly pipelineRunner: PipelineRunner,
    private readonly writerAgent: WriterAgent,
    private readonly settlerAgent: SettlerAgent,
    private readonly novels: NovelService,
    private readonly agentLog: AgentLoggerService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  private async getModel(userId: string): Promise<unknown> {
    const cached = this.models.get(userId);
    if (cached) return cached;
    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.');
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      temperature: 0.5,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 120_000,
      maxRetries: 0,
    });
    this.models.set(userId, model);
    return model;
  }

  /** 写章流水线:writer(一节节写整章)→ settler(同步结算)。通过方法构造,避开字段初始化顺序。 */
  private writeChapterPipeline(): Pipeline {
    return {
      name: 'write-chapter',
      stages: [
        {
          name: 'writer',
          agent: this.writerAgent,
          input: (ctx) => ({
            chapterOrder: ctx.input.chapterOrder,
            userMessage: ctx.input.userMessage,
          }),
        },
        {
          name: 'settler',
          agent: this.settlerAgent,
          input: (ctx) => ({ chapterOrder: ctx.input.chapterOrder }),
        },
      ],
    };
  }

  /**
   * 推进一轮。emit = 直接写 res 的汇(每事件一帧)。返回会话 agent 的正文(replyText,
   * 供 controller 落 Message 表)—— 仅累计【会话 agent 自身】的 content,pipeline 的
   * writer/settler content 不计入(它们经同一 emit 显示,但不污染聊天历史)。
   */
  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
  }): Promise<{ replyText: string }> {
    const { userId, novelId, threadId, userMessage, systemPrompt, emit } = args;
    const log = this.agentLog?.forContext({ sessionId: threadId, novelId });
    const model = await this.getModel(userId);

    let replyText = '';
    // 自愈:GLM 间歇报 "Role information cannot be empty"(checkpointer 攒了它不认的消息结构,
    // 总发生在首个模型调用前)。清掉该 thread 的 checkpoint 后重试是干净的 —— 正文/设定/记忆都在 DB。
    for (let attempt = 1; attempt <= 2; attempt++) {
      replyText = '';

      // 每请求构建 run_pipeline(emit 是每请求的)。流水线事件直接走 emit(res)。
      const runPipeline = tool(
        async ({ name, chapterOrder }) => {
          if (name !== 'write-chapter') {
            return { ok: false, error: `未知流水线: ${name}` };
          }
          log?.info({ phase: 'run_pipeline.start', chapterOrder }, 'agent');
          try {
            for await (const ev of this.pipelineRunner.run(
              this.writeChapterPipeline(),
              { userId, novelId, input: { chapterOrder, userMessage } },
            )) {
              emit(ev);
            }
            return {
              ok: true,
              chapterOrder,
              message: `第${chapterOrder}章已写完并结算。`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log?.error(
              {
                phase: 'run_pipeline.failed',
                chapterOrder,
                err: err instanceof Error ? err : new Error(msg),
              },
              'agent',
            );
            return { ok: false, chapterOrder, error: msg };
          }
        },
        {
          name: 'run_pipeline',
          description:
            '触发一条写章流水线(目前支持 write-chapter):writer 一节节写完整章,settler 随后结算(摘要/伏笔)。作者要写/续写章节正文时调用。',
          schema: z.object({
            name: z.enum(['write-chapter']).describe('流水线名'),
            chapterOrder: z
              .number()
              .int()
              .describe('要写/续写的章节序号(1-based)'),
          }),
        },
      );

      const tools = [
        makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
        makeUpdateNovelTool({ userId, novelId, novels: this.novels }) as never,
        runPipeline as never,
      ];

      const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
      const agent = createReactAgent({
        llm: model as never,
        name: 'conversational',
        prompt: systemPrompt,
        tools,
        preModelHook: makeTrimHook(model),
        ...(this.checkpointer ? { checkpointer: this.checkpointer as never } : {}),
      });

      const stream = (await agent.stream(
        { messages: [{ role: 'user', content: userMessage }] },
        { configurable: { thread_id: threadId }, streamMode: 'messages' },
      )) as AsyncIterable<unknown>;

      // 会话 agent 的 content 累计进 replyText(仅自身,不含 pipeline 的 content)。
      const contentIds = new Set<string>();
      const convEmit = (ev: ActivityEvent): void => {
        emit(ev);
        if (ev.type === 'Act' && ev.act === 'content') contentIds.add(ev.id);
        else if (ev.type === 'ActDelta' && contentIds.has(ev.id))
          replyText += ev.text;
      };
      const em = createActivityEmitter(convEmit);

      try {
        for await (const chunk of stream) {
          em.feed(chunk);
        }
        em.finish();
        break; // 正常结束 → 跳出重试
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
        throw err;
      }
    }

    return { replyText };
  }

  /** 清掉某 thread 在 agent_memory 的 checkpoint 消息状态(用于 400 自愈重试)。 */
  private async clearThreadCheckpoints(threadId: string): Promise<void> {
    if (!this.prisma) return;
    await this.prisma
      .$executeRaw`DELETE FROM agent_memory.checkpoints WHERE thread_id = ${threadId}`;
  }
}

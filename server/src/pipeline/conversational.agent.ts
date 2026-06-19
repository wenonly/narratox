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
// VALUE import (not `import type`):Nest DI 靠 reflect-metadata 读 design:paramtypes,
// type-only import 会被擦除 → 运行期注入失败。WriterAgent/SettlerAgent 必须是值导入。
import { WriterAgent } from './writer.agent';
import { SettlerAgent } from './settler.agent';
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
    if (!apiKey)
      throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.');
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      temperature: 0.5,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 120_000,
      maxRetries: 0,
      // 封顶总输出(含 reasoning)。GLM-5.2 无视 thinking.budget_tokens,但遵守
      // max_tokens;给宽,只兜住 reasoning 跑飞,不卡正常思考/回复。
      maxTokens: 16_000,
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
   * 推进一轮。emit = 直接写 res 的汇(每事件一帧)。会话 agent 自身 + 流水线(writer/settler)
   * 的活动事件都经 emit 流出;controller 在 emit 外层累计 content 增量作为聊天回复(落 Message 表)。
   */
  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
  }): Promise<void> {
    const { userId, novelId, threadId, userMessage, systemPrompt, emit } = args;
    const log = this.agentLog?.forContext({ sessionId: threadId, novelId });
    const model = await this.getModel(userId);

    // 自愈:GLM 间歇报 "Role information cannot be empty"(checkpointer 攒了它不认的消息结构,
    // 总发生在首个模型调用前)。清掉该 thread 的 checkpoint 后重试是干净的 —— 正文/设定/记忆都在 DB。
    for (let attempt = 1; attempt <= 2; attempt++) {
      // 每请求构建 run_pipeline(emit 是每请求的)。流水线事件直接走 emit(res)。
      const runPipeline = tool(
        async ({ name, chapterOrder }) => {
          if (name !== 'write-chapter') {
            // zod enum 已保证 name === 'write-chapter';此处仅为类型收窄后的防御。
            return { ok: false, error: '未知流水线(仅支持 write-chapter)' };
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

      const { createReactAgent } =
        await import('@langchain/langgraph/prebuilt');
      const agent = createReactAgent({
        llm: model as never,
        name: 'conversational',
        prompt: systemPrompt,
        tools,
        preModelHook: makeTrimHook(model),
        ...(this.checkpointer
          ? { checkpointer: this.checkpointer as never }
          : {}),
      });

      const stream = (await agent.stream(
        { messages: [{ role: 'user', content: userMessage }] },
        { configurable: { thread_id: threadId }, streamMode: 'messages' },
      )) as AsyncIterable<unknown>;

      // 会话 agent 与 run_pipeline 共用同一个 emit:逐块翻译 + 流水线事件都直写 res。
      const em = createActivityEmitter(emit);

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
  }

  /**
   * 彻底清掉某 thread 在 agent_memory 的 checkpoint 状态(用于 400 "Role empty" 自愈重试)。
   * PostgresSaver 把线程状态分散在 3 张表:checkpoints(元数据)/ checkpoint_blobs
   * (序列化的消息)/ checkpoint_writes(待写入)。只清 checkpoints 会留下 blobs/writes,
   * 重试时又把损坏的消息(孤儿 tool 结果/空 role)读回来 → 400 复现。三张表都清才算
   * 真正重置 → 重试以[system + 本轮 user]干净起步,不再 400。
   */
  private async clearThreadCheckpoints(threadId: string): Promise<void> {
    if (!this.prisma) return;
    await this.prisma
      .$executeRaw`DELETE FROM agent_memory.checkpoints WHERE thread_id = ${threadId}`;
    await this.prisma
      .$executeRaw`DELETE FROM agent_memory.checkpoint_blobs WHERE thread_id = ${threadId}`;
    await this.prisma
      .$executeRaw`DELETE FROM agent_memory.checkpoint_writes WHERE thread_id = ${threadId}`;
  }
}

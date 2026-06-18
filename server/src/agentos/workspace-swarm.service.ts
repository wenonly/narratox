import { Injectable, Optional, Inject } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { WRITER_AGENT_PROMPT } from './agent-prompts';
import { makeTrimHook, extractDelta } from './agent-tools';
import type { StreamableAgent } from './streamable-agent';
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeWriteChapterTool } from './tools/write-chapter.tool';
import { makeUpdateNovelTool } from './tools/update-novel.tool';
import { ResourceRegistry } from '../resources/resource-registry';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';

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

    // 动态 import:仅 ESM / 仅运行时需要的包推到真正构建 swarm 时加载,
    // 保持 Jest 收集阶段干净(与 deep-agent/creation-agent 同源)。
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
    const { createSwarm, createHandoffTool } =
      await import('@langchain/langgraph-swarm');

    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL },
    });

    const main = createReactAgent({
      llm: model,
      name: 'main',
      // 主 Agent 的 prompt 现在完全来自 ContextAssembler(含状态指令:
      // CONCEPT→update_novel 引导 / ACTIVE→transfer_to_writer 路由)。
      prompt: systemPrompt,
      tools: [
        // 与 writer/creation-agent 同源的双包类型摩擦,边界窄化。
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
        makeWriteChapterTool({
          userId,
          novelId,
          chapters: this.chapters,
          registry: this.registry,
          novels: this.novels,
        }) as never,
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
    const swarm = await this.getSwarm(userId, novelId, systemPrompt);
    const stream = await swarm.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
        tool_calls?: Array<{ name: string; args?: { chapterOrder?: number } }>;
      };
      if (msg?.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (
            tc.name === 'write_chapter' &&
            typeof tc.args?.chapterOrder === 'number'
          ) {
            yield { type: 'writing-chapter', order: tc.args.chapterOrder };
          }
        }
      }
      const delta = extractDelta(chunk);
      if (delta) yield delta;
    }
  }
}

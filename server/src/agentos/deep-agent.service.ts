import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';

/**
 * DeepAgent 暴露的最小接口——只用到 stream()。
 * 用本地接口而非 ReturnType<typeof createDeepAgent> 是为了：
 * 1) 避免在模块顶层静态 import deepagents/@langchain/openai（含仅-ESM 的传递依赖，
 *    会让 Jest 在收集阶段崩溃；动态 import 把加载推迟到真正构建 agent 时）。
 * 2) 让 extractDelta/streamTurn 的单测无需真实加载整条依赖链。
 *
 * streamTurn 只传「新用户消息 + thread_id」：对话历史由 checkpointer 按 thread_id
 * 自动加载，SummarizationMiddleware 自动压缩旧消息（deepagents 对每个 agent 自动挂载）。
 */
interface StreamableAgent {
  stream(
    input: { messages: Array<{ role: string; content: string }> },
    options: {
      configurable: Record<string, unknown>;
      streamMode: 'messages';
    },
  ): Promise<AsyncIterable<unknown>>;
}

@Injectable()
export class DeepAgentService implements OnModuleInit {
  private readonly agents = new Map<string, StreamableAgent>();

  constructor(
    // @Optional：单测里 new DeepAgentService() 不传也能用（走 checkpointer=false）。
    // 生产环境由 checkpointerProvider 注入 PostgresSaver。
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  async onModuleInit(): Promise<void> {
    // agents are built lazily per system prompt in getAgent()
  }

  /**
   * 按 systemPrompt 取（或构建并缓存）对应的 agent。每个小说会由 ContextAssembler
   * 拼出独立的 system prompt，这里以 prompt 文本为 key 做记忆化，避免每次 turn 都重建。
   */
  protected async getAgent(systemPrompt: string): Promise<StreamableAgent> {
    let agent = this.agents.get(systemPrompt);
    if (!agent) {
      agent = await this.buildAgent(systemPrompt);
      this.agents.set(systemPrompt, agent);
    }
    return agent;
  }

  // protected 以便单测可访问；构建真实 DeepAgent（读 env + 动态加载 deepagents）
  protected async buildAgent(systemPrompt: string): Promise<StreamableAgent> {
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ZHIPUAI_API_KEY is not set. Add it to server/.env (see server/.env.example).',
      );
    }
    // 动态 import：避免静态加载仅-ESM 传递依赖导致 Jest 崩溃。
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createDeepAgent } = await import('deepagents');
    // @langchain/openai v1：baseURL 须放进 configuration；模型字段名是 model。
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL },
    });
    // 双包类型摩擦：本服务（CommonJS）解析 BaseCheckpointSaver 走 .d.cts，
    // 而 deepagents（ESM）的同名类型走 .d.ts，@langchain/core 的两份声明里
    // 受保护成员形状不一致，TS 把它们判成不兼容类型。运行期是同一个类。
    // 故仅在此调用边界做窄化转换（设计不变：注入的 checkpointer 原样透传，
    // false 分支仍由类型系统约束）。
    const checkpointer: boolean | BaseCheckpointSaver =
      this.checkpointer ?? false;
    return createDeepAgent({
      model,
      systemPrompt,
      checkpointer: checkpointer as never,
    });
  }

  /**
   * 从 deepagents 的 messages 模式流式分块里抽出文本增量。
   * streamMode:'messages'（无 subgraphs）下，每块形如 [message, metadata]，
   * message.text 是增量 delta。兼容裸对象 / 缺失字段。
   *
   * 范围说明（phase 1）：本 agent 是纯对话、无工具/无子 agent，content 一律为字符串。
   * 因此数组形态的 content（工具调用 / 多段消息）会被有意跳过（返回 ''）。
   */
  protected extractDelta(chunk: unknown): string {
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as
      | { text?: string; content?: unknown }
      | undefined;
    if (typeof msg?.text === 'string') return msg.text;
    if (typeof msg?.content === 'string') return msg.content;
    return '';
  }

  /**
   * 在指定 thread（=session）上推进一轮：只传新的用户消息，历史与压缩由
   * checkpointer + SummarizationMiddleware 自动处理。逐块产出文本增量（仅非空）。
   */
  async *streamTurn({
    threadId,
    userMessage,
    systemPrompt,
  }: {
    threadId: string;
    userMessage: string;
    systemPrompt: string;
  }): AsyncGenerator<string> {
    const agent = await this.getAgent(systemPrompt);
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const delta = this.extractDelta(chunk);
      if (delta) yield delta;
    }
  }
}

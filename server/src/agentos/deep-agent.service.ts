import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  GLM_BASE_URL,
  GLM_MODEL,
  SYSTEM_PROMPT,
} from './agentos.constants';

/**
 * DeepAgent 暴露的最小接口——只用到 stream()。
 * 用本地接口而非 ReturnType<typeof createDeepAgent> 是为了：
 * 1) 避免在模块顶层静态 import deepagents/@langchain/openai（含仅-ESM 的传递依赖，
 *    会让 Jest 在收集阶段崩溃；动态 import 把加载推迟到真正构建 agent 时）。
 * 2) 让 extractDelta/streamDeltas 的单测无需真实加载整条依赖链。
 */
interface StreamableAgent {
  stream(
    input: { messages: Array<{ role: string; content: string }> },
    options: { streamMode: 'messages' },
  ): Promise<AsyncIterable<unknown>>;
}

@Injectable()
export class DeepAgentService implements OnModuleInit {
  private agent!: StreamableAgent;

  async onModuleInit(): Promise<void> {
    this.agent = await this.buildAgent();
  }

  // protected 以便单测可访问；构建真实 DeepAgent（读 env + 动态加载 deepagents）
  protected async buildAgent(): Promise<StreamableAgent> {
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
    return createDeepAgent({ model, systemPrompt: SYSTEM_PROMPT });
  }

  /**
   * 从 deepagents 的 messages 模式流式分块里抽出文本增量。
   * streamMode:'messages'（无 subgraphs）下，每块形如 [message, metadata]，
   * message.text 是增量 delta。兼容裸对象 / 缺失字段。
   *
   * 范围说明（phase 1）：本 agent 是纯对话、无工具/无子 agent，content 一律为字符串。
   * 因此数组形态的 content（工具调用 / 多段消息）会被有意跳过（返回 ''）。
   * 若 Task 7 真机验证发现要渲染工具调用文本，再在此扩展对数组 content 的取值。
   */
  protected extractDelta(chunk: unknown): string {
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as
      | { text?: string; content?: unknown }
      | undefined;
    if (typeof msg?.text === 'string') return msg.text;
    if (typeof msg?.content === 'string') return msg.content;
    return '';
  }

  /** 把用户消息喂给 DeepAgent，逐块产出文本增量（仅非空）。 */
  async *streamDeltas(message: string): AsyncGenerator<string> {
    const stream = await this.agent.stream(
      { messages: [{ role: 'user', content: message }] },
      { streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const delta = this.extractDelta(chunk);
      if (delta) yield delta;
    }
  }
}

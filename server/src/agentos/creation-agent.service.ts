import { Injectable, Optional, Inject } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { CREATION_AGENT_PROMPT } from './agent-prompts';
import { makeTrimHook } from './agent-tools';
import { makeCreateNovelTool } from './tools/create-novel.tool';
import { NovelService } from '../novel/novel.service';

/** 创作 Agent 构建产物:有 .stream({messages},{configurable,streamMode}) 的可流式 agent。 */
export interface StreamableAgent {
  stream(
    input: { messages: Array<{ role: string; content: string }> },
    options: { configurable: Record<string, unknown>; streamMode: 'messages' },
  ): Promise<AsyncIterable<unknown>>;
}

/**
 * 建书前的创作 Agent(单 agent,非 swarm)。问答收集信息 → create_novel 建书。
 * 每次创作会话构建一个(闭包绑定 userId)。controller 直接用 build() + agent.stream()。
 * ESM 动态 import 保 Jest 干净。
 */
@Injectable()
export class CreationAgentService {
  constructor(
    private readonly novels: NovelService,
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  async build(userId: string): Promise<StreamableAgent> {
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey)
      throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.');
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL },
    });
    // 双包类型摩擦:@langchain/core/tools 的 tool() 返回 DynamicStructuredTool,
    // 在本服务(CommonJS)解析下其 func 签名与 langgraph/prebuilt 期望的
    // ServerTool | ClientTool 联合(运行期同一类型,TS 在联合分支上分别校验导致
    // 误报)。在调用边界用 as never 窄化,与 deep-agent.service.ts 的 checkpointer
    // 边界处理(checkpointer as never)同源。tool() 的 schema 仍是受 zod 约束的强类型。
    const createNovelTool = makeCreateNovelTool({
      userId,
      novels: this.novels,
    });
    const agent = createReactAgent({
      llm: model,
      name: 'creation',
      prompt: CREATION_AGENT_PROMPT,
      tools: [createNovelTool as never],
      preModelHook: makeTrimHook(model),
      checkpointer: (this.checkpointer ?? false) as never,
    });
    return agent;
  }
}

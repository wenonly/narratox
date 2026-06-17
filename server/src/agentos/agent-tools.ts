import { trimMessages } from '@langchain/core/messages';

/**
 * preModelHook:调用 LLM 前压缩历史(deepagents 自带 SummarizationMiddleware,raw
 * createReactAgent 没有,这里用 trimMessages 兜底,防止长篇上下文爆炸)。
 * strategy="last" 保留最近的对话,includeSystem 保留系统消息。
 */
export function makeTrimHook(model: unknown) {
  // model 用于 token 计数;类型用 unknown 避免与 @langchain/openai 的具体类型耦合。
  return async (state: { messages: unknown[] }) => {
    const trimmed = await trimMessages(
      state.messages as Parameters<typeof trimMessages>[0],
      {
        maxTokens: 6000,
        tokenCounter: model as Parameters<
          typeof trimMessages
        >[1]['tokenCounter'],
        strategy: 'last',
        includeSystem: true,
        startOn: 'human',
      },
    );
    return { messages: trimmed };
  };
}

/**
 * 从 messages streamMode 的 [message, metadata] 元组里抽出文本增量。
 * (从 deep-agent.service.ts 迁来,creations/workspace 两处流式共用。)
 * tool_calls / 多段 content 等非字符串 content 一律返回 ''(静默丢弃工具噪声)。
 */
export function extractDelta(chunk: unknown): string {
  const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as
    | { text?: string; content?: unknown }
    | undefined;
  if (typeof msg?.text === 'string') return msg.text;
  if (typeof msg?.content === 'string') return msg.content;
  return '';
}

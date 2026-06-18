import { trimMessages } from '@langchain/core/messages';

/**
 * preModelHook:调用 LLM 前压缩历史(deepagents 自带 SummarizationMiddleware,raw
 * createReactAgent 没有,这里用 trimMessages 兜底,防止长篇上下文爆炸)。
 * strategy="last" 保留最近的对话,includeSystem 保留系统消息。
 */
export function makeTrimHook(model: unknown) {
  const VALID_TYPES = new Set(['human', 'ai', 'system', 'tool']);
  return async (state: { messages: unknown[] }) => {
    const trimmed = await trimMessages(
      state.messages as Parameters<typeof trimMessages>[0],
      {
        maxTokens: 30000,
        tokenCounter: model as Parameters<
          typeof trimMessages
        >[1]['tokenCounter'],
        strategy: 'last',
        includeSystem: true,
        startOn: 'human',
      },
    );
    // Sanitize: remove corrupt messages + orphaned tool messages (split by trimming).
    // GLM rejects messages with empty/missing roles or null content, and rejects a
    // ToolMessage whose preceding AIMessage (with tool_calls) was trimmed away —
    // both manifest as 400 "Role information cannot be empty".
    const safe = trimmed.filter((m, i, arr) => {
      const msg = m as {
        _getType?: () => string;
        content?: unknown;
        tool_calls?: unknown[];
      };
      try {
        const type = typeof msg._getType === 'function' ? msg._getType() : '';
        // 1. Must be a valid type
        if (!VALID_TYPES.has(type)) return false;
        // 2. Content must not be null/undefined
        if (msg.content == null) return false;
        // 3. ToolMessages must have a preceding AIMessage with tool_calls (not orphaned)
        if (type === 'tool' && i > 0) {
          const prev = arr[i - 1] as {
            _getType?: () => string;
            tool_calls?: unknown[];
          };
          const prevType =
            typeof prev?._getType === 'function' ? prev._getType() : '';
          if (prevType !== 'ai') return false;
          if (
            !prev?.tool_calls ||
            !Array.isArray(prev.tool_calls) ||
            prev.tool_calls.length === 0
          )
            return false;
        }
        return true;
      } catch {
        return false;
      }
    });
    return { messages: safe };
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

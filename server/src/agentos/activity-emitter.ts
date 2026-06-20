import type { ActivityEvent } from './activity.types';
import { nextActId } from './activity.types';

/**
 * 把一条 message-stream chunk 翻译成 0..n 个扁平活动事件,经 emit 回调吐出。
 * 会话 agent(带 checkpointer)与无状态专家(不带)共用这一份翻译逻辑 —— 区别只在
 * 如何拿到 stream / 如何编排,逐块翻译完全一致。
 *
 * think/content 按【消息 id】分组(同一轮 LLM 生成的 chunk 共享 id);tool 按 tool_call_id 分组。
 */
export interface ActivityEmitter {
  feed(chunk: unknown): void;
  finish(): void;
}

export function createActivityEmitter(
  emit: (ev: ActivityEvent) => void,
): ActivityEmitter {
  const thinkForMsg = new Map<string, string>();
  const contentForMsg = new Map<string, string>();
  const toolActForCall = new Map<string, string>();
  const seenToolCall = new Set<string>();
  /** task 工具的 tool_call_id 集合 —— 子 agent 返回时据此发「回到主 agent」stage 标记。 */
  const taskToolCalls = new Set<string>();
  let msgCounter = 0;

  const feed = (chunk: unknown): void => {
    const tuple = Array.isArray(chunk) ? chunk : [chunk, undefined];
    const msg = tuple[0] as {
      id?: string;
      _getType?: () => string;
      content?: unknown;
      tool_call_id?: string;
      tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
      additional_kwargs?: { reasoning_content?: unknown };
    };
    if (!msg || typeof msg._getType !== 'function') return;

    const type = msg._getType();
    const msgId = msg.id ?? `msg-${msgCounter++}`;

    if (type === 'ai') {
      // 1. reasoning_content(GLM 思考 token)→ think 条目(消除卡顿的关键:思考阶段实时显示)。
      const reasoningRaw = msg.additional_kwargs?.reasoning_content;
      let reasoning = '';
      if (typeof reasoningRaw === 'string') {
        reasoning = reasoningRaw;
      } else if (
        reasoningRaw &&
        typeof reasoningRaw === 'object' &&
        'content' in reasoningRaw
      ) {
        const c = (reasoningRaw as { content?: unknown }).content;
        if (typeof c === 'string') reasoning = c;
      }
      if (reasoning) {
        let thinkId = thinkForMsg.get(msgId);
        if (!thinkId) {
          thinkId = nextActId('think');
          thinkForMsg.set(msgId, thinkId);
          emit({ type: 'Act', id: thinkId, act: 'think', label: '思考' });
        }
        emit({ type: 'ActDelta', id: thinkId, text: reasoning });
      }

      // 2. content(正文)→ content 条目。
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content) {
        let contentId = contentForMsg.get(msgId);
        if (!contentId) {
          contentId = nextActId('content');
          contentForMsg.set(msgId, contentId);
          emit({ type: 'Act', id: contentId, act: 'content' });
        }
        emit({ type: 'ActDelta', id: contentId, text: content });
      }

      // 3. tool_calls → tool 条目(Act + ActTool)。同一 tool_call_id 只开一次。
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!tc.id) continue; // 无 id 的工具调用无法配对结果,跳过
          if (seenToolCall.has(tc.id)) continue;
          seenToolCall.add(tc.id);
          const toolActId = nextActId('tool');
          toolActForCall.set(tc.id, toolActId);
          emit({ type: 'Act', id: toolActId, act: 'tool', label: tc.name });
          emit({ type: 'ActTool', id: toolActId, args: tc.args ?? {} });
          // task 工具 = 委派子 agent。发一个 stage 标记「正在用哪个子 agent」,
          // 标签直接取自 args.subagent_type(子 agent 名是单一来源,不在此处映射,避免漂移)。
          if (tc.name === 'task') {
            taskToolCalls.add(tc.id);
            const subagentType = (
              tc.args as { subagent_type?: string } | undefined
            )?.subagent_type;
            emit({
              type: 'Act',
              id: nextActId('stage'),
              act: 'stage',
              label: `▶ ${subagentType ?? '子 agent'}`,
            });
          }
        }
      }
    } else if (type === 'tool') {
      // 4. 工具结果(ToolMessage)→ ActResult + ActEnd。
      const toolActId = msg.tool_call_id
        ? toolActForCall.get(msg.tool_call_id)
        : undefined;
      if (toolActId) {
        let result: unknown = msg.content;
        if (typeof msg.content === 'string') {
          try {
            result = JSON.parse(msg.content);
          } catch {
            /* 非 JSON,保留原字符串 */
          }
        }
        emit({ type: 'ActResult', id: toolActId, result });
        emit({ type: 'ActEnd', id: toolActId, status: 'ok' });
        // task 结果回来 = 子 agent 结束、回到主 agent。发「返回主 agent」stage 标记。
        if (msg.tool_call_id && taskToolCalls.has(msg.tool_call_id)) {
          emit({
            type: 'Act',
            id: nextActId('stage'),
            act: 'stage',
            label: '◀ 主 agent',
          });
        }
      }
    }
  };

  const finish = (): void => {
    // 收尾:为仍开着的 think/content 条目补 ActEnd(FE 据此标记完成)。
    for (const id of thinkForMsg.values()) {
      emit({ type: 'ActEnd', id, status: 'ok' });
    }
    for (const id of contentForMsg.values()) {
      emit({ type: 'ActEnd', id, status: 'ok' });
    }
  };

  return { feed, finish };
}

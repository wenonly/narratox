import type { ActivityEvent } from './activity.types';
import { nextActId } from './activity.types';

/**
 * 把一条 message-stream chunk 翻译成 0..n 个扁平活动事件,经 emit 回调吐出。
 * 会话 agent(带 checkpointer)与无状态专家(不带)共用这一份翻译逻辑 —— 区别只在
 * 如何拿到 stream / 如何编排,逐块翻译完全一致。
 *
 * think/content 按【消息 id】分组(同一轮 LLM 生成的 chunk 共享 id);tool 按 tool_call_id 分组。
 *
 * stage(子 agent 委派)关闭时机说明:
 *   task 工具用 subagent.invoke()(阻塞),其 ToolMessage 通过 Command 返回给 langgraph
 *   内部状态管理,**不触发 streamMode:'messages' 流事件**。所以无法靠 ToolMessage 检测
 *   子 agent 结束。改用「主 agent 发起下一个 task 调用」作为「上一个子 agent 已结束」的信号
 *   (主 agent 能调下一个 task,说明上一个 task 结果已回来);最后一个靠 finish() 兜底。
 */
export interface ActivityEmitter {
  feed(chunk: unknown): void;
  finish(): void;
}

/**
 * 从 task 工具调用的 args 里提取 subagent_type。
 * 流中 args 可能是:已 parse 的对象 / 完整 JSON 字符串 / 部分 JSON 字符串(流式累积中)。
 */
function extractSubagentType(args: unknown): string | undefined {
  if (!args) return undefined;
  // 已 parse 的对象
  if (typeof args === 'object') {
    const t = (args as { subagent_type?: unknown }).subagent_type;
    return typeof t === 'string' ? t : undefined;
  }
  // JSON 字符串
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      const t = parsed?.subagent_type;
      if (typeof t === 'string') return t;
    } catch {
      // 部分 JSON(流式累积)→ regex 兜底
      const m = args.match(/"subagent_type"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return undefined;
}

export function createActivityEmitter(
  emit: (ev: ActivityEvent) => void,
): ActivityEmitter {
  const thinkForMsg = new Map<string, string>();
  const contentForMsg = new Map<string, string>();
  const toolActForCall = new Map<string, string>();
  const seenToolCall = new Set<string>();
  /** 所有未关闭的 stage act id。 */
  const openStages = new Set<string>();
  let msgCounter = 0;

  /** 关闭所有未关闭的 stage(finish 收尾,或主 agent 发起新 task 时调)。 */
  const closeOpenStages = (): void => {
    for (const sid of openStages) {
      emit({ type: 'ActEnd', id: sid, status: 'ok' });
    }
    openStages.clear();
  };

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
      // 1. reasoning_content(GLM 思考 token)→ think 条目。
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

      // 3. tool_calls → tool 或 stage 条目。
      //    task 工具 = 子 agent 委派,只开 stage(不发 tool Act,避免双重显示);
      //    新 task 到达 = 上一个子 agent 已结束 → 先关旧 stage 再开新。
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!tc.id) continue;
          if (seenToolCall.has(tc.id)) continue;
          seenToolCall.add(tc.id);
          if (tc.name === 'task') {
            // 主 agent 发起新 task → 上一个子 agent 必已结束(subagent.invoke 阻塞)
            closeOpenStages();
            const subagentType = extractSubagentType(tc.args);
            const stageId = nextActId('stage');
            openStages.add(stageId);
            emit({
              type: 'Act',
              id: stageId,
              act: 'stage',
              label: `▶ ${subagentType ?? '子 agent'}`,
            });
          } else {
            const toolActId = nextActId('tool');
            toolActForCall.set(tc.id, toolActId);
            emit({ type: 'Act', id: toolActId, act: 'tool', label: tc.name });
            emit({ type: 'ActTool', id: toolActId, args: tc.args ?? {} });
          }
        }
      }
    } else if (type === 'tool') {
      // 4. 工具结果(ToolMessage)→ ActResult + ActEnd。
      //    注意:task 工具的 ToolMessage 不在 streamMode:'messages' 流里
      //    (subagent.invoke 阻塞,ToolMessage 走 Command 内部状态,不触发流事件)。
      //    所以这里只处理普通工具结果;stage 关闭靠「下一个 task 调用」+ finish()。
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
      }
    }
  };

  const finish = (): void => {
    for (const id of thinkForMsg.values()) {
      emit({ type: 'ActEnd', id, status: 'ok' });
    }
    for (const id of contentForMsg.values()) {
      emit({ type: 'ActEnd', id, status: 'ok' });
    }
    closeOpenStages();
  };

  return { feed, finish };
}

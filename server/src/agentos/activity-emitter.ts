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
  /** tool_call_id → 累积的 args JSON 片段(流式 provider 分片到达时拼起来)。 */
  const toolArgsBuf = new Map<string, string>();
  /** tool_call_id → 初始 tool_calls[0].args 兜底(非流式 provider 没 chunks)。 */
  const toolArgsFallback = new Map<string, unknown>();
  /** 消息内 tool_call index → tool_call_id(流式后续分片只带 index,需映射回 id)。 */
  const chunkIndexToId = new Map<string, string>();
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
      tool_call_chunks?: Array<{
        index?: number;
        id?: string;
        name?: string;
        args?: string;
      }>;
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
      //    普通 tool:这里只开 Act(让 UI 立即看到"工具运行中"),ActTool(args)
      //    延后到 ToolMessage 到达时 emit —— 流式 provider 的 args 分片到那时才累积完整。
      //    累积发生在下方 tool_call_chunks 处理,这里只登记 id/actId。
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
            // 兜底:若 provider 一次性给了完整 args(无流式分片),用它。
            if (tc.args && typeof tc.args === 'object') {
              toolArgsFallback.set(tc.id, tc.args);
            }
            // ActTool(args) 延后到 tool result 时 emit
          }
        }
      }

      // 4. tool_call_chunks → 累积 args 片段(流式 provider 把单个 tool_call
      //    的 args JSON 拆成多片到达,这里按 id 拼接)。和 tool_calls 处理独立,
      //    后续 chunk 可能只带 tool_call_chunks 不带 tool_calls。
      //    后续分片只带 index 不带 id,所以要先建 index→id 映射。
      if (Array.isArray(msg.tool_call_chunks)) {
        for (const c of msg.tool_call_chunks) {
          // 先用 (msgId, index) 解析出真实 id:若 chunk 自带 id 用之,否则查映射
          let id = c.id;
          if (!id && typeof c.index === 'number') {
            const key = `${msgId}:${c.index}`;
            id = chunkIndexToId.get(key);
          } else if (id && typeof c.index === 'number') {
            // 首片带 id+index,建映射给后续只带 index 的分片用
            chunkIndexToId.set(`${msgId}:${c.index}`, id);
          }
          if (!id) continue;
          if (typeof c.args === 'string' && c.args) {
            toolArgsBuf.set(id, (toolArgsBuf.get(id) ?? '') + c.args);
          }
        }
      }
    } else if (type === 'tool') {
      // 5. 工具结果(ToolMessage)→ ActTool + ActResult + ActEnd。
      //    ActTool 延后到这里 emit:此时流式 provider 的 args 片段已累积完整,
      //    可解析出真实 args(修「流式 provider 永远 emit 空 args」bug)。
      //    注意:task 工具的 ToolMessage 不在 streamMode:'messages' 流里
      //    (subagent.invoke 阻塞,ToolMessage 走 Command 内部状态,不触发流事件)。
      //    所以这里只处理普通工具结果;stage 关闭靠「下一个 task 调用」+ finish()。
      const toolActId = msg.tool_call_id
        ? toolActForCall.get(msg.tool_call_id)
        : undefined;
      if (toolActId) {
        // 解析 args:优先累积 buffer;空则回退到初始 tool_calls.args(非流式 provider)
        const callId = msg.tool_call_id!;
        const buf = toolArgsBuf.get(callId);
        let args: unknown = toolArgsFallback.get(callId) ?? {};
        if (buf) {
          try {
            args = JSON.parse(buf);
          } catch {
            /* JSON 不完整,保留 fallback */
          }
        }
        emit({ type: 'ActTool', id: toolActId, args });

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

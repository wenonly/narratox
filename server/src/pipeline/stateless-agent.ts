import type { ActivityEvent } from './activity.types';
import { nextActId } from './activity.types';

/**
 * 无状态专家 agent(spec §3.2)。每次 run:Composer 拼 system → 单次有界工具循环 →
 * 逐块产出扁平活动事件。userId/novelId 闭包/入参注入(防越权)。无持久化线程、无握手、
 * 用完即弃 —— DB 是它的记忆。
 */
export interface AgentRunContext {
  userId: string;
  novelId: string;
  input: Record<string, unknown>;
}

export interface StatelessAgent {
  name: string;
  run(ctx: AgentRunContext): AsyncGenerator<ActivityEvent>;
}

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
      const reasoning =
        typeof reasoningRaw === 'string'
          ? reasoningRaw
          : reasoningRaw && typeof reasoningRaw === 'object'
            ? String((reasoningRaw as { content?: unknown }).content ?? '')
            : '';
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

/**
 * 单次有界工具循环(spec §2)。createReactAgent **不带 checkpointer**(Task 0 spike 证实可行):
 * 不传 thread_id,工具循环跑完即弃。逐块经 createActivityEmitter 翻译成扁平活动事件并 yield。
 */
export async function* runToolLoop(opts: {
  model: unknown;
  system: string;
  user: string;
  tools: unknown[];
  agentName?: string;
}): AsyncGenerator<ActivityEvent> {
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const agent = createReactAgent({
    llm: opts.model as never,
    name: opts.agentName ?? 'specialist',
    tools: opts.tools as never,
    prompt: opts.system,
  });

  const stream = (await agent.stream(
    { messages: [{ role: 'user', content: opts.user }] },
    { streamMode: 'messages' },
  )) as AsyncIterable<unknown>;

  // emitter 通过 buffer 回调收集;每块处理完把 buffer 里的事件逐个 yield。
  const buffer: ActivityEvent[] = [];
  const em = createActivityEmitter((ev) => buffer.push(ev));
  for await (const chunk of stream) {
    buffer.length = 0;
    em.feed(chunk);
    for (const ev of buffer) yield ev;
  }
  buffer.length = 0;
  em.finish();
  for (const ev of buffer) yield ev;
}

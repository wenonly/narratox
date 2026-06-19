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
 * 单次有界工具循环(spec §2)。createReactAgent **不带 checkpointer**(Task 0 spike 证实可行):
 * 不传 thread_id,工具循环跑完即弃。逐块把消息流翻译成扁平活动事件:
 *  - reasoning_content(思考 token)→ think 条目(消除卡顿的关键:思考阶段实时显示)
 *  - content(正文)→ content 条目
 *  - tool_call → tool 条目(Act + ActTool,带工具名/参数)
 *  - tool 结果(ToolMessage)→ ActResult + ActEnd
 *
 * think/content 按【消息 id】分组(同一轮 LLM 生成的 chunk 共享 id);tool 按 tool_call_id 分组。
 */
export async function* runToolLoop(opts: {
  model: unknown;
  system: string;
  user: string;
  tools: unknown[];
  /** 仅供测试替换模型创建;生产留空。 */
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

  // 按【消息 id】维护 think / content 条目;按 tool_call_id 维护 tool 条目。
  const thinkForMsg = new Map<string, string>();
  const contentForMsg = new Map<string, string>();
  const toolActForCall = new Map<string, string>();
  const seenToolCall = new Set<string>();
  let msgCounter = 0;

  for await (const chunk of stream) {
    const tuple = Array.isArray(chunk) ? chunk : [chunk, undefined];
    const msg = tuple[0] as {
      id?: string;
      _getType?: () => string;
      content?: unknown;
      name?: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
      additional_kwargs?: { reasoning_content?: unknown };
    };
    if (!msg || typeof msg._getType !== 'function') continue;

    const type = msg._getType();
    const msgId = msg.id ?? `msg-${msgCounter++}`;

    if (type === 'ai') {
      // 1. reasoning_content(GLM 思考 token)→ think 条目。
      const reasoningRaw = msg.additional_kwargs?.reasoning_content;
      const reasoning =
        typeof reasoningRaw === 'string'
          ? reasoningRaw
          : reasoningRaw && typeof reasoningRaw === 'object'
            ? String(
                (reasoningRaw as { content?: unknown }).content ?? '',
              )
            : '';
      if (reasoning) {
        let thinkId = thinkForMsg.get(msgId);
        if (!thinkId) {
          thinkId = nextActId('think');
          thinkForMsg.set(msgId, thinkId);
          yield { type: 'Act', id: thinkId, act: 'think', label: '思考' };
        }
        yield { type: 'ActDelta', id: thinkId, text: reasoning };
      }

      // 2. content(正文)→ content 条目。
      const content =
        typeof msg.content === 'string' ? msg.content : '';
      if (content) {
        let contentId = contentForMsg.get(msgId);
        if (!contentId) {
          contentId = nextActId('content');
          contentForMsg.set(msgId, contentId);
          yield { type: 'Act', id: contentId, act: 'content' };
        }
        yield { type: 'ActDelta', id: contentId, text: content };
      }

      // 3. tool_calls → tool 条目(Act + ActTool)。同一 tool_call_id 只开一次。
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const callId = tc.id ?? `${tc.name ?? 'tool'}-${msgCounter++}`;
          if (!tc.id) continue; // 无 id 的工具调用无法配对结果,跳过
          if (seenToolCall.has(callId)) continue;
          seenToolCall.add(callId);
          const toolActId = nextActId('tool');
          toolActForCall.set(callId, toolActId);
          yield { type: 'Act', id: toolActId, act: 'tool', label: tc.name };
          yield { type: 'ActTool', id: toolActId, args: tc.args ?? {} };
        }
      }
    } else if (type === 'tool') {
      // 4. 工具结果(ToolMessage)→ ActResult + ActEnd。
      const callId = msg.tool_call_id;
      const toolActId = callId ? toolActForCall.get(callId) : undefined;
      if (toolActId) {
        let result: unknown = msg.content;
        if (typeof msg.content === 'string') {
          try {
            result = JSON.parse(msg.content);
          } catch {
            /* 非 JSON,保留原字符串 */
          }
        }
        yield { type: 'ActResult', id: toolActId, result };
        yield { type: 'ActEnd', id: toolActId, status: 'ok' };
      }
    }
  }

  // 收尾:为仍开着的 think/content 条目补 ActEnd(FE 据此标记完成)。
  for (const id of thinkForMsg.values()) {
    yield { type: 'ActEnd', id, status: 'ok' };
  }
  for (const id of contentForMsg.values()) {
    yield { type: 'ActEnd', id, status: 'ok' };
  }
}

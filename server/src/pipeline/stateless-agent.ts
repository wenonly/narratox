import type { ActivityEvent } from '../agentos/activity.types';
import { nextActId } from '../agentos/activity.types';
import { createActivityEmitter } from '../agentos/activity-emitter';

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

// createActivityEmitter / ActivityEmitter 已抽出到 src/agentos/activity-emitter.ts
// (Task 1: 拯救 activity 协议文件到 agentos/,pipeline/ 在 Task 6 删除)。此处仅保留
// StatelessAgent / AgentRunContext / runToolLoop —— pipeline/ 内部仍引用。
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

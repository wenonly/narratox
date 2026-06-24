import { RemoveMessage } from '@langchain/core/messages';

/** rewind 只需要的 graph 句柄子集(getState/updateState)。便于单测注入假 graph。 */
export interface RewindGraph {
  getState: (config: {
    configurable: Record<string, unknown>;
  }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
  updateState: (
    config: { configurable: Record<string, unknown> },
    values: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * 真回退的核心(纯逻辑,无 DI):在 thread state 里找到锚点 user 消息(langGraphId),
 * 把它及之后的消息全 RemoveMessage 删除,updateState 写一个「已删除」checkpoint。
 * 锚点不在 state(findIndex<0,可能已被摘要压缩)→ 跳过 updateState,返回 -1。
 * 锚点及之后都没有有效 id → 返回 0(不调 updateState)。否则返回删除条数。
 *
 * 抽自 DeepAgentService.rewind 以便单测(graph 句柄难构造);行为须与原内联实现逐字节等价。
 */
export async function applyRewind(
  graph: RewindGraph,
  threadId: string,
  langGraphId: string,
): Promise<number> {
  const state = await graph.getState({
    configurable: { thread_id: threadId },
  });
  const messages = state.values.messages ?? [];
  const idx = messages.findIndex((m) => m.id === langGraphId);
  if (idx < 0) return -1;
  // 只 Remove 当前 state 里确实存在的 id(删不存在的 id 会抛错)。
  const removes = messages
    .slice(idx)
    .filter((m) => typeof m.id === 'string')
    .map((m) => new RemoveMessage({ id: m.id as string }));
  if (removes.length === 0) return 0;
  await graph.updateState(
    { configurable: { thread_id: threadId } },
    { messages: removes },
  );
  return removes.length;
}

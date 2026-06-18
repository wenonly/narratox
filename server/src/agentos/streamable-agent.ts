/**
 * Shared shape of a LangGraph agent/swarm build artifact: anything that has
 * `.stream({ messages }, { configurable, streamMode })`. Used by both the
 * workspace swarm and (formerly) the creation agent. Lives here so it survives
 * the removal of creation-agent.service.ts — workspace-swarm imports it from
 * this module.
 */
export interface StreamableAgent {
  stream(
    input: { messages: Array<{ role: string; content: string }> },
    options: { configurable: Record<string, unknown>; streamMode: 'messages' },
  ): Promise<AsyncIterable<unknown>>;
}

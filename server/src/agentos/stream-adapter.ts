export type AgentosEvent =
  | 'RunStarted'
  | 'RunContent'
  | 'RunCompleted'
  | 'RunError';

export interface AgentosFrame {
  event: AgentosEvent;
  content?: string;
  agent_id?: string;
  session_id?: string;
  created_at: number;
}

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * 把 DeepAgent 的增量 token 流翻译成 AgentOS/AgentUI 期望的 RunResponseContent JSON 帧。
 * 关键约定：RunContent.content 必须是「累积全文」，因为 UI 用 chunk.content.replace(lastContent) 去重。
 */
export class StreamAdapter {
  async *toFrames(
    agentId: string,
    sessionId: string,
    deltas: AsyncIterable<string>,
  ): AsyncGenerator<AgentosFrame> {
    yield {
      event: 'RunStarted',
      agent_id: agentId,
      session_id: sessionId,
      created_at: now(),
    };

    let accumulated = '';
    for await (const delta of deltas) {
      accumulated += delta;
      yield { event: 'RunContent', content: accumulated, created_at: now() };
    }

    yield { event: 'RunCompleted', content: accumulated, created_at: now() };
  }
}

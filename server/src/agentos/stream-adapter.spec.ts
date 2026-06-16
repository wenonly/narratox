import { StreamAdapter, type AgentosFrame } from './stream-adapter';

async function* fromArray(arr: string[]): AsyncIterable<string> {
  for (const s of arr) yield s;
}

describe('StreamAdapter', () => {
  it('emits RunStarted first, then RunContent with accumulated content, then RunCompleted', async () => {
    const adapter = new StreamAdapter();
    const frames: AgentosFrame[] = [];
    for await (const f of adapter.toFrames('deep-agent', 'sess-1', fromArray(['He', 'llo']))) {
      frames.push(f);
    }
    expect(frames[0].event).toBe('RunStarted');
    expect(frames[0].session_id).toBe('sess-1');
    expect(frames[1]).toMatchObject({ event: 'RunContent', content: 'He' });
    expect(frames[2]).toMatchObject({ event: 'RunContent', content: 'Hello' });
    expect(frames[3]).toMatchObject({ event: 'RunCompleted', content: 'Hello' });
  });

  it('emits RunStarted + RunCompleted even with no deltas', async () => {
    const adapter = new StreamAdapter();
    const frames: AgentosFrame[] = [];
    for await (const f of adapter.toFrames('a', 's', fromArray([]))) frames.push(f);
    expect(frames.map((f) => f.event)).toEqual(['RunStarted', 'RunCompleted']);
    expect(frames[1].content).toBe('');
  });

  it('RunContent content is cumulative full text, not a delta', async () => {
    const adapter = new StreamAdapter();
    const frames: AgentosFrame[] = [];
    for await (const f of adapter.toFrames('a', 's', fromArray(['A', 'B', 'C']))) frames.push(f);
    expect(frames.map((f) => f.content)).toEqual([undefined, 'A', 'AB', 'ABC', 'ABC']);
  });
});

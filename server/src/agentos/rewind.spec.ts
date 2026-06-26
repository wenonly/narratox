import type { RewindGraph } from './rewind';
import { applyRewind } from './rewind';

const makeGraph = (
  messages: Array<{ id?: string }>,
): RewindGraph & {
  getState: jest.Mock;
  updateState: jest.Mock;
} => {
  const updateState = jest.fn(() => Promise.resolve());
  const getState = jest.fn(() => Promise.resolve({ values: { messages } }));
  return { getState, updateState };
};

describe('applyRewind', () => {
  it('removes the anchor and all later messages via updateState', async () => {
    const graph = makeGraph([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const removed = await applyRewind(graph, 'thread-1', 'b');
    expect(removed).toBe(2);
    expect(graph.updateState).toHaveBeenCalledTimes(1);
    const [config, values] = graph.updateState.mock.calls[0] as [
      { configurable: { thread_id: string } },
      { messages: Array<{ id?: string }> },
    ];
    expect(config).toEqual({ configurable: { thread_id: 'thread-1' } });
    const msgs = values.messages;
    expect(msgs.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('returns -1 and skips updateState when the anchor is not in state', async () => {
    const graph = makeGraph([{ id: 'a' }, { id: 'b' }]);
    const removed = await applyRewind(graph, 'thread-1', 'missing');
    expect(removed).toBe(-1);
    expect(graph.updateState).not.toHaveBeenCalled();
  });

  it('removes everything when the anchor is the first message', async () => {
    const graph = makeGraph([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const removed = await applyRewind(graph, 'thread-1', 'a');
    expect(removed).toBe(3);
    const values = (graph.updateState.mock.calls[0] as unknown[])[1] as {
      messages: Array<{ id?: string }>;
    };
    expect(values.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

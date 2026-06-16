import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { DeepAgentService } from './deep-agent.service';

describe('DeepAgentService', () => {
  describe('extractDelta', () => {
    const service = new DeepAgentService();
    const extract = (c: unknown) =>
      (service as unknown as { extractDelta: (c: unknown) => string }).extractDelta(c);

    it('reads .text from a [message, meta] tuple (messages streamMode shape)', () => {
      expect(extract([{ text: 'hi' }, {}])).toBe('hi');
    });

    it('reads string .content when .text is absent', () => {
      expect(extract({ content: 'yo' })).toBe('yo');
    });

    it('returns empty string for unrelated / empty chunks', () => {
      expect(extract([{ foo: 1 }, {}])).toBe('');
      expect(extract(undefined)).toBe('');
      expect(extract(null)).toBe('');
    });

    it('ignores the metadata element of the tuple (only chunk[0] is read)', () => {
      expect(extract([{ text: 'hi' }, { text: 'SHOULD-NOT-LEAK' }])).toBe('hi');
    });
  });

  describe('streamTurn', () => {
    it('calls agent.stream with the new user message + thread_id, yields non-empty deltas in order', async () => {
      const service = new DeepAgentService();
      const fakeStream = (async function* () {
        yield [{ text: 'He' }, {}];
        yield [{ foo: 'skip' }, {}]; // extractDelta -> ''
        yield [{ text: 'llo' }, {}];
      })();
      const stream = jest.fn(async () => fakeStream);
      (service as unknown as { agent: unknown }).agent = { stream };

      const out: string[] = [];
      for await (const d of service.streamTurn({ threadId: 'sess-1', userMessage: 'hi' })) {
        out.push(d);
      }

      // Only the NEW user message is passed; thread scopes the conversation.
      expect(stream).toHaveBeenCalledTimes(1);
      const [input, options] = stream.mock.calls[0];
      expect(input).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
      expect(options).toMatchObject({
        configurable: { thread_id: 'sess-1' },
        streamMode: 'messages',
      });
      expect(out).toEqual(['He', 'llo']);
    });
  });

  describe('buildAgent', () => {
    it('throws a clear error when ZHIPUAI_API_KEY is missing', async () => {
      const old = process.env.ZHIPUAI_API_KEY;
      delete process.env.ZHIPUAI_API_KEY;
      const service = new DeepAgentService();
      await expect(
        (service as unknown as { buildAgent: () => Promise<unknown> }).buildAgent(),
      ).rejects.toThrow(/ZHIPUAI_API_KEY/);
      if (old) process.env.ZHIPUAI_API_KEY = old;
    });

    it('passes the injected checkpointer through to createDeepAgent', async () => {
      // NOTE on test mechanics: deepagents & @langchain/openai are ESM-only. The plan's
      // original `jest.doMock` cannot mock native ESM modules — under
      // `--experimental-vm-modules` Jest needs `jest.unstable_mockModule` + a dynamic
      // import() of the module-under-test AFTER the mock is registered. ts-jest keeps
      // `await import(...)` as a native dynamic import (it does NOT down-compile to
      // require()), so this is the only mock API that reaches the service's internal
      // `await import('deepagents')`. The SERVICE design is unchanged:
      // `@Optional @Inject(CHECKPOINTER)`, `checkpointer ?? false`, dynamic import of
      // @langchain/openai/deepagents inside buildAgent. NODE_OPTIONS must include
      // --experimental-vm-modules (set in package.json `test` script).
      const oldKey = process.env.ZHIPUAI_API_KEY;
      process.env.ZHIPUAI_API_KEY = 'fake-key';
      const captured: { checkpointer?: unknown } = {};
      jest.resetModules();
      jest.unstable_mockModule('@langchain/openai', () => ({
        ChatOpenAI: class {
          constructor() {}
        },
      }));
      jest.unstable_mockModule('deepagents', () => ({
        createDeepAgent: (params: { checkpointer?: unknown }) => {
          captured.checkpointer = params.checkpointer;
          return { stream: () => async function* () {} };
        },
      }));
      try {
        const { DeepAgentService: FreshService } = await import('./deep-agent.service');
        const fakeSaver = { _isSaver: true } as unknown as BaseCheckpointSaver;
        const service = new FreshService(fakeSaver);
        await (service as unknown as { buildAgent: () => Promise<unknown> }).buildAgent();
        expect(captured.checkpointer).toBe(fakeSaver);
      } finally {
        jest.restoreAllMocks();
        jest.resetModules();
        if (oldKey) process.env.ZHIPUAI_API_KEY = oldKey;
        else delete process.env.ZHIPUAI_API_KEY;
      }
    });
  });
});

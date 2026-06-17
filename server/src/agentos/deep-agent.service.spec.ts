import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { DeepAgentService } from './deep-agent.service';

/**
 * jest.unstable_mockModule is the ESM mock API Jest needs under
 * --experimental-vm-modules, but it isn't in @types/jest (only the CJS
 * jest.mock is). Bind a typed alias once so both the type-checker and the
 * runtime are happy. (ts-jest still executes this spec normally.)
 */
type UnstableMockModule = (
  path: string,
  factory: () => Record<string, unknown>,
) => void;
const unstableMockModule: UnstableMockModule = (
  jest as unknown as {
    unstable_mockModule: UnstableMockModule;
  }
).unstable_mockModule.bind(jest) as UnstableMockModule;

describe('DeepAgentService', () => {
  describe('extractDelta', () => {
    const service = new DeepAgentService();
    const extract = (c: unknown) =>
      (
        service as unknown as { extractDelta: (c: unknown) => string }
      ).extractDelta(c);

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
        // `await` below is a no-op: keeps this async generator's runtime
        // behavior identical (it still only yields chunks) while satisfying
        // @typescript-eslint/require-await, which otherwise flags async
        // generators that contain no await expression.
        await Promise.resolve();
      })();
      // Type the mock's call signature so mock.calls[0] is a typed tuple
      // (not `[]`), letting us destructure the recorded (input, options).
      type StreamArgs = [
        { messages: Array<{ role: string; content: string }> },
        { configurable: Record<string, unknown>; streamMode: string },
      ];
      // The implementation ignores its args (it returns a canned stream); the
      // `as unknown as jest.Mock<...>` cast is what types the recorded calls.
      // Two-step cast (`unknown` first) because the mock's inferred `[]` params
      // don't overlap the 2-tuple StreamArgs.
      const stream = jest.fn(() =>
        Promise.resolve(fakeStream),
      ) as unknown as jest.Mock<Promise<typeof fakeStream>, StreamArgs>;
      (
        service as unknown as {
          agents: Map<string, { stream: typeof stream }>;
        }
      ).agents.set('PROMPT-X', { stream });

      const out: string[] = [];
      for await (const d of service.streamTurn({
        threadId: 'sess-1',
        userMessage: 'hi',
        systemPrompt: 'PROMPT-X',
      })) {
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
        (
          service as unknown as { buildAgent: (p: string) => Promise<unknown> }
        ).buildAgent('PROMPT-Y'),
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
      unstableMockModule('@langchain/openai', () => ({
        ChatOpenAI: class {
          constructor() {}
        },
      }));
      unstableMockModule('deepagents', () => ({
        createDeepAgent: (params: { checkpointer?: unknown }) => {
          captured.checkpointer = params.checkpointer;
          return { stream: () => async function* () {} };
        },
      }));
      try {
        // Dynamic import of the module-under-test AFTER the ESM mocks above are
        // registered, so buildAgent's internal `await import('deepagents')` /
        // `await import('@langchain/openai')` pick up the fakes.
        //
        // Residual tsc note: under `tsc --noEmit` (moduleResolution: nodenext)
        // a relative dynamic import wants an explicit `.js` extension, but
        // jest-resolve / ts-jest at runtime only resolve the BARE specifier —
        // the `.js` form breaks the test. We keep the bare specifier (tests must
        // stay green) and suppress the one nodenext resolution error here.
        // ts-jest resolves './deep-agent.service' to this very source file.
        //
        // @ts-expect-error: nodenext wants '.js' suffix; jest can't resolve it. ts-jest provides this module at runtime.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- mod is narrowed by the cast below; eslint can't resolve the dynamic specifier but ts-jest provides it at runtime.
        const mod = await import('./deep-agent.service');
        const FreshService = (
          mod as {
            DeepAgentService: typeof DeepAgentService;
          }
        ).DeepAgentService;
        const fakeSaver = { _isSaver: true } as unknown as BaseCheckpointSaver;
        const service = new FreshService(fakeSaver);
        await (
          service as unknown as { buildAgent: (p: string) => Promise<unknown> }
        ).buildAgent('PROMPT-Y');
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

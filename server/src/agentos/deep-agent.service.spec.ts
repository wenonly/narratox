import { DeepAgentService } from './deep-agent.service';

describe('DeepAgentService', () => {
  describe('extractDelta', () => {
    const service = new DeepAgentService();

    it('reads .text from a [message, meta] tuple (messages streamMode shape)', () => {
      expect(service.extractDelta([{ text: 'hi' }, {}])).toBe('hi');
    });

    it('reads string .content when .text is absent', () => {
      expect(service.extractDelta({ content: 'yo' })).toBe('yo');
    });

    it('returns empty string for unrelated / empty chunks', () => {
      expect(service.extractDelta([{ foo: 1 }, {}])).toBe('');
      expect(service.extractDelta(undefined)).toBe('');
      expect(service.extractDelta(null)).toBe('');
    });
  });

  describe('streamDeltas', () => {
    it('yields non-empty deltas in order, skipping empty ones', async () => {
      const service = new DeepAgentService();
      const fakeStream = (async function* () {
        yield [{ text: 'He' }, {}];
        yield [{ foo: 'skip' }, {}]; // extractDelta -> ''
        yield [{ text: 'llo' }, {}];
      })();
      (service as unknown as { agent: unknown }).agent = {
        stream: async () => fakeStream,
      };

      const out: string[] = [];
      for await (const d of service.streamDeltas('hi')) out.push(d);
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
  });
});

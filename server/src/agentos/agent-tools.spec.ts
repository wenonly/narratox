import { extractDelta } from './agent-tools';

describe('extractDelta', () => {
  const extract = (c: unknown) => extractDelta(c);

  it('reads .text from a [message, metadata] tuple (messages streamMode shape)', () => {
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

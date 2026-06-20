import { parseReadingChapterOrder } from './reading-chapter';

describe('parseReadingChapterOrder', () => {
  it('parses a numeric string', () => {
    expect(parseReadingChapterOrder('3')).toBe(3);
  });

  it('returns null for empty string', () => {
    expect(parseReadingChapterOrder('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseReadingChapterOrder(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(parseReadingChapterOrder('abc')).toBeNull();
  });

  it('returns null for non-positive integers', () => {
    expect(parseReadingChapterOrder('0')).toBeNull();
    expect(parseReadingChapterOrder('-1')).toBeNull();
  });
});

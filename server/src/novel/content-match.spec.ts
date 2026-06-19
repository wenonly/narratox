import { findContentRange, countMatches } from './content-match'

describe('findContentRange', () => {
  it('exact match returns the range', () => {
    expect(findContentRange('hello world', 'world')).toEqual({ start: 6, end: 11 })
  })

  it('normalizes whitespace differences (extra spaces / newlines)', () => {
    const content = '少年  站在\n\n山崖上' // 双空格 + 双换行
    const r = findContentRange(content, '少年 站在 山崖上') // find 用单空格
    expect(r).not.toBeNull()
    // 命中映射回【整个原文区间】(含内部多余空白)
    expect(content.slice(r!.start, r!.end)).toBe('少年  站在\n\n山崖上')
  })

  it('preserves surrounding text (only the matched span is addressed)', () => {
    const content = '前文 少年 走 后文'
    const r = findContentRange(content, '少年 走')!
    expect(content.slice(0, r.start) + 'X' + content.slice(r.end)).toBe('前文 X 后文')
  })

  it('returns null when not found', () => {
    expect(findContentRange('hello', 'xyz')).toBeNull()
  })

  it('returns the FIRST match when multiple', () => {
    expect(findContentRange('a a a', 'a')).toEqual({ start: 0, end: 1 })
  })

  it('returns null for empty find', () => {
    expect(findContentRange('hello', '')).toBeNull()
  })
})

describe('countMatches', () => {
  it('counts exact occurrences', () => {
    expect(countMatches('a a a', 'a')).toBe(3)
  })
  it('0 when not found', () => {
    expect(countMatches('hello', 'x')).toBe(0)
  })
  it('0 for empty find', () => {
    expect(countMatches('hello', '')).toBe(0)
  })
})

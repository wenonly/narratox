import { buildForeSlice } from './fore-slice';

describe('buildForeSlice', () => {
  it('空返 ""', () => {
    expect(buildForeSlice([])).toBe('');
  });

  it('格式化 + 早→晚(listRecent 返 desc,reverse)', () => {
    const s = buildForeSlice([
      { chapterOrder: 2, summary: '觉醒' },
      { chapterOrder: 1, summary: '下山' },
    ]);
    expect(s).toBe('【前情】第1章:下山 / 第2章:觉醒');
  });
});

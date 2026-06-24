import { makeReportCharacterReviewTool } from './report-character-review.tool';

describe('report_character_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportCharacterReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 68,
      dimensions: [
        { name: '区分度', status: 'pass' },
        {
          name: '弧光可行性',
          status: 'issue',
          issue: '主角弧光与大纲卷3走向冲突',
        },
      ],
      blockingIssues: ['主角「沈砚」弧光目标与大纲冲突,需改 arcGoal'],
      notes: '语言风格可更区分',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 68 });
    expect(out.blockingIssues).toEqual([
      '主角「沈砚」弧光目标与大纲冲突,需改 arcGoal',
    ]);
    expect(out.dimensions).toHaveLength(2);
    expect(out.dimensions[1].issue).toBe('主角弧光与大纲卷3走向冲突');
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportCharacterReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 88,
      dimensions: [{ name: '区分度', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});

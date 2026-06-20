import { makeReportReviewTool } from './report-review.tool';

describe('report_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 72,
      dimensions: [
        { name: '人物一致', status: 'pass' },
        { name: '战力', status: 'issue', issue: '主角金丹期却打赢元婴' },
      ],
      blockingIssues: ['主角金丹期却打赢元婴,崩战力'],
      notes: '文风略碎',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 72 });
    expect(out.blockingIssues).toEqual(['主角金丹期却打赢元婴,崩战力']);
    expect(out.dimensions).toHaveLength(2);
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 90,
      dimensions: [{ name: '人物一致', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});

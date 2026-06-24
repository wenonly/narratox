import { makeReportWorldviewReviewTool } from './report-worldview-review.tool';

describe('report_worldview_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportWorldviewReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 72,
      dimensions: [
        { name: '逻辑自洽', status: 'pass' },
        { name: '力量体系金手指严谨', status: 'issue', issue: '未说明每级差异' },
      ],
      blockingIssues: ['powerSystem『灵气修炼』未说明每级差异'],
      notes: '概念略堆砌',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 72 });
    expect(out.blockingIssues).toEqual([
      'powerSystem『灵气修炼』未说明每级差异',
    ]);
    expect(out.dimensions).toHaveLength(2);
    expect(out.dimensions[1].issue).toBe('未说明每级差异');
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportWorldviewReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 88,
      dimensions: [{ name: '逻辑自洽', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});

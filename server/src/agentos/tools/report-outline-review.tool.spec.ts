import { makeReportOutlineReviewTool } from './report-outline-review.tool';

describe('report_outline_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportOutlineReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 72,
      dimensions: [
        { name: '主线暗线结构', status: 'pass' },
        {
          name: '伏笔布局衔接一致性',
          status: 'issue',
          issue: '卷2与卷1 synopsis 断层',
        },
      ],
      blockingIssues: ['卷2『药老复苏』与卷1 synopsis 断层'],
      notes: '卷间节奏略快',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 72 });
    expect(out.blockingIssues).toEqual([
      '卷2『药老复苏』与卷1 synopsis 断层',
    ]);
    expect(out.dimensions).toHaveLength(2);
    expect(out.dimensions[1].issue).toBe('卷2与卷1 synopsis 断层');
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportOutlineReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 88,
      dimensions: [{ name: '故事核匹配', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});

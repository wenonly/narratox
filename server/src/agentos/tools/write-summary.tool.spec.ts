import { makeWriteSummaryTool } from './write-summary.tool';

const okChapter = { id: 'c1' };

const baseDeps = () => ({
  chapters: { findByOrder: jest.fn().mockResolvedValue(okChapter) },
  summaries: { upsert: jest.fn().mockResolvedValue(undefined) },
  events: {
    createHooks: jest.fn().mockResolvedValue(undefined),
    advanceHooks: jest.fn().mockResolvedValue(undefined),
    resolveHooks: jest.fn().mockResolvedValue(undefined),
    markCore: jest.fn().mockResolvedValue(undefined),
  },
  characters: { recordChanges: jest.fn().mockResolvedValue(undefined) },
  eventService: { createEvents: jest.fn().mockResolvedValue({ count: 1 }) },
  arcService: { updateProgressSummary: jest.fn().mockResolvedValue(undefined) },
});

describe('write_summary tool — plotEvents(Phase 11)', () => {
  it('plotEvents 传入 → eventService.createEvents 被调', async () => {
    const d = baseDeps();
    const t = makeWriteSummaryTool({
      userId: 'u1',
      novelId: 'n1',
      ...(d as any),
    });
    const out: any = await t.invoke({
      chapterOrder: 12,
      summary: '发现血书',
      roleChanges: [],
      entities: [],
      newHooks: [],
      advancedHookIds: [],
      resolvedHookIds: [],
      coreHookIds: [],
      plotEvents: [
        {
          description: '发现血书',
          significance: 'MAJOR',
          involvedCharacters: ['沈砚'],
        },
      ],
    });
    expect(out).toMatchObject({ ok: true, chapterOrder: 12 });
    expect(d.eventService.createEvents).toHaveBeenCalledWith(
      'u1',
      'n1',
      expect.any(Array),
      12,
    );
  });

  it('plotEvents 不传 → eventService.createEvents 不调', async () => {
    const d = baseDeps();
    const t = makeWriteSummaryTool({
      userId: 'u1',
      novelId: 'n1',
      ...(d as any),
    });
    await t.invoke({
      chapterOrder: 1,
      summary: 's',
      roleChanges: [],
      entities: [],
      newHooks: [],
      advancedHookIds: [],
      resolvedHookIds: [],
      coreHookIds: [],
    });
    expect(d.eventService.createEvents).not.toHaveBeenCalled();
  });

  it('currentArcSummary/currentVolumeArcSummary 传 → arcService.updateProgressSummary 按本章调', async () => {
    const d = baseDeps();
    const t = makeWriteSummaryTool({
      userId: 'u1',
      novelId: 'n1',
      ...(d as any),
    });
    await t.invoke({
      chapterOrder: 12,
      summary: 's',
      roleChanges: [],
      entities: [],
      newHooks: [],
      advancedHookIds: [],
      resolvedHookIds: [],
      coreHookIds: [],
      currentArcSummary: '弧进展',
      currentVolumeArcSummary: '卷进展',
    });
    expect(d.arcService.updateProgressSummary).toHaveBeenCalledWith(
      'u1',
      'n1',
      12,
      '弧进展',
      '卷进展',
    );
  });
});

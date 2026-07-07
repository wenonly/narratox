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
  // $transaction mock:直接跑回调(传空 tx);回调抛错则 rethrow → tool try/catch 捕获。
  // 真 DB 回滚靠 prisma $transaction 语义(集成测试覆盖),此处验证 tool 层事务包裹 + 错误传播。
  prisma: {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb({})),
  },
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
      expect.anything(), // tx(事务 client)
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
      expect.anything(), // tx
    );
  });

  it('事务原子性:某步抛错 → ok:false(transaction_failed)+ 后续步骤不调', async () => {
    const d = baseDeps();
    d.events.createHooks.mockRejectedValueOnce(new Error('DB down'));
    const t = makeWriteSummaryTool({
      userId: 'u1',
      novelId: 'n1',
      ...(d as any),
    });
    const out: any = await t.invoke({
      chapterOrder: 5,
      summary: 's',
      roleChanges: [],
      entities: [],
      newHooks: [{ description: 'h', payoffTiming: 'NEAR_TERM' }],
      advancedHookIds: [],
      resolvedHookIds: [],
      coreHookIds: [],
    });
    expect(out).toMatchObject({
      ok: false,
      chapterOrder: 5,
      reason: 'transaction_failed',
    });
    expect(out.error).toBe('DB down');
    // createHooks 之前的 summaries.upsert 已调;之后的 createEvents 因回调中断未被调。
    expect(d.summaries.upsert).toHaveBeenCalledTimes(1);
    expect(d.eventService.createEvents).not.toHaveBeenCalled();
  });
});

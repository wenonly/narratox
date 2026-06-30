import { makeSetArcTool } from './set-arc.tool';

describe('set_arc tool(Phase 12)', () => {
  it('volumeOrder 传入 → outlines.findVolumeByOrder 解析 + arcs.upsertArc 带 volumeId', async () => {
    const outlines = {
      findVolumeByOrder: jest.fn().mockResolvedValue({ id: 'v1' }),
    };
    const arcs = {
      upsertArc: jest.fn().mockResolvedValue({ id: 'a1', order: 2 }),
    };
    const t = makeSetArcTool({
      userId: 'u1',
      novelId: 'n1',
      outlines: outlines as any,
      arcs: arcs as any,
    });
    const out: any = await t.invoke({
      order: 2,
      volumeOrder: 1,
      title: '拜师',
      goal: '得真传',
      fromChapter: 9,
      toChapter: 15,
    });
    expect(out).toMatchObject({ ok: true, order: 2 });
    expect(outlines.findVolumeByOrder).toHaveBeenCalledWith('u1', 'n1', 1);
    expect(arcs.upsertArc).toHaveBeenCalledWith(
      'u1',
      'n1',
      expect.objectContaining({
        order: 2,
        volumeId: 'v1',
        fromChapter: 9,
        toChapter: 15,
      }),
    );
  });

  it('不传 volumeOrder → volumeId undefined', async () => {
    const outlines = { findVolumeByOrder: jest.fn() };
    const arcs = { upsertArc: jest.fn().mockResolvedValue({ id: 'a2' }) };
    const t = makeSetArcTool({
      userId: 'u1',
      novelId: 'n1',
      outlines: outlines as any,
      arcs: arcs as any,
    });
    await t.invoke({ order: 1, title: '入世', fromChapter: 1, toChapter: 8 });
    expect(outlines.findVolumeByOrder).not.toHaveBeenCalled();
    expect(arcs.upsertArc).toHaveBeenCalledWith(
      'u1',
      'n1',
      expect.objectContaining({ volumeId: undefined }),
    );
  });
});

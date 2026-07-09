import { makeDeleteVolumeTool } from './delete-volume.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('delete_volume tool', () => {
  it('cascade 未传 → 默认 false', async () => {
    const deleteVolume = jest.fn().mockResolvedValue({
      ok: false,
      error: 'HAS_DESCENDANTS',
      arcs: 1,
      chapterPlans: 2,
      hint: 'x',
    });
    const outlines = { deleteVolume } as unknown as OutlineService;
    const t = makeDeleteVolumeTool({ userId: 'u1', novelId: 'n1', outlines });
    await t.invoke({ order: 1 });
    expect(deleteVolume).toHaveBeenCalledWith('u1', 'n1', 1, false);
  });

  it('cascade=true 透传', async () => {
    const deleteVolume = jest.fn().mockResolvedValue({
      ok: true,
      order: 1,
      deletedArcs: 2,
      deletedChapterPlans: 5,
    });
    const outlines = { deleteVolume } as unknown as OutlineService;
    const t = makeDeleteVolumeTool({ userId: 'u1', novelId: 'n1', outlines });
    const out: any = await t.invoke({ order: 1, cascade: true });
    expect(deleteVolume).toHaveBeenCalledWith('u1', 'n1', 1, true);
    expect(out.deletedArcs).toBe(2);
  });
});

import { makeSetChapterPlanTool } from './set-chapter-plan.tool';
import type { OutlineService } from '../../novel/outline.service';

const NODE = { subject: '少年', action: '夺', target: '妖刀' };

describe('set_chapter_plan tool', () => {
  it('upserts a chapter plan, resolving volumeOrder to volumeId', async () => {
    const findVolumeByOrder = jest.fn().mockResolvedValue({ id: 'v1' });
    const upsertChapterPlan = jest.fn().mockResolvedValue({ id: 'o3' });
    const outlines = {
      findVolumeByOrder,
      upsertChapterPlan,
    } as unknown as OutlineService;
    const t = makeSetChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });

    const out = await t.invoke({
      chapterOrder: 3,
      title: '夺刀',
      cbn: NODE,
      cpns: [NODE],
      cen: NODE,
      mustCover: ['妖刀认主'],
      forbidden: ['不可露身世'],
      volumeOrder: 1,
    });

    expect(findVolumeByOrder).toHaveBeenCalledWith('u1', 'n1', 1);
    expect(upsertChapterPlan).toHaveBeenCalledWith(
      'u1',
      'n1',
      3,
      expect.objectContaining({
        title: '夺刀',
        cbn: NODE,
        volumeId: 'v1',
      }),
    );
    expect(out).toMatchObject({ ok: true, chapterOrder: 3 });
  });

  it('omits volumeId when volumeOrder is not provided', async () => {
    const findVolumeByOrder = jest.fn();
    const upsertChapterPlan = jest.fn().mockResolvedValue({ id: 'o1' });
    const outlines = {
      findVolumeByOrder,
      upsertChapterPlan,
    } as unknown as OutlineService;
    const t = makeSetChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });

    await t.invoke({ chapterOrder: 1, cbn: NODE, cpns: [NODE], cen: NODE });

    expect(findVolumeByOrder).not.toHaveBeenCalled();
    expect(upsertChapterPlan).toHaveBeenCalledWith(
      'u1',
      'n1',
      1,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.not.objectContaining({ volumeId: expect.anything() }),
    );
  });
});

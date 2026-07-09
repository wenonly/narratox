import { makeDeleteChapterPlanTool } from './delete-chapter-plan.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('delete_chapter_plan tool', () => {
  it('转发给 OutlineService.deleteChapterPlan 带 userId/novelId', async () => {
    const deleteChapterPlan = jest.fn().mockResolvedValue({
      ok: true,
      chapterOrder: 5,
      warned: false,
    });
    const outlines = { deleteChapterPlan } as unknown as OutlineService;
    const t = makeDeleteChapterPlanTool({
      userId: 'u1',
      novelId: 'n1',
      outlines,
    });
    const out = await t.invoke({ chapterOrder: 5 });
    expect(deleteChapterPlan).toHaveBeenCalledWith('u1', 'n1', 5);
    expect(out).toMatchObject({ ok: true, chapterOrder: 5 });
  });

  it('WRITTEN 细纲透传 warned=true', async () => {
    const deleteChapterPlan = jest.fn().mockResolvedValue({
      ok: true,
      chapterOrder: 3,
      warned: true,
      reason: '本章已写',
    });
    const outlines = { deleteChapterPlan } as unknown as OutlineService;
    const t = makeDeleteChapterPlanTool({
      userId: 'u1',
      novelId: 'n1',
      outlines,
    });
    const out: any = await t.invoke({ chapterOrder: 3 });
    expect(out.warned).toBe(true);
  });
});

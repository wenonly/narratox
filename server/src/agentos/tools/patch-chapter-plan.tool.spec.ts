import { makePatchChapterPlanTool } from './patch-chapter-plan.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('patch_chapter_plan tool', () => {
  it('剥出 chapterOrder,把剩余 patch 透传给 service', async () => {
    const patchChapterPlan = jest.fn().mockResolvedValue({
      ok: true,
      chapterOrder: 5,
      updatedFields: ['cen'],
    });
    const outlines = { patchChapterPlan } as unknown as OutlineService;
    const t = makePatchChapterPlanTool({
      userId: 'u1',
      novelId: 'n1',
      outlines,
    });
    const cen = { subject: '主角', action: '到达', target: '山门' };
    await t.invoke({ chapterOrder: 5, cen });
    expect(patchChapterPlan).toHaveBeenCalledWith('u1', 'n1', 5, { cen });
  });

  it('多字段同传', async () => {
    const patchChapterPlan = jest.fn().mockResolvedValue({
      ok: true,
      chapterOrder: 5,
      updatedFields: ['title', 'mustCover'],
    });
    const outlines = { patchChapterPlan } as unknown as OutlineService;
    const t = makePatchChapterPlanTool({
      userId: 'u1',
      novelId: 'n1',
      outlines,
    });
    await t.invoke({
      chapterOrder: 5,
      title: '新标题',
      mustCover: ['点A', '点B'],
    });
    expect(patchChapterPlan).toHaveBeenCalledWith('u1', 'n1', 5, {
      title: '新标题',
      mustCover: ['点A', '点B'],
    });
  });
});

import { makeGetChapterPlanTool } from './get-chapter-plan.tool';
import type { OutlineService } from '../../novel/outline.service';

const PLAN = {
  id: 'o3',
  chapterOrder: 3,
  title: '夺刀',
  cbn: { subject: '少年', action: '到', target: '铁铺' },
  cpns: [{ subject: '少年', action: '夺', target: '妖刀' }],
  cen: { subject: '少年', action: '逃', target: '夜' },
  mustCover: ['妖刀认主'],
  forbidden: ['不可露身世'],
  status: 'DRAFT',
};

describe('get_chapter_plan tool', () => {
  it('returns the chapter plan nodes when it exists', async () => {
    const getChapterPlan = jest.fn().mockResolvedValue(PLAN);
    const outlines = { getChapterPlan } as unknown as OutlineService;
    const t = makeGetChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });
    const out = await t.invoke({ chapterOrder: 3 });
    expect(getChapterPlan).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toMatchObject({ ok: true, chapterOrder: 3 });
    expect(out).toMatchObject({
      cbn: PLAN.cbn,
      cpns: PLAN.cpns,
      cen: PLAN.cen,
      mustCover: PLAN.mustCover,
      forbidden: PLAN.forbidden,
    });
  });

  it('returns ok:false when no plan exists for the chapter', async () => {
    const getChapterPlan = jest.fn().mockResolvedValue(null);
    const outlines = { getChapterPlan } as unknown as OutlineService;
    const t = makeGetChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });
    const out = await t.invoke({ chapterOrder: 9 });
    expect(out).toEqual({ ok: false, reason: 'no_plan', chapterOrder: 9 });
  });
});

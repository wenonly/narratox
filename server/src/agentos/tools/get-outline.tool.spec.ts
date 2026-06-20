import { makeGetOutlineTool } from './get-outline.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('get_outline tool', () => {
  it('returns volumes + chapter list + nextChapterOrder', async () => {
    const listOutline = jest.fn().mockResolvedValue({
      volumes: [
        { order: 1, title: '初入江湖', goal: '下山', synopsis: '梗概' },
      ],
      chapterOutlines: [
        { chapterOrder: 1, title: '下山', status: 'WRITTEN' },
        { chapterOrder: 2, title: '夜雨', status: 'DRAFT' },
      ],
    });
    const nextChapterOrder = jest.fn().mockResolvedValue(2);
    const outlines = {
      listOutline,
      nextChapterOrder,
    } as unknown as OutlineService;
    const t = makeGetOutlineTool({ userId: 'u1', novelId: 'n1', outlines });

    const out = await t.invoke({});

    expect(listOutline).toHaveBeenCalledWith('u1', 'n1');
    expect(nextChapterOrder).toHaveBeenCalledWith('u1', 'n1');
    expect(out.volumes).toEqual([
      { order: 1, title: '初入江湖', goal: '下山', synopsis: '梗概' },
    ]);
    expect(out.chapters).toEqual([
      { chapterOrder: 1, title: '下山', status: 'WRITTEN' },
      { chapterOrder: 2, title: '夜雨', status: 'DRAFT' },
    ]);
    expect(out.nextChapterOrder).toBe(2);
  });
});

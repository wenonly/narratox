import { makeGetOutlineTool } from './get-outline.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('get_outline tool', () => {
  it('returns volumes + chapter list + nextChapterOrder', async () => {
    const listOutline = jest.fn().mockResolvedValue({
      master: null,
      volumes: [
        {
          order: 1,
          title: '初入江湖',
          goal: '下山',
          synopsis: '梗概',
          bridge: '承接前卷',
          mainProgress: '主角下山',
        },
      ],
      arcs: [
        {
          order: 1,
          title: '拜师',
          goal: '入门',
          fromChapter: 1,
          toChapter: 5,
          summary: '',
        },
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
    expect(out.master).toBeNull();
    expect(out.arcs).toEqual([
      {
        order: 1,
        title: '拜师',
        goal: '入门',
        fromChapter: 1,
        toChapter: 5,
        summary: '',
      },
    ]);
    expect(out.volumes).toEqual([
      {
        order: 1,
        title: '初入江湖',
        goal: '下山',
        synopsis: '梗概',
        bridge: '承接前卷',
        mainProgress: '主角下山',
      },
    ]);
    // chapters 只含未写计划(DRAFT/APPROVED);已写算进 writtenCount
    expect(out.chapters).toEqual([
      { chapterOrder: 2, title: '夜雨', status: 'DRAFT' },
    ]);
    expect(out.writtenCount).toBe(1);
    expect(out.nextChapterOrder).toBe(2);
  });
});

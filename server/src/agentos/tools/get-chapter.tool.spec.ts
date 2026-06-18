import { makeGetChapterTool } from './get-chapter.tool';
import type { ChapterService } from '../../novel/chapter.service';

describe('get_chapter tool', () => {
  it('returns ok + content when found', async () => {
    const getChapter = jest
      .fn()
      .mockResolvedValue({ order: 1, title: '第1章', content: '正文' });
    const chapters = { getChapter } as unknown as ChapterService;

    const t = makeGetChapterTool({ userId: 'u1', novelId: 'n1', chapters });
    const out = (await t.invoke({ chapterOrder: 1 })) as {
      ok: boolean;
      content: string;
    };

    expect(getChapter).toHaveBeenCalledWith('u1', 'n1', 1);
    expect(out.ok).toBe(true);
    expect(out.content).toBe('正文');
  });

  it('returns ok:false when absent', async () => {
    const getChapter = jest.fn().mockResolvedValue(null);
    const chapters = { getChapter } as unknown as ChapterService;

    const t = makeGetChapterTool({ userId: 'u1', novelId: 'n1', chapters });
    const out = (await t.invoke({ chapterOrder: 9 })) as {
      ok: boolean;
      reason: string;
    };

    expect(getChapter).toHaveBeenCalledWith('u1', 'n1', 9);
    expect(out).toEqual({ ok: false, reason: 'not_found' });
  });
});

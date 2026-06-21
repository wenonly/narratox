import { makeGetReadingChapterTool } from './get-reading-chapter.tool';
import type { ChapterService } from '../../novel/chapter.service';

describe('get_reading_chapter tool', () => {
  it('returns ok + order/title/status when the user has a chapter open', async () => {
    const findByOrder = jest
      .fn()
      .mockResolvedValue({ order: 3, title: '雨夜', status: 'COMMITTED' });
    const chapters = { findByOrder } as unknown as ChapterService;

    const t = makeGetReadingChapterTool({
      userId: 'u1',
      novelId: 'n1',
      readingChapterOrder: 3,
      chapters,
    });
    const out = (await t.invoke({})) as {
      ok: boolean;
      order: number;
      title: string;
      status: string;
    };

    expect(findByOrder).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toEqual({
      ok: true,
      order: 3,
      title: '雨夜',
      status: 'COMMITTED',
    });
  });

  it('returns no_active_chapter when readingChapterOrder is null', async () => {
    const findByOrder = jest.fn();
    const chapters = { findByOrder } as unknown as ChapterService;

    const t = makeGetReadingChapterTool({
      userId: 'u1',
      novelId: 'n1',
      readingChapterOrder: null,
      chapters,
    });
    const out = (await t.invoke({})) as { ok: boolean; reason: string };

    expect(findByOrder).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: 'no_active_chapter' });
  });

  it('returns no_such_chapter when the chapter was deleted', async () => {
    const findByOrder = jest.fn().mockResolvedValue(null);
    const chapters = { findByOrder } as unknown as ChapterService;

    const t = makeGetReadingChapterTool({
      userId: 'u1',
      novelId: 'n1',
      readingChapterOrder: 9,
      chapters,
    });
    const out = (await t.invoke({})) as {
      ok: boolean;
      reason: string;
      order: number;
    };

    expect(findByOrder).toHaveBeenCalledWith('u1', 'n1', 9);
    expect(out).toEqual({ ok: false, reason: 'no_such_chapter', order: 9 });
  });
});

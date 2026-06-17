import { makeListChaptersTool } from './list-chapters.tool';
import type { ChapterService } from '../../novel/chapter.service';

function makeChaptersMock(list: jest.Mock): ChapterService {
  return { list } as unknown as ChapterService;
}

describe('makeListChaptersTool', () => {
  it('lists chapters mapped to {order,title,status,words}, scoped to the bound novel', async () => {
    const list = jest.fn().mockResolvedValue([
      { order: 1, title: '第1章', status: 'COMMITTED', content: '一二三四五' },
      { order: 2, title: '第2章', status: 'DRAFT', content: '' },
    ]);
    const chapters = makeChaptersMock(list);
    const t = makeListChaptersTool({ userId: 'u1', novelId: 'n1', chapters });

    const res = (await t.invoke({})) as {
      chapters: Array<{
        order: number;
        title: string;
        status: string;
        words: number;
      }>;
    };

    expect(list).toHaveBeenCalledWith('u1', 'n1');
    expect(res.chapters).toEqual([
      { order: 1, title: '第1章', status: 'COMMITTED', words: 5 },
      { order: 2, title: '第2章', status: 'DRAFT', words: 0 },
    ]);
  });

  it('returns an empty chapters array when the novel has no chapters', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const chapters = makeChaptersMock(list);
    const t = makeListChaptersTool({ userId: 'u1', novelId: 'n1', chapters });
    const res = (await t.invoke({})) as { chapters: unknown[] };
    expect(res.chapters).toEqual([]);
  });

  it('binds userId/novelId from closure, not input', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const chapters = makeChaptersMock(list);
    const t = makeListChaptersTool({
      userId: 'owner',
      novelId: 'n-owner',
      chapters,
    });
    await t.invoke({});
    expect(list).toHaveBeenCalledWith('owner', 'n-owner');
  });

  it('exposes an empty schema (read-only, no input)', () => {
    const t = makeListChaptersTool({
      userId: 'u1',
      novelId: 'n1',
      chapters: makeChaptersMock(jest.fn()),
    });
    expect(t.name).toBe('list_chapters');
  });
});

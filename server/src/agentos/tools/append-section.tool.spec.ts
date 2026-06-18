import { makeAppendSectionTool } from './append-section.tool';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

describe('append_section tool', () => {
  it('appends, activates novel, returns ok + sizes', async () => {
    const appendSection = jest
      .fn()
      .mockResolvedValue({ id: 'c1', content: '开头新段' });
    const findByOrder = jest.fn().mockResolvedValue({ content: '开头新段' });
    const chapters = {
      appendSection,
      findByOrder,
    } as unknown as ChapterService;
    const activate = jest.fn().mockResolvedValue(undefined);
    const novels = { activate } as unknown as NovelService;

    const t = makeAppendSectionTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      novels,
    });
    const out = await t.invoke({ chapterOrder: 1, content: '新段' });

    expect(appendSection).toHaveBeenCalledWith('u1', 'n1', 1, '新段');
    expect(activate).toHaveBeenCalledWith('u1', 'n1');
    // chars = appended section length; totalChars = full chapter content length
    // ('新段'.length === 2; mock findByOrder returns content '开头新段'.length === 4).
    expect(out).toEqual({ ok: true, chapterOrder: 1, chars: 2, totalChars: 4 });
  });
});

import { makeAppendSectionTool } from './append-section.tool';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

describe('append_section tool', () => {
  it('appends, activates novel, returns ok + sizes', async () => {
    const appendSection = jest.fn().mockResolvedValue({ ok: true } as const);
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

  it('A2: returns a structured block (no activate/findByOrder) when the frontier gate refuses', async () => {
    const appendSection = jest.fn().mockResolvedValue({
      ok: false,
      reason: 'predecessor_not_settled',
      unsettledOrder: 1,
    } as const);
    const findByOrder = jest.fn();
    const chapters = {
      appendSection,
      findByOrder,
    } as unknown as ChapterService;
    const activate = jest.fn();
    const novels = { activate } as unknown as NovelService;

    const t = makeAppendSectionTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      novels,
    });
    const out = (await t.invoke({
      chapterOrder: 2,
      content: '新段',
    })) as {
      ok: false;
      reason: string;
      unsettledOrder: number;
      message: string;
    };

    expect(out.ok).toBe(false);
    expect(out.reason).toBe('predecessor_not_settled');
    expect(out.unsettledOrder).toBe(1);
    expect(out.message).toContain('结算第 1 章');
    // 关卡未过:不激活、不回查。
    expect(activate).not.toHaveBeenCalled();
    expect(findByOrder).not.toHaveBeenCalled();
  });

  it('A 大纲关卡: returns a structured block when chapter N has no plan', async () => {
    const appendSection = jest.fn().mockResolvedValue({
      ok: false,
      reason: 'no_chapter_plan',
      chapterOrder: 3,
    } as const);
    const findByOrder = jest.fn();
    const chapters = {
      appendSection,
      findByOrder,
    } as unknown as ChapterService;
    const activate = jest.fn();
    const novels = { activate } as unknown as NovelService;

    const t = makeAppendSectionTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      novels,
    });
    const out = (await t.invoke({
      chapterOrder: 3,
      content: '新段',
    })) as {
      ok: false;
      reason: string;
      chapterOrder: number;
      message: string;
    };

    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_chapter_plan');
    expect(out.chapterOrder).toBe(3);
    expect(out.message).toContain('第 3 章');
    expect(out.message).toContain('细纲');
    expect(activate).not.toHaveBeenCalled();
    expect(findByOrder).not.toHaveBeenCalled();
  });
});

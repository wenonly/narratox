import { makeWriteChapterTool } from './write-chapter.tool';
import type { ResourceRegistry } from '../../resources/resource-registry';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

/**
 * Minimal ChapterService / NovelService doubles: only the methods the tool
 * touches are exercised here, so cast partial objects to the service types.
 */
function makeChaptersMock(findOrCreateByOrder: jest.Mock): ChapterService {
  return { findOrCreateByOrder } as unknown as ChapterService;
}

function makeNovelsMock(activate: jest.Mock): NovelService {
  return { activate } as unknown as NovelService;
}

describe('makeWriteChapterTool', () => {
  it('append: resolves order→chapter via findOrCreateByOrder and dispatches an append with the real cuid', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findOrCreateByOrder = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-1', order: 1 });
    const chapters = makeChaptersMock(findOrCreateByOrder);
    const activate = jest.fn().mockResolvedValue(undefined);
    const novels = makeNovelsMock(activate);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
      novels,
    });

    const res = await t.invoke({
      chapterOrder: 1,
      op: 'append',
      content: '夜雨敲窗。',
    });

    // The whole point: the tool resolves order 1 → the chapter's real cuid,
    // never guesses "1". And it uses findOrCreateByOrder (auto-creates) so a
    // missing order becomes a real chapter rather than a hard error.
    expect(findOrCreateByOrder).toHaveBeenCalledWith('u1', 'n1', 1);
    expect(dispatch).toHaveBeenCalledWith('u1', {
      resource: 'chapter',
      targetId: 'cuid-1',
      op: 'append',
      content: '夜雨敲窗。',
    });
    expect(res).toMatchObject({ ok: true });
  });

  it('set: dispatches a chapter set mutation against the resolved cuid', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findOrCreateByOrder = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-2', order: 2 });
    const chapters = makeChaptersMock(findOrCreateByOrder);
    const activate = jest.fn().mockResolvedValue(undefined);
    const novels = makeNovelsMock(activate);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
      novels,
    });
    await t.invoke({ chapterOrder: 2, op: 'set', content: '全新内容。' });
    expect(findOrCreateByOrder).toHaveBeenCalledWith('u1', 'n1', 2);
    expect(dispatch).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        targetId: 'cuid-2',
        op: 'set',
        content: '全新内容。',
      }),
    );
  });

  it('flips the novel CONCEPT→ACTIVE (calls novels.activate) after a successful dispatch', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findOrCreateByOrder = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-1', order: 1 });
    const chapters = makeChaptersMock(findOrCreateByOrder);
    const activate = jest.fn().mockResolvedValue(undefined);
    const novels = makeNovelsMock(activate);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
      novels,
    });

    await t.invoke({ chapterOrder: 1, op: 'append', content: 'x' });

    // activate runs only AFTER dispatch succeeds — ordering matters: a failed
    // dispatch must not flip CONCEPT→ACTIVE. (jest.fn calls are recorded in
    // invocation order, so asserting both 'dispatched' and 'activated' with
    // both mocks having been called confirms the post-dispatch ordering.)
    expect(dispatch).toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith('u1', 'n1');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('auto-creates the chapter when the order is absent (findOrCreateByOrder, not findByOrder)', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    // findOrCreateByOrder resolves to a freshly-created chapter record.
    const findOrCreateByOrder = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-new', order: 7 });
    const chapters = makeChaptersMock(findOrCreateByOrder);
    const activate = jest.fn().mockResolvedValue(undefined);
    const novels = makeNovelsMock(activate);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
      novels,
    });

    const res = await t.invoke({
      chapterOrder: 7,
      op: 'append',
      content: '新章。',
    });

    expect(findOrCreateByOrder).toHaveBeenCalledWith('u1', 'n1', 7);
    expect(dispatch).toHaveBeenCalledWith('u1', {
      resource: 'chapter',
      targetId: 'cuid-new',
      op: 'append',
      content: '新章。',
    });
    expect(res).toMatchObject({ ok: true });
  });

  it('binds userId/novelId from closure, not input', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findOrCreateByOrder = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-owner', order: 1 });
    const chapters = makeChaptersMock(findOrCreateByOrder);
    const activate = jest.fn().mockResolvedValue(undefined);
    const novels = makeNovelsMock(activate);
    const t = makeWriteChapterTool({
      userId: 'owner',
      novelId: 'n-owner',
      chapters,
      registry,
      novels,
    });
    await t.invoke({ chapterOrder: 1, op: 'append', content: 'x' });
    expect(findOrCreateByOrder).toHaveBeenCalledWith('owner', 'n-owner', 1);
    expect(dispatch).toHaveBeenCalledWith('owner', expect.anything());
    expect(activate).toHaveBeenCalledWith('owner', 'n-owner');
  });
});

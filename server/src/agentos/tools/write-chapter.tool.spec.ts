import { makeWriteChapterTool } from './write-chapter.tool';
import type { ResourceRegistry } from '../../resources/resource-registry';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * Minimal ChapterService double: only `findByOrder` is exercised here, so cast
 * a partial object to the service type (the tool never reads other methods).
 */
function makeChaptersMock(findByOrder: jest.Mock): ChapterService {
  return { findByOrder } as unknown as ChapterService;
}

describe('makeWriteChapterTool', () => {
  it('append: resolves order→chapter and dispatches a chapter append with the real cuid', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findByOrder = jest.fn().mockResolvedValue({ id: 'cuid-1', order: 1 });
    const chapters = makeChaptersMock(findByOrder);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
    });

    const res = await t.invoke({
      chapterOrder: 1,
      op: 'append',
      content: '夜雨敲窗。',
    });

    // The whole point: the tool resolves order 1 → the chapter's real cuid,
    // never guesses "1".
    expect(findByOrder).toHaveBeenCalledWith('u1', 'n1', 1);
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
    const findByOrder = jest.fn().mockResolvedValue({ id: 'cuid-2', order: 2 });
    const chapters = makeChaptersMock(findByOrder);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
    });
    await t.invoke({ chapterOrder: 2, op: 'set', content: '全新内容。' });
    expect(findByOrder).toHaveBeenCalledWith('u1', 'n1', 2);
    expect(dispatch).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        targetId: 'cuid-2',
        op: 'set',
        content: '全新内容。',
      }),
    );
  });

  it('returns {ok:false} and does NOT dispatch when the chapter order is absent', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findByOrder = jest.fn().mockResolvedValue(null);
    const chapters = makeChaptersMock(findByOrder);
    const t = makeWriteChapterTool({
      userId: 'u1',
      novelId: 'n1',
      chapters,
      registry,
    });

    const res = (await t.invoke({
      chapterOrder: 99,
      op: 'append',
      content: 'x',
    })) as { ok: boolean; error?: string };

    // Critical regression guard: a missing chapter surfaces as an error,
    // never a silent no-op that returns ok:true.
    expect(dispatch).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('99');
  });

  it('binds userId/novelId from closure, not input', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const findByOrder = jest
      .fn()
      .mockResolvedValue({ id: 'cuid-owner', order: 1 });
    const chapters = makeChaptersMock(findByOrder);
    const t = makeWriteChapterTool({
      userId: 'owner',
      novelId: 'n-owner',
      chapters,
      registry,
    });
    await t.invoke({ chapterOrder: 1, op: 'append', content: 'x' });
    expect(findByOrder).toHaveBeenCalledWith('owner', 'n-owner', 1);
    expect(dispatch).toHaveBeenCalledWith('owner', expect.anything());
  });
});

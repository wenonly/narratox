import { makeSetReferencesTool } from './set-references.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('set_references tool', () => {
  it('delegates to NovelReferenceService.replaceAll with bound userId/novelId', async () => {
    const replaceAll = jest.fn().mockResolvedValue({ count: 2 });
    const references = { replaceAll } as unknown as NovelReferenceService;
    const t = makeSetReferencesTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });

    const out = await t.invoke({
      entries: [
        {
          title: '悬疑钩子写法',
          category: '方法论',
          content: '开篇抛悬念…',
          injectTo: 'main',
          source: 'kb1,kb2',
        },
        { title: '情绪词库', content: '哭/怒/惊…', injectTo: 'writer' },
      ],
    });

    expect(replaceAll).toHaveBeenCalledWith('u1', 'n1', [
      {
        title: '悬疑钩子写法',
        category: '方法论',
        content: '开篇抛悬念…',
        injectTo: 'main',
        source: 'kb1,kb2',
      },
      {
        title: '情绪词库',
        category: undefined,
        content: '哭/怒/惊…',
        injectTo: 'writer',
        source: null,
      },
    ]);
    expect(out).toEqual({ ok: true, count: 2 });
  });

  it('returns the entries length when replaceAll returns no count', async () => {
    const replaceAll = jest.fn().mockResolvedValue({});
    const references = { replaceAll } as unknown as NovelReferenceService;
    const t = makeSetReferencesTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    const out = await t.invoke({
      entries: [
        { title: 'a', content: 'x' },
        { title: 'b', content: 'y' },
      ],
    });
    expect(out).toEqual({ ok: true, count: 2 });
  });
});

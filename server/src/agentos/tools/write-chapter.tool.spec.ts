import { makeWriteChapterTool } from './write-chapter.tool';
import type { ResourceRegistry } from '../../resources/resource-registry';

describe('makeWriteChapterTool', () => {
  it('append: dispatches a chapter append mutation with the bound userId', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const t = makeWriteChapterTool({ userId: 'u1', registry });

    const res = await t.invoke({
      chapterId: 'c1',
      op: 'append',
      content: '夜雨敲窗。',
    });

    expect(dispatch).toHaveBeenCalledWith('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'append',
      content: '夜雨敲窗。',
    });
    expect(res).toMatchObject({ ok: true });
  });

  it('set: dispatches a chapter set mutation', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const t = makeWriteChapterTool({ userId: 'u1', registry });
    await t.invoke({ chapterId: 'c1', op: 'set', content: '全新内容。' });
    expect(dispatch).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ op: 'set', content: '全新内容。' }),
    );
  });

  it('binds userId from closure, not input', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const registry = { dispatch } as unknown as ResourceRegistry;
    const t = makeWriteChapterTool({ userId: 'owner', registry });
    await t.invoke({ chapterId: 'c1', op: 'append', content: 'x' });
    expect(dispatch).toHaveBeenCalledWith('owner', expect.anything());
  });
});

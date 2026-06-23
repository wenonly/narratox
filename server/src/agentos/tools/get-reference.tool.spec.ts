import { makeGetReferenceTool } from './get-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

const ALL = [
  {
    id: 'r1',
    title: '悬疑钩子写法',
    category: '方法论',
    injectTo: 'main',
    content: '内容1',
  },
  {
    id: 'r2',
    title: '情绪动作词库',
    category: '词汇',
    injectTo: 'writer',
    content: '内容2',
  },
  {
    id: 'r3',
    title: '女频审核红线',
    category: '须知',
    injectTo: 'both',
    content: '内容3',
  },
  {
    id: 'r4',
    title: '复仇文拆解',
    category: '方法论',
    injectTo: null,
    content: '内容4',
  },
];

describe('get_reference tool', () => {
  it('filters by title (fuzzy, case-insensitive) and returns top 3', async () => {
    const listAll = jest.fn().mockResolvedValue(ALL);
    const references = { listAll } as unknown as NovelReferenceService;
    const t = makeGetReferenceTool({ userId: 'u1', novelId: 'n1', references });

    const out = await t.invoke({ title: '悬疑' });

    expect(listAll).toHaveBeenCalledWith('u1', 'n1');
    expect(out.map((r: { id: string }) => r.id)).toEqual(['r1']);
    expect(out[0]).toMatchObject({ title: '悬疑钩子写法', content: '内容1' });
  });

  it('filters by category', async () => {
    const listAll = jest.fn().mockResolvedValue(ALL);
    const references = { listAll } as unknown as NovelReferenceService;
    const t = makeGetReferenceTool({ userId: 'u1', novelId: 'n1', references });

    const out = await t.invoke({ category: '方法论' });
    expect(out.map((r: { id: string }) => r.id)).toEqual(['r1', 'r4']);
  });

  it('caps the result at 3', async () => {
    const listAll = jest.fn().mockResolvedValue([
      ...ALL,
      {
        id: 'r5',
        title: '方法论5',
        category: '方法论',
        injectTo: null,
        content: 'c5',
      },
      {
        id: 'r6',
        title: '方法论6',
        category: '方法论',
        injectTo: null,
        content: 'c6',
      },
    ]);
    const references = { listAll } as unknown as NovelReferenceService;
    const t = makeGetReferenceTool({ userId: 'u1', novelId: 'n1', references });
    const out = await t.invoke({ category: '方法论' });
    expect(out).toHaveLength(3);
  });
});

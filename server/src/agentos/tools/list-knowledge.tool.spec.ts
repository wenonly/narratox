import { makeListKnowledgeTool } from './list-knowledge.tool';

const baseKb = (entries: unknown[]) => ({
  list: jest.fn().mockResolvedValue({ entries, categories: [] }),
});

describe('list_knowledge tool', () => {
  it('无过滤 → kb.list 收到空 filter,返全量索引 JSON', async () => {
    const kb = baseKb([
      {
        id: 'zl0001',
        name: '反差萌人设',
        category: '人设档案',
        tags: ['人设'],
        description: '一句话',
        md_path: '人设档案/x.md',
      },
    ]);
    const t = makeListKnowledgeTool({ kb: kb as never });
    const out = await t.invoke({});
    expect(kb.list).toHaveBeenCalledWith({
      category: undefined,
      tag: undefined,
      search: undefined,
    });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 'zl0001',
      name: '反差萌人设',
      category: '人设档案',
    });
    // 索引不含正文(md_path 不返回)。
    expect(parsed[0].md_path).toBeUndefined();
  });

  it('传 category/tag/keyword → 透传给 kb.list(keyword→search)', async () => {
    const kb = baseKb([]);
    const t = makeListKnowledgeTool({ kb: kb as never });
    await t.invoke({ category: '方法论教程', tag: '大纲', keyword: '伏笔' });
    expect(kb.list).toHaveBeenCalledWith({
      category: '方法论教程',
      tag: '大纲',
      search: '伏笔',
    });
  });

  it('返回 JSON 字符串(非数组,避免供应商多模态 400)', async () => {
    const kb = baseKb([
      {
        id: 'zl0001',
        name: 'x',
        category: '人设档案',
        tags: [],
        description: '',
        md_path: 'x',
      },
    ]);
    const t = makeListKnowledgeTool({ kb: kb as never });
    const out = await t.invoke({});
    expect(typeof out).toBe('string');
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

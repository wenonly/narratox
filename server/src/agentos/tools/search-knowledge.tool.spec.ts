import { makeSearchKnowledgeTool } from './search-knowledge.tool';
import type { KnowledgeService } from '../../knowledge/knowledge.service';

describe('search_knowledge tool', () => {
  it('searches the global KB and maps hits to {id,title,category,content}', async () => {
    const search = jest.fn().mockResolvedValue([
      { id: 'kb1', name: '悬疑钩子写法', category: '方法论教程' },
      { id: 'kb2', name: '情绪动作词库', category: '词汇素材库' },
    ]);
    const getEntry = jest.fn().mockImplementation((id: string) =>
      Promise.resolve({
        entry: { id },
        content: `正文-${id}`,
      }),
    );
    const kb = { search, getEntry } as unknown as KnowledgeService;
    const t = makeSearchKnowledgeTool({ kb });

    const out = await t.invoke({ query: '悬疑', category: '方法论教程' });

    expect(search).toHaveBeenCalledWith('悬疑', {
      category: '方法论教程',
      limit: 8,
    });
    expect(getEntry).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      { id: 'kb1', title: '悬疑钩子写法', category: '方法论教程', content: '正文-kb1' },
      { id: 'kb2', title: '情绪动作词库', category: '词汇素材库', content: '正文-kb2' },
    ]);
  });

  it('passes undefined category when omitted (no filter)', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const getEntry = jest.fn();
    const kb = { search, getEntry } as unknown as KnowledgeService;
    const t = makeSearchKnowledgeTool({ kb });

    await t.invoke({ query: '开头' });

    expect(search).toHaveBeenCalledWith('开头', { category: undefined, limit: 8 });
    expect(getEntry).not.toHaveBeenCalled();
  });
});

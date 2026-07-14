import {
  makeSearchBenchmarkTool,
  filterBenchmarkEntries,
} from './search-benchmark.tool';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

function makeBenchmarkMock(fn: jest.Mock): BenchmarkService {
  return { searchEntries: fn } as unknown as BenchmarkService;
}

const E = (
  over: Partial<{
    id: string;
    bookId: string;
    type: string;
    kind: string | null;
    purposes: string[];
    title: string;
    content: string;
  }>,
) => ({
  id: 'e1',
  bookId: 'b1',
  type: 'CHAPTER',
  title: '',
  content: '',
  chapterNo: null,
  order: 0,
  kind: null,
  purposes: [],
  ...over,
});

describe('filterBenchmarkEntries (migrated from get-benchmark.tool)', () => {
  it('kind 精确匹配', () => {
    const r = filterBenchmarkEntries(
      [
        E({ type: 'MATERIAL', kind: '梗' }),
        E({ type: 'MATERIAL', kind: '金句' }),
      ],
      { kind: '梗' },
    );
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('梗');
  });

  it('purpose 命中 purposes 数组任一', () => {
    const r = filterBenchmarkEntries(
      [
        E({ type: 'MATERIAL', purposes: ['爽点', '反转'] }),
        E({ type: 'MATERIAL', purposes: ['低谷'] }),
      ],
      { purpose: '爽点' },
    );
    expect(r).toHaveLength(1);
    expect(r[0].purposes).toContain('爽点');
  });

  it('query 子串匹配 title/content', () => {
    const r = filterBenchmarkEntries(
      [E({ title: '学霸应援' }), E({ content: '别的内容' })],
      { query: '学霸' },
    );
    expect(r).toHaveLength(1);
  });

  it('无过滤条件全留', () => {
    const es = [E({}), E({ type: 'MATERIAL' })];
    expect(filterBenchmarkEntries(es, {})).toHaveLength(2);
  });
});

describe('makeSearchBenchmarkTool', () => {
  it('正常路径:跨书聚合 + bookTitle 字段映射', async () => {
    const fn = jest.fn().mockResolvedValue([
      {
        entry: {
          id: 'e1',
          bookId: 'b1',
          type: 'PLOT',
          title: '主线',
          content: 'x'.repeat(800),
          chapterNo: null,
          kind: null,
          purposes: [],
          order: 0,
        },
        bookTitle: '我的超能力每周刷新',
      },
    ]);
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ bookTitle: '超能力' })) as {
      entries: Array<{ book: string; content: string }>;
    };
    expect(fn).toHaveBeenCalledWith('u1', { bookTitle: '超能力', limit: 10 });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].book).toBe('我的超能力每周刷新');
    expect(res.entries[0].content.length).toBe(600);
  });

  it('无匹配 → { entries: [] }', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ bookTitle: '不存在' })) as {
      entries: unknown[];
    };
    expect(res.entries).toEqual([]);
  });

  it('MATERIAL kind/purpose 内存过滤', async () => {
    const fn = jest.fn().mockResolvedValue([
      {
        entry: E({ type: 'MATERIAL', kind: '梗', purposes: ['爽点'] }),
        bookTitle: 'A',
      },
      {
        entry: E({ type: 'MATERIAL', kind: '金句', purposes: ['反转'] }),
        bookTitle: 'A',
      },
    ]);
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ kind: '梗' as never })) as {
      entries: Array<{ kind: string | null }>;
    };
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].kind).toBe('梗');
  });

  it('工具名 search_benchmark', () => {
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(jest.fn()),
    });
    expect(t.name).toBe('search_benchmark');
  });
});

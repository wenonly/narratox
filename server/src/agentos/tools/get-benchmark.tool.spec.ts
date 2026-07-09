import { filterBenchmarkEntries } from './get-benchmark.tool';

const E = (
  over: Partial<{
    id: string;
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

describe('filterBenchmarkEntries', () => {
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

import { makeGetBenchmarkEntriesTool } from './get-benchmark-entries.tool';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

function makeBenchmarkMock(fn: jest.Mock): BenchmarkService {
  return { findEntriesForUser: fn } as unknown as BenchmarkService;
}

describe('makeGetBenchmarkEntriesTool', () => {
  it('正常返回 type 过滤的条目,content 截断到 600', async () => {
    const longContent = 'x'.repeat(800);
    const fn = jest.fn().mockResolvedValue({
      entries: [
        {
          id: 'e1',
          type: 'PLOT',
          title: '主线',
          content: longContent,
          chapterNo: null,
          kind: null,
          purposes: [],
          order: 0,
        },
      ],
    });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({
      bookId: 'b1',
      type: 'PLOT' as never,
    })) as { entries: Array<{ content: string }> };
    expect(fn).toHaveBeenCalledWith('u1', 'b1', { type: 'PLOT' });
    expect(res.entries[0].content.length).toBe(600);
  });

  it('bookId 不存在 → { entries: [], error: "book_not_found" }', async () => {
    const fn = jest.fn().mockResolvedValue({ error: 'book_not_found' });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = await t.invoke({ bookId: 'bX' });
    expect(res).toEqual({ entries: [], error: 'book_not_found' });
  });

  it('chapterNo 透传', async () => {
    const fn = jest.fn().mockResolvedValue({ entries: [] });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({ bookId: 'b1', chapterNo: 5 });
    expect(fn).toHaveBeenCalledWith('u1', 'b1', { chapterNo: 5 });
  });

  it('limit 透传', async () => {
    const fn = jest.fn().mockResolvedValue({ entries: [] });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({ bookId: 'b1', limit: 50 });
    expect(fn).toHaveBeenCalledWith('u1', 'b1', { limit: 50 });
  });

  it('工具名 get_benchmark_entries', () => {
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(jest.fn()),
    });
    expect(t.name).toBe('get_benchmark_entries');
  });
});

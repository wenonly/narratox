import { makeListBenchmarkBooksTool } from './list-benchmark-books.tool';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

function makeBenchmarkMock(fn: jest.Mock): BenchmarkService {
  return { listBooksWithEntryCounts: fn } as unknown as BenchmarkService;
}

describe('makeListBenchmarkBooksTool', () => {
  it('返回 books 数组,调用 service.listBooksWithEntryCounts(userId)', async () => {
    const fn = jest.fn().mockResolvedValue([
      {
        id: 'b1',
        title: '盘龙',
        status: 'DONE',
        chapterCount: 30,
        entryCountByType: { PLOT: 5, STYLE: 3 },
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({})) as {
      books: Array<{
        id: string;
        title: string;
        entryCountByType: Record<string, number>;
      }>;
    };
    expect(fn).toHaveBeenCalledWith('u1', 20);
    expect(res.books).toHaveLength(1);
    expect(res.books[0].title).toBe('盘龙');
    expect(res.books[0].entryCountByType.PLOT).toBe(5);
  });

  it('空库 → { books: [] }', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({})) as { books: unknown[] };
    expect(res.books).toEqual([]);
  });

  it('limit 透传', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({ limit: 5 });
    expect(fn).toHaveBeenCalledWith('u1', 5);
  });

  it('闭包绑定 userId,不读 input', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeListBenchmarkBooksTool({
      userId: 'owner',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({});
    expect(fn).toHaveBeenCalledWith('owner', 20);
  });

  it('工具名 list_benchmark_books', () => {
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(jest.fn()),
    });
    expect(t.name).toBe('list_benchmark_books');
  });
});

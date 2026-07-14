import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

/**
 * T1:列出当前用户名下所有拆解书 + 各 type 条目数。
 * userId 闭包注入。返回 { books: [...] } 对象(顶层是对象,不会被供应商当多模态块)。
 */
export interface ListBenchmarkBooksDeps {
  userId: string;
  benchmark: BenchmarkService;
}

export const makeListBenchmarkBooksTool = (d: ListBenchmarkBooksDeps) =>
  tool(
    async ({ limit }) => {
      const books = await d.benchmark.listBooksWithEntryCounts(
        d.userId,
        limit ?? 20,
      );
      return { books };
    },
    {
      name: 'list_benchmark_books',
      description:
        '列出当前用户名下所有对标拆解书,返回每本书的 id、标题、拆解状态、章数、各拆解维度(PLOT/RHYTHM/EMOTION/CHARACTER/STYLE/MATERIAL/CHAPTER)的条目数。写作时动笔前先调一次,确认对标库有哪些可用。',
      schema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('最多返回几本书,默认 20'),
      }),
    },
  );

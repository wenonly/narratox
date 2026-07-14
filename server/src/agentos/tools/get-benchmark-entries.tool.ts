import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';
import { BENCHMARK_TYPES } from '../../benchmark/dimensions';

/**
 * T2:单书深挖(写作 agent)。bookId 必填,归属由 service 校验。
 * content 截断到 600 字符,防单条工具结果爆 token。
 */
export interface GetBenchmarkEntriesDeps {
  userId: string;
  benchmark: BenchmarkService;
}

export const makeGetBenchmarkEntriesTool = (d: GetBenchmarkEntriesDeps) =>
  tool(
    async ({ bookId, type, chapterNo, limit }) => {
      const opts: {
        type?: string;
        chapterNo?: number | null;
        limit?: number;
      } = {};
      if (type) opts.type = type;
      if (chapterNo !== undefined && chapterNo !== null)
        opts.chapterNo = chapterNo;
      if (limit) opts.limit = limit;
      const r = await d.benchmark.findEntriesForUser(d.userId, bookId, opts);
      if ('error' in r) {
        return { entries: [], error: r.error };
      }
      return {
        entries: r.entries.map((e) => ({
          type: e.type,
          title: e.title,
          content: e.content.slice(0, 600),
          chapterNo: e.chapterNo,
          kind: e.kind,
          purposes: e.purposes,
        })),
      };
    },
    {
      name: 'get_benchmark_entries',
      description:
        '单书深挖:按 type/chapterNo 过滤某一本对标书的拆解条目。bookId 必须来自 list_benchmark_books 的返回。典型场景:看这本书的所有 STYLE 条目,或看第 3 章的 PLOT。',
      schema: z.object({
        bookId: z
          .string()
          .describe('对标书 id(来自 list_benchmark_books 的返回)'),
        type: z.enum(BENCHMARK_TYPES).optional().describe('按拆解维度过滤'),
        chapterNo: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe('按章节号过滤'),
        limit: z.number().int().min(1).max(100).optional().describe('默认 30'),
      }),
    },
  );

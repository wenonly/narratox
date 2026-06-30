import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

/**
 * 拆解 tool(Phase 22):取已拆解条目(按 type/chapterNo 过滤)。
 * 返回 content 前 500 字预览——避免一条 tool 返回爆 token;需要全文改单独接口(本期不提供)。
 */
export interface GetDissectEntriesDeps {
  bookId: string;
  benchmark: BenchmarkService;
}

export const makeGetDissectEntriesTool = (d: GetDissectEntriesDeps) =>
  tool(
    async ({ type, chapterNo }) => {
      const entries = await d.benchmark.getEntries(
        d.bookId,
        type,
        chapterNo ?? undefined,
      );
      return {
        entries: entries.map((e) => ({
          type: e.type,
          title: e.title,
          content: e.content.slice(0, 500),
          chapterNo: e.chapterNo,
        })),
      };
    },
    {
      name: 'get_dissect_entries',
      description: '取已拆解条目(按 type/chapterNo 过滤)。',
      schema: z.object({
        type: z
          .enum([
            'CHAPTER',
            'PLOT',
            'RHYTHM',
            'EMOTION',
            'CHARACTER',
            'STYLE',
          ])
          .optional(),
        chapterNo: z.number().nullable().optional(),
      }),
    },
  );

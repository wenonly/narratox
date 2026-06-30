import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

/**
 * 拆解 tool(Phase 22,对标库):写一条拆解产物到对标库 BenchmarkEntry。
 * userId/bookId/benchmark 闭包注入——模型无法跨 book 写。type 与 BenchmarkEntryType 枚举对齐。
 */
export interface WriteBenchmarkDeps {
  userId: string;
  bookId: string;
  benchmark: BenchmarkService;
}

export const makeWriteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ type, title, content, order, chapterNo }) => {
      await d.benchmark.writeEntry(
        d.bookId,
        type,
        title,
        content,
        order ?? 0,
        chapterNo ?? null,
      );
      return { ok: true };
    },
    {
      name: 'write_benchmark',
      description:
        '写一条拆解产物到对标库。type: CHAPTER|PLOT|RHYTHM|EMOTION|CHARACTER|STYLE。',
      schema: z.object({
        type: z.enum([
          'CHAPTER',
          'PLOT',
          'RHYTHM',
          'EMOTION',
          'CHARACTER',
          'STYLE',
        ]),
        title: z.string(),
        content: z.string(),
        order: z.number().optional(),
        chapterNo: z.number().nullable().optional(),
      }),
    },
  );

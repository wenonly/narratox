import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';
import {
  BENCHMARK_TYPES,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from '../../benchmark/dimensions';

/**
 * 拆解 tool(对标库):写一条拆解产物到 BenchmarkEntry。
 * userId/bookId/benchmark 闭包注入——模型无法跨 book 写。type 与 BenchmarkEntryType 对齐(单源)。
 * MATERIAL 必带 kind + purposes(≥1);其余 type 忽略这两个字段。
 */
export interface WriteBenchmarkDeps {
  userId: string;
  bookId: string;
  benchmark: BenchmarkService;
}

export const makeWriteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ type, title, content, order, chapterNo, kind, purposes }) => {
      await d.benchmark.writeEntry(d.bookId, {
        type,
        title,
        content,
        order: order ?? 0,
        chapterNo: chapterNo ?? null,
        kind: type === 'MATERIAL' ? kind ?? null : null,
        purposes: type === 'MATERIAL' ? purposes ?? [] : [],
      });
      return { ok: true };
    },
    {
      name: 'write_benchmark',
      description:
        '写一条拆解产物到对标库。type: CHAPTER|PLOT|RHYTHM|EMOTION|CHARACTER|STYLE|MATERIAL。MATERIAL 必带 kind(梗|名场面|金句|套路)+ purposes(用途数组)。',
      schema: z
        .object({
          type: z.enum(BENCHMARK_TYPES),
          title: z.string(),
          content: z.string(),
          order: z.number().optional(),
          chapterNo: z.number().nullable().optional(),
          kind: z
            .enum(MATERIAL_KINDS)
            .optional()
            .describe('仅 MATERIAL:素材种类'),
          purposes: z
            .array(z.enum(MATERIAL_PURPOSES))
            .optional()
            .describe('仅 MATERIAL:用途标签数组'),
        })
        .refine(
          (v) =>
            v.type !== 'MATERIAL' ||
            (!!v.kind && !!v.purposes && v.purposes.length > 0),
          { message: 'MATERIAL 必须带 kind 和至少一个 purpose' },
        ),
    },
  );

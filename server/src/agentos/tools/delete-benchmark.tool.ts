import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WriteBenchmarkDeps } from './write-benchmark.tool';

/**
 * 拆解 follow-up 工具:删除一条拆解条目(如重复素材、错误条目)。
 * entryId 从 get_dissect_entries 获取。删除不可撤销。
 */
export const makeDeleteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ entryId }) => {
      await d.benchmark.deleteEntry(d.bookId, entryId);
      return { ok: true };
    },
    {
      name: 'delete_benchmark',
      description:
        '删除一条拆解条目(如重复素材、错误条目)。entryId 从 get_dissect_entries 取。删除不可撤销。',
      schema: z.object({
        entryId: z.string().describe('要删除的 BenchmarkEntry id'),
      }),
    },
  );

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WriteBenchmarkDeps } from './write-benchmark.tool';

/**
 * 拆解 follow-up 工具:修改一条已有拆解条目的 title/content。
 * entryId 从 get_dissect_entries 获取。只改 title/content,不改 type/bookId/kind/purposes(结构属性)。
 */
export const makeUpdateBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ entryId, title, content }) => {
      const updated = await d.benchmark.updateEntry(d.bookId, entryId, {
        ...(title != null ? { title } : {}),
        ...(content != null ? { content } : {}),
      });
      return { ok: true, entry: { id: updated.id, title: updated.title } };
    },
    {
      name: 'update_benchmark',
      description:
        '修改一条已有的拆解条目(标题/内容)。entryId 从 get_dissect_entries 取。至少传 title 或 content 之一。',
      schema: z
        .object({
          entryId: z.string().describe('要修改的 BenchmarkEntry id'),
          title: z.string().optional().describe('新标题(不传则不改)'),
          content: z.string().optional().describe('新内容(不传则不改)'),
        })
        .refine((v) => v.title != null || v.content != null, {
          message: '至少传 title 或 content 之一',
        }),
    },
  );

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 只读「从全局对标库按需拉取拆解产物」工具(Phase 22):跨所有对标书(BenchmarkBook)
 * 按 type/query 过滤,返回 PLOT/RHYTHM/EMOTION/CHARACTER/STYLE 等拆解条目作写作参考。
 * userId 闭包注入——模型只能读本人名下的对标书(多租户隔离)。
 *
 * 返回 JSON 字符串(同 get-events/get-reference,防数组被部分供应商当多模态块 → 400)。
 */
export interface GetBenchmarkDeps {
  userId: string;
  prisma: PrismaService;
}

export const makeGetBenchmarkTool = (d: GetBenchmarkDeps) =>
  tool(
    async ({ type, query, limit }) => {
      const books = await d.prisma.benchmarkBook.findMany({
        where: { userId: d.userId },
        select: { id: true, title: true },
      });
      const bookIds = books.map((b) => b.id);
      // 没有对标书 → 直接空(避免 in: [] 被部分 DB 当成全表)
      if (bookIds.length === 0) {
        return JSON.stringify({ entries: [] });
      }
      const where: Record<string, unknown> = { bookId: { in: bookIds } };
      if (type) where.type = type;
      const entries = await d.prisma.benchmarkEntry.findMany({
        where: where as never,
        take: limit ?? 10,
        orderBy: { order: 'asc' },
      });
      const q = query?.trim();
      const filtered = q
        ? entries.filter((e) => e.content.includes(q) || e.title.includes(q))
        : entries;
      const result = {
        entries: filtered.map((e) => ({
          book: books.find((b) => b.id === e.bookId)?.title,
          type: e.type,
          title: e.title,
          content: e.content.slice(0, 600),
          chapterNo: e.chapterNo,
        })),
      };
      return JSON.stringify(result);
    },
    {
      name: 'get_benchmark',
      description:
        '从全局对标库按需拉取其他小说的拆解产物(跨所有对标书)。写大纲拉 PLOT/RHYTHM/EMOTION;写正文拉 STYLE/RHYTHM;建角色拉 CHARACTER。对标是参考不是照抄,产物不进入本小说设定表。',
      schema: z.object({
        type: z
          .enum(['CHAPTER', 'PLOT', 'RHYTHM', 'EMOTION', 'CHARACTER', 'STYLE'])
          .optional()
          .describe('按拆解类型过滤'),
        query: z
          .string()
          .optional()
          .describe('标题/正文关键词模糊匹配(内存侧)'),
        limit: z.number().int().optional().describe('最多返回条数(默认 10)'),
      }),
    },
  );

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  BENCHMARK_TYPES,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from '../../benchmark/dimensions';

/**
 * 只读「从全局对标库按需拉取拆解产物」工具:跨所有对标书按
 * type/kind/purpose/query 过滤,返回拆解条目作写作参考。
 * userId 闭包注入——模型只能读本人名下的对标书(多租户隔离)。
 *
 * 返回 JSON 字符串(防数组被部分供应商当多模态块 → 400)。
 */
export interface GetBenchmarkDeps {
  userId: string;
  prisma: PrismaService;
}

/** 纯函数(可单测):对已查出的 entries 做 kind/purpose/query 内存过滤。 */
export interface BenchmarkFilter {
  kind?: string;
  purpose?: string;
  query?: string;
}

export function filterBenchmarkEntries<
  T extends {
    kind: string | null;
    purposes: string[];
    title: string;
    content: string;
  },
>(entries: T[], f: BenchmarkFilter): T[] {
  let out = entries;
  if (f.kind) out = out.filter((e) => e.kind === f.kind);
  if (f.purpose) out = out.filter((e) => e.purposes.includes(f.purpose!));
  const q = f.query?.trim();
  if (q) out = out.filter((e) => e.title.includes(q!) || e.content.includes(q!));
  return out;
}

export const makeGetBenchmarkTool = (d: GetBenchmarkDeps) =>
  tool(
    async ({ type, kind, purpose, query, limit }) => {
      const books = await d.prisma.benchmarkBook.findMany({
        where: { userId: d.userId },
        select: { id: true, title: true },
      });
      const bookIds = books.map((b) => b.id);
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
      const filtered = filterBenchmarkEntries(entries, { kind, purpose, query });
      const result = {
        entries: filtered.map((e) => ({
          book: books.find((b) => b.id === e.bookId)?.title,
          type: e.type,
          title: e.title,
          content: e.content.slice(0, 600),
          chapterNo: e.chapterNo,
          kind: e.kind,
          purposes: e.purposes,
        })),
      };
      return JSON.stringify(result);
    },
    {
      name: 'get_benchmark',
      description:
        '从全局对标库按需拉取其他小说的拆解产物(跨所有对标书)。写大纲拉 PLOT/RHYTHM/EMOTION;写正文拉 STYLE/RHYTHM;建角色拉 CHARACTER;写具体场景(开篇/爽点/反转/低谷)拉 type=MATERIAL 按 purpose 取素材参考。',
      schema: z.object({
        type: z.enum(BENCHMARK_TYPES).optional().describe('按拆解类型过滤'),
        kind: z
          .enum(MATERIAL_KINDS)
          .optional()
          .describe('仅 MATERIAL:按素材种类过滤(梗/名场面/金句/套路)'),
        purpose: z
          .enum(MATERIAL_PURPOSES)
          .optional()
          .describe('仅 MATERIAL:按用途过滤(命中 purposes 数组任一)'),
        query: z
          .string()
          .optional()
          .describe('标题/正文关键词模糊匹配(内存侧)'),
        limit: z.number().int().optional().describe('最多返回条数(默认 10)'),
      }),
    },
  );

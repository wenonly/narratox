import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';
import {
  BENCHMARK_TYPES,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from '../../benchmark/dimensions';

/**
 * T3:跨书搜索(写作 agent)。userId 闭包注入。
 * kind/purpose/query 走内存侧纯函数过滤(service 只做 bookTitle/type/limit)。
 * 返回 { entries: [...] } 对象(顶层是对象,不会被供应商当多模态块)。
 */
export interface SearchBenchmarkDeps {
  userId: string;
  benchmark: BenchmarkService;
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
  if (q) out = out.filter((e) => e.title.includes(q) || e.content.includes(q));
  return out;
}

export const makeSearchBenchmarkTool = (d: SearchBenchmarkDeps) =>
  tool(
    async ({ bookTitle, type, kind, purpose, query, limit }) => {
      const opts: { bookTitle?: string; type?: string; limit?: number } = {};
      if (bookTitle) opts.bookTitle = bookTitle;
      if (type) opts.type = type;
      opts.limit = limit ?? 10;
      const rows = await d.benchmark.searchEntries(d.userId, opts);
      const filtered = filterBenchmarkEntries(
        rows.map((r) => r.entry),
        { kind, purpose, query },
      ).slice(0, limit ?? 10);
      const idToTitle = new Map(rows.map((r) => [r.entry.bookId, r.bookTitle]));
      return {
        entries: filtered.map((e) => ({
          book: idToTitle.get(e.bookId) ?? '',
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
      name: 'search_benchmark',
      description:
        '跨书搜索对标库条目,支持书名模糊 / 拆解维度 / 素材种类 / 用途 / 关键词任意组合。书名匹配用 bookTitle(如"超能力"可匹配《我的超能力每周刷新》),条目内容关键词用 query。典型场景:找所有书里"反转"类型的素材 → type=MATERIAL & purpose=反转。',
      schema: z.object({
        bookTitle: z
          .string()
          .optional()
          .describe('书名模糊匹配(大小写不敏感)'),
        type: z.enum(BENCHMARK_TYPES).optional(),
        kind: z
          .enum(MATERIAL_KINDS)
          .optional()
          .describe('仅 MATERIAL:素材种类(梗|名场面|金句|套路)'),
        purpose: z
          .enum(MATERIAL_PURPOSES)
          .optional()
          .describe('仅 MATERIAL:用途标签'),
        query: z
          .string()
          .optional()
          .describe('条目标题/正文关键词(内存侧模糊匹配)'),
        limit: z.number().int().min(1).max(50).optional().describe('默认 10'),
      }),
    },
  );

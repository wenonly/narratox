import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Writer 的主动记忆检索(只读)。关键词在 章节摘要/角色变化/物品设定/伏笔 里 contains 匹配。
 * userId/novelId 闭包注入。kind 省略 → 同时搜 summary + hook。P2 只做关键词。
 */
export function makeQueryMemoryTool({
  userId,
  novelId,
  prisma,
}: {
  userId: string;
  novelId: string;
  prisma: PrismaService;
}) {
  return tool(
    async ({ query, kind }) => {
      const q = query.trim();
      if (!q) return { summaries: [], hooks: [] };
      const wantSummary =
        !kind || kind === 'summary' || kind === 'role' || kind === 'entity';
      const wantHook = !kind || kind === 'hook';

      let summaries: Array<{ chapterOrder: number; summary: string }> = [];
      if (wantSummary) {
        const rows = await prisma.chapterSummary.findMany({
          where: {
            novelId,
            chapter: { novel: { userId } },
            OR: [
              { summary: { contains: q, mode: 'insensitive' } },
              { roleChanges: { string_contains: q } },
              { entities: { string_contains: q } },
            ],
          },
          take: 10,
          orderBy: { chapter: { order: 'desc' } },
          select: { summary: true, chapter: { select: { order: true } } },
        });
        summaries = rows.map((r) => ({
          chapterOrder: r.chapter.order,
          summary: r.summary,
        }));
      }

      let hooks: Array<{ id: string; description: string; status: string }> =
        [];
      if (wantHook) {
        const rows = await prisma.storyEvent.findMany({
          where: {
            novelId,
            novel: { userId },
            description: { contains: q, mode: 'insensitive' },
          },
          take: 10,
          orderBy: { createdAt: 'asc' },
          select: { id: true, description: true, status: true },
        });
        hooks = rows.map((r) => ({
          id: r.id,
          description: r.description,
          status: r.status,
        }));
      }
      return { summaries, hooks };
    },
    {
      name: 'query_memory',
      description:
        '按关键词检索已记住的事实:章节摘要/角色变化/物品设定(role·entity·summary)与伏笔(hook)。写涉及已有角色/伏笔的章节前先调用核实。',
      schema: z.object({
        query: z.string().describe('关键词,如角色名、物品名、伏笔描述片段'),
        kind: z
          .enum(['role', 'hook', 'entity', 'summary'])
          .optional()
          .describe('限定检索维度;省略则同时搜摘要与伏笔'),
      }),
    },
  );
}

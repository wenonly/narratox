import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ResourceRegistry } from '../../resources/resource-registry';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

/**
 * 写作 Agent 的写章节工具。按 **章节序号**(1,2,3...,LLM 自然表达)定位章节,
 * 而不是 cuid(代理无法习得真实 cuid,旧实现猜 "1" → findFirst({id:"1"}) → null
 * → 静默 no-op)。序号经 ChapterService.findOrCreateByOrder 解析成 cuid 再走
 * mutation 层(ChapterHandler 仍按 userId 隔离)。append=追加到本章末尾;set=重写本章。
 *
 * 自动开章 + 状态推进:
 *   - findOrCreateByOrder —— 序号缺了自动种一条 `第N章`,写作 Agent 不需要先单独"开章"。
 *   - novels.activate —— 首次写章节后把小说 CONCEPT → ACTIVE(把"想法"推进到"在写"),
 *     幂等,后续写章不会再翻动(已是 ACTIVE)。
 */
export function makeWriteChapterTool({
  userId,
  novelId,
  chapters,
  registry,
  novels,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  registry: ResourceRegistry;
  novels: NovelService;
}) {
  return tool(
    async ({ chapterOrder, op, content }) => {
      const chapter = await chapters.findOrCreateByOrder(
        userId,
        novelId,
        chapterOrder,
      );
      await registry.dispatch(userId, {
        resource: 'chapter',
        targetId: chapter.id,
        op,
        content,
      });
      // 推进小说状态:首次写章 CONCEPT → ACTIVE。放在 dispatch 之后,dispatch
      // 抛错则不会翻状态(避免"看起来在写"但实际没写入)。
      await novels.activate(userId, novelId);
      return {
        ok: true as const,
        chapterOrder,
        chapterId: chapter.id,
        message: `已${op === 'append' ? '追加到' : '重写'}第 ${chapterOrder} 章。`,
      };
    },
    {
      name: 'write_chapter',
      description:
        '把小说正文写入指定章节(按章节序号)。chapterOrder=章节序号(1,2,3...);op="append" 追加到本章末尾(接着写),op="set" 重写整章。不存在该序号的章节会自动创建。生成正文后应主动调用,不要只贴在聊天里。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        op: z.enum(['append', 'set']).describe('append=追加,set=重写'),
        content: z.string().describe('要写入的正文'),
      }),
    },
  );
}

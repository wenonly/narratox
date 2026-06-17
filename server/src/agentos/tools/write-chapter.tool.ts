import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ResourceRegistry } from '../../resources/resource-registry';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * 写作 Agent 的写章节工具。按 **章节序号**(1,2,3...,LLM 自然表达)定位章节,
 * 而不是 cuid(代理无法习得真实 cuid,旧实现猜 "1" → findFirst({id:"1"}) → null
 * → 静默 no-op)。序号经 ChapterService.findByOrder 解析成 cuid 再走 mutation 层
 * (ChapterHandler 仍按 userId 隔离)。append=追加到本章末尾;set=重写本章。
 *
 * 找不到章节时返回 {ok:false,error},**绝不**静默返回 ok:true —— 这正是本工具要
 * 修复的缺陷:旧实现对越权/不存在章节静默成功,让"写第一章"看起来写成了。
 */
export function makeWriteChapterTool({
  userId,
  novelId,
  chapters,
  registry,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  registry: ResourceRegistry;
}) {
  return tool(
    async ({ chapterOrder, op, content }) => {
      const chapter = await chapters.findByOrder(userId, novelId, chapterOrder);
      if (!chapter) {
        return {
          ok: false as const,
          error: `第 ${chapterOrder} 章不存在,可先调用 list_chapters 查看现有章节。`,
        };
      }
      await registry.dispatch(userId, {
        resource: 'chapter',
        targetId: chapter.id,
        op,
        content,
      });
      return {
        ok: true as const,
        message: `已${op === 'append' ? '追加到' : '重写'}第 ${chapterOrder} 章。`,
      };
    },
    {
      name: 'write_chapter',
      description:
        '把小说正文写入指定章节(按章节序号)。chapterOrder=章节序号(1,2,3...);op="append" 追加到本章末尾(接着写),op="set" 重写整章。生成正文后应主动调用,不要只贴在聊天里。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        op: z.enum(['append', 'set']).describe('append=追加,set=重写'),
        content: z.string().describe('要写入的正文'),
      }),
    },
  );
}

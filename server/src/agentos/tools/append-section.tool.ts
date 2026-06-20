import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

/**
 * Writer 的「追加一节」工具。content 是一小节(~300-800 字),不是整章 —— 避免
 * 大工具参数触发 z.ai 60s 掐流(spike 证实)。userId/novelId 闭包注入。
 * 首次落内容时 novels.activate(CONCEPT→ACTIVE),与原 write_chapter 一致。
 */
export function makeAppendSectionTool({
  userId,
  novelId,
  chapters,
  novels,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  novels: NovelService;
}) {
  return tool(
    async ({ chapterOrder, content }) => {
      const res = await chapters.appendSection(
        userId,
        novelId,
        chapterOrder,
        content,
      );
      // 双关卡:本章无细纲(no_chapter_plan)或前驱未结算(predecessor_not_settled)
      // → 拒绝推进,把结构化拒绝翻译给模型。不激活、不回查;模型看到 message 后
      // 应先补细纲(set_chapter_plan)或委派 settler 结算。
      if (!res.ok) {
        if (res.reason === 'no_chapter_plan') {
          return {
            ok: false as const,
            reason: res.reason,
            chapterOrder: res.chapterOrder,
            message: `请先为第 ${res.chapterOrder} 章生成细纲(set_chapter_plan)后再写。`,
          };
        }
        return {
          ok: false as const,
          reason: res.reason,
          unsettledOrder: res.unsettledOrder,
          message: `请先用 settler 结算第 ${res.unsettledOrder} 章后再写后续章节。`,
        };
      }
      await novels.activate(userId, novelId); // 幂等:CONCEPT→ACTIVE
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      return {
        ok: true as const,
        chapterOrder,
        chars: content.length,
        totalChars: (ch?.content ?? '').length,
      };
    },
    {
      name: 'append_section',
      description:
        '向第 chapterOrder 章末尾追加【一小节】正文(约300-800字)。一章通过多次 append_section 拼成。不要一次写整章。章节不存在会自动创建。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        content: z.string().describe('这一小节的正文(约300-800字,不要整章)'),
      }),
    },
  );
}

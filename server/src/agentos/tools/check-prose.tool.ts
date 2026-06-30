import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';
import { check } from '../prose-guard';

/**
 * CHAPTER_ORCH 的「确定性正文守卫」工具,settler 与 validator 之间执行。
 * 读章正文 + Novel.settings.chapterWordTarget,跑纯函数 check,auto-fix 命中则写回。
 * userId/novelId 闭包注入(不从 LLM 入参取)。返回 report;orchestrator 据 nextAction
 * 路由:blocking 非空 → 与 validator.blockingIssues 取并集驱动修订。
 */
export function makeCheckProseTool({
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
    async ({ chapterOrder }) => {
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      if (!ch?.content) {
        return {
          ok: false as const,
          chapterOrder,
          message: `第 ${chapterOrder} 章无正文,跳过守卫。`,
          blocking: [],
          advisory: [],
          autoFixed: [],
          nextAction: 'pass' as const,
        };
      }
      const novel = await novels.get(userId, novelId);
      const settings = (novel.settings ?? {}) as { chapterWordTarget?: number };
      const report = check(ch.content, {
        chapterWordTarget: settings.chapterWordTarget,
      });

      if (report.autoFixed.length) {
        await chapters.update(userId, novelId, ch.id, {
          content: report.normalizedContent,
        });
      }
      return { ok: true as const, chapterOrder, ...report };
    },
    {
      name: 'check_prose',
      description:
        '确定性正文守卫:settler 之后、validator 之前对第 chapterOrder 章跑机械检测(复读/截断/拒绝语/工程词泄漏=blocking;破折号泛滥/句长过匀/碎句号/字数欠账/AI套话=advisory),并自动归一机械残留(\\uFFFD/--)。返回 nextAction:revise=有blocking需修订;proceed-validator=仅advisory进校验;pass=干净。blocking 与 validator.blockingIssues 取并集驱动 writer 修订。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}

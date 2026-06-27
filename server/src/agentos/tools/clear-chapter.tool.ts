import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { RevisionSnapshotService } from '../../novel/revision-snapshot.service';

/**
 * Writer 的"清空整章正文"工具。保留章节行与标题,只把 content 清空、status 回 DRAFT。
 * 用于"重写整章":clear_chapter 清空 → append_section 一节节重写(避免整章大 replace)。
 *
 * 安全网(E2E 发现):清空前【自动 snapshot】原版——即使 agent 误判触发重写、或重写中途
 * 被打断,也能用 restore_chapter 恢复,杜绝「清空即数据丢失」。best-effort,快照失败不阻断。
 * userId/novelId 闭包注入。
 */
export function makeClearChapterTool({
  userId,
  novelId,
  chapters,
  snapshots,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  snapshots: RevisionSnapshotService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      // 清空前自动快照原版(best-effort;空章快照失败也照常清空)。
      try {
        await snapshots.snapshot(userId, novelId, chapterOrder);
      } catch {
        // ignore — 快照失败不阻断清空
      }
      return chapters.clearChapter(userId, novelId, chapterOrder);
    },
    {
      name: 'clear_chapter',
      description:
        '清空第 chapterOrder 章的全部正文(保留章节与标题)。【清空前会自动快照原版,可用 restore_chapter 恢复,不会丢】要重写整章时:clear_chapter 清空 → append_section 一节节重写;不要用 replace_text 整章替换。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}

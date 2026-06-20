import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RevisionSnapshotService } from '../../novel/revision-snapshot.service';

/**
 * main agent 的「快照章节正文」工具(D1 回滚支撑)。userId/novelId 闭包注入。
 * 修订前调用:把当前 Chapter.content 存进内存快照,供修订后若更差时 restore 回滚。
 */
export function makeSnapshotChapterTool({
  userId,
  novelId,
  snapshots,
}: {
  userId: string;
  novelId: string;
  snapshots: RevisionSnapshotService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      const res = await snapshots.snapshot(userId, novelId, chapterOrder);
      if (!res.ok) {
        return {
          ok: false as const,
          reason: res.reason,
          chapterOrder,
          message: `第 ${chapterOrder} 章不存在,无法快照。`,
        };
      }
      return {
        ok: true as const,
        chapterOrder,
        chars: res.chars,
        message: `已快照第 ${chapterOrder} 章(修订前原版,${res.chars} 字)。`,
      };
    },
    {
      name: 'snapshot_chapter',
      description:
        '修订前快照第 chapterOrder 章当前正文(存修订前原版)。修订闭环里,校验未过要委派 writer 修订前先调它,以便修订后更差时 restore_chapter 回滚。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}

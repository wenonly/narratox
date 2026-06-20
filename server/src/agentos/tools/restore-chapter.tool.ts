import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RevisionSnapshotService } from '../../novel/revision-snapshot.service';

/**
 * main agent 的「回滚章节正文」工具(D1)。userId/novelId 闭包注入。
 * 修订后再校验若 score 更低(越改越差),调它把章节正文恢复为修订前快照。
 * 无快照则 no-op 返回 ok:false。
 */
export function makeRestoreChapterTool({
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
      const res = await snapshots.restore(userId, novelId, chapterOrder);
      if (!res.ok) {
        return {
          ok: false as const,
          reason: res.reason,
          chapterOrder,
          message:
            res.reason === 'no_snapshot'
              ? `第 ${chapterOrder} 章无修订前快照,无法回滚(修订前需先 snapshot_chapter)。`
              : `第 ${chapterOrder} 章不存在,无法回滚。`,
        };
      }
      return {
        ok: true as const,
        chapterOrder,
        chars: res.chars,
        message: `已回滚第 ${chapterOrder} 章到修订前原版(${res.chars} 字)。`,
      };
    },
    {
      name: 'restore_chapter',
      description:
        '把第 chapterOrder 章正文回滚到修订前快照(修订前需先 snapshot_chapter)。修订后 score 更低(越改越差)时调用。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/**
 * main agent 的「创建/更新一卷大纲」工具。userId/novelId 闭包注入。
 * 立项后规划全书分卷结构时调用。卷 = 大纲/卷纲层。
 */
export function makeSetVolumeTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async ({ order, title, goal, synopsis }) => {
      await outlines.upsertVolume(userId, novelId, order, {
        title,
        goal,
        synopsis,
      });
      return { ok: true as const, order, title };
    },
    {
      name: 'set_volume',
      description:
        '创建或更新一卷大纲(卷纲:卷标题/目标/梗概)。立项后规划全书分卷结构时调用。',
      schema: z.object({
        order: z.number().int().describe('卷序号(1-based)'),
        title: z.string().describe('卷标题'),
        goal: z.string().optional().describe('本卷目标'),
        synopsis: z.string().optional().describe('本卷梗概'),
      }),
    },
  );
}

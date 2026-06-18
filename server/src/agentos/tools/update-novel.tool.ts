import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelService } from '../../novel/novel.service';

/**
 * 创作 Agent 的更新小说基础信息工具。userId / novelId 闭包注入(不从 LLM 入参取,
 * 防伪造/越权)。worldviewText / style 映射到 Novel.settings 的对应子字段。
 */
export function makeUpdateNovelTool({
  userId,
  novelId,
  novels,
}: {
  userId: string;
  novelId: string;
  novels: NovelService;
}) {
  return tool(
    async ({ title, genre, worldviewText, style }) => {
      const settings: Record<string, string> = {};
      if (worldviewText) settings.worldviewText = worldviewText;
      if (style) settings.style = style;
      await novels.update(userId, novelId, {
        ...(title !== undefined && { title }),
        ...(genre !== undefined && { genre }),
        ...(Object.keys(settings).length > 0 && { settings }),
      });
      return { ok: true, message: '小说信息已更新。' };
    },
    {
      name: 'update_novel',
      description:
        '更新小说基础信息(书名/类型/世界观/文风)。立项收集到新信息时调用,更新左侧信息卡。',
      schema: z.object({
        title: z.string().optional().describe('书名'),
        genre: z.string().optional().describe('类型/题材'),
        worldviewText: z.string().optional().describe('世界观/设定'),
        style: z.string().optional().describe('文风'),
      }),
    },
  );
}

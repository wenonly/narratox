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
    async ({
      title,
      genre,
      synopsis,
      worldviewText,
      style,
      coreConflict,
      chapterWordTarget,
      totalWordTarget,
    }) => {
      // 读取当前 novel 的 settings,合并(避免覆盖已有的)
      const current = await novels.get(userId, novelId);
      const existing = (current.settings ?? {}) as Record<string, unknown>;
      const merged = { ...existing };
      if (worldviewText) merged.worldviewText = worldviewText;
      if (style) merged.style = style;
      if (coreConflict) merged.coreConflict = coreConflict;
      if (chapterWordTarget) merged.chapterWordTarget = chapterWordTarget;
      if (typeof totalWordTarget === 'number')
        merged.totalWordTarget = totalWordTarget;

      await novels.update(userId, novelId, {
        ...(title !== undefined && { title }),
        ...(genre !== undefined && { genre }),
        ...(synopsis !== undefined && { synopsis }),
        ...(Object.keys(merged).length > 0 && { settings: merged }),
      });
      return { ok: true, message: '小说信息已更新。' };
    },
    {
      name: 'update_novel',
      description:
        '更新小说基础信息(书名/类型/简介/核心冲突/每章字数目标/总字数目标/世界观/文风)。立项收集到新信息时调用,更新左侧信息卡。',
      schema: z.object({
        title: z.string().optional().describe('书名'),
        genre: z.string().optional().describe('类型/题材'),
        synopsis: z
          .string()
          .optional()
          .describe('简介——一两句话概括这本小说讲什么'),
        coreConflict: z
          .string()
          .optional()
          .describe('核心冲突——主角欲望 vs 障碍,全书张力所在(区别于简介)'),
        chapterWordTarget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('每章字数目标——writer 单章字数预算(如 3000)'),
        totalWordTarget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            '全书字数目标——整本书的总字数预算(如 1200000)。网文长篇 100万-300万,中篇 20-50万',
          ),
        worldviewText: z.string().optional().describe('世界观/设定'),
        style: z.string().optional().describe('文风'),
      }),
    },
  );
}

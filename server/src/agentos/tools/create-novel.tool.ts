import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelService } from '../../novel/novel.service';

/**
 * 创作 Agent 的建书工具。userId 闭包注入(不从 LLM 入参取,防伪造/越权)。
 * worldviewText 映射到 Novel.settings.worldviewText(Phase 1 ContextAssembler 会读它)。
 */
export function makeCreateNovelTool({
  userId,
  novels,
}: {
  userId: string;
  novels: NovelService;
}) {
  return tool(
    async ({
      title,
      genre,
      synopsis,
      worldviewText,
      coreConflict,
      chapterWordTarget,
    }) => {
      // 装配 settings:仅收集已提供的子字段;全空则不传 settings(NovelService 默认 {})。
      const settings: Record<string, unknown> = {};
      if (worldviewText) settings.worldviewText = worldviewText;
      if (coreConflict) settings.coreConflict = coreConflict;
      if (chapterWordTarget) settings.chapterWordTarget = chapterWordTarget;
      const novel = await novels.create(userId, {
        title,
        genre: genre ?? undefined,
        synopsis: synopsis ?? undefined,
        ...(Object.keys(settings).length > 0 && { settings }),
      });
      return { novelId: novel.id, message: `已创建小说《${title}》。` };
    },
    {
      name: 'create_novel',
      description:
        '创建一本新小说。当通过对话已收集到足够信息(至少有书名;最好还有类型/故事核/核心冲突/每章字数目标/世界观)时调用。',
      schema: z.object({
        title: z.string().describe('书名(必需)'),
        genre: z.string().optional().describe('类型/题材,如 玄幻/悬疑/武侠'),
        synopsis: z.string().optional().describe('一句话故事——这本小说讲什么'),
        coreConflict: z
          .string()
          .optional()
          .describe('核心冲突——主角欲望 vs 障碍,全书张力所在'),
        chapterWordTarget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('每章字数目标——单章字数预算(如 3000)'),
        worldviewText: z.string().optional().describe('世界观 / 设定'),
      }),
    },
  );
}

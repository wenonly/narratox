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
    async ({ title, genre, synopsis, worldviewText }) => {
      const novel = await novels.create(userId, {
        title,
        genre: genre ?? undefined,
        synopsis: synopsis ?? undefined,
        settings: worldviewText ? { worldviewText } : undefined,
      });
      return { novelId: novel.id, message: `已创建小说《${title}》。` };
    },
    {
      name: 'create_novel',
      description:
        '创建一本新小说。当通过对话已收集到足够信息(至少有书名;最好还有类型/故事核/世界观)时调用。',
      schema: z.object({
        title: z.string().describe('书名(必需)'),
        genre: z.string().optional().describe('类型/题材,如 玄幻/悬疑/武侠'),
        synopsis: z.string().optional().describe('一句话故事 / 核心冲突'),
        worldviewText: z.string().optional().describe('世界观 / 设定'),
      }),
    },
  );
}

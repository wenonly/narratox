import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelService } from '../../novel/novel.service';

/**
 * 主 Agent 的只读"查看当前小说信息"工具。userId / novelId 闭包注入(不从 LLM
 * 入参取,防伪造/越权)。每轮回答用户前由 agent 自发调用,确认哪些基础信息已收集、
 * 哪些还缺失(missing 数组)—— 用 missing 决定下一轮该追问什么。
 *
 * 只读 —— 不走 mutation 层,不改任何状态。
 */
export function makeGetNovelInfoTool({
  userId,
  novelId,
  novels,
}: {
  userId: string;
  novelId: string;
  novels: NovelService;
}) {
  return tool(
    async () => {
      const novel = await novels.get(userId, novelId);
      const settings = (novel.settings ?? {}) as {
        worldviewText?: string;
        style?: string;
      };
      return {
        title: novel.title,
        genre: novel.genre,
        synopsis: novel.synopsis,
        status: novel.status,
        worldviewText: settings.worldviewText ?? null,
        style: settings.style ?? null,
        missing: [
          !novel.title || novel.title === '未命名' ? '书名' : null,
          !novel.genre ? '类型' : null,
          !novel.synopsis ? '简介/故事核' : null,
          !settings.worldviewText ? '世界观' : null,
          !settings.style ? '文风' : null,
        ].filter(Boolean),
      };
    },
    {
      name: 'get_novel_info',
      description:
        '查看当前小说已收集的基础信息(书名/类型/简介/世界观/文风)和缺失字段。每次回答用户前先调用,确认哪些信息已收集、哪些还缺失。',
      schema: z.object({}),
    },
  );
}

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

/**
 * 只读「检索角色完整变化轨迹」工具。userId/novelId 闭包注入。
 * get_character 为控 token 只注入 MAJOR全量+MINOR近30;本工具按需拉全量(可按起止章/
 * 重要性过滤),让注入窗口外的旧 MINOR 也能被查到——不记死数据。镜像 get_events 范式。
 * 返回 JSON 字符串(防数组被部分供应商当多模态块 → 400,见 get-events.tool)。
 */
export function makeGetCharacterHistoryTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({ name, sinceChapter, significance }) => {
      const list = await characters.getCharacterHistory(
        userId,
        novelId,
        name,
        { sinceChapter, significance },
      );
      return JSON.stringify(list);
    },
    {
      name: 'get_character_history',
      description:
        '检索某角色【完整】变化轨迹(get_character 为控 token 只注入 MAJOR全量+MINOR近30;本工具拉全量)。按起止章/重要性过滤。追溯角色弧光、核证旧转变、写涉及角色旧经历/审计一致性时用——让旧 MINOR 不是死数据。返回 {name, changes[]} JSON。',
      schema: z.object({
        name: z.string().describe('角色名(支持别名)'),
        sinceChapter: z
          .number()
          .int()
          .optional()
          .describe('起始章(含);省略=从第 1 章'),
        significance: z
          .enum(['MAJOR', 'MINOR'])
          .optional()
          .describe('重要性过滤;省略=全要'),
      }),
    },
  );
}

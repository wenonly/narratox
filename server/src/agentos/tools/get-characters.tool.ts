import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

export function makeGetCharactersTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({ role }) => {
      const list = await characters.listCharacters(userId, novelId, role);
      // lean:索引(main 已注入 name+role)之外的补充 = currentState(易漂移、一致性核对用)。
      // 稳定档案(appearance/personality/...)只走 get_character(name) 单查,避免一调全档案涌入。
      const CAP = 30;
      const head = list.slice(0, CAP).map((c) => ({
        name: c.name,
        role: c.role,
        aliases: c.aliases,
        currentState: c.currentState,
      }));
      return {
        characters: head,
        ...(list.length > CAP
          ? {
              note: `共 ${list.length} 个,仅显示前 ${CAP};用 role 过滤或 get_character(name) 读稳定档案`,
            }
          : {}),
      };
    },
    {
      name: 'get_characters',
      description:
        '列出角色 lean(名字+定位+别名+当前态,封顶30)。稳定档案(外貌/性格/动机/弧光/语言风格)用 get_character(name) 单查。场景规划/一致性核对时调用。',
      schema: z.object({
        role: z
          .enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'])
          .optional()
          .describe('只列某定位;省略列全部(超30截断)'),
      }),
    },
  );
}

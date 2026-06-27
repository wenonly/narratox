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
      return {
        characters: list.map((c) => ({
          name: c.name,
          role: c.role,
          aliases: c.aliases,
          faction: c.faction,
          background: c.background,
          appearance: c.appearance,
          personality: c.personality,
          motivation: c.motivation,
          arcGoal: c.arcGoal,
          voice: c.voice,
          currentState: c.currentState,
        })),
      };
    },
    {
      name: 'get_characters',
      description:
        '列出全部角色(可按定位过滤)+ 当前态摘要。场景规划(本章哪些角色出场)时调用。',
      schema: z.object({
        role: z
          .enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'])
          .optional()
          .describe('只列某定位;省略列全部'),
      }),
    },
  );
}

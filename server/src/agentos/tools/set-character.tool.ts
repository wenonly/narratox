import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

export function makeSetCharacterTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({ name, role, aliases, faction, background }) => {
      await characters.upsertCharacter(userId, novelId, {
        name,
        role,
        aliases,
        faction,
        background,
      });
      return { ok: true as const, name };
    },
    {
      name: 'set_character',
      description:
        '创建或更新角色(稳定身份:名字/定位/别名/势力/背景)。世界观后建主要角色时调用。',
      schema: z.object({
        name: z.string().describe('角色主名(书内唯一)'),
        role: z
          .enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'])
          .optional()
          .describe('角色定位'),
        aliases: z.array(z.string()).optional().describe('别名/外号'),
        faction: z.string().optional().describe('势力/组织归属'),
        background: z.string().optional().describe('身世背景(角色前史)'),
      }),
    },
  );
}

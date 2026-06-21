import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

export function makeGetCharacterTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({ name }) => {
      const ch = await characters.getCharacter(userId, novelId, name);
      if (!ch)
        return { ok: false as const, reason: 'no_character' as const, name };
      return { ok: true as const, ...ch };
    },
    {
      name: 'get_character',
      description:
        '取角色当前态(性格/能力/关系/状态——从时间线最新值派生)+ 成长时间线。写涉及该角色的场景前调用。',
      schema: z.object({
        name: z.string().describe('角色名'),
      }),
    },
  );
}

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

/** char-writer 的「清空全书角色」工具。ACTIVE 返 warning(不拦,对标 clear_master_outline)。 */
export function makeClearCharactersTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(async () => characters.clearCharacters(userId, novelId), {
    name: 'clear_characters',
    description:
      '清空全书角色 bible(角色 + 变迁史,$transaction 原子)。ACTIVE 小说返 warning(bible 是 writer/validator 的依据),但不拦。仅在作者明确要求「重建角色体系」时调用。不是「重写某角色」的快捷方式(那是 set_character merge)。',
    schema: z.object({}),
  });
}

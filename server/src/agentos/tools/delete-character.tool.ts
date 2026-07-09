import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

/** char-writer 的「删角色」工具。cascade 默认 false:有变迁史返清单(对标 delete_volume)。 */
export function makeDeleteCharacterTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({ name, cascade }) =>
      characters.deleteCharacter(userId, novelId, name, cascade ?? false),
    {
      name: 'delete_character',
      description:
        '删单个角色(by name)。该角色的 CharacterChange 变迁史处理:cascade=false(默认)→ 有变迁史拒绝返清单(不偷删);cascade=true → 连删变迁史+角色(事务原子)。单删是显式请求,不拦 ACTIVE。改名不做 rename(身份不可变),要改 = 新建旧删。',
      schema: z.object({
        name: z.string().describe('角色主名(或别名,会解析到 canonical)'),
        cascade: z
          .boolean()
          .optional()
          .describe('有变迁史时是否连删:true=连删;false(默认)=拒绝返清单'),
      }),
    },
  );
}

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
    async ({
      name,
      role,
      aliases,
      faction,
      background,
      appearance,
      personality,
      motivation,
      arcGoal,
      voice,
      growth,
      flaw,
      clear_fields,
    }) => {
      await characters.upsertCharacter(userId, novelId, {
        name,
        role,
        aliases,
        faction,
        background,
        appearance,
        personality,
        motivation,
        arcGoal,
        voice,
        growth,
        flaw,
        clear_fields,
      });
      return { ok: true as const, name };
    },
    {
      name: 'set_character',
      description:
        '创建或更新角色人物小传(稳定身份:名字/定位/别名/势力/出身/成长经历/外貌/性格/动机/弱点/弧光/语言风格)。按 role 分层:主角/反派全填深,配角精简。建/丰富角色档案时调用。改某字段直接传新值(未传字段保留旧值);要清空某字段回空用 clear_fields(比空串更明确)。',
      schema: z.object({
        name: z.string().describe('角色主名(书内唯一)'),
        role: z
          .enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'])
          .nullish()
          .describe('角色定位(决定小传填多深:主角/反派全填,配角精简)'),
        aliases: z.array(z.string()).nullish().describe('别名/外号'),
        faction: z.string().nullish().describe('势力/组织归属'),
        background: z.string().nullish().describe('身世背景(出身/前史)'),
        growth: z
          .string()
          .nullish()
          .describe('成长经历:塑造性格的重大事件(防 OOC 的根;来路)'),
        appearance: z.string().nullish().describe('外貌/记忆点'),
        personality: z.string().nullish().describe('性格基调'),
        motivation: z.string().nullish().describe('执念/动机/欲望'),
        flaw: z.string().nullish().describe('弱点/执念阴暗面(挣扎与蜕变之源)'),
        arcGoal: z.string().nullish().describe('弧光目标(归宿/成长终点)'),
        voice: z.string().nullish().describe('语言风格/口头禅'),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe(
            '要清空成 "" 的字段名(白名单:faction/background/appearance/personality/motivation/arcGoal/voice/growth/flaw)。比传空串更明确。未传字段保留旧值;clear_fields 是显式清空。',
          ),
      }),
    },
  );
}

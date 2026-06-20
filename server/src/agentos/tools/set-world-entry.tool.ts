import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WorldEntryService } from '../../novel/world-entry.service';

/**
 * main agent 的「创建/更新一条世界观条目」工具。userId/novelId 闭包注入。
 * 构建世界观时调用:产出 concept(总览)/powerSystem(力量体系)/location/
 * faction/race/rule(禁忌)/item/history 等条目。按 name upsert。
 */
export function makeSetWorldEntryTool({
  userId,
  novelId,
  world,
}: {
  userId: string;
  novelId: string;
  world: WorldEntryService;
}) {
  return tool(
    async ({ type, name, content }) => {
      await world.upsertEntry(userId, novelId, { type, name, content });
      return { ok: true as const, type, name };
    },
    {
      name: 'set_world_entry',
      description:
        '创建或更新一条世界观条目(设定卡片)。构建世界观时调用:力量体系/地点/势力/种族/规则禁忌/物品/历史等。同名条目会被更新。',
      schema: z.object({
        type: z
          .enum([
            'concept',
            'powerSystem',
            'location',
            'faction',
            'race',
            'rule',
            'item',
            'history',
          ])
          .describe(
            '条目类型:concept=设定/总览, powerSystem=力量体系, location=地点, faction=势力/组织, race=种族/生物, rule=规则/禁忌, item=物品/资源, history=历史/传说',
          ),
        name: z.string().describe('条目名(如「玄天宗」「灵气修炼」),书内唯一'),
        content: z.string().describe('条目内容(markdown,自由描述)'),
      }),
    },
  );
}

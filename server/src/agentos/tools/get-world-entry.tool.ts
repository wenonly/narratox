import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WorldEntryService } from '../../novel/world-entry.service';

/**
 * main + writer 的「取单条世界观条目」工具(只读)。userId/novelId 闭包注入。
 * writer 写到某地点/势力/规则时按 name 查细节全文,避免编造与设定冲突。
 */
export function makeGetWorldEntryTool({
  userId,
  novelId,
  world,
}: {
  userId: string;
  novelId: string;
  world: WorldEntryService;
}) {
  return tool(
    async ({ name }) => {
      const entry = await world.getEntry(userId, novelId, name);
      if (!entry) {
        return { ok: false as const, reason: 'no_entry' as const, name };
      }
      return { ok: true as const, ...entry };
    },
    {
      name: 'get_world_entry',
      description:
        '按 name 取单条世界观条目全文(地点/势力/规则等的细节)。写涉及该设定前调用核实。无此条目返回 ok=false。',
      schema: z.object({
        name: z.string().describe('条目名(如「玄天宗」)'),
      }),
    },
  );
}

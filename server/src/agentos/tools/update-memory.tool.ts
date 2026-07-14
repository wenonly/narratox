import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ProcessMemoryService } from '../../memory/process-memory.service';

/**
 * main 的过程记忆写入工具(只挂 main)。整段重写:main 传完整新内容,不是 append delta。
 * 字段语义:undefined=保留原值;""=清空该段;非空字符串=设新值。
 * userId/novelId 闭包注入(防越权,同所有现有工具)。
 */
export function makeUpdateMemoryTool({
  userId,
  novelId,
  processMemory,
}: {
  userId: string;
  novelId: string;
  processMemory: ProcessMemoryService;
}) {
  return tool(
    async ({ rules, lessons, decisions }) => {
      if (
        rules === undefined &&
        lessons === undefined &&
        decisions === undefined
      ) {
        return { ok: false as const, reason: 'no_fields' as const };
      }
      const result = await processMemory.upsert(userId, novelId, {
        rules,
        lessons,
        decisions,
      });
      if (!result) {
        return { ok: false as const, reason: 'denied' as const };
      }
      return { ok: true as const, ...result };
    },
    {
      name: 'update_memory',
      description:
        '更新本书过程记忆(规矩/经验/决策)。整段重写:把"现有内容(见上方注入)+ 本轮新增"合并压缩后传完整新内容,不要 append。字段语义:不传=保留原值;空串=清空该段;非空=设新值。各段字数上限:规矩/经验 ≤800 字、决策 ≤1200 字 —— 超了合并相似条目/淘汰过时条目/提炼更精炼表述,不要简单截断。【近期决策】超 10 条时把有长期价值的升段进【经验】再从决策段删。只传本轮有变化的段。本轮对话结束前必须调用一次。',
      schema: z.object({
        rules: z
          .string()
          .optional()
          .describe(
            '【本书规矩】完整新内容(本书硬性写作要求,如"不用第一人称")',
          ),
        lessons: z
          .string()
          .optional()
          .describe(
            '【经验教训】完整新内容(提炼出的写作经验,如"本书偏好短章快节奏")',
          ),
        decisions: z
          .string()
          .optional()
          .describe('【近期决策】完整新内容(最近重要决策/尝试,保持≤10条)'),
      }),
    },
  );
}

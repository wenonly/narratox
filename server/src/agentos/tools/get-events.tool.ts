import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { EventService } from '../../memory/event.service';

/**
 * 只读「检索过往故事事件」工具(Phase 11)。userId/novelId 闭包注入。
 * 返回 JSON 字符串(防数组被部分供应商当多模态块 → 400,见 get-reference.tool)。
 * 结构化过滤(章范围/角色/重要性/关键词),补 query_memory 关键词 contains 短板。
 */
export function makeGetEventsTool({
  userId,
  novelId,
  eventService,
}: {
  userId: string;
  novelId: string;
  eventService: EventService;
}) {
  return tool(
    async (args) => {
      const list = await eventService.listEvents(userId, novelId, args);
      return JSON.stringify(list);
    },
    {
      name: 'get_events',
      description:
        '检索过往故事事件(「发生了什么」账本)。按章范围/角色名/重要性/关键词查。写涉及旧情节、核证「是否已发生过某事」时用(补 query_memory 关键词短板)。返回事件列表 JSON。',
      schema: z.object({
        chapterFrom: z.number().int().optional().describe('起始章(含)'),
        chapterTo: z.number().int().optional().describe('结束章(含)'),
        character: z.string().optional().describe('涉及的角色名'),
        significance: z
          .enum(['MAJOR', 'MINOR'])
          .optional()
          .describe('重要性过滤'),
        keyword: z.string().optional().describe('description 关键词'),
      }),
    },
  );
}

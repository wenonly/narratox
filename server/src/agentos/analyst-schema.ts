import { z } from 'zod';

/**
 * Analyst 结构化输出 schema。MUST 用 withStructuredOutput(schema, { method:'functionCalling' })
 * —— spike 证明这是 z.ai coding 端点唯一可用的 method。
 */
export const analystSchema = z.object({
  summary: z.string().describe('本章一句话情节摘要'),
  roleChanges: z.array(
    z.object({ name: z.string(), change: z.string().describe('状态变化') }),
  ),
  entities: z.array(
    z.object({
      type: z.enum(['item', 'place', 'setting']),
      name: z.string(),
      note: z.string().describe('一句话说明'),
    }),
  ),
  newHooks: z.array(z.string().describe('本章新埋下的伏笔描述')),
  resolvedHookIds: z.array(
    z.string().describe('从输入的 OPEN 伏笔列表里,本章回收了的 id'),
  ),
});
export type AnalystOutput = z.infer<typeof analystSchema>;

/**
 * GET /novels/:id/chapters/:order/summary 返回的形状(从 DB 重建)。
 * settled=false → 前端继续轮询。
 */
export interface MemoryData {
  settled: boolean;
  chapterOrder: number;
  summary: string;
  roleChanges: { name: string; change: string }[];
  entities: {
    type: 'item' | 'place' | 'setting';
    name: string;
    note: string;
  }[];
  newHooks: { id: string; description: string }[];
  resolvedHooks: { id: string; description: string }[];
}

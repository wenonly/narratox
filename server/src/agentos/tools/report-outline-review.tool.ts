import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * outline-critic 子 agent 的「提交大纲评审结构化判定」工具。**瞬态**——不写库,
 * 只把 6 维审计结果结构化返回(经 tool result 回到 outline-critic,活动流亦可见)。
 * outline-critic 据此给编排者(outliner)最终判定;outliner 据 passed/blockingIssues
 * 决定是否进入外科式修订闭环(blockingIssues 须点名是哪卷/哪章,驱动 outline-writer 定点改)。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportOutlineReviewTool() {
  return tool(
    // 纯结构化返回,无 I/O;保持 async 与其它工具一致,显式忽略 require-await。
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ passed, score, dimensions, blockingIssues, notes }) => ({
      ok: true,
      passed,
      score,
      dimensions,
      blockingIssues,
      notes,
    }),
    {
      name: 'report_outline_review',
      description:
        '提交大纲评审的结构化判定:6 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修、且须点名是哪卷/哪章)+ notes(非阻塞)。评审完必调,代替散文结论。',
      schema: z.object({
        passed: z.boolean().describe('是否通过(blockingIssues 为空 → true)'),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe('全局质量分 0-100(用于修订前后比较)'),
        dimensions: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  '维度名:故事核匹配 / 主线暗线结构 / 力量金手指节奏 / 卷间节奏起承转合 / 情节引擎爽点 / 伏笔布局衔接一致性',
                ),
              status: z.enum(['pass', 'issue']),
              issue: z
                .string()
                .optional()
                .describe('status=issue 时的问题描述'),
            }),
          )
          .describe('逐维判定(6 维)'),
        blockingIssues: z
          .array(z.string())
          .describe(
            '会让结构崩/写不下去、必须修的问题(主线断裂/暗线无回收/伏笔脱节/与故事核矛盾/卷断层/核心条目缺失),每条须点名是哪卷/哪章(如「卷2『药老复苏』...」「第8章细纲...」)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(节奏/偏好)'),
      }),
    },
  );
}

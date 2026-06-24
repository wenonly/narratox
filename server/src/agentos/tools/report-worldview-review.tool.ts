import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * wb-critic 子 agent 的「提交世界观评审结构化判定」工具。**瞬态**——不写库,
 * 只把 6 维审计结果结构化返回(经 tool result 回到 wb-critic,活动流亦可见)。
 * wb-critic 据此给编排者(worldbuilder)最终判定;worldbuilder 据 passed/blockingIssues
 * 决定是否进入外科式修订闭环(blockingIssues 须点名是哪条 entry,驱动 wb-writer 定点改)。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportWorldviewReviewTool() {
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
      name: 'report_worldview_review',
      description:
        '提交世界观评审的结构化判定:6 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修、且须点名是哪条 entry)+ notes(非阻塞)。评审完必调,代替散文结论。',
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
                  '维度名:逻辑自洽 / 支撑情节可写性 / 力量体系金手指严谨 / 代入感现实微创新 / 要素完备 / 故事核匹配',
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
            '会让设定崩/写不下去、必须修的问题(自洽冲突/力量体系漏洞/与故事核矛盾/核心条目缺失),每条须点名是哪条 entry(如 powerSystem『灵气修炼』...)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(风格/偏好)'),
      }),
    },
  );
}

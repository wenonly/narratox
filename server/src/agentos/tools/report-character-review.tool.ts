import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * char-critic 子 agent 的「提交角色评审结构化判定」工具。**瞬态**——不写库,
 * 只把 6 维审计结果结构化返回(经 tool result 回到 char-critic,活动流亦可见)。
 * char-critic 据此给编排者(character)最终判定;character 据 passed/blockingIssues
 * 决定是否进入外科式修订闭环(blockingIssues 须点名是哪个角色,驱动 char-writer 定点改)。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportCharacterReviewTool() {
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
      name: 'report_character_review',
      description:
        '提交角色档案评审的结构化判定:6 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修、且须点名是哪个角色)+ notes(非阻塞)。评审完必调,代替散文结论。',
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
                  '维度名:区分度 / 一致性 / 弧光可行性 / 语言风格区分 / 关系合理性 / 动机可信',
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
            '会让角色立不住、必须修的问题(区分度不足/与世界设定矛盾/弧光与大纲冲突/动机不可信/核心角色缺失),每条须点名是哪个角色(如「主角『沈砚』arcGoal 与大纲冲突」)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(语言风格/偏好)'),
      }),
    },
  );
}

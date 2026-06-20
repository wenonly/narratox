import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * validator 子 agent 的「提交结构化校验判定」工具。**瞬态**——不写库,
 * 只把 6-7 维审计结果结构化返回(经 tool result 回到 validator,活动流亦可见)。
 * validator 据此给编排者(main agent)最终判定;main agent 据 passed/score
 * 决定是否进入修订闭环(D1),据 score 高低决定是否回滚。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportReviewTool() {
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
      name: 'report_review',
      description:
        '提交本章校验的结构化判定:6-7 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修的)+ notes(非阻塞)。校验完必调,代替散文结论。',
      schema: z.object({
        passed: z.boolean().describe('是否通过(blockingIssues 为空 → true)'),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe('全局质量分 0-100(用于修订前后比较/回滚)'),
        dimensions: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  '维度名:人物一致 / 设定世界观 / 战力 / 伏笔 / 时间线逻辑 / 文风视角',
                ),
              status: z.enum(['pass', 'issue']),
              issue: z
                .string()
                .optional()
                .describe('status=issue 时的问题描述'),
            }),
          )
          .describe('逐维判定(建议覆盖 6-7 个维度)'),
        blockingIssues: z
          .array(z.string())
          .describe(
            '会导致读者出戏/设定崩、必须修的问题(人物/设定/战力/伏笔/逻辑冲突)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(如文风微调、节奏)'),
      }),
    },
  );
}

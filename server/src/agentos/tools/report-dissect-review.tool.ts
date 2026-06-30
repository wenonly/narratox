import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 拆解 tool(Phase 22):提交拆解质量报告,存 BenchmarkBook.review(完整性/缺失/备注)。
 * bookId 闭包注入——只能 review 当前拆解对象。
 */
export interface ReportDissectReviewDeps {
  bookId: string;
  prisma: PrismaService;
}

export const makeReportDissectReviewTool = (d: ReportDissectReviewDeps) =>
  tool(
    async ({ summary, missingTypes, notes }) => {
      await d.prisma.benchmarkBook.update({
        where: { id: d.bookId },
        data: {
          review: { summary, missingTypes, notes } as never,
        },
      });
      return { ok: true };
    },
    {
      name: 'report_dissect_review',
      description: '提交拆解质量报告(完整性/缺失/备注)。',
      schema: z.object({
        summary: z.string(),
        missingTypes: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
    },
  );

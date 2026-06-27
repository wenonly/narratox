import type { PrismaService } from '../../src/prisma/prisma.service';

/** DB 状态断言(L1/L2 共用)。直接查 PrismaService(真 DB)。 */

export async function assertChapterCommitted(
  prisma: PrismaService,
  novelId: string,
  order: number,
  minChars: number,
): Promise<void> {
  const ch = await prisma.chapter.findFirst({
    where: { novelId, order },
  });
  if (!ch) throw new Error(`第 ${order} 章不存在`);
  if (ch.status !== 'COMMITTED')
    throw new Error(`第 ${order} 章 status=${ch.status}(期望 COMMITTED)`);
  if ((ch.content || '').length < minChars)
    throw new Error(
      `第 ${order} 章 ${(ch.content || '').length} 字 < ${minChars}`,
    );
}

export async function assertSummaryExists(
  prisma: PrismaService,
  novelId: string,
  order: number,
): Promise<void> {
  const sum = await prisma.chapterSummary.findFirst({
    where: { novelId, chapter: { order } },
  });
  if (!sum) throw new Error(`第 ${order} 章无 ChapterSummary(未结算)`);
  if (!sum.summary) throw new Error(`第 ${order} 章 summary 为空`);
}

export async function assertEventsExist(
  prisma: PrismaService,
  novelId: string,
  order: number,
  minCount: number,
): Promise<void> {
  const count = await prisma.event.count({
    where: { novelId, chapterOrder: order },
  });
  if (count < minCount)
    throw new Error(`第 ${order} 章 Event ${count} 条 < ${minCount}`);
}

export async function assertNovelStatus(
  prisma: PrismaService,
  novelId: string,
  expected: string,
): Promise<void> {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { status: true },
  });
  if (!novel) throw new Error(`novel ${novelId} 不存在`);
  if (novel.status !== expected)
    throw new Error(`novel status=${novel.status}(期望 ${expected})`);
}

/** 清理测试 novel(cascade 删所有关联)。 */
export async function cleanupNovel(
  prisma: PrismaService,
  novelId: string,
): Promise<void> {
  try {
    await prisma.novel.delete({ where: { id: novelId } });
  } catch {
    // 已删/不存在 → 忽略
  }
}

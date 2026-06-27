import { PrismaService } from '../../src/prisma/prisma.service';

/** 创建测试 User+Session+Novel(CONCEPT)+Chapter(DRAFT),返回 ids。afterAll 用 teardown 删 User(cascade 全部)。 */
export async function setupTestNovel(prefix = 'L1-') {
  const prisma = new PrismaService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await prisma.user.create({
    data: { email: `${prefix}${suffix}@test.narratox`, passwordHash: 'x' },
  });
  const session = await prisma.session.create({
    data: { id: `sess-${suffix}`, userId: user.id, name: 'L1-test' },
  });
  const novel = await prisma.novel.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      title: `${prefix}novel`,
      status: 'CONCEPT',
      settings: {},
    },
  });
  const chapter = await prisma.chapter.create({
    data: { novelId: novel.id, order: 1, title: '第1章', content: '', status: 'DRAFT' },
  });
  return {
    prisma,
    userId: user.id,
    novelId: novel.id,
    sessionId: session.id,
    chapterId: chapter.id,
  };
}

/** 删除测试 User(cascade: novel/session/chapter/outline/summary/event/arc/...)。 */
export async function teardown(prisma: PrismaService, userId: string) {
  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch {
    // 已删/不存在
  }
}

/** 创建一条最小 ChapterOutline(让 assertHasPlan 通过)。 */
export async function seedOutline(
  prisma: PrismaService,
  novelId: string,
  order: number,
) {
  return prisma.chapterOutline.create({
    data: {
      novelId,
      chapterOrder: order,
      title: `第${order}章`,
      cbn: { subject: '主角', action: '出场', target: '演武场' },
      cpns: [{ subject: '主角', action: '战斗', target: '对手' }],
      cen: { subject: '主角', action: '胜', target: '对手' },
      mustCover: ['主角出场'],
      forbidden: [],
      status: 'APPROVED',
    },
  });
}

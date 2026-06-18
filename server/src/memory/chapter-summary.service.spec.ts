import { SummaryService } from './chapter-summary.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  chapterSummary: {
    upsert: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
}
const makePrismaMock = (): PrismaMock => ({
  chapterSummary: {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
});

describe('SummaryService', () => {
  it('upserts by chapterId with merged JSON fields', async () => {
    const prisma = makePrismaMock();
    prisma.chapterSummary.upsert.mockResolvedValue({ id: 's1' });
    const svc = new SummaryService(prisma as unknown as PrismaService);
    await svc.upsert({
      userId: 'u1',
      novelId: 'n1',
      chapterId: 'c1',
      summary: '主角下山',
      roleChanges: [{ name: '陈平安', change: '觉醒' }],
      entities: [{ type: 'item', name: '剑', note: '所得' }],
    });
    expect(prisma.chapterSummary.upsert).toHaveBeenCalledWith({
      where: { chapterId: 'c1' },
      create: {
        chapterId: 'c1',
        novelId: 'n1',
        summary: '主角下山',
        roleChanges: [{ name: '陈平安', change: '觉醒' }],
        entities: [{ type: 'item', name: '剑', note: '所得' }],
      },
      update: {
        novelId: 'n1',
        summary: '主角下山',
        roleChanges: [{ name: '陈平安', change: '觉醒' }],
        entities: [{ type: 'item', name: '剑', note: '所得' }],
      },
    });
  });

  it('findByChapter returns null when absent, the row when present', async () => {
    const prisma = makePrismaMock();
    prisma.chapterSummary.findFirst.mockResolvedValue({
      id: 's1',
      summary: 'x',
    });
    const svc = new SummaryService(prisma as unknown as PrismaService);
    const got = await svc.findByChapter('u1', 'n1', 'c1');
    expect(prisma.chapterSummary.findFirst).toHaveBeenCalledWith({
      where: {
        chapterId: 'c1',
        novelId: 'n1',
        chapter: { novel: { userId: 'u1' } },
      },
    });
    expect(got).toEqual({ id: 's1', summary: 'x' });
  });

  it('listRecent returns N summaries ordered by chapter order desc', async () => {
    const prisma = makePrismaMock();
    prisma.chapterSummary.findMany.mockResolvedValue([
      { summary: '第3章', chapter: { order: 3 } },
      { summary: '第2章', chapter: { order: 2 } },
    ]);
    const svc = new SummaryService(prisma as unknown as PrismaService);
    const rows = await svc.listRecent('u1', 'n1', 5);
    expect(prisma.chapterSummary.findMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', chapter: { novel: { userId: 'u1' } } },
      take: 5,
      orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    expect(rows).toEqual([
      { summary: '第3章', chapterOrder: 3 },
      { summary: '第2章', chapterOrder: 2 },
    ]);
  });
});

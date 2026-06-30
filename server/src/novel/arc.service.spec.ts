import { ArcService } from './arc.service';

const mockPrisma = (arcRow: unknown = null) => ({
  novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1' }) },
  arc: {
    upsert: jest.fn().mockResolvedValue({ id: 'a1' }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(arcRow),
    update: jest.fn().mockResolvedValue({}),
  },
  volume: { update: jest.fn().mockResolvedValue({}) },
  chapterOutline: { findFirst: jest.fn().mockResolvedValue(null) },
});

describe('ArcService', () => {
  it('upsertArc 按 (novelId,order) upsert,过 ownership 校验', async () => {
    const prisma = mockPrisma();
    const svc = new ArcService(prisma as any);
    await svc.upsertArc('u1', 'n1', {
      order: 1,
      title: '拜师',
      goal: '得师父真传',
      fromChapter: 9,
      toChapter: 15,
    });
    expect(prisma.novel.findFirst).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1' },
      select: { id: true },
    });
    expect(prisma.arc.upsert).toHaveBeenCalled();
    const arg = prisma.arc.upsert.mock.calls[0][0];
    expect(arg.where.novelId_order).toEqual({ novelId: 'n1', order: 1 });
    expect(arg.create).toMatchObject({
      title: '拜师',
      fromChapter: 9,
      toChapter: 15,
    });
  });

  it('listArcs scope by userId,按 fromChapter asc', async () => {
    const prisma = mockPrisma();
    const svc = new ArcService(prisma as any);
    await svc.listArcs('u1', 'n1');
    expect(prisma.arc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { novelId: 'n1', novel: { userId: 'u1' } },
        orderBy: { fromChapter: 'asc' },
      }),
    );
  });

  it('findArcByChapter range 命中(fromChapter≤N≤toChapter)', async () => {
    const prisma = mockPrisma({ id: 'a1', fromChapter: 9, toChapter: 15 });
    const svc = new ArcService(prisma as any);
    await svc.findArcByChapter('u1', 'n1', 12);
    expect(prisma.arc.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          novelId: 'n1',
          fromChapter: { lte: 12 },
          toChapter: { gte: 12 },
          novel: { userId: 'u1' },
        },
      }),
    );
  });

  it('updateProgressSummary:arc 命中→更新 arc.summary;volume(arc.volumeId)→更新 volume.arcSummary', async () => {
    const prisma = mockPrisma({ id: 'a1', volumeId: 'v1' });
    const svc = new ArcService(prisma as any);
    await svc.updateProgressSummary('u1', 'n1', 12, '弧进展X', '卷进展Y');
    expect(prisma.arc.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { summary: '弧进展X' },
    });
    expect(prisma.volume.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { arcSummary: '卷进展Y' },
    });
  });

  it('updateProgressSummary:无 arc、回落 ChapterOutline.volumeId', async () => {
    const prisma = mockPrisma(null);
    prisma.chapterOutline.findFirst.mockResolvedValue({ volumeId: 'v2' });
    const svc = new ArcService(prisma as any);
    await svc.updateProgressSummary('u1', 'n1', 12, undefined, '卷进展Z');
    expect(prisma.arc.update).not.toHaveBeenCalled();
    expect(prisma.chapterOutline.findFirst).toHaveBeenCalled();
    expect(prisma.volume.update).toHaveBeenCalledWith({
      where: { id: 'v2' },
      data: { arcSummary: '卷进展Z' },
    });
  });

  it('updateProgressSummary:都解析不到→不抛错', async () => {
    const prisma = mockPrisma(null);
    const svc = new ArcService(prisma as any);
    await expect(
      svc.updateProgressSummary('u1', 'n1', 12, '弧', '卷'),
    ).resolves.toBeUndefined();
    expect(prisma.arc.update).not.toHaveBeenCalled();
    expect(prisma.volume.update).not.toHaveBeenCalled();
  });
});

import { EventService } from './event.service';

const mockPrisma = (eventFindMany: unknown = []) => ({
  event: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    findMany: jest.fn().mockResolvedValue(eventFindMany),
  },
  novel: {
    findFirst: jest.fn().mockResolvedValue({ id: 'n1' }), // 默认归属校验通过
  },
});

describe('EventService', () => {
  it('createEvents 批量写入(过 userId scope 校验)', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    const out = await svc.createEvents(
      'u1',
      'n1',
      [
        {
          description: '发现血书',
          significance: 'MAJOR',
          involvedCharacters: ['沈砚'],
        },
      ],
      12,
    );
    expect(prisma.novel.findFirst).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1' },
      select: { id: true },
    });
    expect(prisma.event.createMany).toHaveBeenCalled();
    const arg = (prisma.event.createMany as jest.Mock).mock.calls[0][0];
    expect(arg.data[0]).toMatchObject({
      novelId: 'n1',
      chapterOrder: 12,
      description: '发现血书',
      significance: 'MAJOR',
      involvedCharacters: ['沈砚'],
    });
    expect(out).toEqual({ count: 1 });
  });

  it('createEvents 空数组不写', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    await svc.createEvents('u1', 'n1', [], 12);
    expect(prisma.event.createMany).not.toHaveBeenCalled();
  });

  it('createEvents novel 不归属 user → 不写(count 0)', async () => {
    const prisma = mockPrisma();
    prisma.novel.findFirst = jest.fn().mockResolvedValue(null);
    const svc = new EventService(prisma as any);
    const out = await svc.createEvents(
      'u1',
      'n1',
      [{ description: 'x', significance: 'MAJOR' }],
      12,
    );
    expect(prisma.event.createMany).not.toHaveBeenCalled();
    expect(out).toEqual({ count: 0 });
  });

  it('listRecentMajor 只取 MAJOR,按 chapterOrder desc,limit', async () => {
    const prisma = mockPrisma([
      { chapterOrder: 12, description: 'a', significance: 'MAJOR' },
    ]);
    const svc = new EventService(prisma as any);
    const out = await svc.listRecentMajor('u1', 'n1', 8);
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          novelId: 'n1',
          significance: 'MAJOR',
          novel: { userId: 'u1' },
        },
        orderBy: { chapterOrder: 'desc' },
        take: 8,
      }),
    );
    expect(out).toHaveLength(1);
  });

  it('listEvents 支持过滤(章范围/角色/significance/keyword)', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    await svc.listEvents('u1', 'n1', {
      chapterFrom: 5,
      chapterTo: 20,
      character: '沈砚',
      significance: 'MAJOR',
      keyword: '血书',
    });
    const arg = (prisma.event.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.chapterOrder).toEqual({ gte: 5, lte: 20 });
    expect(arg.where.involvedCharacters).toEqual({ has: '沈砚' });
    expect(arg.where.significance).toBe('MAJOR');
    expect(arg.where.description).toEqual({ contains: '血书' });
    expect(arg.where.novel).toEqual({ userId: 'u1' });
  });

  it('listForPanel 全量按 chapterOrder asc', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    await svc.listForPanel('u1', 'n1');
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { novelId: 'n1', novel: { userId: 'u1' } },
        orderBy: { chapterOrder: 'asc' },
      }),
    );
  });
});

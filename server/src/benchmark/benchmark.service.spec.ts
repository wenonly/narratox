import { BenchmarkService } from './benchmark.service';

const prisma = {
  benchmarkBook: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
  benchmarkEntry: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};
const svc = new BenchmarkService(prisma as never);

beforeEach(() => jest.clearAllMocks());

describe('BenchmarkService', () => {
  it('list 按 userId 倒序', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([
      { id: 'b1', title: '盘龙' },
    ]);
    const out = await svc.list('u1');
    expect(out[0].id).toBe('b1');
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });

  it('upload 建 book + 切分 chapters', async () => {
    prisma.benchmarkBook.create.mockImplementation(
      async (args: {
        data: { userId: string; title: string; chapters: unknown };
      }) => ({ id: 'b1', ...args.data, chapters: args.data.chapters }),
    );
    const r = await svc.upload('u1', '盘龙', '第一章 出场\n内容');
    expect(prisma.benchmarkBook.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          title: '盘龙',
          status: 'PENDING',
        }),
      }),
    );
    expect(r.id).toBe('b1');
    expect((r.chapters as Array<{ chapterNo: number }>).length).toBeGreaterThan(
      0,
    );
  });

  it('get 含 entries', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    prisma.benchmarkEntry.findMany.mockResolvedValue([]);
    const r = await svc.getWithEntries('u1', 'b1');
    expect(r?.id).toBe('b1');
  });

  it('get 不归属 → throw', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue(null);
    await expect(svc.get('u1', 'bX')).rejects.toThrow();
  });

  it('delete 删 book + entries', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    await svc.delete('u1', 'b1');
    expect(prisma.benchmarkEntry.deleteMany).toHaveBeenCalledWith({
      where: { bookId: 'b1' },
    });
    expect(prisma.benchmarkBook.delete).toHaveBeenCalledWith({
      where: { id: 'b1' },
    });
  });

  it('writeEntry 写一条(options 对象)', async () => {
    await svc.writeEntry('b1', {
      type: 'CHAPTER',
      title: '第1章',
      content: '内容',
      chapterNo: 1,
    });
    expect(prisma.benchmarkEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookId: 'b1',
          type: 'CHAPTER',
          chapterNo: 1,
        }),
      }),
    );
  });

  it('writeEntry MATERIAL 带 kind/purposes', async () => {
    await svc.writeEntry('b1', {
      type: 'MATERIAL',
      title: '学霸考完·单人应援',
      content: '【原文锚点】…',
      kind: '梗',
      purposes: ['爽点', '打脸装逼'],
    });
    expect(prisma.benchmarkEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'MATERIAL',
          kind: '梗',
          purposes: ['爽点', '打脸装逼'],
        }),
      }),
    );
  });

  it('getEntries 按 order 倒序,支持 type/chapterNo 过滤', async () => {
    prisma.benchmarkEntry.findMany.mockResolvedValue([]);
    await svc.getEntries('b1', 'CHAPTER', 2);
    expect(prisma.benchmarkEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookId: 'b1', type: 'CHAPTER', chapterNo: 2 },
        orderBy: { order: 'asc' },
      }),
    );
  });

  it('markInterruptedOnBoot: RUNNING → INTERRUPTED', async () => {
    await svc.markInterruptedOnBoot();
    expect(prisma.benchmarkBook.updateMany).toHaveBeenCalledWith({
      where: { status: 'RUNNING' },
      data: { status: 'INTERRUPTED' },
    });
  });
});

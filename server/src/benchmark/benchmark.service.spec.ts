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
    groupBy: jest.fn(),
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

  it('updateEntryTitle: 改标题(归属校验)', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    prisma.benchmarkEntry.update.mockResolvedValue({ id: 'e1', title: '新名' });
    const r = await svc.updateEntryTitle('u1', 'b1', 'e1', '新名');
    expect(r.title).toBe('新名');
    expect(prisma.benchmarkEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: { title: '新名' },
      }),
    );
  });

  it('updateEntryTitle: 书不归属 → throw', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue(null);
    await expect(
      svc.updateEntryTitle('u1', 'bX', 'e1', '新名'),
    ).rejects.toThrow();
  });

  it('updateEntryTitle: 空标题 → throw', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    await expect(
      svc.updateEntryTitle('u1', 'b1', 'e1', '   '),
    ).rejects.toThrow();
  });

  it('listBooksWithEntryCounts: 聚合 userId 名下每本书的各 type 条目数', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([
      {
        id: 'b1',
        title: '盘龙',
        status: 'DONE',
        chapters: [{ chapterNo: 1 }, { chapterNo: 2 }],
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    prisma.benchmarkEntry.groupBy.mockResolvedValue([
      { bookId: 'b1', type: 'PLOT', _count: { _all: 5 } },
      { bookId: 'b1', type: 'STYLE', _count: { _all: 3 } },
    ]);
    const out = await svc.listBooksWithEntryCounts('u1');
    expect(out).toEqual([
      {
        id: 'b1',
        title: '盘龙',
        status: 'DONE',
        chapterCount: 2,
        entryCountByType: { PLOT: 5, STYLE: 3 },
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(prisma.benchmarkEntry.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['bookId', 'type'],
        where: { bookId: { in: ['b1'] } },
        _count: { _all: true },
      }),
    );
  });

  it('listBooksWithEntryCounts: chapters 非数组时 chapterCount=0', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([
      {
        id: 'b2',
        title: '坏书',
        status: 'PENDING',
        chapters: null,
        updatedAt: new Date(0),
      },
    ]);
    prisma.benchmarkEntry.groupBy.mockResolvedValue([]);
    const out = await svc.listBooksWithEntryCounts('u1');
    expect(out[0].chapterCount).toBe(0);
    expect(out[0].entryCountByType).toEqual({});
  });

  it('listBooksWithEntryCounts: limit 透传', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([]);
    prisma.benchmarkEntry.groupBy.mockResolvedValue([]);
    await svc.listBooksWithEntryCounts('u1', 5);
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it('findEntriesForUser: book 不存在 → error', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue(null);
    const r = await svc.findEntriesForUser('u1', 'bX', {});
    expect(r).toEqual({ error: 'book_not_found' });
  });

  it('findEntriesForUser: book 不归属本人 → error(不泄露存在性)', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'other',
    });
    const r = await svc.findEntriesForUser('u1', 'b1', {});
    expect(r).toEqual({ error: 'book_not_found' });
  });

  it('findEntriesForUser: 正常返回(归属校验 + type 过滤)', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    const fakeEntries = [
      {
        id: 'e1',
        type: 'PLOT',
        title: '主线',
        content: '内容',
        chapterNo: null,
        kind: null,
        purposes: [],
        order: 0,
      },
    ];
    prisma.benchmarkEntry.findMany.mockResolvedValue(fakeEntries);
    const r = await svc.findEntriesForUser('u1', 'b1', {
      type: 'PLOT',
      limit: 30,
    });
    expect(r).toEqual({ entries: fakeEntries });
    expect(prisma.benchmarkEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookId: 'b1', type: 'PLOT' },
        orderBy: { order: 'asc' },
        take: 30,
      }),
    );
  });

  it('findEntriesForUser: chapterNo 过滤', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    prisma.benchmarkEntry.findMany.mockResolvedValue([]);
    await svc.findEntriesForUser('u1', 'b1', { chapterNo: 5 });
    expect(prisma.benchmarkEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookId: 'b1', chapterNo: 5 },
      }),
    );
  });
});

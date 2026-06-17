import { ChapterService, ChapterHandler } from './chapter.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Typed test double for PrismaService — every delegate is a jest.Mock (not an
 * unbound Prisma method), so `expect(prisma.chapter.X).toHaveBeenCalledWith`
 * assertions stay type-checked and don't trip @typescript-eslint/unbound-method.
 *
 * The mocks are intentionally loose `jest.Mock` (untyped args): jest's matcher
 * helpers (mockResolvedValue / toHaveBeenCalledWith) mis-infer to `never` when
 * the Y/Params generics are pinned, so we keep them loose.
 */
interface PrismaMock {
  novel: { findFirst: jest.Mock };
  chapter: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    chapter: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
  };
}

describe('ChapterService', () => {
  describe('list', () => {
    it('returns chapters ordered by `order`, only if novel is owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findMany.mockResolvedValue([
        { id: 'c1', order: 1, title: '一', content: 'a', status: 'DRAFT' },
      ]);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      const result = await svc.list('u1', 'n1');
      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
      expect(prisma.chapter.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1' },
        orderBy: { order: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('throws 404 when novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await expect(svc.list('u1', 'n1')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('creates a chapter with order = max+1', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.aggregate.mockResolvedValue({ _max: { order: 2 } });
      prisma.chapter.create.mockResolvedValue({ id: 'c3', order: 3 });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await svc.create('u1', 'n1', { title: '第三章' });
      expect(prisma.chapter.create).toHaveBeenCalledWith({
        data: { novelId: 'n1', order: 3, title: '第三章' },
      });
    });

    // Default title behavior: when dto.title is empty/absent, default to
    // `第${order}章` (e.g. "第1章" for the first chapter). Test + impl agree.
    it('starts at order 1 with title 第1章 when no chapters exist', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.aggregate.mockResolvedValue({ _max: { order: null } });
      prisma.chapter.create.mockResolvedValue({ id: 'c1', order: 1 });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await svc.create('u1', 'n1', {});
      expect(prisma.chapter.create).toHaveBeenCalledWith({
        data: { novelId: 'n1', order: 1, title: '第1章' },
      });
    });
  });
});

describe('ChapterHandler', () => {
  it("append concatenates onto the chapter's content and sets COMMITTED", async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'c1',
      novelId: 'n1',
      content: '旧',
      novel: { userId: 'u1' },
    });
    const handler = new ChapterHandler(prisma as unknown as PrismaService);
    await handler.apply('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'append',
      content: '新',
    });
    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      // expect.objectContaining is an asymmetric matcher typed `any` in
      // @types/jest; the value flows into toHaveBeenCalledWith(...: any[])
      // (so a type cast would trip no-unnecessary-type-assertion instead).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({ content: '旧新', status: 'COMMITTED' }),
    });
  });

  it('set replaces content and sets COMMITTED', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'c1',
      novelId: 'n1',
      content: '旧',
      novel: { userId: 'u1' },
    });
    const handler = new ChapterHandler(prisma as unknown as PrismaService);
    await handler.apply('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'set',
      content: '全新',
    });
    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({ content: '全新', status: 'COMMITTED' }),
    });
  });

  it('is a no-op when the chapter is not owned by the user', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue(null);
    const handler = new ChapterHandler(prisma as unknown as PrismaService);
    await handler.apply('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'set',
      content: 'x',
    });
    expect(prisma.chapter.update).not.toHaveBeenCalled();
  });

  it('throws on an unsupported op (e.g. patch)', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'c1',
      novelId: 'n1',
      content: '旧',
      novel: { userId: 'u1' },
    });
    const handler = new ChapterHandler(prisma as unknown as PrismaService);
    await expect(
      handler.apply('u1', {
        resource: 'chapter',
        targetId: 'c1',
        op: 'patch',
        content: 'x',
      }),
    ).rejects.toThrow(/Unsupported op for chapter: patch/);
    expect(prisma.chapter.update).not.toHaveBeenCalled();
  });

  it("registers itself as the 'chapter' handler", () => {
    expect(
      new ChapterHandler(makePrismaMock() as unknown as PrismaService).resource,
    ).toBe('chapter');
  });
});

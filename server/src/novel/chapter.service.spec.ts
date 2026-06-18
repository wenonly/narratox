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

  describe('findOrCreateByOrder', () => {
    it('returns the existing chapter when the order already exists', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const existing = {
        id: 'cuid-existing',
        novelId: 'n1',
        order: 2,
        title: '第2章',
        content: '',
        status: 'DRAFT',
      };
      prisma.chapter.findFirst.mockResolvedValue(existing);
      const svc = new ChapterService(prisma as unknown as PrismaService);

      const result = await svc.findOrCreateByOrder('u1', 'n1', 2);

      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
      expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
        where: { novelId: 'n1', order: 2 },
      });
      // Must NOT create when the chapter already exists.
      expect(prisma.chapter.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a chapter with title 第N章 when the order is absent', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue(null);
      const created = {
        id: 'cuid-new',
        novelId: 'n1',
        order: 5,
        title: '第5章',
        content: '',
        status: 'DRAFT',
      };
      prisma.chapter.create.mockResolvedValue(created);
      const svc = new ChapterService(prisma as unknown as PrismaService);

      const result = await svc.findOrCreateByOrder('u1', 'n1', 5);

      expect(prisma.chapter.create).toHaveBeenCalledWith({
        data: { novelId: 'n1', order: 5, title: '第5章' },
      });
      expect(result).toBe(created);
    });

    it('throws 404 when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await expect(svc.findOrCreateByOrder('u1', 'n1', 1)).rejects.toThrow();
      expect(prisma.chapter.findFirst).not.toHaveBeenCalled();
      expect(prisma.chapter.create).not.toHaveBeenCalled();
    });
  });

  describe('findByOrder', () => {
    it('returns the chapter matching the order within an owned novel', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue({
        id: 'cuid-1',
        order: 1,
        title: '第1章',
        content: '',
        status: 'DRAFT',
      });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      const result = await svc.findByOrder('u1', 'n1', 1);
      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
      expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
        where: { novelId: 'n1', order: 1 },
      });
      expect(result?.id).toBe('cuid-1');
    });

    it('returns null when no chapter has that order', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      const result = await svc.findByOrder('u1', 'n1', 99);
      expect(result).toBeNull();
    });

    it('throws 404 when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await expect(svc.findByOrder('u1', 'n1', 1)).rejects.toThrow();
      expect(prisma.chapter.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates title and content of an owned chapter', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.chapter.update.mockResolvedValue({ id: 'c1' });
      const svc = new ChapterService(prisma as unknown as PrismaService);

      await svc.update('u1', 'n1', 'c1', {
        title: '新标题',
        content: '新内容',
      });

      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
      // Verify chapter belongs to the novel before updating — prevents a
      // chapterId from a different novel slipping through (the
      // @@unique([novelId, order]) index doesn't enforce this on id alone).
      expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', novelId: 'n1' },
        select: { id: true },
      });
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { title: '新标题', content: '新内容' },
      });
    });

    it('throws 404 when the chapter does not belong to the novel', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await expect(
        svc.update('u1', 'n1', 'c1', { content: 'x' }),
      ).rejects.toThrow();
      expect(prisma.chapter.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await expect(
        svc.update('u1', 'n1', 'c1', { content: 'x' }),
      ).rejects.toThrow();
      expect(prisma.chapter.findFirst).not.toHaveBeenCalled();
      expect(prisma.chapter.update).not.toHaveBeenCalled();
    });

    it('only sends provided fields (title-only update omits content)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.chapter.update.mockResolvedValue({ id: 'c1' });
      const svc = new ChapterService(prisma as unknown as PrismaService);

      await svc.update('u1', 'n1', 'c1', { title: 'T2' });

      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { title: 'T2' },
      });
    });
  });

  describe('appendSection', () => {
    it('appends content to an existing chapter and marks COMMITTED', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' }); // assertOwned
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', order: 1, content: '开头' });
      prisma.chapter.update.mockResolvedValue({ id: 'c1', content: '开头新段' });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await svc.appendSection('u1', 'n1', 1, '新段');
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: '开头新段', status: 'COMMITTED' },
      });
    });

    it('creates the chapter (via findOrCreateByOrder) if the order is absent, then appends', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValueOnce(null); // absent
      prisma.chapter.create.mockResolvedValue({ id: 'c9', order: 9, content: '' });
      prisma.chapter.update.mockResolvedValue({ id: 'c9', content: '首段' });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await svc.appendSection('u1', 'n1', 9, '首段');
      expect(prisma.chapter.create).toHaveBeenCalledWith({ data: { novelId: 'n1', order: 9, title: '第9章' } });
      expect(prisma.chapter.update).toHaveBeenCalledWith({ where: { id: 'c9' }, data: { content: '首段', status: 'COMMITTED' } });
    });
  });

  describe('getChapter', () => {
    it('returns order/title/content or null', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue({ order: 1, title: '第1章', content: 'abc' });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      const got = await svc.getChapter('u1', 'n1', 1);
      expect(prisma.chapter.findFirst).toHaveBeenCalledWith({ where: { novelId: 'n1', order: 1 }, select: { order: true, title: true, content: true } });
      expect(got).toEqual({ order: 1, title: '第1章', content: 'abc' });
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

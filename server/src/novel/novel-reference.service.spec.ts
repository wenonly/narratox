import { NovelReferenceService } from './novel-reference.service';
import type { PrismaService } from '../prisma/prisma.service';

const mockPrisma = (overrides: Record<string, any> = {}) => ({
  novelReference: {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1', userId: 'u1' }) },
  ...overrides,
});

describe('NovelReferenceService', () => {
  it('listForInject returns entries whose injectTo matches the role', async () => {
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'r1',
              injectTo: 'writer',
              title: 't1',
              content: 'c1',
              category: '词汇',
            },
            {
              id: 'r2',
              injectTo: 'both',
              title: 't2',
              content: 'c2',
              category: '须知',
            },
          ]),
        },
      }) as unknown as PrismaService,
    );
    const res = await svc.listForInject('u1', 'n1', 'writer');
    expect(res.map((r) => r.id)).toEqual(['r1', 'r2']); // writer + both
  });

  it('listAll returns all entries for the novel (for the index + panel)', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    const svc = new NovelReferenceService(
      mockPrisma({ novelReference: { findMany } }) as unknown as PrismaService,
    );
    expect((await svc.listAll('u1', 'n1')).length).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { novelId: 'n1', novel: { userId: 'u1' } },
        orderBy: { order: 'asc' },
      }),
    );
  });

  it('replaceAll clears then bulk-inserts (idempotent curator rerun)', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: {
          deleteMany,
          createMany,
          findMany: jest.fn().mockResolvedValue([]),
        },
      }) as unknown as PrismaService,
    );
    await svc.replaceAll('u1', 'n1', [
      { title: 't1', category: '方法论', content: 'c1', injectTo: 'main' },
      { title: 't2', category: '词汇', content: 'c2', injectTo: 'writer' },
    ]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', novel: { userId: 'u1' } },
    });
    expect(createMany).toHaveBeenCalled();
  });

  it('assertOwned throws when novel does not belong to user', async () => {
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst: jest.fn().mockResolvedValue(null) },
      }) as unknown as PrismaService,
    );
    await expect(svc.replaceAll('u1', 'other', [])).rejects.toThrow();
  });

  it('update patches an owned reference (rid verified to belong to the novel)', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'r1' }) // rid owned check
      .mockResolvedValueOnce(null); // title uniqueness ok
    const update = jest.fn().mockResolvedValue({ id: 'r1', title: 'T2' });
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst, update },
      }) as unknown as PrismaService,
    );
    const out = await svc.update('u1', 'n1', 'r1', { title: 'T2' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'r1', novelId: 'n1', novel: { userId: 'u1' } },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { title: 'T2' },
    });
    expect(out).toEqual({ id: 'r1', title: 'T2' });
  });

  it('update 404s when rid belongs to a different novel (cross-tenant guard)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const update = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst, update },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.update('u1', 'n1', 'foreign-rid', { title: 'x' }),
    ).rejects.toThrow();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-rid', novelId: 'n1', novel: { userId: 'u1' } },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  // ===== Task 1 新增 =====

  it('create inserts a single reference and returns it', async () => {
    const novelFindFirst = jest.fn().mockResolvedValue({ id: 'n1', userId: 'u1' });
    const refFindFirst = jest.fn().mockResolvedValue(null); // title uniqueness ok
    const create = jest.fn().mockResolvedValue({ id: 'r9', title: 'T' });
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst: novelFindFirst },
        novelReference: { findFirst: refFindFirst, create },
      }) as unknown as PrismaService,
    );
    const out = await svc.create('u1', 'n1', {
      title: 'T',
      content: 'C',
      category: '词汇',
      injectTo: 'writer',
    });
    expect(out).toEqual({ id: 'r9', title: 'T' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        novelId: 'n1',
        userId: 'u1',
        title: 'T',
        content: 'C',
        category: '词汇',
        injectTo: 'writer',
        order: 0,
      }),
    });
  });

  it('create throws TITLE_DUPLICATE when title exists in same novel', async () => {
    const novelFindFirst = jest.fn().mockResolvedValue({ id: 'n1', userId: 'u1' });
    const refFindFirst = jest.fn().mockResolvedValue({ id: 'existing' }); // title clash
    const create = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst: novelFindFirst },
        novelReference: { findFirst: refFindFirst, create },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.create('u1', 'n1', { title: 'dup', content: 'c' }),
    ).rejects.toThrow(/标题.*已存在|TITLE_DUPLICATE/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('create rejects when assertOwned fails (novel not owned)', async () => {
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst: jest.fn().mockResolvedValue(null) },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.create('u1', 'other', { title: 't', content: 'c' }),
    ).rejects.toThrow();
  });

  it('deleteOne removes an owned reference by id', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'r1', title: 'T' });
    const deleteFn = jest.fn().mockResolvedValue({ id: 'r1' });
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst, delete: deleteFn },
      }) as unknown as PrismaService,
    );
    const out = await svc.deleteOne('u1', 'n1', 'r1');
    expect(out).toEqual({ id: 'r1', title: 'T' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'r1', novelId: 'n1', novel: { userId: 'u1' } },
      select: { id: true, title: true },
    });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('deleteOne 404s when rid belongs to another novel (cross-tenant)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const deleteFn = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst, delete: deleteFn },
      }) as unknown as PrismaService,
    );
    await expect(svc.deleteOne('u1', 'n1', 'foreign')).rejects.toThrow();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('update throws TITLE_DUPLICATE when changing title to a used one', async () => {
    // 拥有验证先通过(rid 属于本 novel),然后 title 唯一性检查发现冲突
    const ownedFindFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'r1' }) // rid owned check
      .mockResolvedValueOnce({ id: 'r2' }); // title clash with another row
    const update = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst: ownedFindFirst, update },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.update('u1', 'n1', 'r1', { title: 'taken' }),
    ).rejects.toThrow(/标题.*已存在|TITLE_DUPLICATE/i);
    expect(update).not.toHaveBeenCalled();
  });
});

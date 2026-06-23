import { NovelReferenceService } from './novel-reference.service';
import type { PrismaService } from '../prisma/prisma.service';

const mockPrisma = (overrides: Record<string, any> = {}) => ({
  novelReference: {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    findUnique: jest.fn(),
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
      }) as any,
    );
    const res = await svc.listForInject('u1', 'n1', 'writer');
    expect(res.map((r) => r.id)).toEqual(['r1', 'r2']); // writer + both
  });

  it('listAll returns all entries for the novel (for the index + panel)', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    const svc = new NovelReferenceService(
      mockPrisma({ novelReference: { findMany } }) as any,
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
      }) as any,
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
      }) as any,
    );
    await expect(svc.replaceAll('u1', 'other', [])).rejects.toThrow();
  });
});

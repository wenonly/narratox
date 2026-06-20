import { WorldEntryService } from './world-entry.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  worldEntry: { upsert: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    worldEntry: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

describe('WorldEntryService', () => {
  describe('assertOwned', () => {
    it('passes when the novel belongs to the user', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      await expect(svc.assertOwned('u1', 'n1')).resolves.toBeUndefined();
      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
    });

    it('throws when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      await expect(svc.assertOwned('u1', 'n1')).rejects.toThrow();
    });
  });

  describe('upsertEntry', () => {
    it('upserts an entry by (novelId, name)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.worldEntry.upsert.mockResolvedValue({ id: 'w1' });
      const svc = new WorldEntryService(prisma as unknown as PrismaService);

      await svc.upsertEntry('u1', 'n1', {
        type: 'powerSystem',
        name: '灵气修炼',
        content: '炼气→筑基→金丹…',
      });

      expect(prisma.worldEntry.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '灵气修炼' } },
        create: {
          novelId: 'n1',
          type: 'powerSystem',
          name: '灵气修炼',
          content: '炼气→筑基→金丹…',
        },
        update: {
          type: 'powerSystem',
          content: '炼气→筑基→金丹…',
        },
      });
    });

    it('throws when the novel is not owned (no upsert)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      await expect(
        svc.upsertEntry('u1', 'n1', {
          type: 'location',
          name: '玄天宗',
          content: 'x',
        }),
      ).rejects.toThrow();
      expect(prisma.worldEntry.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listEntries', () => {
    it('lists all entries user-scoped when no type filter', async () => {
      const prisma = makePrismaMock();
      prisma.worldEntry.findMany.mockResolvedValue([
        { id: 'w1', type: 'concept', name: '总览' },
      ]);
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      const out = await svc.listEntries('u1', 'n1');
      expect(prisma.worldEntry.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', novel: { userId: 'u1' } },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
      expect(out).toEqual([{ id: 'w1', type: 'concept', name: '总览' }]);
    });

    it('filters by type when given', async () => {
      const prisma = makePrismaMock();
      prisma.worldEntry.findMany.mockResolvedValue([]);
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      await svc.listEntries('u1', 'n1', 'location');
      expect(prisma.worldEntry.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', novel: { userId: 'u1' }, type: 'location' },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
    });
  });

  describe('getEntry', () => {
    it('returns a single entry by name, user-scoped', async () => {
      const prisma = makePrismaMock();
      prisma.worldEntry.findFirst.mockResolvedValue({
        id: 'w1',
        name: '玄天宗',
        content: '东域大宗',
      });
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      const e = await svc.getEntry('u1', 'n1', '玄天宗');
      expect(prisma.worldEntry.findFirst).toHaveBeenCalledWith({
        where: { novelId: 'n1', name: '玄天宗', novel: { userId: 'u1' } },
      });
      expect(e).toEqual({ id: 'w1', name: '玄天宗', content: '东域大宗' });
    });
  });

  describe('listCore', () => {
    it('returns concept + powerSystem entries (for passive injection)', async () => {
      const prisma = makePrismaMock();
      prisma.worldEntry.findMany.mockResolvedValue([
        { type: 'concept', name: '总览', content: '仙侠世界' },
        { type: 'powerSystem', name: '灵气', content: '炼气…' },
      ]);
      const svc = new WorldEntryService(prisma as unknown as PrismaService);
      const out = await svc.listCore('u1', 'n1');
      expect(prisma.worldEntry.findMany).toHaveBeenCalledWith({
        where: {
          novelId: 'n1',
          novel: { userId: 'u1' },
          type: { in: ['concept', 'powerSystem'] },
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
      expect(out).toHaveLength(2);
    });
  });
});

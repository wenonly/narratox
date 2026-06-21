import { StoryEventService } from './story-event.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  storyEvent: {
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
  };
}
const makePrismaMock = (): PrismaMock => ({
  storyEvent: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  },
});

describe('StoryEventService', () => {
  describe('listOpen', () => {
    it('returns OPEN+PROGRESSING hooks enriched', async () => {
      const prisma = makePrismaMock();
      prisma.storyEvent.findMany.mockResolvedValue([
        {
          id: 'e1',
          description: '黑影',
          status: 'OPEN',
          payoffTiming: 'MID_ARC',
          openedAtChapter: 1,
          lastAdvancedAtChapter: null,
          advancedCount: 0,
          coreHook: true,
          dependsOn: [],
        },
      ]);
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      const rows = await svc.listOpen('u1', 'n1');
      expect(prisma.storyEvent.findMany).toHaveBeenCalledWith({
        where: {
          novelId: 'n1',
          status: { in: ['OPEN', 'PROGRESSING'] },
          novel: { userId: 'u1' },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          description: true,
          status: true,
          payoffTiming: true,
          openedAtChapter: true,
          lastAdvancedAtChapter: true,
          advancedCount: true,
          coreHook: true,
          dependsOn: true,
        },
      });
      expect(rows[0]).toMatchObject({ id: 'e1', coreHook: true });
    });

    it('marks stale hooks when currentChapter given (MID_ARC stale-after 40)', async () => {
      const prisma = makePrismaMock();
      prisma.storyEvent.findMany.mockResolvedValue([
        {
          id: 'fresh',
          status: 'OPEN',
          payoffTiming: 'MID_ARC',
          openedAtChapter: 10,
          lastAdvancedAtChapter: null,
          advancedCount: 0,
          coreHook: false,
          dependsOn: [],
        },
        {
          id: 'stale',
          status: 'OPEN',
          payoffTiming: 'MID_ARC',
          openedAtChapter: 1,
          lastAdvancedAtChapter: null,
          advancedCount: 0,
          coreHook: false,
          dependsOn: [],
        },
      ]);
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      const rows = await svc.listOpen('u1', 'n1', 50);
      expect(rows.find((r) => r.id === 'fresh')?.stale).toBe(false); // 50-10=40, not >40
      expect(rows.find((r) => r.id === 'stale')?.stale).toBe(true); // 50-1=49 >40
    });

    it('slow-burn hooks do not go stale quickly', async () => {
      const prisma = makePrismaMock();
      prisma.storyEvent.findMany.mockResolvedValue([
        {
          id: 'sb',
          status: 'OPEN',
          payoffTiming: 'SLOW_BURN',
          openedAtChapter: 1,
          lastAdvancedAtChapter: null,
          advancedCount: 0,
          coreHook: false,
          dependsOn: [],
        },
      ]);
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      const rows = await svc.listOpen('u1', 'n1', 50);
      expect(rows[0].stale).toBe(false); // SLOW_BURN stale-after 120, 50-1=49
    });
  });

  describe('createHooks', () => {
    it('creates hooks with payoffTiming/core/dependsOn', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.createHooks(
        'u1',
        'n1',
        [
          {
            description: '黑影',
            payoffTiming: 'SLOW_BURN',
            core: true,
            dependsOn: ['e0'],
          },
          { description: '钥匙', payoffTiming: 'NEAR_TERM' },
        ],
        3,
      );
      expect(prisma.storyEvent.create).toHaveBeenCalledTimes(2);
      expect(prisma.storyEvent.create).toHaveBeenNthCalledWith(1, {
        data: {
          novelId: 'n1',
          description: '黑影',
          status: 'OPEN',
          openedAtChapter: 3,
          payoffTiming: 'SLOW_BURN',
          coreHook: true,
          dependsOn: ['e0'],
        },
      });
    });

    it('is a no-op for empty list', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.createHooks('u1', 'n1', [], 3);
      expect(prisma.storyEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('advanceHooks', () => {
    it('flips OPEN/PROGRESSING → PROGRESSING + bumps count + lastAdvanced', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.advanceHooks('u1', 'n1', ['e1', 'e2'], 5);
      expect(prisma.storyEvent.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.storyEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'e1',
          novelId: 'n1',
          status: { in: ['OPEN', 'PROGRESSING'] },
        },
        data: {
          status: 'PROGRESSING',
          advancedCount: { increment: 1 },
          lastAdvancedAtChapter: 5,
        },
      });
    });
  });

  describe('markCore', () => {
    it('sets coreHook on the given ids', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.markCore('u1', 'n1', ['e1'], true);
      expect(prisma.storyEvent.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', novelId: 'n1' },
        data: { coreHook: true },
      });
    });
  });

  describe('resolveHooks', () => {
    it('flips OPEN or PROGRESSING → RESOLVED', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.resolveHooks('u1', 'n1', ['e1'], 8);
      expect(prisma.storyEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'e1',
          novelId: 'n1',
          status: { in: ['OPEN', 'PROGRESSING'] },
        },
        data: { status: 'RESOLVED', resolvedAtChapter: 8 },
      });
    });
  });

  describe('cleanupForChapter', () => {
    it('deletes opened-here events + reopens resolved-here events', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.cleanupForChapter('u1', 'n1', 4);
      expect(prisma.storyEvent.deleteMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', openedAtChapter: 4, novel: { userId: 'u1' } },
      });
      expect(prisma.storyEvent.updateMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', resolvedAtChapter: 4, novel: { userId: 'u1' } },
        data: { status: 'OPEN', resolvedAtChapter: null },
      });
    });
  });
});

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
  it('listOpen returns OPEN hooks oldest first', async () => {
    const prisma = makePrismaMock();
    prisma.storyEvent.findMany.mockResolvedValue([
      { id: 'e1', description: '黑影', openedAtChapter: 1 },
    ]);
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    const rows = await svc.listOpen('u1', 'n1');
    expect(prisma.storyEvent.findMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', status: 'OPEN', novel: { userId: 'u1' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, description: true, openedAtChapter: true },
    });
    expect(rows).toEqual([
      { id: 'e1', description: '黑影', openedAtChapter: 1 },
    ]);
  });

  it('createHooks makes one OPEN event per description, tagged with opening chapter', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.createHooks('u1', 'n1', ['黑影', '钥匙'], 3);
    expect(prisma.storyEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.storyEvent.create).toHaveBeenNthCalledWith(1, {
      data: {
        novelId: 'n1',
        description: '黑影',
        status: 'OPEN',
        openedAtChapter: 3,
      },
    });
  });

  it('createHooks is a no-op for empty list', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.createHooks('u1', 'n1', [], 3);
    expect(prisma.storyEvent.create).not.toHaveBeenCalled();
  });

  it('resolveHooks flips each id to RESOLVED with resolving chapter', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.resolveHooks('u1', 'n1', ['e1', 'e2'], 3);
    expect(prisma.storyEvent.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.storyEvent.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'e1', novelId: 'n1', status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAtChapter: 3 },
    });
  });

  it('cleanupForChapter deletes opened-here events + reopens resolved-here events', async () => {
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

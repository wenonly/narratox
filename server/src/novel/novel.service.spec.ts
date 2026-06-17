import { NovelService } from './novel.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResourceRegistry } from '../resources/resource-registry';

/**
 * Typed test double for PrismaService — every delegate is a jest.Mock (not an
 * unbound Prisma method), so `expect(prisma.novel.X).toHaveBeenCalledWith`
 * assertions stay type-checked and don't trip @typescript-eslint/unbound-method.
 *
 * The mocks are intentionally loose `jest.Mock` (untyped args): jest's matcher
 * helpers (mockResolvedValue / toHaveBeenCalledWith) mis-infer to `never` when
 * the Y/Params generics are pinned, so we keep them loose.
 */
interface PrismaMock {
  novel: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  session: { create: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    novel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    session: { create: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('NovelService', () => {
  describe('create', () => {
    it('creates a session + novel (+ seed chapter) in a transaction', async () => {
      const prisma = makePrismaMock();
      const tx = {
        session: { create: jest.fn().mockResolvedValue({ id: 's1' }) },
        novel: {
          create: jest.fn().mockResolvedValue({ id: 'n1', sessionId: 's1' }),
        },
      };
      // `fn(tx)` runs the impl's async tx callback against our mock `tx`;
      // returning its Promise makes $transaction resolve to the callback's
      // result. Typed callback (not `any`) to keep eslint happy.
      prisma.$transaction.mockImplementation(
        (fn: (txClient: typeof tx) => unknown) => fn(tx),
      );
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        { dispatch: jest.fn() } as unknown as ResourceRegistry,
      );

      const result = await svc.create('u1', {
        title: '我的书',
        genre: '玄幻',
        synopsis: '一句话',
      });

      expect(tx.session.create).toHaveBeenCalledWith(
        // expect.objectContaining is an asymmetric matcher typed `any` in
        // @types/jest; the value flows into toHaveBeenCalledWith(...: any[])
        // (so a type cast would trip no-unnecessary-type-assertion instead).

        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ userId: 'u1', name: '我的书' }),
        }),
      );
      // The impl generates `sessionId = randomUUID()` locally and uses it for
      // both session.create and novel.create (the resolved session id 's1' is
      // discarded). sessionId is therefore any UUID string here.
      expect(tx.novel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            userId: 'u1',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            sessionId: expect.any(String),
            title: '我的书',
            genre: '玄幻',
            chapters: { create: [{ order: 1, title: '第1章' }] },
          }),
        }),
      );
      // Both session.create and novel.create inside the tx must share the
      // same generated sessionId. Narrow the recorded call args — the loose
      // `jest.Mock` types `.mock.calls` as `any`, so cast the whole calls
      // array at the read site (mirror sessions.service.spec.ts style).
      const sessionCalls = tx.session.create.mock.calls as Array<
        [{ data: { id: string; userId: string; name: string } }]
      >;
      const novelCalls = tx.novel.create.mock.calls as Array<
        [{ data: { sessionId: string } }]
      >;
      expect(novelCalls[0][0].data.sessionId).toBe(sessionCalls[0][0].data.id);
      expect(result.id).toBe('n1');
    });
  });

  describe('list', () => {
    it('lists novels by userId newest-first', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findMany.mockResolvedValue([{ id: 'n1' }]);
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        { dispatch: jest.fn() } as unknown as ResourceRegistry,
      );
      await svc.list('u1');
      expect(prisma.novel.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });

  describe('get', () => {
    it('returns novel with chapters, scoped by user', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', chapters: [] });
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        { dispatch: jest.fn() } as unknown as ResourceRegistry,
      );
      await svc.get('u1', 'n1');
      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        include: { chapters: { orderBy: { order: 'asc' } } },
      });
    });
  });

  describe('delete', () => {
    it('deletes only an owned novel', async () => {
      const prisma = makePrismaMock();
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        { dispatch: jest.fn() } as unknown as ResourceRegistry,
      );
      await svc.delete('u1', 'n1');
      expect(prisma.novel.deleteMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
    });
  });

  describe('accept', () => {
    it('asserts ownership then dispatches the chapter mutation', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const dispatch = jest.fn().mockResolvedValue(undefined);
      const registry = { dispatch } as unknown as ResourceRegistry;
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        registry,
      );

      await svc.accept('u1', 'n1', {
        chapterId: 'c1',
        op: 'append',
        content: 'hi',
      });

      expect(dispatch).toHaveBeenCalledWith('u1', {
        resource: 'chapter',
        targetId: 'c1',
        op: 'append',
        content: 'hi',
      });
    });

    it('404s when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const dispatch = jest.fn();
      const registry = { dispatch } as unknown as ResourceRegistry;
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        registry,
      );
      await expect(
        svc.accept('u1', 'n1', { chapterId: 'c1', op: 'set', content: 'x' }),
      ).rejects.toThrow();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

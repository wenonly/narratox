import { SessionsService } from './sessions.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Typed test double for PrismaService — every delegate is a jest.Mock (not an
 * unbound Prisma method), so `expect(prisma.session.X).toHaveBeenCalledWith`
 * assertions stay type-checked and don't trip @typescript-eslint/unbound-method.
 *
 * The mocks are intentionally loose `jest.Mock` (untyped args): jest's matcher
 * helpers (mockResolvedValue / toHaveBeenCalledWith) mis-infer to `never` when
 * the Y/Params generics are pinned, so we keep them loose and narrow at the
 * few spots that read recorded call args (see `mock.calls` below).
 */
interface PrismaMock {
  session: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  message: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    session: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
}

/** Build a SessionsService backed by the typed mock (cast only at the boundary). */
function makeService(prisma: PrismaMock): SessionsService {
  return new SessionsService(prisma as unknown as PrismaService);
}

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

describe('SessionsService', () => {
  describe('resolveSession', () => {
    it('creates a new owned session (uuid + name) when no id given', async () => {
      const prisma = makePrismaMock();
      prisma.session.create.mockResolvedValue({
        id: 'new-id',
        userId: 'u1',
        agentId: 'deep-agent',
        name: 'short',
        createdAt: EPOCH,
        updatedAt: EPOCH,
      });
      const service = makeService(prisma);

      const result = await service.resolveSession(
        'u1',
        undefined,
        'deep-agent',
        'short',
      );

      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalledWith({
        // expect.objectContaining is an asymmetric matcher typed `any` in
        // @types/jest; the value flows into toHaveBeenCalledWith(...: any[])
        // (so a type cast would trip no-unnecessary-type-assertion instead).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          userId: 'u1',
          agentId: 'deep-agent',
          name: 'short',
        }),
      });
      expect(result.id).toBe('new-id');
    });

    it('seeds name from the first message, truncated to 30 chars', async () => {
      const prisma = makePrismaMock();
      prisma.session.create.mockResolvedValue({ name: '' });
      const service = makeService(prisma);

      await service.resolveSession(
        'u1',
        undefined,
        'deep-agent',
        'x'.repeat(40),
      );

      // Narrow the recorded call args — the loose `jest.Mock` types
      // `.mock.calls` as `any`, so cast the whole calls array at the read site
      // (the call was `create({ data: {...} })`, so each entry is a 1-tuple).
      const calls = prisma.session.create.mock.calls as Array<
        [{ data: { name: string; userId: string } }]
      >;
      const callArg = calls[0][0];
      expect(callArg.data.name).toBe('x'.repeat(30));
      expect(callArg.data.userId).toBe('u1');
    });

    it('reuses an existing session owned by the same user', async () => {
      const prisma = makePrismaMock();
      const existing = {
        id: 's1',
        userId: 'u1',
        name: 'old',
        createdAt: EPOCH,
        updatedAt: EPOCH,
      };
      prisma.session.findUnique.mockResolvedValue(existing);
      const service = makeService(prisma);

      const result = await service.resolveSession(
        'u1',
        's1',
        'deep-agent',
        'hi',
      );

      expect(prisma.session.findUnique).toHaveBeenCalledWith({
        where: { id: 's1' },
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a fresh own session when the id belongs to another user (no leak/reuse)', async () => {
      const prisma = makePrismaMock();
      prisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'someone-else',
      });
      prisma.session.create.mockResolvedValue({
        id: 'new',
        userId: 'u1',
      });
      const service = makeService(prisma);

      const result = await service.resolveSession(
        'u1',
        's1',
        'deep-agent',
        'hi',
      );

      expect(prisma.session.create).toHaveBeenCalled();
      expect(result.id).toBe('new');
    });
  });

  describe('listSessions', () => {
    it('filters by userId + agentId, newest-first', async () => {
      const prisma = makePrismaMock();
      prisma.session.findMany.mockResolvedValue([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
      const service = makeService(prisma);

      await service.listSessions('u1', 'deep-agent');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', agentId: 'deep-agent' },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });

  describe('getRuns', () => {
    it('returns [] without reading messages when the session is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      const result = await service.getRuns('u1', 'sX');

      expect(prisma.session.findFirst).toHaveBeenCalledWith({
        where: { id: 'sX', userId: 'u1' },
      });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('pairs consecutive user+assistant messages when owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({
        id: 's1',
        userId: 'u1',
      });
      prisma.message.findMany.mockResolvedValue([
        { role: 'user', content: 'q1', createdAt: EPOCH },
        { role: 'assistant', content: 'a1', createdAt: EPOCH },
        { role: 'user', content: 'q2', createdAt: EPOCH },
        { role: 'assistant', content: 'a2', createdAt: EPOCH },
      ]);
      const service = makeService(prisma);

      const result = await service.getRuns('u1', 's1');

      expect(result).toEqual([
        {
          userContent: 'q1',
          assistantContent: 'a1',
          createdAt: EPOCH,
          activities: null,
        },
        {
          userContent: 'q2',
          assistantContent: 'a2',
          createdAt: EPOCH,
          activities: null,
        },
      ]);
    });

    it('maps the assistant row activities into each RunPair (null when missing)', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      const activities = { 'think-1': { act: 'think', text: '想' } };
      prisma.message.findMany.mockResolvedValue([
        { role: 'user', content: 'q', createdAt: EPOCH },
        {
          role: 'assistant',
          content: 'a',
          createdAt: EPOCH,
          activities,
        },
        { role: 'user', content: 'q2', createdAt: EPOCH },
        {
          role: 'assistant',
          content: 'a2',
          createdAt: EPOCH,
          // no activities column on this row → null
        },
      ]);
      const service = makeService(prisma);

      const result = await service.getRuns('u1', 's1');

      expect(result).toEqual([
        {
          userContent: 'q',
          assistantContent: 'a',
          createdAt: EPOCH,
          activities,
        },
        {
          userContent: 'q2',
          assistantContent: 'a2',
          createdAt: EPOCH,
          activities: null,
        },
      ]);
    });
  });

  describe('startTurn', () => {
    it('is a no-op (returns null) when the session is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      const result = await service.startTurn('u1', 'sX', 'hi', 'lg-1');

      expect(result).toBeNull();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('creates the user message row with langGraphId and returns its id', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      prisma.message.create.mockResolvedValue({ id: 'msg-1' });
      const service = makeService(prisma);

      const result = await service.startTurn('u1', 's1', 'hi', 'lg-1');

      expect(result).toBe('msg-1');
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          sessionId: 's1',
          role: 'user',
          content: 'hi',
          langGraphId: 'lg-1',
        },
      });
    });
  });

  describe('finishTurn', () => {
    it('is a no-op when the session is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      await service.finishTurn('u1', 's1', 'hello', undefined, false);

      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('writes the assistant message (with isError) and bumps updatedAt when owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      const service = makeService(prisma);

      await service.finishTurn('u1', 's1', 'boom-msg', undefined, true);

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          sessionId: 's1',
          role: 'assistant',
          content: 'boom-msg',
          activities: undefined,
          isError: true,
        },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { updatedAt: expect.any(Date) },
      });
    });

    it('persists activities on the assistant message when provided (isError defaults false)', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      const service = makeService(prisma);
      const activities = { 'think-1': { act: 'think', text: '想' } };

      await service.finishTurn('u1', 's1', '你好', activities, false);

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          sessionId: 's1',
          role: 'assistant',
          content: '你好',
          activities,
          isError: false,
        },
      });
    });
  });

  describe('deleteSession', () => {
    it('deletes only an owned session (deleteMany by id+userId)', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma);

      await service.deleteSession('u1', 's1');

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { id: 's1', userId: 'u1' },
      });
    });
  });
});

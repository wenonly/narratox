import { SessionsService } from './sessions.service';
import type { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
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
  } as unknown as PrismaService;
}

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

describe('SessionsService', () => {
  describe('resolveSession', () => {
    it('creates a new owned session (uuid + name) when no id given', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({
        id: 'new-id', userId: 'u1', agentId: 'deep-agent', name: 'short',
        createdAt: EPOCH, updatedAt: EPOCH,
      });
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('u1', undefined, 'deep-agent', 'short');

      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', agentId: 'deep-agent', name: 'short' }),
      });
      expect(result.id).toBe('new-id');
    });

    it('seeds name from the first message, truncated to 30 chars', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({ name: '' });
      const service = new SessionsService(prisma);

      await service.resolveSession('u1', undefined, 'deep-agent', 'x'.repeat(40));

      const data = (prisma.session.create as jest.Mock).mock.calls[0][0].data;
      expect(data.name).toBe('x'.repeat(30));
      expect(data.userId).toBe('u1');
    });

    it('reuses an existing session owned by the same user', async () => {
      const prisma = makePrismaMock();
      const existing = { id: 's1', userId: 'u1', name: 'old', createdAt: EPOCH, updatedAt: EPOCH };
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(existing);
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('u1', 's1', 'deep-agent', 'hi');

      expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a fresh own session when the id belongs to another user (no leak/reuse)', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({ id: 's1', userId: 'someone-else' });
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'new', userId: 'u1' });
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('u1', 's1', 'deep-agent', 'hi');

      expect(prisma.session.create).toHaveBeenCalled();
      expect(result.id).toBe('new');
    });
  });

  describe('listSessions', () => {
    it('filters by userId + agentId, newest-first', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

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
      (prisma.session.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new SessionsService(prisma);

      const result = await service.getRuns('u1', 'sX');

      expect(prisma.session.findFirst).toHaveBeenCalledWith({ where: { id: 'sX', userId: 'u1' } });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('pairs consecutive user+assistant messages when owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue({ id: 's1', userId: 'u1' });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'user', content: 'q1', createdAt: EPOCH },
        { role: 'assistant', content: 'a1', createdAt: EPOCH },
        { role: 'user', content: 'q2', createdAt: EPOCH },
        { role: 'assistant', content: 'a2', createdAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      const result = await service.getRuns('u1', 's1');

      expect(result).toEqual([
        { userContent: 'q1', assistantContent: 'a1', createdAt: EPOCH },
        { userContent: 'q2', assistantContent: 'a2', createdAt: EPOCH },
      ]);
    });
  });

  describe('appendTurn', () => {
    it('is a no-op when the session is not owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new SessionsService(prisma);

      await service.appendTurn('u1', 'sX', 'hi', 'hello');

      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('writes user+assistant messages and bumps updatedAt when owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue({ id: 's1', userId: 'u1' });
      const service = new SessionsService(prisma);

      await service.appendTurn('u1', 's1', 'hi', 'hello');

      expect(prisma.message.create).toHaveBeenCalledTimes(2);
      expect(prisma.message.create).toHaveBeenNthCalledWith(1, {
        data: { sessionId: 's1', role: 'user', content: 'hi' },
      });
      expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
        data: { sessionId: 's1', role: 'assistant', content: 'hello' },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { updatedAt: expect.any(Date) },
      });
    });
  });

  describe('deleteSession', () => {
    it('deletes only an owned session (deleteMany by id+userId)', async () => {
      const prisma = makePrismaMock();
      const service = new SessionsService(prisma);

      await service.deleteSession('u1', 's1');

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { id: 's1', userId: 'u1' },
      });
    });
  });
});

import { SessionsService } from './sessions.service';
import type { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return {
    session: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
    it('creates a new session (uuid + truncated name) when no id given', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({
        id: 'new-id',
        agentId: 'deep-agent',
        name: 'short',
        createdAt: EPOCH,
        updatedAt: EPOCH,
      });
      const service = new SessionsService(prisma);

      const result = await service.resolveSession(undefined, 'deep-agent', 'short');

      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentId: 'deep-agent', name: 'short' }),
      });
      expect(result.id).toBe('new-id');
    });

    it('seeds name from the first message, truncated to 30 chars', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({ name: '' });
      const service = new SessionsService(prisma);
      const long = 'x'.repeat(40);

      await service.resolveSession(undefined, 'deep-agent', long);

      const data = (prisma.session.create as jest.Mock).mock.calls[0][0].data;
      expect(data.name).toBe('x'.repeat(30));
      expect(data.name).toHaveLength(30);
    });

    it('reuses an existing session when id is given and found', async () => {
      const prisma = makePrismaMock();
      const existing = { id: 's1', name: 'old', createdAt: EPOCH, updatedAt: EPOCH };
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(existing);
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('s1', 'deep-agent', 'hi');

      expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates with the given id when id is given but missing (upsert)', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 's2' });
      const service = new SessionsService(prisma);

      await service.resolveSession('s2', 'deep-agent', 'hi');

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 's2', name: 'hi' }),
      });
    });
  });

  describe('listSessions', () => {
    it('returns sessions newest-first, mapped to the UI shape', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      const result = await service.listSessions('deep-agent');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { agentId: 'deep-agent' },
        orderBy: { updatedAt: 'desc' },
      });
      expect(result).toEqual([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
    });
  });

  describe('getRuns', () => {
    it('pairs consecutive user+assistant messages into runs, oldest-first', async () => {
      const prisma = makePrismaMock();
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'user', content: 'q1', createdAt: EPOCH },
        { role: 'assistant', content: 'a1', createdAt: EPOCH },
        { role: 'user', content: 'q2', createdAt: EPOCH },
        { role: 'assistant', content: 'a2', createdAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      const result = await service.getRuns('s1');

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { sessionId: 's1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([
        { userContent: 'q1', assistantContent: 'a1', createdAt: EPOCH },
        { userContent: 'q2', assistantContent: 'a2', createdAt: EPOCH },
      ]);
    });
  });

  describe('appendTurn', () => {
    it('writes the user+assistant messages and bumps updatedAt', async () => {
      const prisma = makePrismaMock();
      const service = new SessionsService(prisma);

      await service.appendTurn('s1', 'hi', 'hello');

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
    it('deletes the session row (messages cascade)', async () => {
      const prisma = makePrismaMock();
      const service = new SessionsService(prisma);

      await service.deleteSession('s1');

      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });
  });
});

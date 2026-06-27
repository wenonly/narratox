import {
  VoiceProfileService,
  buildProfilePrompt,
} from './voice-profile.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Typed test double — delegates are jest.Mock (not unbound Prisma methods),
 * so `expect(prisma.voiceProfile.X).toHaveBeenCalledWith` stays type-checked
 * and doesn't trip @typescript-eslint/unbound-method. Mirrors the pattern in
 * model-config.service.spec.ts.
 */
interface PrismaMock {
  voiceProfile: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  novel: { findFirst: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    voiceProfile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    novel: { findFirst: jest.fn() },
  };
}

const mockModelConfigs = (active: unknown) =>
  ({ getActive: jest.fn().mockResolvedValue(active) }) as never;

describe('VoiceProfileService', () => {
  describe('list', () => {
    it('returns voice profiles scoped by user, newest-first', async () => {
      const prisma = makePrismaMock();
      prisma.voiceProfile.findMany.mockResolvedValue([{ id: 'v1' }]);
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );

      const out = await svc.list('u1');

      expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(out).toEqual([{ id: 'v1' }]);
    });
  });

  describe('create', () => {
    it('persists with userId', async () => {
      const prisma = makePrismaMock();
      prisma.voiceProfile.create.mockResolvedValue({ id: 'v1' });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );

      await svc.create('u1', { name: '鲁迅风', profile: '# 画像' });

      expect(prisma.voiceProfile.create).toHaveBeenCalledWith({
        data: { name: '鲁迅风', profile: '# 画像', userId: 'u1' },
      });
    });
  });

  describe('update', () => {
    it('throws NotFound when profile belongs to another user', async () => {
      const prisma = makePrismaMock();
      prisma.voiceProfile.findFirst.mockResolvedValue(null);
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      await expect(svc.update('u1', 'vX', { name: '改名' })).rejects.toThrow(
        'Voice profile not found',
      );
      expect(prisma.voiceProfile.update).not.toHaveBeenCalled();
    });

    it('updates after ownership check', async () => {
      const prisma = makePrismaMock();
      prisma.voiceProfile.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.voiceProfile.update.mockResolvedValue({ id: 'v1' });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );

      await svc.update('u1', 'v1', { profile: '# 新' });

      expect(prisma.voiceProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'v1', userId: 'u1' },
        select: { id: true },
      });
      expect(prisma.voiceProfile.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { profile: '# 新' },
      });
    });
  });

  describe('remove', () => {
    it('deletes after ownership check and returns ok', async () => {
      const prisma = makePrismaMock();
      prisma.voiceProfile.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.voiceProfile.delete.mockResolvedValue({ id: 'v1' });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );

      const out = await svc.remove('u1', 'v1');

      expect(prisma.voiceProfile.delete).toHaveBeenCalledWith({
        where: { id: 'v1' },
      });
      expect(out).toEqual({ ok: true });
    });

    it('throws NotFound when not owned', async () => {
      const prisma = makePrismaMock();
      prisma.voiceProfile.findFirst.mockResolvedValue(null);
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      await expect(svc.remove('u1', 'vX')).rejects.toThrow(
        'Voice profile not found',
      );
      expect(prisma.voiceProfile.delete).not.toHaveBeenCalled();
    });
  });

  describe('getForNovel', () => {
    it('returns the profile Markdown for a novel with a bound profile', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({
        voiceProfile: { profile: '# 雷厉风行' },
      });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );

      const out = await svc.getForNovel('u1', 'n1');

      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        select: { voiceProfile: { select: { profile: true } } },
      });
      expect(out).toBe('# 雷厉风行');
    });

    it('returns null when the novel has no bound profile', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ voiceProfile: null });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      expect(await svc.getForNovel('u1', 'n1')).toBeNull();
    });

    it('returns null when the novel does not exist (or is foreign)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      expect(await svc.getForNovel('u1', 'nX')).toBeNull();
    });
  });

  describe('buildProfilePrompt (pure)', () => {
    it('embeds samples into the builder instruction', () => {
      const p = buildProfilePrompt(['第一段样本', '第二段']);
      expect(p).toContain('第一段样本');
      expect(p).toContain('第二段');
      expect(p).toContain('作者画像');
    });
  });

  describe('generate', () => {
    it('throws when no active model config', async () => {
      const svc = new VoiceProfileService(
        makePrismaMock() as unknown as PrismaService,
        mockModelConfigs(null),
      );
      await expect(svc.generate('u1', ['一段样本'])).rejects.toThrow(
        /尚未配置模型/,
      );
    });
  });
});

import {
  VoiceProfileService,
  buildProfilePrompt,
} from './voice-profile.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Typed test double — delegates are jest.Mock (not unbound Prisma methods),
 * so `expect(prisma.user.X).toHaveBeenCalledWith` stays type-checked and
 * doesn't trip @typescript-eslint/unbound-method. Mirrors the pattern in
 * model-config.service.spec.ts / sessions.service.spec.ts.
 */
interface PrismaMock {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

const makePrisma = (
  overrides: Partial<{ findUnique: jest.Mock; update: jest.Mock }> = {},
): PrismaMock => ({
  user: {
    findUnique: overrides.findUnique ?? jest.fn(),
    update: overrides.update ?? jest.fn(),
  },
});

describe('VoiceProfileService', () => {
  describe('get', () => {
    it('returns the stored voiceProfile', async () => {
      const prisma = makePrisma({
        findUnique: jest
          .fn()
          .mockResolvedValue({ voiceProfile: '# 画像\n雷厉风行' }),
      });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      expect(await svc.get('u1')).toBe('# 画像\n雷厉风行');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { voiceProfile: true },
      });
    });

    it('returns null when not set', async () => {
      const prisma = makePrisma({
        findUnique: jest.fn().mockResolvedValue({ voiceProfile: null }),
      });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      expect(await svc.get('u1')).toBeNull();
    });
  });

  describe('upsert', () => {
    it('stores profile (empty string → null)', async () => {
      const update = jest.fn().mockResolvedValue({});
      const prisma = makePrisma({ update });
      const svc = new VoiceProfileService(
        prisma as unknown as PrismaService,
        {} as never,
      );
      const out = await svc.upsert('u1', '');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { voiceProfile: null },
      });
      expect(out).toEqual({ profile: null });
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
});

import { NotFoundException } from '@nestjs/common';
import { ModelConfigService } from './model-config.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  modelConfig: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    modelConfig: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn(), update: jest.fn() },
  };
}

const baseConfig = {
  id: 'c1',
  userId: 'u1',
  name: '我的 GLM',
  provider: 'openai-compatible',
  model: 'GLM-5.2',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  apiKey: 'secret',
  temperature: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ModelConfigService', () => {
  describe('list', () => {
    it('returns configs with active flag and NO raw apiKey', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findMany.mockResolvedValue([baseConfig]);
      prisma.user.findUnique.mockResolvedValue({ activeModelConfigId: 'c1' });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      const out = await svc.list('u1');

      expect(prisma.modelConfig.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ id: 'c1', active: true, hasApiKey: true });
      expect(out[0]).not.toHaveProperty('apiKey');
    });
  });

  describe('create', () => {
    it('persists with userId and masks the key', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.create.mockResolvedValue(baseConfig);
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      const out = await svc.create('u1', {
        name: '我的 GLM',
        provider: 'openai-compatible',
        model: 'GLM-5.2',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        apiKey: 'secret',
      });

      expect(prisma.modelConfig.create).toHaveBeenCalledWith({
        // expect.objectContaining is an asymmetric matcher typed `any` in
        // @types/jest; it flows into toHaveBeenCalledWith(...: any[]).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ userId: 'u1', apiKey: 'secret' }),
      });
      expect(out).not.toHaveProperty('apiKey');
      expect(out.hasApiKey).toBe(true);
    });
  });

  describe('update', () => {
    it('throws NotFound when config belongs to another user', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue(null);
      const svc = new ModelConfigService(prisma as unknown as PrismaService);
      await expect(
        svc.update('u1', 'cX', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('keeps old apiKey when dto leaves it blank', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.modelConfig.update.mockResolvedValue(baseConfig);
      prisma.user.findUnique.mockResolvedValue({ activeModelConfigId: null });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      await svc.update('u1', 'c1', { name: '改名' });

      expect(prisma.modelConfig.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: '改名' }, // 不含 apiKey
      });
    });
  });

  describe('delete', () => {
    it('clears activeModelConfigId when deleting the active one', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.user.findUnique.mockResolvedValue({ activeModelConfigId: 'c1' });
      prisma.modelConfig.delete.mockResolvedValue(baseConfig);
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      await svc.delete('u1', 'c1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { activeModelConfigId: null },
      });
      expect(prisma.modelConfig.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });
  });

  describe('activate', () => {
    it('sets activeModelConfigId after ownership check', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue({ id: 'c1' });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      await svc.activate('u1', 'c1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { activeModelConfigId: 'c1' },
      });
    });
  });

  describe('getActive', () => {
    it('returns the active config WITH its apiKey (server-side use)', async () => {
      const prisma = makePrismaMock();
      prisma.user.findUnique.mockResolvedValue({
        activeModelConfig: baseConfig,
      });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      const out = await svc.getActive('u1');

      expect(out?.apiKey).toBe('secret'); // 工厂要用,不脱敏
    });

    it('returns null when none active', async () => {
      const prisma = makePrismaMock();
      prisma.user.findUnique.mockResolvedValue({ activeModelConfig: null });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);
      expect(await svc.getActive('u1')).toBeNull();
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { AgentModelOverrideService } from './agent-model-override.service';

const prisma = {
  agentModelOverride: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  modelConfig: {
    findFirst: jest.fn(),
  },
};

const svc = new AgentModelOverrideService(prisma as never);

beforeEach(() => jest.clearAllMocks());

describe('AgentModelOverrideService', () => {
  it('listMap 返回 agentKey→modelConfig 行 map(含 apiKey)', async () => {
    (prisma.agentModelOverride.findMany as jest.Mock).mockResolvedValue([
      {
        agentKey: 'writer',
        modelConfig: { id: 'mc1', apiKey: 'sk-x', updatedAt: new Date(0) },
      },
    ]);
    const map = await svc.listMap('u1');
    expect(map.get('writer')?.id).toBe('mc1');
    expect(map.get('writer')?.apiKey).toBe('sk-x');
    expect(prisma.agentModelOverride.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      include: { modelConfig: true },
    });
  });

  it('upsert 校验 modelConfig 归属当前用户', async () => {
    (prisma.modelConfig.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.upsert('u1', 'writer', 'mcX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.agentModelOverride.upsert).not.toHaveBeenCalled();
  });

  it('upsert 归属校验通过后写库', async () => {
    (prisma.modelConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'mc1' });
    await svc.upsert('u1', 'writer', 'mc1');
    expect(prisma.agentModelOverride.upsert).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
      create: { userId: 'u1', agentKey: 'writer', modelConfigId: 'mc1' },
      update: { modelConfigId: 'mc1' },
    });
  });

  it('listForApi 返回 agentKey→modelConfigId(脱敏)', async () => {
    (prisma.agentModelOverride.findMany as jest.Mock).mockResolvedValue([
      { agentKey: 'writer', modelConfigId: 'mc1' },
    ]);
    const out = await svc.listForApi('u1');
    expect(out).toEqual({ writer: 'mc1' });
  });

  it('remove 删指定 agentKey', async () => {
    await svc.remove('u1', 'writer');
    expect(prisma.agentModelOverride.delete).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
    });
  });
});

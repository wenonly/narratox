import { NotFoundException } from '@nestjs/common';
import { AgentModelOverrideService } from './agent-model-override.service';

const prisma = {
  agentModelOverride: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  vendor: {
    findFirst: jest.fn(),
  },
};

const svc = new AgentModelOverrideService(prisma as never);

beforeEach(() => jest.clearAllMocks());

describe('AgentModelOverrideService', () => {
  it('listMap 拼 ModelConfigRecord + temperatureOverride(modelId 非空,含 apiKey,经 vendor)', async () => {
    prisma.agentModelOverride.findMany.mockResolvedValue([
      {
        agentKey: 'writer',
        temperature: 0.3,
        model: {
          id: 'm1',
          model: 'glm-4-plus',
          temperature: 0.7,
          updatedAt: new Date(0),
          vendor: {
            provider: 'openai-compatible',
            baseUrl: 'https://bigmodel.cn',
            apiKey: 'sk-x',
          },
        },
      },
      // modelId 空(model: null)→ config 也 null,只保留 temperatureOverride。
      {
        agentKey: 'validator',
        temperature: 0.2,
        model: null,
      },
    ]);
    const map = await svc.listMap('u1');
    // modelId 非空行:正常拼装。
    expect(map.get('writer')?.config?.id).toBe('m1');
    expect(map.get('writer')?.config?.apiKey).toBe('sk-x');
    expect(map.get('writer')?.config?.provider).toBe('openai-compatible');
    expect(map.get('writer')?.temperatureOverride).toBe(0.3);
    // modelId 空行:config 为 null,temperatureOverride 仍保留。
    expect(map.get('validator')?.config).toBeNull();
    expect(map.get('validator')?.temperatureOverride).toBe(0.2);
    expect(prisma.agentModelOverride.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      include: { model: { include: { vendor: true } } },
    });
  });

  it('listForApi 返回 agentKey→{modelId,temperature}(脱敏)', async () => {
    prisma.agentModelOverride.findMany.mockResolvedValue([
      { agentKey: 'writer', modelId: 'm1', temperature: 0.3 },
    ]);
    const out = await svc.listForApi('u1');
    expect(out).toEqual({ writer: { modelId: 'm1', temperature: 0.3 } });
    expect(prisma.agentModelOverride.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { agentKey: true, modelId: true, temperature: true },
    });
  });

  it('upsert 校验 model 归属当前用户(经 vendor)', async () => {
    prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(
      svc.upsert('u1', 'writer', { modelId: 'mX', temperature: 0.3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.agentModelOverride.upsert).not.toHaveBeenCalled();
  });

  it('upsert 归属校验通过后写库(modelId + temperature)', async () => {
    prisma.vendor.findFirst.mockResolvedValue({ id: 'v1' });
    await svc.upsert('u1', 'writer', { modelId: 'm1', temperature: 0.3 });
    expect(prisma.agentModelOverride.upsert).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
      create: {
        userId: 'u1',
        agentKey: 'writer',
        modelId: 'm1',
        temperature: 0.3,
      },
      update: { modelId: 'm1', temperature: 0.3 },
    });
  });

  it('upsert 不传 temperature → 写 null(用模型自带)', async () => {
    prisma.vendor.findFirst.mockResolvedValue({ id: 'v1' });
    await svc.upsert('u1', 'writer', { modelId: 'm1' });
    expect(prisma.agentModelOverride.upsert).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
      create: {
        userId: 'u1',
        agentKey: 'writer',
        modelId: 'm1',
        temperature: null,
      },
      update: { modelId: 'm1', temperature: null },
    });
  });

  it('upsert modelId 空 + temperature 有值 → 建 override(modelId null,不校验 vendor)', async () => {
    await svc.upsert('u1', 'writer', { temperature: 0.7 });
    expect(prisma.agentModelOverride.upsert).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
      create: {
        userId: 'u1',
        agentKey: 'writer',
        modelId: null,
        temperature: 0.7,
      },
      update: { modelId: null, temperature: 0.7 },
    });
    // modelId 空 → 不需要校验 Model 归属。
    expect(prisma.vendor.findFirst).not.toHaveBeenCalled();
    expect(prisma.agentModelOverride.deleteMany).not.toHaveBeenCalled();
  });

  it('upsert modelId 空 + temperature null → 走 remove(两者都空 = 无 override)', async () => {
    await svc.upsert('u1', 'writer', {});
    expect(prisma.agentModelOverride.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', agentKey: 'writer' },
    });
    expect(prisma.vendor.findFirst).not.toHaveBeenCalled();
    expect(prisma.agentModelOverride.upsert).not.toHaveBeenCalled();
  });

  it('remove 删指定 agentKey', async () => {
    await svc.remove('u1', 'writer');
    expect(prisma.agentModelOverride.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', agentKey: 'writer' },
    });
  });

  it('remove 幂等:行不存在不抛错(deleteMany 返 count:0)', async () => {
    // 模拟温度变化对无 override 的 agent 触发 remove → deleteMany 返 0 行不报错
    prisma.agentModelOverride.deleteMany.mockResolvedValue({
      count: 0,
    });
    await expect(svc.remove('u1', 'no-such-agent')).resolves.toBeUndefined();
    expect(prisma.agentModelOverride.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', agentKey: 'no-such-agent' },
    });
  });
});

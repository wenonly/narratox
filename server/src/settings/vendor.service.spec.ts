import { VendorService } from './vendor.service';

const prisma = {
  user: {
    findUnique: jest.fn(),
  },
  vendor: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
const svc = new VendorService(prisma as never);
beforeEach(() => jest.clearAllMocks());

/** 把返回对象当宽表看,断言「apiKey 已被脱敏」(类型层已剔除该字段)。 */
const apiKeyOf = (row: unknown) => (row as Record<string, unknown>).apiKey;

describe('VendorService', () => {
  it('list 返回脱敏(无 apiKey,带 hasApiKey;标记 active 模型)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      activeModelId: 'm-active',
    });
    prisma.vendor.findMany.mockResolvedValue([
      {
        id: 'v1',
        apiKey: 'sk',
        models: [
          { id: 'm-active', model: 'glm', temperature: 0.7 },
          { id: 'm2', model: 'flash', temperature: 0.5 },
        ],
      },
    ]);
    const out = await svc.list('u1');
    expect(apiKeyOf(out[0])).toBeUndefined();
    expect(out[0].hasApiKey).toBe(true);
    // active 标记:m-active 为默认,m2 不是
    expect(out[0].models[0].active).toBe(true);
    expect(out[0].models[1].active).toBe(false);
  });

  it('create 写库', async () => {
    prisma.vendor.create.mockResolvedValue({
      id: 'v1',
      apiKey: 'sk',
      name: 'GLM',
    });
    const out = await svc.create('u1', {
      name: 'GLM',
      provider: 'anthropic',
      apiKey: 'sk',
    });
    expect(apiKeyOf(out)).toBeUndefined();
    expect(out.hasApiKey).toBe(true);
    expect(prisma.vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          name: 'GLM',
          apiKey: 'sk',
        }),
      }),
    );
  });

  it('update apiKey 空串不改', async () => {
    prisma.vendor.findFirst.mockResolvedValue({
      id: 'v1',
      userId: 'u1',
    });
    prisma.vendor.update.mockResolvedValue({
      id: 'v1',
      name: 'GLM2',
      apiKey: 'sk',
    });
    const out = await svc.update('u1', 'v1', { name: 'GLM2', apiKey: '' });
    expect(apiKeyOf(out)).toBeUndefined();
    expect(out.hasApiKey).toBe(true);
    expect(prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ apiKey: expect.anything() }),
      }),
    );
  });

  it('update apiKey 提供非空值则写入', async () => {
    prisma.vendor.findFirst.mockResolvedValue({
      id: 'v1',
      userId: 'u1',
    });
    prisma.vendor.update.mockResolvedValue({ id: 'v1' });
    await svc.update('u1', 'v1', { apiKey: 'sk2' });
    expect(prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ apiKey: 'sk2' }),
      }),
    );
  });

  it('update 不归属则抛错', async () => {
    prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(svc.update('u1', 'vX', { name: 'x' })).rejects.toThrow();
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it('delete 不归属则抛错', async () => {
    prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(svc.delete('u1', 'vX')).rejects.toThrow();
    expect(prisma.vendor.delete).not.toHaveBeenCalled();
  });
});

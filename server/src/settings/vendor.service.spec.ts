import { VendorService } from './vendor.service';

const prisma = {
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
  it('list 返回脱敏(无 apiKey,带 hasApiKey)', async () => {
    (prisma.vendor.findMany as jest.Mock).mockResolvedValue([
      { id: 'v1', apiKey: 'sk' },
    ]);
    const out = await svc.list('u1');
    expect(apiKeyOf(out[0])).toBeUndefined();
    expect(out[0].hasApiKey).toBe(true);
  });

  it('create 写库', async () => {
    (prisma.vendor.create as jest.Mock).mockResolvedValue({
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
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue({
      id: 'v1',
      userId: 'u1',
    });
    (prisma.vendor.update as jest.Mock).mockResolvedValue({
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
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue({
      id: 'v1',
      userId: 'u1',
    });
    (prisma.vendor.update as jest.Mock).mockResolvedValue({ id: 'v1' });
    await svc.update('u1', 'v1', { apiKey: 'sk2' });
    expect(prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ apiKey: 'sk2' }),
      }),
    );
  });

  it('update 不归属则抛错', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.update('u1', 'vX', { name: 'x' })).rejects.toThrow();
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it('delete 不归属则抛错', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.delete('u1', 'vX')).rejects.toThrow();
    expect(prisma.vendor.delete).not.toHaveBeenCalled();
  });
});

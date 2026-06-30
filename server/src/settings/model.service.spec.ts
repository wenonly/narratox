import { ModelService } from './model.service';

const prisma = {
  model: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  vendor: { findFirst: jest.fn() },
  user: { update: jest.fn() },
};
const svc = new ModelService(prisma as never);
beforeEach(() => jest.clearAllMocks());

describe('ModelService', () => {
  it('create 校验 vendor 归属(vendor 不归属则抛错且不写库)', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.create('u1', 'vX', { model: 'glm' })).rejects.toThrow();
    expect(prisma.model.create).not.toHaveBeenCalled();
  });

  it('create 归属通过写库', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue({ id: 'v1' });
    await svc.create('u1', 'v1', { model: 'glm-4-air', temperature: 0.7 });
    expect(prisma.model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'v1',
          model: 'glm-4-air',
          temperature: 0.7,
        }),
      }),
    );
  });

  it('activate 设 User.activeModelId', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue({ id: 'v1' });
    await svc.activate('u1', 'm1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { activeModelId: 'm1' },
    });
  });

  it('activate 不归属则抛错且不更新 User', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.activate('u1', 'mX')).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('update 校验 model 归属', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.update('u1', 'mX', { model: 'glm' })).rejects.toThrow();
    expect(prisma.model.update).not.toHaveBeenCalled();
  });

  it('delete 校验 model 归属', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.delete('u1', 'mX')).rejects.toThrow();
    expect(prisma.model.delete).not.toHaveBeenCalled();
  });
});

import { MasterOutlineService } from './master-outline.service';
import type { PrismaService } from '../prisma/prisma.service';

const prismaMock = {
  novel: { findFirst: jest.fn() },
  masterOutline: { upsert: jest.fn(), findUnique: jest.fn() },
};
const svc = new MasterOutlineService(
  prismaMock as unknown as PrismaService,
);

beforeEach(() => jest.clearAllMocks());

describe('MasterOutlineService', () => {
  it('upsert: 归属校验通过 → upsert by novelId', async () => {
    prismaMock.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prismaMock.masterOutline.upsert.mockResolvedValue({ id: 'm1' });
    const res = await svc.upsert('u1', 'n1', { theme: '核心' });
    expect(prismaMock.masterOutline.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { novelId: 'n1' } }),
    );
    expect(res).toMatchObject({ id: 'm1' });
  });

  it('upsert: 非本人小说 → 抛错', async () => {
    prismaMock.novel.findFirst.mockResolvedValue(null);
    await expect(svc.upsert('u1', 'n1', { theme: 'x' })).rejects.toThrow();
  });

  it('get: 返回总纲或 null', async () => {
    prismaMock.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prismaMock.masterOutline.findUnique.mockResolvedValue(null);
    expect(await svc.get('u1', 'n1')).toBeNull();
  });
});

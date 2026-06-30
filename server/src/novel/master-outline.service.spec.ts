import { MasterOutlineService } from './master-outline.service';
import type { PrismaService } from '../prisma/prisma.service';

const prismaMock = {
  novel: { findFirst: jest.fn() },
  masterOutline: { upsert: jest.fn(), findUnique: jest.fn() },
};
const svc = new MasterOutlineService(prismaMock as unknown as PrismaService);

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

  it('upsert: threeAct 透传到 upsert 字段', async () => {
    prismaMock.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prismaMock.masterOutline.upsert.mockResolvedValue({ id: 'm1' });
    const threeAct = {
      act1Turn: { atVolume: 2, beat: '上路' },
      act2Turn: { atVolume: 5, beat: '低谷' },
    };
    await svc.upsert('u1', 'n1', { theme: '核心', threeAct });
    expect(prismaMock.masterOutline.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ threeAct }),
        update: expect.objectContaining({ threeAct }),
      }),
    );
  });

  it('upsert: 未传 threeAct → 默认 {}(与其它字段同语义,全替换)', async () => {
    prismaMock.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prismaMock.masterOutline.upsert.mockResolvedValue({ id: 'm1' });
    await svc.upsert('u1', 'n1', { theme: '核心' });
    expect(prismaMock.masterOutline.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ threeAct: {} }),
      }),
    );
  });
});

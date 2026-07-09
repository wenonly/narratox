import { OutlineService } from './outline.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  volume: {
    upsert: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  chapterOutline: {
    upsert: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  arc: { count: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    volume: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    chapterOutline: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    arc: { count: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };
}

const NODE = { subject: '少年', action: '夺', target: '妖刀' };

describe('OutlineService', () => {
  describe('assertOwned', () => {
    it('passes when the novel belongs to the user', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      await expect(svc.assertOwned('u1', 'n1')).resolves.toBeUndefined();
      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
    });

    it('throws when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      await expect(svc.assertOwned('u1', 'n1')).rejects.toThrow();
    });
  });

  describe('upsertVolume', () => {
    it('upserts a volume by (novelId, order)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.volume.upsert.mockResolvedValue({ id: 'v1' });
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );

      await svc.upsertVolume('u1', 'n1', 1, {
        title: '初入江湖',
        goal: '少年下山',
        synopsis: '卷一梗概',
      });

      expect(prisma.volume.upsert).toHaveBeenCalledWith({
        where: { novelId_order: { novelId: 'n1', order: 1 } },
        create: {
          novelId: 'n1',
          order: 1,
          title: '初入江湖',
          goal: '少年下山',
          synopsis: '卷一梗概',
          bridge: '',
          mainProgress: '',
        },
        update: {
          title: '初入江湖',
          goal: '少年下山',
          synopsis: '卷一梗概',
          bridge: '',
          mainProgress: '',
        },
      });
    });
  });

  describe('upsertChapterPlan', () => {
    it('upserts a chapter outline by (novelId, chapterOrder) with node data', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapterOutline.upsert.mockResolvedValue({ id: 'o3' });
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );

      await svc.upsertChapterPlan('u1', 'n1', 3, {
        title: '夺刀',
        cbn: NODE,
        cpns: [NODE, { subject: '掌柜', action: '算计', target: '少年' }],
        cen: { subject: '少年', action: '持刀', target: '逃夜' },
        mustCover: ['妖刀认主'],
        forbidden: ['不可露身世'],
        volumeId: 'v1',
      });

      expect(prisma.chapterOutline.upsert).toHaveBeenCalledWith({
        where: { novelId_chapterOrder: { novelId: 'n1', chapterOrder: 3 } },
        create: {
          novelId: 'n1',
          chapterOrder: 3,
          title: '夺刀',
          cbn: NODE,
          cpns: [NODE, { subject: '掌柜', action: '算计', target: '少年' }],
          cen: { subject: '少年', action: '持刀', target: '逃夜' },
          mustCover: ['妖刀认主'],
          forbidden: ['不可露身世'],
          volumeId: 'v1',
        },
        update: {
          title: '夺刀',
          cbn: NODE,
          cpns: [NODE, { subject: '掌柜', action: '算计', target: '少年' }],
          cen: { subject: '少年', action: '持刀', target: '逃夜' },
          mustCover: ['妖刀认主'],
          forbidden: ['不可露身世'],
          volumeId: 'v1',
        },
      });
    });

    it('throws when the novel is not owned (no upsert)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      await expect(
        svc.upsertChapterPlan('u1', 'n1', 1, {
          cbn: NODE,
          cpns: [NODE],
          cen: NODE,
        }),
      ).rejects.toThrow();
      expect(prisma.chapterOutline.upsert).not.toHaveBeenCalled();
    });
  });

  describe('findVolumeByOrder', () => {
    it('returns the volume id, user-scoped', async () => {
      const prisma = makePrismaMock();
      prisma.volume.findFirst.mockResolvedValue({ id: 'v1' });
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const v = await svc.findVolumeByOrder('u1', 'n1', 1);
      expect(prisma.volume.findFirst).toHaveBeenCalledWith({
        where: { novelId: 'n1', order: 1, novel: { userId: 'u1' } },
        select: { id: true },
      });
      expect(v).toEqual({ id: 'v1' });
    });
  });

  describe('getChapterPlan', () => {
    it('returns the chapter outline by chapterOrder, user-scoped', async () => {
      const prisma = makePrismaMock();
      prisma.chapterOutline.findFirst.mockResolvedValue({
        id: 'o3',
        chapterOrder: 3,
        title: '夺刀',
      });
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const plan = await svc.getChapterPlan('u1', 'n1', 3);
      expect(prisma.chapterOutline.findFirst).toHaveBeenCalledWith({
        where: { novelId: 'n1', chapterOrder: 3, novel: { userId: 'u1' } },
      });
      expect(plan).toEqual({ id: 'o3', chapterOrder: 3, title: '夺刀' });
    });
  });

  describe('listOutline', () => {
    it('returns volumes + chapter outlines, ordered, user-scoped', async () => {
      const prisma = makePrismaMock();
      prisma.volume.findMany.mockResolvedValue([{ id: 'v1', order: 1 }]);
      prisma.chapterOutline.findMany.mockResolvedValue([
        { id: 'o1', chapterOrder: 1 },
      ]);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );

      const out = await svc.listOutline('u1', 'n1');

      expect(prisma.volume.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', novel: { userId: 'u1' } },
        orderBy: { order: 'asc' },
      });
      expect(prisma.chapterOutline.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', novel: { userId: 'u1' } },
        orderBy: { chapterOrder: 'asc' },
      });
      expect(out.volumes).toEqual([{ id: 'v1', order: 1 }]);
      expect(out.chapterOutlines).toEqual([{ id: 'o1', chapterOrder: 1 }]);
    });
  });

  describe('nextChapterOrder', () => {
    it('returns the first non-WRITTEN chapter outline order', async () => {
      const prisma = makePrismaMock();
      prisma.chapterOutline.findMany.mockResolvedValue([
        { chapterOrder: 4, status: 'WRITTEN' },
        { chapterOrder: 5, status: 'DRAFT' },
        { chapterOrder: 6, status: 'DRAFT' },
      ]);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      await expect(svc.nextChapterOrder('u1', 'n1')).resolves.toBe(5);
    });

    it('falls back to max chapterOrder + 1 when all outlines are WRITTEN', async () => {
      const prisma = makePrismaMock();
      prisma.chapterOutline.findMany.mockResolvedValue([
        { chapterOrder: 3, status: 'WRITTEN' },
        { chapterOrder: 4, status: 'WRITTEN' },
      ]);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      await expect(svc.nextChapterOrder('u1', 'n1')).resolves.toBe(5);
    });

    it('falls back to 1 when no outlines exist', async () => {
      const prisma = makePrismaMock();
      prisma.chapterOutline.findMany.mockResolvedValue([]);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      await expect(svc.nextChapterOrder('u1', 'n1')).resolves.toBe(1);
    });
  });

  describe('deleteChapterPlan', () => {
    it('DRAFT 细纲 → ok 无 warning', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapterOutline.findFirst.mockResolvedValue({
        id: 'co1',
        chapterOrder: 5,
        status: 'DRAFT',
      });
      prisma.chapterOutline.delete.mockResolvedValue({});
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteChapterPlan('u1', 'n1', 5);
      expect(r).toEqual({ ok: true, chapterOrder: 5, warned: false });
      expect(prisma.chapterOutline.delete).toHaveBeenCalledWith({
        where: { id: 'co1' },
      });
    });

    it('WRITTEN 细纲 → ok 且 warned=true(软护栏)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapterOutline.findFirst.mockResolvedValue({
        id: 'co2',
        chapterOrder: 3,
        status: 'WRITTEN',
      });
      prisma.chapterOutline.delete.mockResolvedValue({});
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteChapterPlan('u1', 'n1', 3);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warned).toBe(true);
        expect(r.reason).toContain('已写');
      }
    });

    it('不存在的细纲 → {ok:false, reason:"not_found"}', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapterOutline.findFirst.mockResolvedValue(null);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteChapterPlan('u1', 'n1', 99);
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe('deleteVolume', () => {
    it('cascade=false 且无下属 → ok', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.volume.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.arc.count.mockResolvedValue(0);
      prisma.chapterOutline.count.mockResolvedValue(0);
      const txMock = {
        arc: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        chapterOutline: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        volume: { delete: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteVolume('u1', 'n1', 2, false);
      expect(r).toEqual({
        ok: true,
        order: 2,
        deletedArcs: 0,
        deletedChapterPlans: 0,
      });
    });

    it('cascade=false 且有下属 → HAS_DESCENDANTS 报错清单', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.volume.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.arc.count.mockResolvedValue(2);
      prisma.chapterOutline.count.mockResolvedValue(5);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteVolume('u1', 'n1', 1, false);
      expect(r).toEqual({
        ok: false,
        error: 'HAS_DESCENDANTS',
        arcs: 2,
        chapterPlans: 5,
        hint: expect.stringContaining('cascade=true'),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cascade=true → 事务连删 volume+arcs+chapterOutlines', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.volume.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.arc.count.mockResolvedValue(2);
      prisma.chapterOutline.count.mockResolvedValue(5);
      const txMock = {
        arc: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
        chapterOutline: {
          deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
        },
        volume: { delete: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteVolume('u1', 'n1', 1, true);
      expect(r).toEqual({
        ok: true,
        order: 1,
        deletedArcs: 2,
        deletedChapterPlans: 5,
      });
      expect(txMock.arc.deleteMany).toHaveBeenCalledWith({
        where: { volumeId: 'v1' },
      });
      expect(txMock.chapterOutline.deleteMany).toHaveBeenCalledWith({
        where: { volumeId: 'v1' },
      });
      expect(txMock.volume.delete).toHaveBeenCalledWith({
        where: { id: 'v1' },
      });
    });

    it('卷不存在 → {ok:false, reason:"not_found"}', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.volume.findFirst.mockResolvedValue(null);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.deleteVolume('u1', 'n1', 9, false);
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe('patchChapterPlan', () => {
    it('只传 cen → 仅 cen 更新,其他不动', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapterOutline.findFirst.mockResolvedValue({ id: 'co1' });
      prisma.chapterOutline.update.mockResolvedValue({});
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const cen = { subject: '主角', action: '到达', target: '山门' };
      const r = await svc.patchChapterPlan('u1', 'n1', 5, { cen });
      expect(r).toEqual({
        ok: true,
        chapterOrder: 5,
        updatedFields: ['cen'],
      });
      expect(prisma.chapterOutline.update).toHaveBeenCalledWith({
        where: { id: 'co1' },
        data: { cen },
      });
    });

    it('传 volumeOrder → 解析 volumeId', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.volume.findFirst.mockResolvedValue({ id: 'v3' });
      prisma.chapterOutline.findFirst.mockResolvedValue({ id: 'co1' });
      prisma.chapterOutline.update.mockResolvedValue({});
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.patchChapterPlan('u1', 'n1', 5, { volumeOrder: 3 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.updatedFields).toContain('volumeId');
      expect(prisma.chapterOutline.update).toHaveBeenCalledWith({
        where: { id: 'co1' },
        data: { volumeId: 'v3' },
      });
    });

    it('不存在的章 → {ok:false, reason:"not_found"}', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapterOutline.findFirst.mockResolvedValue(null);
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.patchChapterPlan('u1', 'n1', 99, { title: 'x' });
      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('空 patch(无任何字段)→ {ok:false, reason:"empty_patch"}', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new OutlineService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockResolvedValue(null) } as never,
        { listArcs: jest.fn().mockResolvedValue([]) } as never,
      );
      const r = await svc.patchChapterPlan('u1', 'n1', 5, {});
      expect(r).toEqual({ ok: false, reason: 'empty_patch' });
    });
  });
});

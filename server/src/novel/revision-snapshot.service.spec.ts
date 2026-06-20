import { RevisionSnapshotService } from './revision-snapshot.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  chapter: { findFirst: jest.Mock; update: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    chapter: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
}

describe('RevisionSnapshotService', () => {
  it('snapshot reads current content into memory and returns chars', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue({ content: '原版正文' });
    const svc = new RevisionSnapshotService(prisma as unknown as PrismaService);
    const r = await svc.snapshot('u1', 'n1', 3);
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
      where: { novelId: 'n1', order: 3, novel: { userId: 'u1' } },
      select: { content: true },
    });
    expect(r).toEqual({ ok: true, chars: 4 });
  });

  it('snapshot returns no_chapter when the chapter is absent', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue(null);
    const svc = new RevisionSnapshotService(prisma as unknown as PrismaService);
    const r = await svc.snapshot('u1', 'n1', 9);
    expect(r).toEqual({ ok: false, reason: 'no_chapter' });
  });

  it('restore writes the snapshotted content back to the chapter', async () => {
    const prisma = makePrismaMock();
    // 第一次调用 snapshot:返回原版
    prisma.chapter.findFirst.mockResolvedValueOnce({ content: '原版正文' });
    // restore 时按 order 查 id
    prisma.chapter.findFirst.mockResolvedValueOnce({ id: 'c3' });
    const svc = new RevisionSnapshotService(prisma as unknown as PrismaService);

    await svc.snapshot('u1', 'n1', 3);
    const r = await svc.restore('u1', 'n1', 3);

    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'c3' },
      data: { content: '原版正文' },
    });
    expect(r).toEqual({ ok: true, chars: 4 });
  });

  it('restore returns no_snapshot when nothing was snapshotted', async () => {
    const prisma = makePrismaMock();
    const svc = new RevisionSnapshotService(prisma as unknown as PrismaService);
    const r = await svc.restore('u1', 'n1', 3);
    expect(r).toEqual({ ok: false, reason: 'no_snapshot' });
    expect(prisma.chapter.update).not.toHaveBeenCalled();
  });
});

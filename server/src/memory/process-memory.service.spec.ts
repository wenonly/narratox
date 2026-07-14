import {
  ProcessMemoryService,
  MEMORY_LIMITS,
} from './process-memory.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  novelProcessMemory: { upsert: jest.Mock; findFirst: jest.Mock };
}
const makePrismaMock = (): PrismaMock => ({
  novel: { findFirst: jest.fn() },
  novelProcessMemory: { upsert: jest.fn(), findFirst: jest.fn() },
});

describe('ProcessMemoryService', () => {
  it('upsert: 只覆盖传了的段(undefined=保留原值)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.novelProcessMemory.upsert.mockResolvedValue({
      rules: '新规矩',
      lessons: '旧经验',
      decisions: '旧决策',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.upsert('u1', 'n1', { rules: '新规矩' });
    expect(prisma.novelProcessMemory.upsert).toHaveBeenCalledWith({
      where: { novelId: 'n1' },
      create: { novelId: 'n1', rules: '新规矩' },
      update: { rules: '新规矩' },
      select: { rules: true, lessons: true, decisions: true },
    });
    expect(out).toEqual({
      rules: '新规矩',
      lessons: '旧经验',
      decisions: '旧决策',
    });
  });

  it('upsert: 空串=清空该段(主动删除)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.novelProcessMemory.upsert.mockResolvedValue({
      rules: '',
      lessons: '保留',
      decisions: '保留',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    await svc.upsert('u1', 'n1', { rules: '' });
    expect(prisma.novelProcessMemory.upsert).toHaveBeenCalledWith({
      where: { novelId: 'n1' },
      create: { novelId: 'n1', rules: '' },
      update: { rules: '' },
      select: { rules: true, lessons: true, decisions: true },
    });
  });

  it('upsert: 超长字段截断到 MEMORY_LIMITS', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.novelProcessMemory.upsert.mockResolvedValue({
      rules: 'x'.repeat(MEMORY_LIMITS.rules),
      lessons: '',
      decisions: '',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const longRules = 'x'.repeat(MEMORY_LIMITS.rules + 100);
    await svc.upsert('u1', 'n1', { rules: longRules });
    const call = prisma.novelProcessMemory.upsert.mock.calls[0][0];
    expect(call.update.rules.length).toBe(MEMORY_LIMITS.rules);
  });

  it('upsert: novel 不归属 user → 返回 null(越权)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue(null);
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.upsert('u1', 'other-novel', { rules: 'x' });
    expect(out).toBeNull();
    expect(prisma.novelProcessMemory.upsert).not.toHaveBeenCalled();
  });

  it('get: 三段全空 → 返回 null', async () => {
    const prisma = makePrismaMock();
    prisma.novelProcessMemory.findFirst.mockResolvedValue({
      rules: '',
      lessons: '',
      decisions: '',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.get('u1', 'n1');
    expect(out).toBeNull();
  });

  it('get: 任一段非空 → 返回三段', async () => {
    const prisma = makePrismaMock();
    prisma.novelProcessMemory.findFirst.mockResolvedValue({
      rules: '规矩',
      lessons: '',
      decisions: '决策',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.get('u1', 'n1');
    expect(out).toEqual({ rules: '规矩', lessons: '', decisions: '决策' });
    expect(prisma.novelProcessMemory.findFirst).toHaveBeenCalledWith({
      where: { novelId: 'n1', novel: { userId: 'u1' } },
      select: { rules: true, lessons: true, decisions: true },
    });
  });

  it('get: 无行 → 返回 null', async () => {
    const prisma = makePrismaMock();
    prisma.novelProcessMemory.findFirst.mockResolvedValue(null);
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.get('u1', 'n1');
    expect(out).toBeNull();
  });
});

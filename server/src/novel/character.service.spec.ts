import { CharacterService } from './character.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  character: {
    upsert: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  characterChange: {
    create: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    character: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    characterChange: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('CharacterService', () => {
  describe('upsertCharacter', () => {
    it('upserts a character by (novelId, name) with stable identity', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        role: 'PROTAGONIST',
        aliases: ['沈少'],
        faction: '棺材铺',
        background: '青州城棺材铺少掌柜',
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          role: 'PROTAGONIST',
          aliases: ['沈少'],
          faction: '棺材铺',
          background: '青州城棺材铺少掌柜',
        },
        update: {
          role: 'PROTAGONIST',
          aliases: ['沈少'],
          faction: '棺材铺',
          background: '青州城棺材铺少掌柜',
        },
      });
    });

    it('持久化 5 个新稳定身份字段(appearance/personality/motivation/arcGoal/voice)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        role: 'PROTAGONIST',
        appearance: '青衫长剑',
        personality: '外冷内热',
        motivation: '复仇',
        arcGoal: '放下执念',
        voice: '寡言、短句',
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          role: 'PROTAGONIST',
          appearance: '青衫长剑',
          personality: '外冷内热',
          motivation: '复仇',
          arcGoal: '放下执念',
          voice: '寡言、短句',
        },
        update: {
          role: 'PROTAGONIST',
          appearance: '青衫长剑',
          personality: '外冷内热',
          motivation: '复仇',
          arcGoal: '放下执念',
          voice: '寡言、短句',
        },
      });
    });

    it('持久化人物小传 growth/flaw(防 OCG 的成长经历 + 弱点)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        role: 'PROTAGONIST',
        growth: '幼年家变,流落棺材铺,养成隐忍',
        flaw: '执念复仇,易被仇家牵鼻',
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            growth: '幼年家变,流落棺材铺,养成隐忍',
            flaw: '执念复仇,易被仇家牵鼻',
          }),
        }),
      );
    });

    it('null 字段视为「不提供」跳过(等同 undefined),不会把已有值清空', async () => {
      // 回归:set_character schema 用 .nullish(),模型发 null 不应被当「显式清空」。
      // null 与 undefined 都跳过 → update 不含该字段 → 保留旧值。
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        role: 'PROTAGONIST',
        faction: null, // 显式 null → 跳过
        background: undefined, // undefined → 跳过
        personality: '外冷内热', // 有值 → 写入
        growth: null, // 显式 null → 跳过
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          role: 'PROTAGONIST',
          personality: '外冷内热',
        },
        update: {
          role: 'PROTAGONIST',
          personality: '外冷内热',
        },
      });
    });
  });

  describe('findOrCreateByName', () => {
    it('returns existing character when found', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const ch = await svc.findOrCreateByName('u1', 'n1', '沈砚');
      expect(ch).toEqual({ id: 'c1', name: '沈砚' });
      expect(prisma.character.create).not.toHaveBeenCalled();
    });

    it('creates a minimal character when not found', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue(null);
      prisma.character.create.mockResolvedValue({ id: 'c2', name: '陆青棠' });
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const ch = await svc.findOrCreateByName('u1', 'n1', '陆青棠');
      expect(prisma.character.create).toHaveBeenCalledWith({
        data: { novelId: 'n1', name: '陆青棠' },
      });
      expect(ch).toEqual({ id: 'c2', name: '陆青棠' });
    });
  });

  describe('recordChanges', () => {
    it('find-or-creates characters + writes CharacterChange rows,significance 默认 MINOR', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.recordChanges('u1', 'n1', 5, [
        {
          name: '沈砚',
          field: 'personality',
          value: '沉稳果决',
          reason: '恩师被杀',
        },
      ]);

      expect(prisma.characterChange.create).toHaveBeenCalledWith({
        data: {
          novelId: 'n1',
          characterId: 'c1',
          chapterOrder: 5,
          field: 'personality',
          value: '沉稳果决',
          reason: '恩师被杀',
          significance: 'MINOR',
        },
      });
    });

    it('significance=MAJOR 透传(实质蜕变)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.recordChanges('u1', 'n1', 5, [
        {
          name: '沈砚',
          field: 'personality',
          value: '从天真转冷峻',
          reason: '恩师被杀',
          significance: 'MAJOR',
        },
      ]);

      expect(prisma.characterChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ significance: 'MAJOR' }),
      });
    });
  });

  describe('getCharacter', () => {
    it('时间线 = MAJOR 全量 + MINOR 最近 30;currentState 从合并集派生', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({
        id: 'c1',
        name: '沈砚',
        role: 'PROTAGONIST',
        aliases: [],
      });
      // 第 1 次 findMany = MAJOR(全量);第 2 次 = MINOR(take 30)。
      const majorChange = {
        field: 'personality',
        value: '从天真转冷峻',
        chapterOrder: 50,
        reason: '恩师被杀',
        significance: 'MAJOR',
      };
      const minorChange = {
        field: 'relationship:陆青棠',
        value: '缓和',
        chapterOrder: 52,
        reason: '并肩退敌',
        significance: 'MINOR',
      };
      prisma.characterChange.findMany
        .mockResolvedValueOnce([majorChange]) // MAJOR
        .mockResolvedValueOnce([minorChange]); // MINOR recent
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const result = await svc.getCharacter('u1', 'n1', '沈砚');

      expect(result).not.toBeNull();
      // MAJOR 查全量、MINOR take:30
      expect(prisma.characterChange.findMany).toHaveBeenNthCalledWith(1, {
        where: { characterId: 'c1', significance: 'MAJOR' },
        orderBy: { chapterOrder: 'desc' },
      });
      expect(prisma.characterChange.findMany).toHaveBeenNthCalledWith(2, {
        where: { characterId: 'c1', significance: 'MINOR' },
        orderBy: { chapterOrder: 'desc' },
        take: 30,
      });
      // 合并集按 chapterOrder desc:52 在前
      expect(result!.changes.map((c) => c.chapterOrder)).toEqual([52, 50]);
      // currentState 从合并集派生(MAJOR 的 personality + MINOR 的 relationship)
      expect(result!.currentState.personality).toEqual({
        value: '从天真转冷峻',
        chapterOrder: 50,
        reason: '恩师被杀',
      });
    });
  });

  describe('listCharacters', () => {
    it('returns all characters with current state', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findMany.mockResolvedValue([
        { id: 'c1', name: '沈砚', role: 'PROTAGONIST', changes: [] },
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const result = await svc.listCharacters('u1', 'n1');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: '沈砚', role: 'PROTAGONIST' });
    });
  });

  describe('getCharacter (别名解析)', () => {
    it('传别名也能命中(OR aliases has),返回 canonical', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({
        id: 'c1',
        name: '沈砚',
        role: 'PROTAGONIST',
        aliases: ['沈少'],
      });
      prisma.characterChange.findMany.mockResolvedValue([]);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const ch = await svc.getCharacter('u1', 'n1', '沈少');

      expect(prisma.character.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ name: '沈少' }, { aliases: { has: '沈少' } }],
          }),
        }),
      );
      expect(ch).not.toBeNull();
      expect(ch!.name).toBe('沈砚');
    });
  });

  describe('getCharacterHistory', () => {
    it('返回角色完整时间线(可按 sinceChapter/significance 过滤)——旧 MINOR 也能查到', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.findMany.mockResolvedValue([
        {
          field: 'personality',
          value: '冷峻',
          chapterOrder: 80,
          significance: 'MAJOR',
        },
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const res = await svc.getCharacterHistory('u1', 'n1', '沈砚', {
        sinceChapter: 50,
        significance: 'MAJOR',
      });

      expect(res.name).toBe('沈砚');
      expect(res.changes).toHaveLength(1);
      expect(prisma.characterChange.findMany).toHaveBeenCalledWith({
        where: {
          characterId: 'c1',
          chapterOrder: { gte: 50 },
          significance: 'MAJOR',
        },
        orderBy: { chapterOrder: 'desc' },
      });
    });

    it('角色不存在 → { name, changes: [] }', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue(null);
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const res = await svc.getCharacterHistory('u1', 'n1', '路人甲');
      expect(res).toEqual({ name: '路人甲', changes: [] });
    });
  });

  describe('deleteCharacter', () => {
    it('无 CharacterChange → 直接删,deletedChanges: 0', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.count.mockResolvedValue(0);
      prisma.character.delete.mockResolvedValue({});
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '沈砚', false);

      expect(r).toEqual({ ok: true, name: '沈砚', deletedChanges: 0 });
      expect(prisma.character.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('有 CharacterChange + cascade=false → HAS_CHANGES 拒绝返清单(不偷删)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.count.mockResolvedValue(7);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '沈砚', false);

      expect(r).toEqual({
        ok: false,
        error: 'HAS_CHANGES',
        changes: 7,
        hint: '该角色有 7 条变迁史,删除前请确认:传 cascade=true 连带删,或保留变迁史(角色删了变迁史成孤儿)',
      });
      expect(prisma.character.delete).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('有 CharacterChange + cascade=true → $transaction 连删,返 deletedChanges', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.count.mockResolvedValue(3);
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          characterChange: { deleteMany: prisma.characterChange.deleteMany },
          character: { delete: prisma.character.delete },
        };
        return cb(tx);
      });
      prisma.characterChange.deleteMany.mockResolvedValue({ count: 3 });
      prisma.character.delete.mockResolvedValue({});
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '沈砚', true);

      expect(r).toEqual({ ok: true, name: '沈砚', deletedChanges: 3 });
      expect(prisma.characterChange.deleteMany).toHaveBeenCalledWith({
        where: { characterId: 'c1' },
      });
      expect(prisma.character.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('角色不存在 → not_found', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue(null);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '路人甲', false);

      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe('clearCharacters', () => {
    it('无任何角色 → empty', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', status: 'CONCEPT' });
      prisma.character.count.mockResolvedValue(0);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.clearCharacters('u1', 'n1');

      expect(r).toEqual({ ok: false, reason: 'empty' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('CONCEPT → 删,无 warning', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', status: 'CONCEPT' });
      prisma.character.count.mockResolvedValue(3);
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          characterChange: { deleteMany: prisma.characterChange.deleteMany },
          character: { deleteMany: prisma.character.deleteMany },
        };
        return cb(tx);
      });
      prisma.characterChange.deleteMany.mockResolvedValue({ count: 12 });
      prisma.character.deleteMany.mockResolvedValue({ count: 3 });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.clearCharacters('u1', 'n1');

      expect(r).toEqual({
        ok: true,
        deletedCharacters: 3,
        deletedChanges: 12,
        warned: false,
      });
      expect(prisma.characterChange.deleteMany).toHaveBeenCalledWith({
        where: { novelId: 'n1' },
      });
      expect(prisma.character.deleteMany).toHaveBeenCalledWith({
        where: { novelId: 'n1' },
      });
    });

    it('ACTIVE → 删 + warned=true + reason', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', status: 'ACTIVE' });
      prisma.character.count.mockResolvedValue(5);
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          characterChange: { deleteMany: prisma.characterChange.deleteMany },
          character: { deleteMany: prisma.character.deleteMany },
        };
        return cb(tx);
      });
      prisma.characterChange.deleteMany.mockResolvedValue({ count: 20 });
      prisma.character.deleteMany.mockResolvedValue({ count: 5 });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.clearCharacters('u1', 'n1');

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warned).toBe(true);
        expect(r.reason).toContain('ACTIVE');
        expect(r.deletedCharacters).toBe(5);
        expect(r.deletedChanges).toBe(20);
      }
    });
  });

  describe('upsertCharacter clear_fields', () => {
    it('clear_fields: [appearance] → 该字段 set 为空串,其他字段保留', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        personality: '新描述',
        clear_fields: ['appearance'],
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          personality: '新描述',
          appearance: '',
        },
        update: {
          personality: '新描述',
          appearance: '',
        },
      });
    });

    it('clear_fields 多字段 + 与 merge 共存:正常应用', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        motivation: '复仇',
        clear_fields: ['appearance', 'growth'],
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          motivation: '复仇',
          appearance: '',
          growth: '',
        },
        update: {
          motivation: '复仇',
          appearance: '',
          growth: '',
        },
      });
    });

    it('clear_fields 含未知字段名 → 抛错(防 typo 静默丢数据)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await expect(
        svc.upsertCharacter('u1', 'n1', {
          name: '沈砚',
          clear_fields: ['typo_field'],
        }),
      ).rejects.toThrow(/typo_field/);
    });

    it('clear_fields 含 name/role/aliases → 抛错(不在白名单)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await expect(
        svc.upsertCharacter('u1', 'n1', {
          name: '沈砚',
          clear_fields: ['name'],
        }),
      ).rejects.toThrow(/name/);
    });
  });
});

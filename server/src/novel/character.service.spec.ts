import { CharacterService } from './character.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  character: {
    upsert: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
  characterChange: { create: jest.Mock; findMany: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    character: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    characterChange: { create: jest.fn(), findMany: jest.fn() },
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
    it('find-or-creates characters + writes CharacterChange rows', async () => {
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
        { name: '沈砚', field: 'appearance', value: 'appeared', reason: '' },
      ]);

      expect(prisma.characterChange.create).toHaveBeenCalledTimes(2);
      expect(prisma.characterChange.create).toHaveBeenNthCalledWith(1, {
        data: {
          novelId: 'n1',
          characterId: 'c1',
          chapterOrder: 5,
          field: 'personality',
          value: '沉稳果决',
          reason: '恩师被杀',
        },
      });
    });
  });

  describe('getCharacter', () => {
    it('returns character + current state (latest change per field)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      // include: changes ordered desc (latest first).
      prisma.character.findFirst.mockResolvedValue({
        id: 'c1',
        name: '沈砚',
        role: 'PROTAGONIST',
        aliases: [],
        faction: '',
        background: '',
        changes: [
          {
            field: 'personality',
            value: '沉稳果决',
            chapterOrder: 5,
            reason: '恩师被杀',
          },
          {
            field: 'personality',
            value: '懒散随性',
            chapterOrder: 1,
            reason: '初始',
          },
          {
            field: 'appearance',
            value: 'appeared',
            chapterOrder: 5,
            reason: '',
          },
        ],
      });
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const result = await svc.getCharacter('u1', 'n1', '沈砚');
      expect(result).not.toBeNull();
      expect(result!.currentState.personality).toEqual({
        value: '沉稳果决',
        chapterOrder: 5,
        reason: '恩师被杀',
      });
      expect(result!.currentState.appearance).toEqual({
        value: 'appeared',
        chapterOrder: 5,
        reason: '',
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

  describe('listIndex', () => {
    it('返回 name+role 索引(lean,select 只取 name+role)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findMany.mockResolvedValue([
        { name: '沈砚', role: 'PROTAGONIST' },
        { name: '陆青棠', role: 'SUPPORTING' },
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const idx = await svc.listIndex('u1', 'n1');

      expect(idx).toEqual([
        { name: '沈砚', role: 'PROTAGONIST' },
        { name: '陆青棠', role: 'SUPPORTING' },
      ]);
      expect(prisma.character.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { name: true, role: true } }),
      );
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
        changes: [],
      });
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
});

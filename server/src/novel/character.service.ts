import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CharacterChangeInput {
  name: string;
  field: string;
  value: string;
  reason: string;
  significance?: 'MAJOR' | 'MINOR';
}

/**
 * 角色资源服务(B2)。事件驱动时间线:
 *  - Character = 稳定身份(name/aliases/role/faction/background)
 *  - CharacterChange = 演变时间线(第几章/哪个维度/变成什么/为什么变)
 *  - 当前态 = 每维度最新 CharacterChange 的 value(派生,不直接 CRUD)
 *
 * settler 通过 write_summary 的 roleChanges 自动写 CharacterChange。
 * main agent 通过 set_character 建稳定身份。writer 通过 get_character 读当前态。
 */
@Injectable()
export class CharacterService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOwned(userId: string, novelId: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }

  /** upsert 角色稳定身份(by novelId+name)。 */
  async upsertCharacter(
    userId: string,
    novelId: string,
    data: {
      name: string;
      // null 与 undefined 都视为「不提供」(跳过=保留旧值)。schema 用 .nullish(),
      // 模型发 null 不再被 zod 拒收而触发重试(同 set_references 的修复)。
      role?: string | null;
      aliases?: string[] | null;
      faction?: string | null;
      background?: string | null;
      appearance?: string | null;
      personality?: string | null;
      motivation?: string | null;
      arcGoal?: string | null;
      voice?: string | null;
      growth?: string | null;
      flaw?: string | null;
    },
  ) {
    await this.assertOwned(userId, novelId);
    const fields = {
      ...(data.role != null && { role: data.role as never }),
      ...(data.aliases != null && { aliases: data.aliases }),
      ...(data.faction != null && { faction: data.faction }),
      ...(data.background != null && { background: data.background }),
      ...(data.appearance != null && { appearance: data.appearance }),
      ...(data.personality != null && { personality: data.personality }),
      ...(data.motivation != null && { motivation: data.motivation }),
      ...(data.arcGoal != null && { arcGoal: data.arcGoal }),
      ...(data.voice != null && { voice: data.voice }),
      ...(data.growth != null && { growth: data.growth }),
      ...(data.flaw != null && { flaw: data.flaw }),
    };
    return this.prisma.character.upsert({
      where: { novelId_name: { novelId, name: data.name } },
      create: { novelId, name: data.name, ...fields },
      update: fields,
    });
  }

  /** find-or-create 角色(by name)。settler 遇到未注册角色时自动建。 */
  async findOrCreateByName(
    userId: string,
    novelId: string,
    name: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const existing = await client.character.findFirst({
      where: { novelId, name, novel: { userId } },
    });
    if (existing) return existing;
    return client.character.create({
      data: { novelId, name },
    });
  }

  /** 批量记角色变化(settler 每章调用)。find-or-create 角色 + 建 CharacterChange。 */
  async recordChanges(
    userId: string,
    novelId: string,
    chapterOrder: number,
    changes: CharacterChangeInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.assertOwned(userId, novelId);
    const client = tx ?? this.prisma;
    for (const c of changes) {
      const ch = await this.findOrCreateByName(userId, novelId, c.name, tx);
      await client.characterChange.create({
        data: {
          novelId,
          characterId: ch.id,
          chapterOrder,
          field: c.field,
          value: c.value,
          reason: c.reason,
          significance: (c.significance ?? 'MINOR') as never,
        },
      });
    }
  }

  /** 当前态派生:changes 已按 chapterOrder desc 排,取每 field 的第一条(最新)。 */
  private deriveCurrentState(
    changes: Array<{
      field: string;
      value: string;
      chapterOrder: number;
      reason: string;
    }>,
  ): Record<string, { value: string; chapterOrder: number; reason: string }> {
    const state: Record<
      string,
      { value: string; chapterOrder: number; reason: string }
    > = {};
    for (const c of changes) {
      if (!state[c.field])
        state[c.field] = {
          value: c.value,
          chapterOrder: c.chapterOrder,
          reason: c.reason,
        };
    }
    return state;
  }

  /**
   * 取角色 + 当前态(派生)+ 时间线。别名感知:正文常用别名(如「老张」),canonical 是
   * 「张三」;OR aliases has 让别名也能命中。canonical 名优先(OR 顺序 + findFirst)。
   *
   * 时间线注入策略(token 治理):MAJOR(实质蜕变)全留 + MINOR(次要状态)最近 30 条。
   * 持久态字段(personality/ability/status/relationship)的变化走 MAJOR → currentState 从
   * 该合并集派生仍正确。避免长篇 changes 线性膨胀。
   */
  async getCharacter(userId: string, novelId: string, name: string) {
    await this.assertOwned(userId, novelId);
    const ch = await this.prisma.character.findFirst({
      where: {
        novelId,
        novel: { userId },
        OR: [{ name }, { aliases: { has: name } }],
      },
    });
    if (!ch) return null;
    const [major, minor] = await Promise.all([
      this.prisma.characterChange.findMany({
        where: { characterId: ch.id, significance: 'MAJOR' },
        orderBy: { chapterOrder: 'desc' },
      }),
      this.prisma.characterChange.findMany({
        where: { characterId: ch.id, significance: 'MINOR' },
        orderBy: { chapterOrder: 'desc' },
        take: 30,
      }),
    ]);
    const changes = [...major, ...minor].sort(
      (a, b) => b.chapterOrder - a.chapterOrder,
    );
    return {
      ...ch,
      changes,
      currentState: this.deriveCurrentState(changes),
    };
  }

  /** 列角色 + 当前态(派生)。按 role→name 排序。供 FE 面板。 */
  async listCharacters(userId: string, novelId: string, role?: string) {
    await this.assertOwned(userId, novelId);
    const characters = await this.prisma.character.findMany({
      where: {
        novelId,
        novel: { userId },
        ...(role ? { role: role as never } : {}),
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      include: {
        changes: { orderBy: { chapterOrder: 'desc' }, take: 50 },
      },
    });
    return characters.map((ch) => ({
      ...ch,
      currentState: this.deriveCurrentState(
        ch.changes as Array<{
          field: string;
          value: string;
          chapterOrder: number;
          reason: string;
        }>,
      ),
    }));
  }

  /**
   * 检索某角色【完整】变化轨迹(不止 getCharacter 注入的 MAJOR全量+MINOR近30)。
   * getCharacter 为控 token 只注入近期;这个方法按需拉全量(可按起止章/重要性过滤),
   * 让注入窗口外的旧 MINOR 也能被查到——不记死数据。别名感知(同 getCharacter)。
   * 供 get_character_history 工具。
   */
  async getCharacterHistory(
    userId: string,
    novelId: string,
    name: string,
    opts: { sinceChapter?: number; significance?: 'MAJOR' | 'MINOR' } = {},
  ) {
    await this.assertOwned(userId, novelId);
    const ch = await this.prisma.character.findFirst({
      where: {
        novelId,
        novel: { userId },
        OR: [{ name }, { aliases: { has: name } }],
      },
      select: { id: true, name: true },
    });
    if (!ch) return { name, changes: [] };
    const changes = await this.prisma.characterChange.findMany({
      where: {
        characterId: ch.id,
        ...(opts.sinceChapter !== undefined
          ? { chapterOrder: { gte: opts.sinceChapter } }
          : {}),
        ...(opts.significance ? { significance: opts.significance } : {}),
      },
      orderBy: { chapterOrder: 'desc' },
    });
    return { name: ch.name, changes };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CharacterChangeInput {
  name: string;
  field: string;
  value: string;
  reason: string;
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
      role?: string;
      aliases?: string[];
      faction?: string;
      background?: string;
      appearance?: string;
      personality?: string;
      motivation?: string;
      arcGoal?: string;
      voice?: string;
    },
  ) {
    await this.assertOwned(userId, novelId);
    const fields = {
      ...(data.role !== undefined && { role: data.role as never }),
      ...(data.aliases !== undefined && { aliases: data.aliases }),
      ...(data.faction !== undefined && { faction: data.faction }),
      ...(data.background !== undefined && { background: data.background }),
      ...(data.appearance !== undefined && { appearance: data.appearance }),
      ...(data.personality !== undefined && { personality: data.personality }),
      ...(data.motivation !== undefined && { motivation: data.motivation }),
      ...(data.arcGoal !== undefined && { arcGoal: data.arcGoal }),
      ...(data.voice !== undefined && { voice: data.voice }),
    };
    return this.prisma.character.upsert({
      where: { novelId_name: { novelId, name: data.name } },
      create: { novelId, name: data.name, ...fields },
      update: fields,
    });
  }

  /** find-or-create 角色(by name)。settler 遇到未注册角色时自动建。 */
  async findOrCreateByName(userId: string, novelId: string, name: string) {
    const existing = await this.prisma.character.findFirst({
      where: { novelId, name, novel: { userId } },
    });
    if (existing) return existing;
    return this.prisma.character.create({
      data: { novelId, name },
    });
  }

  /** 批量记角色变化(settler 每章调用)。find-or-create 角色 + 建 CharacterChange。 */
  async recordChanges(
    userId: string,
    novelId: string,
    chapterOrder: number,
    changes: CharacterChangeInput[],
  ): Promise<void> {
    await this.assertOwned(userId, novelId);
    for (const c of changes) {
      const ch = await this.findOrCreateByName(userId, novelId, c.name);
      await this.prisma.characterChange.create({
        data: {
          novelId,
          characterId: ch.id,
          chapterOrder,
          field: c.field,
          value: c.value,
          reason: c.reason,
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

  /** 取角色 + 当前态(派生) + 时间线(最近 50 条)。 */
  async getCharacter(userId: string, novelId: string, name: string) {
    await this.assertOwned(userId, novelId);
    const ch = await this.prisma.character.findFirst({
      where: { novelId, name, novel: { userId } },
      include: {
        changes: { orderBy: { chapterOrder: 'desc' }, take: 50 },
      },
    });
    if (!ch) return null;
    return {
      ...ch,
      currentState: this.deriveCurrentState(ch.changes),
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
        changes: { orderBy: { chapterOrder: 'desc' } },
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
}

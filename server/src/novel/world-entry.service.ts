import { Injectable, NotFoundException } from '@nestjs/common';
import { type WorldEntryType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 被动注入 prompt 的「核心条目」type 集(世界观常驻背景)。 */
const CORE_TYPES: WorldEntryType[] = ['concept', 'powerSystem'];

/**
 * 世界观资源服务(Phase 2)。类型化条目(codex/lorebook):
 * 世界观 = 一组带类型的设定卡片(concept/powerSystem/location/faction/race/
 * rule/item/history)。按 (novelId, name) 唯一。
 *
 * 工具层(set_world_entry/get_worldview/get_world_entry)与未来 API 都走这里。
 * ContextAssembler 被动注入核心条目(concept + powerSystem)用 listCore。
 */
@Injectable()
export class WorldEntryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 归属校验:novel 必须属于该用户,否则 404。与 Chapter/Outline 一致。 */
  async assertOwned(userId: string, novelId: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }

  /** upsert 一条世界观条目(by novelId+name)。type/content 更新,name 不变。 */
  async upsertEntry(
    userId: string,
    novelId: string,
    data: { type: string; name: string; content: string },
  ) {
    await this.assertOwned(userId, novelId);
    return this.prisma.worldEntry.upsert({
      where: { novelId_name: { novelId, name: data.name } },
      create: {
        novelId,
        type: data.type as never,
        name: data.name,
        content: data.content,
      },
      update: {
        type: data.type as never,
        content: data.content,
      },
    });
  }

  /** 列出条目(可按 type 过滤),按 type→name 排序。供 FE 面板按 type 分组。 */
  async listEntries(userId: string, novelId: string, type?: string) {
    return this.prisma.worldEntry.findMany({
      where: {
        novelId,
        novel: { userId },
        ...(type ? { type: type as never } : {}),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  /** 取单条(by name,user-scoped)。供 get_world_entry 工具:writer 写前查细节。 */
  getEntry(userId: string, novelId: string, name: string) {
    return this.prisma.worldEntry.findFirst({
      where: { novelId, name, novel: { userId } },
    });
  }

  /** 核心条目(type ∈ concept+powerSystem),供 ContextAssembler 被动注入。 */
  listCore(userId: string, novelId: string) {
    return this.prisma.worldEntry.findMany({
      where: {
        novelId,
        novel: { userId },
        type: { in: CORE_TYPES },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }
}

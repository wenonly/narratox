import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 大纲节点统一形状:主体 | 动作/变化 | 对象/结果。 */
export interface OutlineNode {
  subject: string;
  action: string;
  target: string;
}

/**
 * 大纲资源服务(Phase C1)。两层结构化大纲:
 *  - Volume:大纲/卷纲(全书骨架)
 *  - ChapterOutline:细纲(每章 CBN/CPNs/CEN 节点 + 必须覆盖/禁区)
 *
 * ChapterOutline 按 (novelId, chapterOrder) 唯一,先于 Chapter 行存在(计划先于写作)。
 * 工具层(set_volume/set_chapter_plan/get_outline/get_chapter_plan)与未来 API 都走这里。
 * 写章节关卡(ChapterService.assertHasPlan)直接查 chapterOutline 表,不经此服务(避免依赖)。
 */
@Injectable()
export class OutlineService {
  constructor(private readonly prisma: PrismaService) {}

  /** 归属校验:novel 必须属于该用户,否则 404。与 ChapterService.assertOwned 一致。 */
  async assertOwned(userId: string, novelId: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }

  /** upsert 一卷(by novelId+order)。 */
  async upsertVolume(
    userId: string,
    novelId: string,
    order: number,
    data: { title: string; goal?: string; synopsis?: string },
  ) {
    await this.assertOwned(userId, novelId);
    const fields = {
      title: data.title,
      goal: data.goal ?? '',
      synopsis: data.synopsis ?? '',
    };
    return this.prisma.volume.upsert({
      where: { novelId_order: { novelId, order } },
      create: { novelId, order, ...fields },
      update: fields,
    });
  }

  /** upsert 第 chapterOrder 章细纲(by novelId+chapterOrder)。节点存为 JSON。 */
  async upsertChapterPlan(
    userId: string,
    novelId: string,
    chapterOrder: number,
    data: {
      title?: string;
      cbn: OutlineNode;
      cpns: OutlineNode[];
      cen: OutlineNode;
      mustCover?: string[];
      forbidden?: string[];
      volumeId?: string;
    },
  ) {
    await this.assertOwned(userId, novelId);
    // Prisma InputJsonValue 要求字符串索引签名,类型化对象/数组需经 unknown 中转
    // (与 SummaryService 的 Json 写入约定一致)。
    const fields = {
      title: data.title ?? '',
      cbn: data.cbn as unknown as Prisma.InputJsonValue,
      cpns: data.cpns as unknown as Prisma.InputJsonValue,
      cen: data.cen as unknown as Prisma.InputJsonValue,
      mustCover: (data.mustCover ?? []) as unknown as Prisma.InputJsonValue,
      forbidden: (data.forbidden ?? []) as unknown as Prisma.InputJsonValue,
      ...(data.volumeId !== undefined && { volumeId: data.volumeId }),
    };
    return this.prisma.chapterOutline.upsert({
      where: { novelId_chapterOrder: { novelId, chapterOrder } },
      create: { novelId, chapterOrder, ...fields },
      update: fields,
    });
  }

  /** 列出全书大纲(卷 + 细纲),按序,user-scoped。供 get_outline 工具与 FE 面板。 */
  async listOutline(userId: string, novelId: string) {
    const where = { novelId, novel: { userId } };
    const [volumes, chapterOutlines] = await Promise.all([
      this.prisma.volume.findMany({ where, orderBy: { order: 'asc' } }),
      this.prisma.chapterOutline.findMany({
        where,
        orderBy: { chapterOrder: 'asc' },
      }),
    ]);
    return { volumes, chapterOutlines };
  }

  /**
   * 下一个该写/该规划的章序号:
   *  - 第一个 status≠WRITTEN 的细纲章;否则
   *  - 最大细纲章 + 1;否则
   *  - 1(尚无任何细纲)
   * 让 writer/main agent 自定位(get_outline 返回此值)。
   */
  async nextChapterOrder(userId: string, novelId: string): Promise<number> {
    const outlines = await this.prisma.chapterOutline.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { chapterOrder: 'asc' },
      select: { chapterOrder: true, status: true },
    });
    const next = outlines.find((o) => o.status !== 'WRITTEN');
    if (next) return next.chapterOrder;
    if (outlines.length) return outlines[outlines.length - 1].chapterOrder + 1;
    return 1;
  }
}

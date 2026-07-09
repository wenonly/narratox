import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterOutlineService } from './master-outline.service';
import { ArcService } from './arc.service';

/** 大纲节点统一形状:主体 | 动作/变化 | 对象/结果。 */
export interface OutlineNode {
  subject: string;
  action: string;
  target: string;
}

/** patch_chapter_plan 的部分更新入参。全 optional:只改传了字段。 */
export interface ChapterPlanPatch {
  title?: string;
  cbn?: OutlineNode;
  cpns?: OutlineNode[];
  cen?: OutlineNode;
  mustCover?: string[];
  forbidden?: string[];
  volumeOrder?: number;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterOutlines: MasterOutlineService,
    private readonly arcs: ArcService,
  ) {}

  /** 归属校验:novel 必须属于该用户,否则 404。与 ChapterService.assertOwned 一致。 */
  async assertOwned(userId: string, novelId: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }

  /** upsert 一卷(by novelId+order)。bridge(承上启下)/mainProgress(主线推进点)为卷纲轻量补。 */
  async upsertVolume(
    userId: string,
    novelId: string,
    order: number,
    data: {
      title: string;
      goal?: string;
      synopsis?: string;
      bridge?: string;
      mainProgress?: string;
    },
  ) {
    await this.assertOwned(userId, novelId);
    const fields = {
      title: data.title,
      goal: data.goal ?? '',
      synopsis: data.synopsis ?? '',
      bridge: data.bridge ?? '',
      mainProgress: data.mainProgress ?? '',
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

  /** 按卷序号找一卷(user-scoped)。供 set_chapter_plan 把 volumeOrder 解析成 volumeId。 */
  async findVolumeByOrder(userId: string, novelId: string, order: number) {
    return this.prisma.volume.findFirst({
      where: { novelId, order, novel: { userId } },
      select: { id: true },
    });
  }

  /** 取第 chapterOrder 章细纲(user-scoped)。供 get_chapter_plan 工具:writer 写前读节点。 */
  getChapterPlan(userId: string, novelId: string, chapterOrder: number) {
    return this.prisma.chapterOutline.findFirst({
      where: { novelId, chapterOrder, novel: { userId } },
    });
  }

  /**
   * 删第 chapterOrder 章细纲。WRITTEN 细纲软护栏:代码不拦,返回 warned=true。
   * user-scoped:先 ownership(novel 属 user)+ 行存在校验。
   */
  async deleteChapterPlan(
    userId: string,
    novelId: string,
    chapterOrder: number,
  ): Promise<
    | { ok: true; chapterOrder: number; warned: boolean; reason?: string }
    | { ok: false; reason: 'not_found' }
  > {
    await this.assertOwned(userId, novelId);
    const existing = await this.prisma.chapterOutline.findFirst({
      where: { novelId, chapterOrder },
      select: { id: true, status: true },
    });
    if (!existing) return { ok: false, reason: 'not_found' };
    await this.prisma.chapterOutline.delete({ where: { id: existing.id } });
    if (existing.status === 'WRITTEN') {
      return {
        ok: true,
        chapterOrder,
        warned: true,
        reason: '本章已写,删除后 validator dim12「细纲兑现」将失去审计依据',
      };
    }
    return { ok: true, chapterOrder, warned: false };
  }

  /**
   * 删一卷。cascade=false(默认)且卷下有 arcs/chapterOutlines → 报错返回清单(不偷删)。
   * cascade=true → $transaction 一次性删 volume + 下属 arcs + chapterOutlines。
   * 不依赖 DB 级联(Arc/ChapterOutline 的 volumeId 是 SetNull),预检+显式连删便于精确反馈。
   */
  async deleteVolume(
    userId: string,
    novelId: string,
    order: number,
    cascade: boolean,
  ): Promise<
    | {
        ok: true;
        order: number;
        deletedArcs: number;
        deletedChapterPlans: number;
      }
    | {
        ok: false;
        error: 'HAS_DESCENDANTS';
        arcs: number;
        chapterPlans: number;
        hint: string;
      }
    | { ok: false; reason: 'not_found' }
  > {
    await this.assertOwned(userId, novelId);
    const vol = await this.prisma.volume.findFirst({
      where: { novelId, order, novel: { userId } },
      select: { id: true },
    });
    if (!vol) return { ok: false, reason: 'not_found' };

    const [arcCount, planCount] = await Promise.all([
      this.prisma.arc.count({ where: { volumeId: vol.id } }),
      this.prisma.chapterOutline.count({ where: { volumeId: vol.id } }),
    ]);

    if (!cascade && (arcCount > 0 || planCount > 0)) {
      return {
        ok: false,
        error: 'HAS_DESCENDANTS',
        arcs: arcCount,
        chapterPlans: planCount,
        hint: `卷 ${order} 下属 ${arcCount} 弧 / ${planCount} 细纲,请先删除/移走它们,或传 cascade=true 连带删`,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const a = await tx.arc.deleteMany({ where: { volumeId: vol.id } });
      const c = await tx.chapterOutline.deleteMany({
        where: { volumeId: vol.id },
      });
      await tx.volume.delete({ where: { id: vol.id } });
      return { deletedArcs: a.count, deletedChapterPlans: c.count };
    });
    return { ok: true, order, ...result };
  }

  /**
   * 字段级改细纲。未传字段零变更;数组/对象字段整体替换(不按索引合并)。
   * volumeOrder 会被解析成 volumeId(与 set_chapter_plan 一致);chapterOrder 不可改。
   * patch 不是 upsert:不存在的章返 not_found(要新建走 upsertChapterPlan)。
   */
  async patchChapterPlan(
    userId: string,
    novelId: string,
    chapterOrder: number,
    data: ChapterPlanPatch,
  ): Promise<
    | { ok: true; chapterOrder: number; updatedFields: string[] }
    | { ok: false; reason: 'not_found' | 'empty_patch' }
  > {
    await this.assertOwned(userId, novelId);
    const fields: Record<string, unknown> = {};
    if (data.title !== undefined) fields.title = data.title;
    if (data.cbn !== undefined) fields.cbn = data.cbn;
    if (data.cpns !== undefined) fields.cpns = data.cpns;
    if (data.cen !== undefined) fields.cen = data.cen;
    if (data.mustCover !== undefined) fields.mustCover = data.mustCover;
    if (data.forbidden !== undefined) fields.forbidden = data.forbidden;
    if (data.volumeOrder !== undefined) {
      const vol = await this.findVolumeByOrder(
        userId,
        novelId,
        data.volumeOrder,
      );
      if (vol) fields.volumeId = vol.id;
    }
    if (Object.keys(fields).length === 0)
      return { ok: false, reason: 'empty_patch' };

    const existing = await this.prisma.chapterOutline.findFirst({
      where: { novelId, chapterOrder, novel: { userId } },
      select: { id: true },
    });
    if (!existing) return { ok: false, reason: 'not_found' };

    await this.prisma.chapterOutline.update({
      where: { id: existing.id },
      data: fields,
    });
    return { ok: true, chapterOrder, updatedFields: Object.keys(fields) };
  }

  /** 列出全书大纲(总纲 + 卷 + 弧线 + 细纲),按序,user-scoped。供 get_outline 工具与 FE 面板。 */
  async listOutline(userId: string, novelId: string) {
    const where = { novelId, novel: { userId } };
    const [master, volumes, arcs, chapterOutlines] = await Promise.all([
      this.masterOutlines.get(userId, novelId),
      this.prisma.volume.findMany({ where, orderBy: { order: 'asc' } }),
      this.arcs.listArcs(userId, novelId),
      this.prisma.chapterOutline.findMany({
        where,
        orderBy: { chapterOrder: 'asc' },
      }),
    ]);
    return { master, volumes, arcs, chapterOutlines };
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

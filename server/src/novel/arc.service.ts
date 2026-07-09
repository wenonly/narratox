import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** set_arc 工具入参(volumeId 由工具层从 volumeOrder 解析后传入)。 */
export interface ArcUpsertInput {
  order: number;
  volumeId?: string | null;
  title: string;
  goal?: string;
  fromChapter: number;
  toChapter: number;
}

/**
 * 弧线(Arc)服务(Phase 12)。Arc = 卷内子段,带 chapter range。
 * 「当前弧」按 currentChapter 落点查;settler 经 write_summary 滚动更新 arc/volume summary。
 * user scope 走 `novel: { userId }`(与其它 novel 资源服务同)。
 */
@Injectable()
export class ArcService {
  constructor(private readonly prisma: PrismaService) {}

  /** upsert by (novelId, order)。先 ownership 校验。 */
  async upsertArc(userId: string, novelId: string, input: ArcUpsertInput) {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!owned) throw new ForbiddenException('novel not owned by user');
    return this.prisma.arc.upsert({
      where: { novelId_order: { novelId, order: input.order } },
      create: { novelId, ...input },
      update: { ...input },
    });
  }

  /** get_arcs / 注入用:全量按 fromChapter asc。 */
  async listArcs(userId: string, novelId: string) {
    return this.prisma.arc.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { fromChapter: 'asc' },
      select: {
        id: true,
        order: true,
        volumeId: true,
        title: true,
        goal: true,
        fromChapter: true,
        toChapter: true,
        summary: true,
      },
    });
  }

  /** 删弧线。无级联(ChapterOutline 不引用 Arc FK)。upsert 用 novelId_order unique。 */
  async deleteArc(
    userId: string,
    novelId: string,
    order: number,
  ): Promise<{ ok: true; order: number } | { ok: false; reason: 'not_found' }> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!owned) throw new ForbiddenException('novel not owned by user');
    const existing = await this.prisma.arc.findFirst({
      where: { novelId, order, novel: { userId } },
      select: { id: true },
    });
    if (!existing) return { ok: false, reason: 'not_found' };
    await this.prisma.arc.delete({ where: { id: existing.id } });
    return { ok: true, order };
  }

  /** 按 chapter 范围查当前弧(fromChapter≤N≤toChapter)。 */
  async findArcByChapter(
    userId: string,
    novelId: string,
    chapterOrder: number,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.arc.findFirst({
      where: {
        novelId,
        fromChapter: { lte: chapterOrder },
        toChapter: { gte: chapterOrder },
        novel: { userId },
      },
    });
  }

  /**
   * settler 滚动更新 arc/volume 进展摘要。按 chapterOrder 解析目标:
   *  - arc = range 命中 → 更新 arc.summary
   *  - volume = arc.volumeId,回落 ChapterOutline(N).volumeId → 更新 volume.arcSummary
   * 解析不到则静默跳过(不阻断结算)。
   */
  async updateProgressSummary(
    userId: string,
    novelId: string,
    chapterOrder: number,
    arcSummary?: string,
    volumeArcSummary?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const arc = await this.findArcByChapter(userId, novelId, chapterOrder, tx);
    if (arcSummary && arc) {
      await client.arc.update({
        where: { id: arc.id },
        data: { summary: arcSummary },
      });
    }
    let volumeId = arc?.volumeId ?? null;
    if (!volumeId) {
      const outline = await client.chapterOutline.findFirst({
        where: { novelId, chapterOrder, novel: { userId } },
        select: { volumeId: true },
      });
      volumeId = outline?.volumeId ?? null;
    }
    if (volumeArcSummary && volumeId) {
      await client.volume.update({
        where: { id: volumeId },
        data: { arcSummary: volumeArcSummary },
      });
    }
  }
}

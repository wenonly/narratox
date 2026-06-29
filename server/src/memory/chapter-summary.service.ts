import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RoleChange {
  name: string;
  field: string;
  value: string;
  reason: string;
  significance?: 'MAJOR' | 'MINOR'; // 默认 MINOR;MAJOR=性格/弧光/能力/地位的实质蜕变
}
export interface EntityFact {
  type: 'item' | 'place' | 'setting';
  name: string;
  note: string;
}

@Injectable()
export class SummaryService {
  constructor(private readonly prisma: PrismaService) {}

  // 信任调用方:仅 settler 专家调用,userId/novelId/chapterId 在专家构建时
  // 闭包注入(不来自 LLM 入参)。故此处不再重复归属校验。
  async upsert(args: {
    userId: string;
    novelId: string;
    chapterId: string;
    summary: string;
    roleChanges: RoleChange[];
    entities: EntityFact[];
  }): Promise<void> {
    const { novelId, chapterId, summary, roleChanges, entities } = args;
    // Prisma 7's `Json` input type is `InputJsonValue`. A typed-object array
    // (RoleChange[]/EntityFact[]) lacks the string index signature Prisma's
    // InputJsonObject variant demands, so a direct cast errors. We go through
    // `unknown` — the repo-wide Json-write convention (novel.service.ts casts
    // `as Prisma.InputJsonValue`, but its DTO source is already a loose Record;
    // our typed-array source needs the `unknown` hop).
    const roleChangesJson = roleChanges as unknown as Prisma.InputJsonValue;
    const entitiesJson = entities as unknown as Prisma.InputJsonValue;
    await this.prisma.chapterSummary.upsert({
      where: { chapterId },
      create: {
        chapterId,
        novelId,
        summary,
        roleChanges: roleChangesJson,
        entities: entitiesJson,
      },
      update: {
        novelId,
        summary,
        roleChanges: roleChangesJson,
        entities: entitiesJson,
      },
    });
  }

  /** GET 端点用:按 chapterId 取本章已结算的事实(null=未结算)。novelId 为防御性过滤。 */
  findByChapter(userId: string, novelId: string, chapterId: string) {
    // ChapterSummary has no `novel` relation — only `novelId` (scalar) + `chapter`.
    // User-scoping therefore goes through `chapter.novel.userId`; the extra
    // `novelId` filter is defense-in-depth against a caller passing a chapterId
    // that belongs to a different novel.
    return this.prisma.chapterSummary.findFirst({
      where: { chapterId, novelId, chapter: { novel: { userId } } },
    });
  }

  /** 最近 N 章摘要(按章节序号倒序),供 ContextAssembler 注入【前情】。 */
  async listRecent(
    userId: string,
    novelId: string,
    limit: number,
  ): Promise<Array<{ summary: string; chapterOrder: number }>> {
    const rows = await this.prisma.chapterSummary.findMany({
      where: { novelId, chapter: { novel: { userId } } },
      take: limit,
      orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    return rows.map((r) => ({
      summary: r.summary,
      chapterOrder: r.chapter.order,
    }));
  }

  /**
   * 按 chapterOrder 范围取摘要(升序),供 ContextAssembler 派生弧/卷进展。
   * Phase 12 修正:settler 不可靠地写 Arc.summary,改为服务端从 ChapterSummary 派生。
   */
  async listByChapterRange(
    userId: string,
    novelId: string,
    fromCh: number,
    toCh: number,
  ): Promise<Array<{ summary: string; chapterOrder: number }>> {
    const rows = await this.prisma.chapterSummary.findMany({
      where: {
        novelId,
        chapter: { novel: { userId }, order: { gte: fromCh, lte: toCh } },
      },
      orderBy: { chapter: { order: 'asc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    return rows.map((r) => ({
      summary: r.summary,
      chapterOrder: r.chapter.order,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RoleChange { name: string; change: string; }
export interface EntityFact { type: 'item' | 'place' | 'setting'; name: string; note: string; }

@Injectable()
export class SummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(args: {
    userId: string; novelId: string; chapterId: string;
    summary: string; roleChanges: RoleChange[]; entities: EntityFact[];
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
      create: { chapterId, novelId, summary, roleChanges: roleChangesJson, entities: entitiesJson },
      update: { novelId, summary, roleChanges: roleChangesJson, entities: entitiesJson },
    });
  }

  /** GET 端点用:按 chapterId 取本章已结算的事实(null=未结算)。 */
  findByChapter(userId: string, novelId: string, chapterId: string) {
    // ChapterSummary has no `novel` relation — only `novelId` (scalar) + `chapter`.
    // User-scoping therefore goes through `chapter.novel.userId`.
    void novelId;
    return this.prisma.chapterSummary.findFirst({
      where: { chapterId, chapter: { novel: { userId } } },
    });
  }

  /** 最近 N 章摘要(按章节序号倒序),供 ContextAssembler 注入【前情】。 */
  async listRecent(
    userId: string, novelId: string, limit: number,
  ): Promise<Array<{ summary: string; chapterOrder: number }>> {
    const rows = await this.prisma.chapterSummary.findMany({
      where: { novelId, chapter: { novel: { userId } } },
      take: limit, orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    return rows.map((r) => ({ summary: r.summary, chapterOrder: r.chapter.order }));
  }
}

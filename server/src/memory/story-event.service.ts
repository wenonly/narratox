import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenHook {
  id: string;
  description: string;
  openedAtChapter: number | null;
}

@Injectable()
export class StoryEventService {
  constructor(private readonly prisma: PrismaService) {}

  listOpen(userId: string, novelId: string): Promise<OpenHook[]> {
    return this.prisma.storyEvent.findMany({
      where: { novelId, status: 'OPEN', novel: { userId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, description: true, openedAtChapter: true },
    });
  }

  async createHooks(
    userId: string,
    novelId: string,
    descriptions: string[],
    openedAtChapter: number,
  ): Promise<void> {
    for (const description of descriptions) {
      await this.prisma.storyEvent.create({
        data: { novelId, description, status: 'OPEN', openedAtChapter },
      });
    }
  }

  async resolveHooks(
    userId: string,
    novelId: string,
    ids: string[],
    resolvedAtChapter: number,
  ): Promise<void> {
    for (const id of ids) {
      // updateMany to compound-filter on (id + novelId + status) safely.
      await this.prisma.storyEvent.updateMany({
        where: { id, novelId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAtChapter },
      });
    }
  }

  /** 章节删除级联:埋于本章的事件删除;回收于本章的事件回退为 OPEN。 */
  async cleanupForChapter(
    userId: string,
    novelId: string,
    chapterOrder: number,
  ): Promise<void> {
    await this.prisma.storyEvent.deleteMany({
      where: { novelId, openedAtChapter: chapterOrder, novel: { userId } },
    });
    await this.prisma.storyEvent.updateMany({
      where: { novelId, resolvedAtChapter: chapterOrder, novel: { userId } },
      data: { status: 'OPEN', resolvedAtChapter: null },
    });
  }

  /** GET 端点用:取与某章相关的事件(埋于/回收于该章)。 */
  listForChapter(userId: string, novelId: string, chapterOrder: number) {
    return this.prisma.storyEvent.findMany({
      where: {
        novelId,
        novel: { userId },
        OR: [
          { openedAtChapter: chapterOrder },
          { resolvedAtChapter: chapterOrder },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        description: true,
        openedAtChapter: true,
        resolvedAtChapter: true,
      },
    });
  }
}

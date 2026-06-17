import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ResourceHandler,
  type ResourceMutation,
} from '../resources/mutation.types';

@Injectable()
export class ChapterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, novelId: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.chapter.findMany({
      where: { novelId },
      orderBy: { order: 'asc' },
    });
  }

  async create(userId: string, novelId: string, dto: { title?: string }) {
    await this.assertOwned(userId, novelId);
    const max = await this.prisma.chapter.aggregate({
      where: { novelId },
      _max: { order: true },
    });
    const nextOrder = (max._max.order ?? 0) + 1;
    return this.prisma.chapter.create({
      data: {
        novelId,
        order: nextOrder,
        // Default title: `第${order}章` (e.g. "第1章") when dto.title is
        // empty/absent. Test + impl agree on this convention.
        title: dto.title?.trim() || `第${nextOrder}章`,
      },
    });
  }

  /**
   * PATCH /novels/:id/chapters/:cid — edit a chapter's title/content.
   *
   * Two ownership guards:
   *   1. assertOwned — the novel belongs to the user.
   *   2. findFirst({ id, novelId }) — the chapter belongs to that novel.
   * The `@@unique([novelId, order])` index doesn't prevent a chapterId from a
   * different novel slipping through on `update({ where: { id } })`, so we
   * fetch+check first and 404 otherwise.
   */
  async update(
    userId: string,
    novelId: string,
    chapterId: string,
    dto: { title?: string; content?: string },
  ) {
    await this.assertOwned(userId, novelId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, novelId },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    const data: { title?: string; content?: string } = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.content !== undefined) data.content = dto.content;
    return this.prisma.chapter.update({ where: { id: chapterId }, data });
  }

  private async assertOwned(userId: string, novelId: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }
}

@Injectable()
export class ChapterHandler implements ResourceHandler {
  readonly resource = 'chapter';
  constructor(private readonly prisma: PrismaService) {}

  async apply(userId: string, mutation: ResourceMutation): Promise<void> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: mutation.targetId, novel: { userId } },
      select: { id: true, content: true },
    });
    if (!chapter) return; // 不属于本用户 → no-op，绝不改别人的章节
    if (mutation.op !== 'set' && mutation.op !== 'append') {
      throw new Error(`Unsupported op for chapter: ${mutation.op}`);
    }
    const content =
      mutation.op === 'append'
        ? (chapter.content ?? '') + mutation.content
        : mutation.content;
    await this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { content, status: 'COMMITTED' },
    });
  }
}

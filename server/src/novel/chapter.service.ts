import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
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

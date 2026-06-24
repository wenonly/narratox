import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_ID } from '../agentos/agentos.constants';
import { ResourceRegistry } from '../resources/resource-registry';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import type { MemoryData } from '../agentos/analyst-schema';
import type { AcceptDto } from './dto/accept.dto';
import type { CreateNovelDto } from './dto/create-novel.dto';
import type { UpdateNovelDto } from './dto/update-novel.dto';

@Injectable()
export class NovelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ResourceRegistry,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

  /** 建小说 + 1:1 聊天 Session + 种第一章。 */
  async create(userId: string, dto: CreateNovelDto) {
    const sessionId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: { id: sessionId, userId, agentId: AGENT_ID, name: dto.title },
      });
      const novel = await tx.novel.create({
        data: {
          userId,
          sessionId,
          status: 'CONCEPT',
          title: dto.title,
          genre: dto.genre ?? null,
          synopsis: dto.synopsis ?? null,
          settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
          chapters: { create: [{ order: 1, title: '第1章' }] },
        },
        include: { chapters: { orderBy: { order: 'asc' } } },
      });
      // 不种入开场白:新小说的 session 为空,第一条消息由用户在聊天框主动发出。
      return novel;
    });
  }

  list(userId: string) {
    return this.prisma.novel.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(userId: string, id: string) {
    const novel = await this.prisma.novel.findFirst({
      where: { id, userId },
      include: { chapters: { orderBy: { order: 'asc' } } },
    });
    if (!novel) throw new NotFoundException('Novel not found');
    return novel;
  }

  async update(userId: string, id: string, dto: UpdateNovelDto) {
    await this.assertOwned(userId, id);
    return this.prisma.novel.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.genre !== undefined && { genre: dto.genre }),
        ...(dto.synopsis !== undefined && { synopsis: dto.synopsis }),
        ...(dto.settings !== undefined && {
          settings: dto.settings as Prisma.InputJsonValue,
        }),
      },
    });
  }

  delete(userId: string, id: string) {
    return this.prisma.novel.deleteMany({ where: { id, userId } });
  }

  /**
   * CONCEPT → ACTIVE:首次写章节时由 write_chapter 工具调用,把小说从"想法"
   * 状态推进到"在写"。幂等 —— 多次写章节不会改变已经是 ACTIVE 的状态。
   * assertOwned 与 update/accept 共用同一归属校验。
   */
  async activate(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.novel.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }

  /** 「采纳」:校验小说归属后,把变更交给 mutation 层分发。 */
  async accept(userId: string, novelId: string, dto: AcceptDto) {
    await this.assertOwned(userId, novelId);
    await this.registry.dispatch(userId, {
      resource: 'chapter',
      targetId: dto.chapterId,
      op: dto.op,
      content: dto.content,
    });
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }

  /** GET /novels/:id/chapters/:order/summary —— 从 DB 重建 MemoryData。 */
  async getChapterMemory(
    userId: string,
    novelId: string,
    order: number,
  ): Promise<MemoryData> {
    await this.assertOwned(userId, novelId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    const summary = await this.summaries.findByChapter(
      userId,
      novelId,
      chapter.id,
    );
    if (!summary) {
      return {
        settled: false,
        chapterOrder: order,
        summary: '',
        roleChanges: [],
        entities: [],
        newHooks: [],
        resolvedHooks: [],
      };
    }
    const evs = await this.events.listForChapter(userId, novelId, order);
    const newHooks = evs
      .filter((e) => e.openedAtChapter === order)
      .map((e) => ({ id: e.id, description: e.description }));
    const resolvedHooks = evs
      .filter((e) => e.resolvedAtChapter === order)
      .map((e) => ({ id: e.id, description: e.description }));
    return {
      settled: true,
      chapterOrder: order,
      summary: summary.summary,
      roleChanges: summary.roleChanges as MemoryData['roleChanges'],
      entities: summary.entities as MemoryData['entities'],
      newHooks,
      resolvedHooks,
    };
  }

  /** 章节删除:级联清理 StoryEvent(埋于本章→删;回收于本章→回退 OPEN)。 */
  async deleteChapterCascade(
    userId: string,
    novelId: string,
    order: number,
  ): Promise<void> {
    await this.events.cleanupForChapter(userId, novelId, order);
  }
}

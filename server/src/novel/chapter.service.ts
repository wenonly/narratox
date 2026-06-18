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

  /**
   * Find a chapter by its order within a novel (scoped by ownership).
   * Returns null if the order is absent or the novel is not owned.
   *
   * Used by the workspace `write_chapter` tool so the writer agent can target
   * a chapter by its 1-based position (LLM-natural) instead of an opaque cuid
   * the agent never learns. Not-found is surfaced by the caller as an error —
   * this method deliberately returns null rather than throwing so the tool can
   * distinguish "no such chapter" from a hard lookup failure.
   */
  async findByOrder(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId);
    return this.prisma.chapter.findFirst({
      where: { novelId, order },
    });
  }

  /**
   * 按 order 找章节;不存在则自动创建。供 write_chapter 工具用 —— 写作 Agent
   * 调用 `write_chapter(chapterOrder=N, ...)` 时不需要先单独"开章",直接按序号
   * 写即可,序号缺了就种一条 `第N章`(title 调用方可后续 update)。
   *
   * 与 findByOrder 的区别:findByOrder 返回 null(让工具层决定报错 vs 别的语义),
   * findOrCreateByOrder 保证返回一个真实章节记录,从不返回 null。
   */
  async findOrCreateByOrder(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId);
    let chapter = await this.prisma.chapter.findFirst({
      where: { novelId, order },
    });
    if (!chapter) {
      chapter = await this.prisma.chapter.create({
        data: { novelId, order, title: `第${order}章` },
      });
    }
    return chapter;
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

  /**
   * 追加一小节正文到第 order 章(不存在则自动建)。Section 粒度写入:Writer 用
   * append_section 一节节拼正文,避免整章大工具参数(会触发 z.ai 60s 掐流)。
   */
  async appendSection(
    userId: string,
    novelId: string,
    order: number,
    content: string,
  ) {
    // findOrCreateByOrder 已含 assertOwned;不存在则种 `第N章`。
    const chapter = await this.findOrCreateByOrder(userId, novelId, order);
    const newContent = (chapter.content ?? '') + content;
    return this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: newContent, status: 'COMMITTED' },
    });
  }

  /** 只读:取第 order 章的 order/title/content(供 Writer 改前先看现状)。null=无此章。 */
  async getChapter(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId);
    return this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { order: true, title: true, content: true },
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

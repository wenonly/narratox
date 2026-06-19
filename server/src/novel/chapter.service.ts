import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ResourceHandler,
  type ResourceMutation,
} from '../resources/mutation.types';
import { findContentRange, countMatches } from './content-match';

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

  /** 编辑用:按 order 取章节的 {id, content};不存在返回 null(调用方决定报错)。 */
  private async loadForEdit(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId);
    return this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { id: true, content: true },
    });
  }

  /** 替换第 order 章 find 的首个命中为 replace。 */
  async replaceText(
    userId: string,
    novelId: string,
    order: number,
    find: string,
    replace: string,
  ): Promise<
    | { ok: true; matchCount: number; totalChars: number }
    | { ok: false; reason: 'not_found'; matchCount: number }
    | { ok: false; reason: 'no_such_chapter' }
  > {
    const ch = await this.loadForEdit(userId, novelId, order);
    if (!ch) return { ok: false, reason: 'no_such_chapter' };
    const content = ch.content ?? '';
    const range = findContentRange(content, find);
    if (!range) return { ok: false, reason: 'not_found', matchCount: 0 };
    // 精确命中才算多处;归一化命中只知 ≥1。
    const matchCount =
      content.indexOf(find) !== -1 ? countMatches(content, find) : 1;
    const newContent =
      content.slice(0, range.start) + replace + content.slice(range.end);
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: newContent, status: 'COMMITTED' },
    });
    return { ok: true, matchCount, totalChars: newContent.length };
  }

  /** 在第 order 章的 after 原文之后插入 content(after="" → 插在最前)。 */
  async insertText(
    userId: string,
    novelId: string,
    order: number,
    after: string,
    insertContent: string,
  ): Promise<
    | { ok: true; totalChars: number }
    | { ok: false; reason: 'anchor_not_found' | 'no_such_chapter' }
  > {
    const ch = await this.loadForEdit(userId, novelId, order);
    if (!ch) return { ok: false, reason: 'no_such_chapter' };
    const content = ch.content ?? '';
    let at = 0;
    if (after !== '') {
      const range = findContentRange(content, after);
      if (!range) return { ok: false, reason: 'anchor_not_found' };
      at = range.end;
    }
    const newContent = content.slice(0, at) + insertContent + content.slice(at);
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: newContent, status: 'COMMITTED' },
    });
    return { ok: true, totalChars: newContent.length };
  }

  /** 删除第 order 章里 find 的首个命中。 */
  async deleteText(
    userId: string,
    novelId: string,
    order: number,
    find: string,
  ): Promise<
    | { ok: true; totalChars: number }
    | { ok: false; reason: 'not_found' | 'no_such_chapter' }
  > {
    const ch = await this.loadForEdit(userId, novelId, order);
    if (!ch) return { ok: false, reason: 'no_such_chapter' };
    const content = ch.content ?? '';
    const range = findContentRange(content, find);
    if (!range) return { ok: false, reason: 'not_found' };
    const newContent = content.slice(0, range.start) + content.slice(range.end);
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: newContent, status: 'COMMITTED' },
    });
    return { ok: true, totalChars: newContent.length };
  }

  /** 改第 order 章标题。 */
  async setChapterTitle(
    userId: string,
    novelId: string,
    order: number,
    title: string,
  ): Promise<
    { ok: true; title: string } | { ok: false; reason: 'no_such_chapter' }
  > {
    await this.assertOwned(userId, novelId);
    const ch = await this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { id: true },
    });
    if (!ch) return { ok: false, reason: 'no_such_chapter' };
    await this.prisma.chapter.update({ where: { id: ch.id }, data: { title } });
    return { ok: true, title };
  }

  /**
   * 清空第 order 章的全部正文(保留章节行与标题,status 回 DRAFT)。
   * 用于"重写整章":清空后用 append_section 一节节重写,避免整章大 replace。
   */
  async clearChapter(
    userId: string,
    novelId: string,
    order: number,
  ): Promise<{ ok: true } | { ok: false; reason: 'no_such_chapter' }> {
    const ch = await this.loadForEdit(userId, novelId, order);
    if (!ch) return { ok: false, reason: 'no_such_chapter' };
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: '', status: 'DRAFT' },
    });
    return { ok: true };
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

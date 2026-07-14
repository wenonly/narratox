import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { splitChapters } from './chapter-splitter';

@Injectable()
export class BenchmarkService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.benchmarkBook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        progress: true,
        chapters: true,
        createdAt: true,
      },
    });
  }

  /**
   * 列出 userId 名下所有对标书 + 每本书各 type 的条目数聚合(写作 agent T1)。
   * groupBy 一次拿全部 (bookId, type, count) 三元组,内存分桶避免 N+1。
   */
  async listBooksWithEntryCounts(userId: string, limit: number = 20) {
    const books = await this.prisma.benchmarkBook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        chapters: true,
        updatedAt: true,
      },
    });
    if (books.length === 0) return [];
    const bookIds = books.map((b) => b.id);
    const groups = await this.prisma.benchmarkEntry.groupBy({
      by: ['bookId', 'type'],
      where: { bookId: { in: bookIds } },
      _count: { _all: true },
    });
    const countsByBook = new Map<string, Record<string, number>>();
    for (const g of groups) {
      const bid = g.bookId as string;
      if (!countsByBook.has(bid)) countsByBook.set(bid, {});
      countsByBook.get(bid)![g.type as string] = g._count._all;
    }
    return books.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      chapterCount: Array.isArray(b.chapters)
        ? (b.chapters as unknown[]).length
        : 0,
      entryCountByType: countsByBook.get(b.id) ?? {},
      updatedAt: b.updatedAt,
    }));
  }

  async upload(userId: string, title: string, rawText: string) {
    const chapters = splitChapters(rawText).map(
      ({ chapterNo, title: t, offset, length }) => ({
        chapterNo,
        title: t,
        offset,
        length,
      }),
    );
    return this.prisma.benchmarkBook.create({
      data: {
        userId,
        title,
        rawText,
        chapters: chapters as never,
        status: 'PENDING',
      },
    });
  }

  async get(userId: string, id: string) {
    const book = await this.prisma.benchmarkBook.findUnique({ where: { id } });
    if (!book || book.userId !== userId) throw new NotFoundException();
    return book;
  }

  async getWithEntries(userId: string, id: string) {
    const book = await this.get(userId, id);
    const entries = await this.prisma.benchmarkEntry.findMany({
      where: { bookId: id },
      orderBy: { order: 'asc' },
    });
    return { ...book, entries };
  }

  async delete(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.benchmarkEntry.deleteMany({ where: { bookId: id } });
    await this.prisma.benchmarkBook.delete({ where: { id } });
  }

  writeEntry(
    bookId: string,
    opts: {
      type: string;
      title: string;
      content: string;
      order?: number;
      chapterNo?: number | null;
      kind?: string | null;
      purposes?: string[];
    },
  ) {
    return this.prisma.benchmarkEntry.create({
      data: {
        bookId,
        type: opts.type as never,
        title: opts.title,
        content: opts.content,
        order: opts.order ?? 0,
        chapterNo: opts.chapterNo ?? null,
        kind: opts.kind ?? null,
        purposes: opts.purposes ?? [],
      },
    });
  }

  getEntries(bookId: string, type?: string, chapterNo?: number) {
    const where: Record<string, unknown> = { bookId };
    if (type) where.type = type;
    if (chapterNo != null) where.chapterNo = chapterNo;
    return this.prisma.benchmarkEntry.findMany({
      where: where as never,
      orderBy: { order: 'asc' },
    });
  }

  /**
   * 单书钻取(写作 agent T2):归属校验 → type/chapterNo 过滤。
   * book 不存在或非本人 → { error: 'book_not_found' }(不抛、不区分两种情况,避免泄露存在性)。
   */
  async findEntriesForUser(
    userId: string,
    bookId: string,
    opts: { type?: string; chapterNo?: number | null; limit?: number },
  ): Promise<
    | { entries: Awaited<ReturnType<BenchmarkService['getEntries']>> }
    | { error: 'book_not_found' }
  > {
    const book = await this.prisma.benchmarkBook.findUnique({
      where: { id: bookId },
      select: { userId: true },
    });
    if (!book || book.userId !== userId) return { error: 'book_not_found' };
    const where: Record<string, unknown> = { bookId };
    if (opts.type) where.type = opts.type;
    if (opts.chapterNo != null) where.chapterNo = opts.chapterNo;
    const entries = await this.prisma.benchmarkEntry.findMany({
      where: where as never,
      orderBy: { order: 'asc' },
      take: opts.limit ?? 30,
    });
    return { entries };
  }

  /** 重命名卡片标题:校验书归属 user + entry 归属书(经 bookId where)。 */
  async updateEntryTitle(
    userId: string,
    bookId: string,
    entryId: string,
    title: string,
  ) {
    const book = await this.prisma.benchmarkBook.findUnique({
      where: { id: bookId },
    });
    if (!book || book.userId !== userId) throw new NotFoundException();
    const t = title.trim();
    if (!t) throw new BadRequestException('标题不能为空');
    if (t.length > 120) throw new BadRequestException('标题过长(≤120)');
    return this.prisma.benchmarkEntry.update({
      where: { id: entryId },
      data: { title: t },
    });
  }

  async markInterruptedOnBoot() {
    await this.prisma.benchmarkBook.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'INTERRUPTED' },
    });
  }
}

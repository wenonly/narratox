import { Injectable, NotFoundException } from '@nestjs/common';
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

  async markInterruptedOnBoot() {
    await this.prisma.benchmarkBook.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'INTERRUPTED' },
    });
  }
}

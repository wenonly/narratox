import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 拆解 tool(Phase 22):取对标书原文第 N 章(按 BenchmarkBook.chapters 切分后的片段)。
 * bookId 闭包注入——模型只能读当前拆解对象。
 */
export interface GetRawChapterDeps {
  bookId: string;
  prisma: PrismaService;
}

interface ChapterSplit {
  chapterNo: number;
  offset: number;
  length: number;
}

export const makeGetRawChapterTool = (d: GetRawChapterDeps) =>
  tool(
    async ({ chapterNo }) => {
      const book = await d.prisma.benchmarkBook.findUnique({
        where: { id: d.bookId },
      });
      if (!book) return { error: 'book not found' };
      const chapters = (book.chapters as unknown as ChapterSplit[]) ?? [];
      const ch = chapters.find((c) => c.chapterNo === chapterNo);
      if (!ch) return { error: `chapter ${chapterNo} not found` };
      return { text: book.rawText.slice(ch.offset, ch.offset + ch.length) };
    },
    {
      name: 'get_raw_chapter',
      description: '取对标书原文第 N 章(按章号切分后的片段)。',
      schema: z.object({ chapterNo: z.number() }),
    },
  );

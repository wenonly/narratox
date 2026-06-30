import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DissectContextAssembler {
  constructor(private readonly prisma: PrismaService) {}

  /** 拆解 context(独立于 novel):返回 prompt + bookId。 */
  async forBook(
    userId: string,
    bookId: string,
  ): Promise<{ prompt: string; bookId: string }> {
    const book = await this.prisma.benchmarkBook.findUnique({
      where: { id: bookId },
    });
    if (!book || book.userId !== userId)
      throw new Error('Benchmark book not found');
    const chapters = (book.chapters as unknown[]) ?? [];
    const prompt = [
      `【拆解任务】拆解对标书《${book.title}》,共 ${chapters.length} 章。`,
      '【产出规范】按角色拆解维度产出,调 write_benchmark 写入对标库:',
      '- CHAPTER(逐章):每章调 write_benchmark(type=CHAPTER, chapterNo=N),含摘要+情节点+角色提及',
      '- PLOT/RHYTHM/EMOTION(全书):基于全章摘要,各调 write_benchmark',
      '- CHARACTER(主要角色):各调 write_benchmark',
      '- STYLE(文风指纹):抽样关键章,调 write_benchmark',
      '【工具】get_raw_chapter(N) 取原文第N章;get_dissect_entries(type?) 取已拆条目。',
    ].join('\n');
    return { prompt, bookId };
  }
}

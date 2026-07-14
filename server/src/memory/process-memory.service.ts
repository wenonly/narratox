import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 三段字数上限(字符数)。超了服务端截断兜底 + warn。 */
export const MEMORY_LIMITS = {
  rules: 800,
  lessons: 800,
  decisions: 1200,
} as const;

export type MemorySection = 'rules' | 'lessons' | 'decisions';
export interface MemoryDoc {
  rules: string;
  lessons: string;
  decisions: string;
}
export type MemoryUpdate = Partial<Record<MemorySection, string>>;

/**
 * per-novel 过程记忆(规矩/经验/决策)。main 每轮调 update_memory 写;
 * ContextAssembler.forSession 读后常驻注入 main systemPrompt。
 *
 * upsert 字段语义:undefined=保留原值;""=清空该段(主动删除);非空字符串=设新值。
 * 超长截断 + warn(可观测 main 守不守纪律)。novel 不归属 user → 返 null(防越权)。
 */
@Injectable()
export class ProcessMemoryService {
  private readonly logger = new Logger('ProcessMemoryService');

  constructor(private readonly prisma: PrismaService) {}

  private truncate(section: MemorySection, value: string): string {
    const limit = MEMORY_LIMITS[section];
    if (value.length <= limit) return value;
    this.logger.warn(
      `${section} 超 ${limit} 字(${value.length}),已截断兜底 —— main 未守压缩纪律`,
    );
    return value.slice(0, limit);
  }

  async upsert(
    userId: string,
    novelId: string,
    partial: MemoryUpdate,
  ): Promise<MemoryDoc | null> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!owned) return null;

    const updates: Record<string, string> = {};
    (['rules', 'lessons', 'decisions'] as MemorySection[]).forEach((sec) => {
      if (partial[sec] !== undefined) {
        updates[sec] = this.truncate(sec, partial[sec]);
      }
    });

    const row = await this.prisma.novelProcessMemory.upsert({
      where: { novelId },
      create: { novelId, ...updates },
      update: updates,
      select: { rules: true, lessons: true, decisions: true },
    });
    return row;
  }

  /** 三段全空或无行 → 返 null(调用方据此不注入 slice)。 */
  async get(userId: string, novelId: string): Promise<MemoryDoc | null> {
    const row = await this.prisma.novelProcessMemory.findFirst({
      where: { novelId, novel: { userId } },
      select: { rules: true, lessons: true, decisions: true },
    });
    if (!row) return null;
    if (!row.rules && !row.lessons && !row.decisions) return null;
    return row;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EventSignificance } from '@prisma/client';

/**
 * 事件输入(settler 经 write_summary plotEvents 传)。
 * significance 默认 MINOR(settler 漏标也保守,不污染注入)。
 */
export interface PlotEventInput {
  description: string;
  significance?: EventSignificance;
  kind?: string;
  involvedCharacters?: string[];
  location?: string;
  causedById?: string;
  relatedHookId?: string;
  relatedHookAction?: string;
}

/** get_events 工具的结构化过滤。 */
export interface EventFilter {
  chapterFrom?: number;
  chapterTo?: number;
  character?: string;
  significance?: EventSignificance;
  keyword?: string;
}

/**
 * 故事事件账本(Phase 11)。Event = 离散「这章发生了什么」的事实点,
 * 独立于 StoryEvent(伏笔,承诺线)。修 Phase 8 诊断的「超 5 章遗忘剧情」:
 * 最近 MAJOR 事件常驻上下文(listRecentMajor)+ 全量可结构化召回(listEvents)。
 * user scope 走 `novel: { userId }`(与 StoryEventService 同)。
 */
@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  /** settler 批量写入本章事件。先校验 novel 归属 user。 */
  async createEvents(
    userId: string,
    novelId: string,
    events: PlotEventInput[],
    chapterOrder: number,
  ) {
    if (!events?.length) return { count: 0 };
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!owned) return { count: 0 };
    const rows = events.map((e) => ({
      novelId,
      chapterOrder,
      description: e.description,
      kind: e.kind ?? null,
      significance: (e.significance ?? 'MINOR') as EventSignificance,
      involvedCharacters: e.involvedCharacters ?? [],
      location: e.location ?? null,
      causedById: e.causedById ?? null,
      relatedHookId: e.relatedHookId ?? null,
      relatedHookAction: e.relatedHookAction ?? null,
    }));
    return this.prisma.event.createMany({ data: rows });
  }

  /** 注入用:最近 N 个 MAJOR,按 chapterOrder desc。 */
  async listRecentMajor(userId: string, novelId: string, limit = 8) {
    return this.prisma.event.findMany({
      where: { novelId, significance: 'MAJOR', novel: { userId } },
      orderBy: { chapterOrder: 'desc' },
      take: limit,
      select: {
        id: true,
        chapterOrder: true,
        description: true,
        involvedCharacters: true,
        location: true,
        relatedHookId: true,
        relatedHookAction: true,
      },
    });
  }

  /** get_events 工具用:结构化过滤查询(top 30 防爆)。 */
  async listEvents(userId: string, novelId: string, f: EventFilter) {
    const where: {
      novelId: string;
      novel: { userId: string };
      chapterOrder?: { gte?: number; lte?: number };
      involvedCharacters?: { has: string };
      significance?: EventSignificance;
      description?: { contains: string };
    } = { novelId, novel: { userId } };
    if (f.chapterFrom !== undefined || f.chapterTo !== undefined) {
      where.chapterOrder = {};
      if (f.chapterFrom !== undefined) where.chapterOrder.gte = f.chapterFrom;
      if (f.chapterTo !== undefined) where.chapterOrder.lte = f.chapterTo;
    }
    if (f.character) where.involvedCharacters = { has: f.character };
    if (f.significance) where.significance = f.significance;
    if (f.keyword) where.description = { contains: f.keyword };
    return this.prisma.event.findMany({
      where,
      orderBy: { chapterOrder: 'asc' },
      take: 30,
      select: {
        id: true,
        chapterOrder: true,
        description: true,
        significance: true,
        kind: true,
        involvedCharacters: true,
        location: true,
        relatedHookId: true,
        relatedHookAction: true,
        causedById: true,
      },
    });
  }

  /** FE 面板用:全量按章。 */
  async listForPanel(userId: string, novelId: string) {
    return this.prisma.event.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { chapterOrder: 'asc' },
    });
  }
}

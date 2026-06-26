import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 回报时机 → 陈旧阈值(章)。slow-burn/endgame 不会短期陈旧。 */
export const PAYOFF_STALE_AFTER: Record<string, number> = {
  IMMEDIATE: 3,
  NEAR_TERM: 12,
  MID_ARC: 40,
  SLOW_BURN: 120,
  ENDGAME: Number.POSITIVE_INFINITY,
};

export interface HookCreateInput {
  description: string;
  payoffTiming: string;
  core?: boolean;
  dependsOn?: string[];
}

export interface OpenHook {
  id: string;
  description: string;
  status: string;
  payoffTiming: string;
  openedAtChapter: number | null;
  lastAdvancedAtChapter: number | null;
  advancedCount: number;
  coreHook: boolean;
  dependsOn: string[];
  stale?: boolean;
}

function isStale(
  hook: {
    status: string;
    payoffTiming: string;
    openedAtChapter: number | null;
    lastAdvancedAtChapter: number | null;
  },
  currentChapter: number,
): boolean {
  if (hook.status === 'RESOLVED') return false;
  const last = hook.lastAdvancedAtChapter ?? hook.openedAtChapter ?? 0;
  return currentChapter - last > (PAYOFF_STALE_AFTER[hook.payoffTiming] ?? 40);
}

@Injectable()
export class StoryEventService {
  constructor(private readonly prisma: PrismaService) {}

  /** OPEN+PROGRESSING 伏笔(enriched)。传 currentChapter 则算 stale(供 slice 标⚠️)。 */
  async listOpen(
    userId: string,
    novelId: string,
    currentChapter?: number,
  ): Promise<OpenHook[]> {
    const rows = await this.prisma.storyEvent.findMany({
      where: {
        novelId,
        status: { in: ['OPEN', 'PROGRESSING'] },
        novel: { userId },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        description: true,
        status: true,
        payoffTiming: true,
        openedAtChapter: true,
        lastAdvancedAtChapter: true,
        advancedCount: true,
        coreHook: true,
        dependsOn: true,
      },
    });
    if (currentChapter === undefined) return rows;
    return (rows as OpenHook[]).map((r) => ({
      ...r,
      stale: isStale(r, currentChapter),
    }));
  }

  async createHooks(
    userId: string,
    novelId: string,
    hooks: HookCreateInput[],
    openedAtChapter: number,
  ): Promise<void> {
    for (const h of hooks) {
      await this.prisma.storyEvent.create({
        data: {
          novelId,
          description: h.description,
          status: 'OPEN',
          openedAtChapter,
          payoffTiming: h.payoffTiming as never,
          coreHook: h.core ?? false,
          dependsOn: h.dependsOn ?? [],
        },
      });
    }
  }

  /** 推进已有伏笔:status→PROGRESSING + advancedCount++ + lastAdvancedAtChapter。 */
  async advanceHooks(
    userId: string,
    novelId: string,
    ids: string[],
    chapterOrder: number,
  ): Promise<void> {
    for (const id of ids) {
      await this.prisma.storyEvent.updateMany({
        where: { id, novelId, status: { in: ['OPEN', 'PROGRESSING'] } },
        data: {
          status: 'PROGRESSING',
          advancedCount: { increment: 1 },
          lastAdvancedAtChapter: chapterOrder,
        },
      });
    }
  }

  async markCore(
    userId: string,
    novelId: string,
    ids: string[],
    core: boolean,
  ): Promise<void> {
    for (const id of ids) {
      await this.prisma.storyEvent.updateMany({
        where: { id, novelId },
        data: { coreHook: core },
      });
    }
  }

  async resolveHooks(
    userId: string,
    novelId: string,
    ids: string[],
    resolvedAtChapter: number,
  ): Promise<void> {
    for (const id of ids) {
      await this.prisma.storyEvent.updateMany({
        where: { id, novelId, status: { in: ['OPEN', 'PROGRESSING'] } },
        data: { status: 'RESOLVED', resolvedAtChapter },
      });
    }
  }

  /** GET 端点用:取与某章相关的事件(埋于/回收于该章)。 */
  listForChapter(userId: string, novelId: string, chapterOrder: number) {
    return this.prisma.storyEvent.findMany({
      where: {
        novelId,
        novel: { userId },
        OR: [
          { openedAtChapter: chapterOrder },
          { resolvedAtChapter: chapterOrder },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        description: true,
        openedAtChapter: true,
        resolvedAtChapter: true,
      },
    });
  }

  /** 状态面板用:全部伏笔 + stale + 未满足依赖(供分组渲染)。currentChapter 服务端算。 */
  async listForStatusView(userId: string, novelId: string) {
    const maxCh = await this.prisma.chapter.aggregate({
      where: { novelId },
      _max: { order: true },
    });
    const currentChapter = maxCh._max.order ?? 0;
    const all = await this.prisma.storyEvent.findMany({
      where: { novelId, novel: { userId } },
      orderBy: [{ coreHook: 'desc' }, { createdAt: 'asc' }],
    });
    const statusById = new Map(all.map((h) => [h.id, h.status]));
    return all.map((h) => ({
      ...h,
      stale: isStale(h, currentChapter),
      unmetDeps: (h.dependsOn ?? []).filter(
        (depId) => statusById.get(depId) !== 'RESOLVED',
      ),
    }));
  }
}

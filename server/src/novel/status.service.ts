import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoryEventService } from '../memory/story-event.service';
import { ArcService } from './arc.service';

/** 工具名 → 近期阶段(recentPhase 从最后一条 message 的 activities 派生)。 */
const TOOL_TO_PHASE: Record<string, string> = {
  append_section: '写正文',
  replace_text: '改正文',
  insert_text: '改正文',
  delete_text: '改正文',
  clear_chapter: '重写章',
  set_world_entry: '建世界观',
  set_volume: '建大纲',
  set_chapter_plan: '建大纲',
  set_arc: '建大纲',
  set_character: '建角色',
  set_references: '建参考',
  report_review: '校验',
  write_summary: '结算',
};

export interface NovelOnboardingBasics {
  title: boolean;
  genre: boolean;
  synopsis: boolean;
  coreConflict: boolean;
  chapterWordTarget: boolean;
  worldviewText: boolean;
  style: boolean;
}

export type NovelNextStep =
  | 'collect_basics'
  | 'build_world'
  | 'plan_outline'
  | 'build_characters'
  | 'plan_more'
  | 'write_next';

/**
 * 小说态势聚合视图(Phase 13)。混合落地:全量派生 + 只读作者目标(settings)。
 * 让主 agent/作者看到「在哪、进度、下一步」。零 DB drift(不另存表)。
 */
@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: StoryEventService,
    private readonly arcs: ArcService,
  ) {}

  async getOverview(userId: string, novelId: string) {
    const novel = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { status: true, settings: true, sessionId: true },
    });
    if (!novel) return null;
    const settings =
      novel.settings && typeof novel.settings === 'object' && !Array.isArray(novel.settings)
        ? (novel.settings as Record<string, unknown>)
        : {};

    // 进度
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId },
      select: { content: true, status: true, order: true },
    });
    const totalWords = chapters.reduce((n, c) => n + (c.content?.length ?? 0), 0);
    const committedCount = chapters.filter((c) => c.status === 'COMMITTED').length;
    const maxOrder = chapters.reduce((m, c) => Math.max(m, c.order), 0);
    const frontierChapter = maxOrder + 1;

    // 当前弧/卷(maxOrder 落点;无已写则 null)
    let currentArc: {
      order: number;
      title: string;
      fromChapter: number;
      toChapter: number;
    } | null = null;
    let currentVolume: { order: number; title: string } | null = null;
    if (maxOrder > 0) {
      const arc = await this.arcs.findArcByChapter(userId, novelId, maxOrder);
      if (arc) {
        currentArc = {
          order: arc.order,
          title: arc.title,
          fromChapter: arc.fromChapter,
          toChapter: arc.toChapter,
        };
        if (arc.volumeId) {
          const vol = await this.prisma.volume.findUnique({
            where: { id: arc.volumeId },
            select: { order: true, title: true },
          });
          currentVolume = vol;
        }
      }
    }

    // 立项 checklist
    const basics: NovelOnboardingBasics = {
      title: !!settings.title,
      genre: !!settings.genre,
      synopsis: !!settings.synopsis,
      coreConflict: !!settings.coreConflict,
      chapterWordTarget: !!settings.chapterWordTarget,
      worldviewText: !!settings.worldviewText,
      style: !!settings.style,
    };
    const [refN, worldN, volN, arcN, charN] = await Promise.all([
      this.prisma.novelReference.count({ where: { novelId } }),
      this.prisma.worldEntry.count({
        where: { novelId, type: { in: ['concept', 'powerSystem'] } },
      }),
      this.prisma.volume.count({ where: { novelId } }),
      this.prisma.arc.count({ where: { novelId } }),
      this.prisma.character.count({ where: { novelId } }),
    ]);
    const basicsAll = Object.values(basics).every(Boolean);
    const onboarding = {
      basics,
      hasReferences: refN > 0,
      hasWorld: worldN > 0,
      hasOutline: volN > 0,
      hasArcs: arcN > 0,
      hasCharacters: charN > 0,
      readyToWrite: basicsAll && worldN > 0 && volN > 0 && charN > 0,
    };

    // 覆盖
    const plannedMax = await this.prisma.chapterOutline.aggregate({
      where: { novelId },
      _max: { chapterOrder: true },
    });
    const plannedChapters = await this.prisma.chapterOutline.count({
      where: { novelId },
    });
    const plannedRemaining = Math.max(
      (plannedMax._max.chapterOrder ?? 0) - frontierChapter + 1,
      0,
    );
    const targetChapters =
      typeof settings.targetChapters === 'number' ? settings.targetChapters : null;

    // 健康
    const openHooks = await this.events.listOpen(userId, novelId, frontierChapter);
    const staleHooks = openHooks.filter((h) => h.stale).length;
    const majorEvents = await this.prisma.event.count({
      where: { novelId, significance: 'MAJOR' },
    });

    // 近期活动(最后一条 message 的 activities)
    const lastMsg = await this.prisma.message.findFirst({
      where: { sessionId: novel.sessionId },
      orderBy: { createdAt: 'desc' },
      select: { activities: true },
    });
    const recentPhase = this.deriveRecentPhase(lastMsg?.activities);

    return {
      status: novel.status,
      totalWords,
      chapterCount: committedCount,
      frontierChapter,
      currentArc,
      currentVolume,
      onboarding,
      coverage: {
        volumes: volN,
        arcs: arcN,
        plannedChapters,
        plannedRemaining,
        targetChapters,
      },
      health: {
        openHooks: openHooks.length,
        staleHooks,
        majorEvents,
      },
      recentPhase,
      nextStep: this.deriveNextStep(novel.status, onboarding, plannedRemaining),
    };
  }

  /** activities 是 Record<id,{act,label}>(无序 map);按「最能代表当前在干嘛」的优先级取一个阶段。 */
  private deriveRecentPhase(activities: unknown): string | null {
    if (!activities) return null;
    const json = JSON.stringify(activities);
    const phaseTools: Record<string, string[]> = {};
    for (const [tool, phase] of Object.entries(TOOL_TO_PHASE)) {
      (phaseTools[phase] ??= []).push(tool);
    }
    const priority = [
      '写正文', '建大纲', '建角色', '建世界观', '建参考', '校验', '结算', '改正文', '重写章',
    ];
    for (const phase of priority) {
      if ((phaseTools[phase] ?? []).some((t) => json.includes(t))) return phase;
    }
    return null;
  }

  private deriveNextStep(
    status: string,
    onboarding: { basics: NovelOnboardingBasics; hasWorld: boolean; hasOutline: boolean; hasCharacters: boolean },
    plannedRemaining: number,
  ): NovelNextStep {
    if (status === 'CONCEPT') {
      if (!Object.values(onboarding.basics).every(Boolean)) return 'collect_basics';
      if (!onboarding.hasWorld) return 'build_world';
      if (!onboarding.hasOutline) return 'plan_outline';
      if (!onboarding.hasCharacters) return 'build_characters';
      return 'write_next';
    }
    if (plannedRemaining <= 3) return 'plan_more';
    return 'write_next';
  }
}

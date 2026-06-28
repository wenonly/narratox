import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
import { MAIN_AGENT_PROMPT } from './agent-prompts';
import { buildReferenceSlice } from './reference-slice';
// Value import (NOT `import type`) so Nest DI can resolve PrismaService when
// AgentosController injects this service (Task 10). A type-only import compiles
// away and leaves the constructor parameter unannotated at runtime → DI failure.
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { EventService } from '../memory/event.service';
import { ArcService } from '../novel/arc.service';
import { StatusService } from '../novel/status.service';
import { WorldEntryService } from '../novel/world-entry.service';
import { NovelReferenceService } from '../novel/novel-reference.service';
import { MasterOutlineService } from '../novel/master-outline.service';
import {
  CharacterService,
  ContextCharacterActive,
  ContextCharacterDormant,
} from '../novel/character.service';
import { buildMasterOutlineSlice } from './master-slice';

interface NovelPromptInput {
  title: string;
  genre: string | null;
  synopsis: string | null;
  // Prisma's `settings` is JsonValue (could be null/array/scalar/...). We
  // narrow defensively inside buildSystemPrompt, so accept `unknown` here —
  // a narrow structural type would reject Prisma's JsonValue at the call site.
  settings?: unknown;
}

interface NovelSettings {
  style?: string;
  language?: string;
  worldviewText?: string;
  coreConflict?: string;
  chapterWordTarget?: number;
}

/**
 * 把小说设定组装成写作 Agent 的 system prompt（作者视角的自然语言，非 JSON）。
 * Phase 1 lite：只拼 title/genre/synopsis/settings；Phase 2 再加大纲 slice/角色段。
 */
@Injectable()
export class ContextAssembler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly world: WorldEntryService,
    private readonly references: NovelReferenceService,
    private readonly characters: CharacterService,
    private readonly eventService: EventService,
    private readonly arcService: ArcService,
    private readonly statusService: StatusService,
    private readonly masterOutlines: MasterOutlineService,
  ) {}

  /**
   * 组装 system prompt。编排骨架 = MAIN_AGENT_PROMPT(交互式一步一停,Phase 16);
   * 本书字段 + 一行【当前阶段】作补充上下文。slices(总纲/态势/前情/角色/事件/伏笔/参考)
   * 由 forSession 插在「规则:」marker 前。status 仅决定一行阶段(DB 真相);阶段流程引导
   * 靠 MAIN_AGENT_PROMPT(立项/建置/写作各段)+ 【小说态势】nextStep。
   */
  buildSystemPrompt(novel: NovelPromptInput, status?: string): string {
    const raw = novel.settings;
    const s: NovelSettings =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const lines: string[] = [MAIN_AGENT_PROMPT, ''];
    lines.push(
      status === 'CONCEPT'
        ? '【当前阶段】立项中(CONCEPT)——基础信息未齐,先按立项流程分步收集(简介自生成,不问用户)。'
        : '【当前阶段】写作中(ACTIVE)——信息已齐,作者要写章时按写章流程委派 chapter。',
    );
    lines.push('');
    lines.push(`【书名】${novel.title}`);
    if (novel.genre) lines.push(`【类型】${novel.genre}`);
    if (novel.synopsis) lines.push(`【简介】${novel.synopsis}`);
    // 核心冲突 + 每章字数目标紧跟简介——让 writer/main 始终看到全书张力与长度预算。
    if (s.coreConflict) lines.push(`【核心冲突】${s.coreConflict}`);
    if (s.chapterWordTarget)
      lines.push(`【每章字数目标】${s.chapterWordTarget} 字`);
    if (s.worldviewText) lines.push(`【世界观/设定】${s.worldviewText}`);
    if (s.style) lines.push(`【文风】${s.style}`);
    if (s.language) lines.push(`【语言】${s.language}`);
    lines.push('');
    lines.push('规则:不要编造与设定冲突的情节;保持人物与已有内容一致。');
    return lines.join('\n');
  }

  /**
   * 由聊天 session（=novel.sessionId）反查小说并组装 prompt；查不到回落通用 prompt。
   * 同时返回 novelId —— buildAgentGraph 闭包注入它,让各 agent 工具按章节序号(order,
   * 而非 cuid)定位章节。select 收紧成 prompt 构造所需 + id 字段。
   *
   * 被动记忆注入:在状态指令之前插入【前情】(最近 5 章摘要,早→晚)
   * 与【未回收伏笔】(开放 StoryEvent)。两者皆空则不插入任何 slice,prompt 与
   * 旧版完全一致。memory 查询跳过 CONCEPT 回落路径(no novel)。
   */
  async forSession(
    userId: string,
    sessionId: string,
  ): Promise<{ prompt: string; novelId: string | null }> {
    const novel = await this.prisma.novel.findFirst({
      where: { sessionId, userId },
      select: {
        title: true,
        genre: true,
        synopsis: true,
        settings: true,
        id: true,
        status: true,
      },
    });
    if (!novel) return { prompt: SYSTEM_PROMPT, novelId: null };

    const base = this.buildSystemPrompt(novel, novel.status);
    const recent = await this.summaries.listRecent(userId, novel.id, 5);
    // B1: 用当前最新章序号算伏笔 stale(超过 payoffTiming 阈值→⚠️)。
    const maxCh = await this.prisma.chapter.aggregate({
      where: { novelId: novel.id },
      _max: { order: true },
    });
    const currentChapter = maxCh._max.order ?? 0;
    const openHooks = await this.events.listOpen(
      userId,
      novel.id,
      currentChapter,
    );
    const coreWorld = await this.world.listCore(userId, novel.id);
    // 角色:分层注入(活跃全档案 + 沉默名册)。currentChapter 复用上面算好的最新章序号。
    const cast = await this.characters.listForContext(
      userId,
      novel.id,
      currentChapter,
    );
    // Phase 11:最近 N 个 MAJOR 事件常驻(修「超 5 章遗忘剧情」)。
    const recentEvents = await this.eventService.listRecentMajor(
      userId,
      novel.id,
      8,
    );
    // Phase 12:当前弧线(写章时知道「在哪条弧、本卷/本弧进展」)。
    const currentArc =
      currentChapter > 0
        ? await this.arcService.findArcByChapter(userId, novel.id, currentChapter)
        : null;
    const currentVolume = currentArc?.volumeId
      ? await this.prisma.volume.findUnique({
          where: { id: currentArc.volumeId },
          select: { title: true, goal: true, arcSummary: true },
        })
      : null;
    // Phase 13:小说态势(进度/立项/覆盖/下一步)——最高层定位,置最前。
    const overview = await this.statusService.getOverview(userId, novel.id);
    // Phase 18:总纲(全书北极星)——比态势更高层,置最前(锁战力崩坏/暗线遗忘/主线漂移)。
    const master = await this.masterOutlines.get(userId, novel.id);
    const masterSlice = buildMasterOutlineSlice(master as never);

    const slices: string[] = [];
    if (masterSlice) slices.push(masterSlice);
    if (overview) {
      const ob = overview.onboarding;
      const basicsAll = Object.values(ob.basics).every(Boolean);
      const flags = `基础${basicsAll ? '✓' : '✗'}参考${ob.hasReferences ? '✓' : '✗'}世界${ob.hasWorld ? '✓' : '✗'}大纲${ob.hasOutline ? '✓' : '✗'}弧${ob.hasArcs ? '✓' : '✗'}角色${ob.hasCharacters ? '✓' : '✗'}`;
      slices.push(
        `【小说态势】${overview.totalWords}字·${overview.chapterCount}章·frontier第${overview.frontierChapter}章${overview.currentVolume ? `·${overview.currentVolume.title}` : ''}${overview.currentArc ? `·弧${overview.currentArc.order}「${overview.currentArc.title}」` : ''} | 立项:${flags} | 细纲剩${overview.coverage.plannedRemaining}章可写 | 开放伏笔${overview.health.openHooks}(⚠️${overview.health.staleHooks}) | 下一步:${overview.nextStep}`,
      );
    }
    if (currentArc) {
      // Phase 12 修正:弧进展服务端派生(从本章所属弧的已写章节摘要拼),不依赖 settler 写 Arc.summary。
      const arcProgress = await this.summaries.listByChapterRange(
        userId,
        novel.id,
        currentArc.fromChapter,
        currentChapter,
      );
      const parts = [
        `弧${currentArc.order}「${currentArc.title}」(第${currentArc.fromChapter}-${currentArc.toChapter}章${currentArc.goal ? `,目标:${currentArc.goal}` : ''})`,
      ];
      if (arcProgress.length) {
        const recent = arcProgress.slice(-8);
        parts.push(
          `弧进展:${recent.map((s) => `第${s.chapterOrder}章:${s.summary}`).join(' / ')}`,
        );
      }
      slices.push(
        `【当前弧线】${currentVolume ? `卷《${currentVolume.title}》· ` : ''}${parts.join(' / ')}`,
      );
    }
    if (coreWorld.length) {
      // 核心世界设定(concept+powerSystem)常驻背景,被动注入。
      slices.push(
        `【世界观】${coreWorld.map((e) => `${e.name}:${e.content}`).join(' / ')}`,
      );
    }
    if (cast.active.length || cast.dormant.length) {
      // 角色:唯一曾缺失的被动 slice。长篇每轮带着角色档案,避免漂移丢设定。
      slices.push(this.buildCharacterSlice(cast));
    }
    if (recent.length) {
      // listRecent 返回章节序号倒序(最新在前);recap 用早→晚,故 reverse()。
      const recap = recent
        .slice()
        .reverse()
        .map((r) => `第${r.chapterOrder}章:${r.summary}`)
        .join(' / ');
      slices.push(`【前情】${recap}`);
    }
    if (recentEvents.length) {
      // listRecentMajor 返回 chapterOrder desc;recap 用早→晚。
      const evRecap = recentEvents
        .slice()
        .reverse()
        .map((e) => `第${e.chapterOrder}章:${e.description}`)
        .join(' / ');
      slices.push(`【近期关键事件】${evRecap}`);
    }
    if (openHooks.length) {
      // B1: 按 核心/进行中/⚠️陈旧 分组,让 agent 看到哪些伏笔该推进/回收。
      const core = openHooks.filter((h) => h.coreHook);
      const stale = openHooks.filter((h) => h.stale);
      const active = openHooks.filter((h) => !h.coreHook && !h.stale);
      const parts: string[] = [];
      if (core.length)
        parts.push(`核心:${core.map((h) => h.description).join('、')}`);
      if (active.length)
        parts.push(`进行中:${active.map((h) => h.description).join('、')}`);
      if (stale.length)
        parts.push(
          `⚠️陈久未推进:${stale
            .map(
              (h) =>
                `${h.description}(${h.payoffTiming},始于第${h.openedAtChapter}章)`,
            )
            .join('、')}`,
        );
      slices.push(`【未回收伏笔】${parts.join(' · ')}`);
    }
    const refsAll = await this.references.listAll(userId, novel.id);
    // main 的【写作参考】slice:命中 main/both 精要(top6)+ 全量索引。与子 agent 注入
    // 共用 buildReferenceSlice(子 agent 侧在 DeepAgentService.resolvePrompt 按各自角色名拼)。
    const mainSlice = buildReferenceSlice('main', refsAll);
    if (mainSlice) slices.push(mainSlice);
    if (!slices.length) return { prompt: base, novelId: novel.id };

    // 把 memory slices 插到「规则:...」之前(即紧贴设定之后、状态指令之前)。
    const marker = '规则:不要编造与设定冲突的情节';
    const idx = base.indexOf(marker);
    if (idx === -1) return { prompt: base, novelId: novel.id };
    return {
      prompt: base.slice(0, idx) + slices.join('\n') + '\n' + base.slice(idx),
      novelId: novel.id,
    };
  }

  /** 拼角色分层 slice:活跃(全档案 + 当前态)+ 沉默(名册 + essence)。 */
  private buildCharacterSlice(cast: {
    active: ContextCharacterActive[];
    dormant: ContextCharacterDormant[];
  }): string {
    const ROLE_LABEL: Record<string, string> = {
      PROTAGONIST: '主角',
      ANTAGONIST: '反派',
      SUPPORTING: '配角',
    };
    const STATE_LABEL: Record<string, string> = {
      personality: '性格',
      emotion: '情绪',
      ability: '能力',
      status: '状态',
      knowledge: '认知',
      relationship: '关系',
      background: '背景',
      other: '其他',
    };
    const lines: string[] = [];
    if (cast.active.length) {
      lines.push('【角色档案 · 活跃】(写涉及他们时以这些设定为准)');
      for (const c of cast.active) {
        const head = `- ${c.name}(${ROLE_LABEL[c.role] ?? c.role})${
          c.aliases.length ? ` [别名:${c.aliases.join('/')}]` : ''
        }`;
        const profile = [
          c.faction && `阵营:${c.faction}`,
          c.background && `背景:${c.background}`,
          c.appearance && `外貌:${c.appearance}`,
          c.personality && `性格基调:${c.personality}`,
          c.motivation && `动机:${c.motivation}`,
          c.arcGoal && `弧光目标:${c.arcGoal}`,
          c.voice && `语言风格:${c.voice}`,
        ]
          .filter(Boolean)
          .join(' | ');
        // 排除 field=appearance(出场记录,非外貌),与 FE 一致。
        const stateEntries = Object.entries(c.currentState)
          .filter(([f]) => f !== 'appearance')
          .map(([f, s]) => `${STATE_LABEL[f] ?? f}=${s.value}`);
        const state = stateEntries.length
          ? ` | 当前态:${stateEntries.join(' | ')}`
          : '';
        lines.push(`${head}${profile ? ` | ${profile}` : ''}${state}`);
      }
    }
    if (cast.dormant.length) {
      lines.push(
        '【角色名册 · 沉默】(近期未出场;若要写他们,先 get_character 取最新档案)',
      );
      for (const c of cast.dormant) {
        const essence = [
          c.personality && `性格:${c.personality}`,
          c.motivation && `动机:${c.motivation}`,
        ]
          .filter(Boolean)
          .join('; ');
        const head = `- ${c.name}(${ROLE_LABEL[c.role] ?? c.role})${
          c.aliases.length ? ` [${c.aliases.join('/')}]` : ''
        }`;
        lines.push(essence ? `${head} — ${essence}` : head);
      }
    }
    return lines.join('\n');
  }
}

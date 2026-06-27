# 小说态势(NovelStatus)实施计划(Phase 13)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans.

**Goal:** NovelStatus 聚合视图(混合:派生为主 + 只持久化作者目标)→ 【小说态势】slice + `GET /novels/:id/status` + FE 📊 态势 tab。让主 agent/作者看到「在哪、进度、下一步」。

**Architecture:** `StatusService.getOverview`(PrismaService + StoryEventService + ArcService 派生全量 + recentPhase 从最后一条 Message.activities + nextStep 路由)。零 migration(作者目标进 settings JSON)。

**Spec:** [2026-06-27-novel-status-design.md](../specs/2026-06-27-novel-status-design.md)

---

## Task 1:StatusService + module + 单测(TDD)

**Files:** Create `server/src/novel/status.service.ts` + spec;Modify `novel.module.ts`

- [ ] **spec 先行**(照 event.service.spec 模式)。核心用例:
  - ACTIVE 态:totalWords/chapterCount/frontier 正确;currentArc/currentVolume 命中。
  - CONCEPT 态:onboarding.basics 各 bool;readyToWrite=false(角色缺)。
  - coverage.plannedRemaining = max(ChapterOutline.chapterOrder) - frontier + 1。
  - nextStep 路由:CONCEPT+basics 缺→`collect_basics`;ACTIVE+plannedRemaining≤3→`plan_more`;否则→`write_next`。
  - recentPhase:mock 最后一条 Message.activities(含 tool 名)→ 映射。
  - health:openHooks/staleHooks/majorEvents 计数。

- [ ] **实现 StatusService**(照 spec 字段;user scope via `novel: { userId }`):

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoryEventService } from '../memory/story-event.service';
import { ArcService } from './arc.service';

const TOOL_TO_PHASE: Record<string, string> = {
  append_section: '写正文', replace_text: '改正文', set_world_entry: '建世界观',
  set_volume: '建大纲', set_chapter_plan: '建大纲', set_arc: '建大纲',
  set_character: '建角色', set_references: '建参考', report_review: '校验', write_summary: '结算',
};

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: StoryEventService,
    private readonly arcs: ArcService,
  ) {}

  async getOverview(userId: string, novelId: string) {
    const novel = await this.prisma.novel.findFirst({ where: { id: novelId, userId }, select: { status: true, settings: true } });
    if (!novel) return null;
    const settings = (novel.settings && typeof novel.settings === 'object' && !Array.isArray(novel.settings) ? novel.settings : {}) as any;

    // 进度
    const agg = await this.prisma.chapter.aggregate({ where: { novelId }, _sum: {}, _max: { order: true }, count: true });
    // 字数:chapter.content 长度和需逐行(aggregate 无字符串长度);取已写章 select content 算
    const chapters = await this.prisma.chapter.findMany({ where: { novelId }, select: { content: true, status: true, order: true } });
    const totalWords = chapters.reduce((n, c) => n + (c.content?.length ?? 0), 0);
    const committedCount = chapters.filter((c) => c.status === 'COMMITTED').length;
    const maxOrder = (agg._max.order ?? 0);
    const frontierChapter = maxOrder + 1;

    // 当前弧/卷(frontier-1 落点;无已写则 null)
    let currentArc: any = null; let currentVolume: any = null;
    const posChapter = Math.max(maxOrder, 1);
    if (maxOrder > 0) {
      currentArc = await this.arcs.findArcByChapter(userId, novelId, posChapter);
      if (currentArc?.volumeId) currentVolume = await this.prisma.volume.findUnique({ where: { id: currentArc.volumeId }, select: { order: true, title: true } });
    }

    // 立项 checklist
    const basics = {
      title: !!settings.title, genre: !!settings.genre, synopsis: !!settings.synopsis,
      coreConflict: !!settings.coreConflict, chapterWordTarget: !!settings.chapterWordTarget,
      worldviewText: !!settings.worldviewText, style: !!settings.style,
    };
    const [refN, worldN, volN, arcN, charN] = await Promise.all([
      this.prisma.novelReference.count({ where: { novelId } }),
      this.prisma.worldEntry.count({ where: { novelId, type: { in: ['concept', 'powerSystem'] } } }),
      this.prisma.volume.count({ where: { novelId } }),
      this.prisma.arc.count({ where: { novelId } }),
      this.prisma.character.count({ where: { novelId } }),
    ]);
    const basicsAll = Object.values(basics).every(Boolean);
    const onboarding = {
      basics, hasReferences: refN > 0, hasWorld: worldN > 0, hasOutline: volN > 0,
      hasArcs: arcN > 0, hasCharacters: charN > 0,
      readyToWrite: basicsAll && worldN > 0 && volN > 0 && charN > 0,
    };

    // 覆盖
    const plannedMax = await this.prisma.chapterOutline.aggregate({ where: { novelId }, _max: { chapterOrder: true } });
    const plannedChapters = await this.prisma.chapterOutline.count({ where: { novelId } });
    const plannedRemaining = Math.max((plannedMax._max.chapterOrder ?? 0) - frontierChapter + 1, 0);
    const targetChapters = typeof settings.targetChapters === 'number' ? settings.targetChapters : null;

    // 健康
    const openHooks = await this.events.listOpen(userId, novelId, frontierChapter);
    const staleHooks = openHooks.filter((h) => h.stale).length;
    const majorEvents = await this.prisma.event.count({ where: { novelId, significance: 'MAJOR' } });

    // 近期活动(最后一条 message 的 activities)
    const lastMsg = await this.prisma.message.findFirst({ where: { session: { novelId } }, orderBy: { createdAt: 'desc' }, select: { activities: true } });
    const recentPhase = this.deriveRecentPhase(lastMsg?.activities);

    // nextStep
    const nextStep = this.deriveNextStep(novel.status, onboarding, plannedRemaining);

    return {
      status: novel.status, totalWords, chapterCount: committedCount, frontierChapter,
      currentArc: currentArc ? { order: currentArc.order, title: currentArc.title, fromChapter: currentArc.fromChapter, toChapter: currentArc.toChapter } : null,
      currentVolume, onboarding,
      coverage: { volumes: volN, arcs: arcN, plannedChapters, plannedRemaining, targetChapters },
      health: { openHooks: openHooks.length, staleHooks, majorEvents },
      recentPhase, nextStep,
    };
  }

  private deriveRecentPhase(activities: unknown): string | null {
    if (!activities || typeof activities !== 'object') return null;
    // activities 形态见 activity-aggregator;扫描工具调用名,取末个映射。
    const json = JSON.stringify(activities);
    let last: string | null = null;
    for (const k of Object.keys(TOOL_TO_PHASE)) if (json.includes(k)) last = TOOL_TO_PHASE[k];
    return last;
  }

  private deriveNextStep(status: string, onboarding: any, plannedRemaining: number): string {
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
```

- [ ] **跑 spec 确认 pass;注册到 NovelModule(providers+exports);typecheck + 提交。**

---

## Task 2:API GET /novels/:id/status

**Files:** `novel.controller.ts`

- [ ] 注入 StatusService;加 `@Get(':id/status') getStatus(user, id) { return this.status.getOverview(user.id, id); }`。controller spec 加 StatusService provider stub。回归 + 提交。

---

## Task 3:ContextAssembler 【小说态势】slice + MAIN prompt

**Files:** `context-assembler.service.ts`(+ specs 构造同步)、`agent-prompts.ts`(MAIN)

- [ ] 构造注入 StatusService;forSession 拉 `const overview = await this.status.getOverview(userId, novel.id);`;slices 最前 push 精简态势:
```ts
if (overview) {
  const ob = overview.onboarding;
  const flags = `基础${Object.values(ob.basics).every(Boolean) ? '✓' : '✗'}参考${ob.hasReferences?'✓':'✗'}世界${ob.hasWorld?'✓':'✗'}大纲${ob.hasOutline?'✓':'✗'}弧${ob.hasArcs?'✓':'✗'}角色${ob.hasCharacters?'✓':'✗'}`;
  slices.push(`【小说态势】${overview.totalWords}字·${overview.chapterCount}章·frontier第${overview.frontierChapter}章${overview.currentVolume?`·${overview.currentVolume.title}`:''}${overview.currentArc?`·弧${overview.currentArc.order}「${overview.currentArc.title}」`:''} | 立项:${flags} | 细纲剩${overview.coverage.plannedRemaining}章可写 | 开放伏笔${overview.health.openHooks}(⚠️${overview.health.staleHooks}) | 下一步:${overview.nextStep}`);
}
```
- [ ] context-assembler.service.spec + memory.spec + pipeline.spec 构造 += statusService stub({ getOverview: jest.fn().mockResolvedValue(null) })。
- [ ] MAIN prompt 状态指令加一句:【小说态势】在你背景里(进度/立项/下一步),据此决定本轮委派(缺啥补啥、细纲将尽先补细纲)。
- [ ] 回归 + typecheck + 提交。

---

## Task 4:FE 📊 态势 tab

**Files:** `types/novel.ts`、`api/routes.ts`、`api/novels.ts`、`IconRail.tsx`、`ResourcePanel.tsx`、`page.tsx`

- [ ] `types/novel.ts` 加 `NovelStatus` interface(对齐 server 字段)。
- [ ] `routes.ts` 加 `NovelStatus: (base, id) => \`${base}/novels/${id}/status\`,`;`novels.ts` 加 `getStatus` client。
- [ ] ResourceKey(三处)+ TITLES += `'overview'` / `overview: '态势'`;IconRail RESOURCES 加 `{ key: 'overview', icon: '📊', label: '态势' }`。
- [ ] ResourcePanel 条件渲染 `{resource === 'overview' && <OverviewView novel={novel} />}` + fallback。
- [ ] 新 OverviewView 组件:取 `getStatus`,刷新触发复用 `chapterWriteSeq`(章/大纲/事件/角色写入都改变态势)。渲染:进度(字数/章数/frontier;有 targetChapters 显示比)、立项 checklist(✓✗,卡点高亮)、覆盖(卷/弧/细纲剩余)、健康微标、下一步文案。
- [ ] `pnpm validate`(lint+format+typecheck)+ 提交。

---

## Task 5:CLAUDE.md Phase 13 入档

- [ ] Phase 12 去 current;加 Phase 13 条(态势聚合视图:派生为主 + 作者目标 settings;【小说态势】slice;GET status;📊 tab;零 migration)。提交。

---

## Self-Review

- **Spec 覆盖**:StatusService 派生 → T1;API → T2;slice+MAIN → T3;FE → T4。混合(只存作者目标,无 migration)→ settings JSON;recentPhase 从 message 派生 → StatusService;nextStep 路由 → T1。✅
- **一致性**:getOverview 字段 = slice 精简 + FE 全量同源;ToolDeps 不动(StatusService 只 ContextAssembler/controller 用)。✅

## 验证未覆盖

- 态势是否真帮 main 编排(nextStep 驱动)、FE 渲染,需活 E2E。本期不强制。

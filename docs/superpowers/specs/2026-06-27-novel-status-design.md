# 小说态势(NovelStatus)设计(Phase 13)

> 日期:2026-06-27 · Phase 13 · 关联 [架构文档](../../architecture/novel-writing-flow.md)(状态散落诊断)

## 问题诊断

当前「小说状态」**散落在多表 + 大量现算**,没有一个 consolidated 的「态势」让主 agent 编排、让作者定位:

- 生命周期只有 `Novel.status`(CONCEPT/ACTIVE)两态,过粗。
- **总字数 / 章节数 / 当前位置不存在**——每次现算(`Chapter.aggregate`),没固化、没注入、FE 看不到。
- **立项 checklist 散在各表**——main 每轮靠 `get_novel_info` 的 missing 列表反推「世界观建没/大纲建没/角色建没」,无汇总。
- **大纲覆盖(下一章有没有细纲、距 frontier 还剩几章可写)散在 ChapterOutline**——这是「该不该委派 outliner 补细纲」的关键编排信号,main 要 `get_outline` 查,没固化。
- 健康(陈久伏笔/最近分数)散在 StoryEvent / 活动流,无汇总。

有大量「记忆」(角色/事件/伏笔/弧线——是什么),但**缺「态势」(在哪、进度、下一步该干嘛)**。主 agent 每轮从散数据重推「我在哪」,慢且易偏;作者也无总览。

## 目标

新增 **NovelStatus 聚合视图**(混合落地:派生为主 + 只持久化作者目标),产出:

1. **【小说态势】slice** 注入主 agent(高层定位,写在最前);
2. **`GET /novels/:id/status`** 端点;
3. **FE 新「📊 态势」tab**(进度环 + 立项 checklist + 覆盖条 + 健康微标 + 下一步)。

全量字段:进度 / 立项 / 覆盖 / 健康 / 下一步 + 近期活动。

## 设计

### 混合落地(零 migration、零 drift)

- **派生为主**:`StatusService.getOverview(userId, novelId)` 从现有表算出全部态势。
- **「瞬态 phase / 近期活动」不另存字段**:从最后一条 `Message.activities` 派生(活动已持久化在 DB)。避免每轮写 Novel 行 + phase map 服务端/前端双份维护。
- **只持久化作者目标**:`Novel.settings` JSON 加 `targetChapters?: number` / `targetVolumes?: number`(作者意图,不可派生)。经 `update_novel` 设。**无 DB migration**(settings 是 JSON)。

### StatusService.getOverview 字段(全量)

```ts
interface NovelStatus {
  // 进度
  status: 'CONCEPT' | 'ACTIVE';
  totalWords: number;            // Chapter.content 字数和
  chapterCount: number;          // 已写(COMMITTED)章数
  frontierChapter: number;       // 下一章该写 = maxOrder + 1
  currentVolume: { order; title } | null;
  currentArc: { order; title; fromChapter; toChapter } | null;

  // 立项 checklist
  onboarding: {
    basics: { title; genre; synopsis; coreConflict; chapterWordTarget; worldviewText; style }; // 各 bool
    hasReferences: boolean; hasWorld: boolean; hasOutline: boolean;
    hasArcs: boolean; hasCharacters: boolean;
    readyToWrite: boolean;
  };

  // 大纲覆盖
  coverage: {
    volumes: number; arcs: number;
    plannedChapters: number;        // 有细纲的章数
    plannedRemaining: number;       // 距 frontier 还剩几章有细纲(→ 驱动补细纲)
    targetChapters: number | null;  // 作者目标(若有)→ 进度比
  };

  // 健康
  health: { openHooks: number; staleHooks: number; majorEvents: number };

  // 近期活动 + 下一步
  recentPhase: string | null;       // 从最后一条 Message.activities 派生
  nextStep: 'collect_basics' | 'build_world' | 'plan_outline' | 'plan_more' | 'build_characters' | 'write_next';
}
```

**派生查询**(全 user-scoped):
- 进度:`Chapter.aggregate({ _sum: content 长度, _max: order, where COMMITTED })`。currentArc/Arc 按 frontier-1 range 查 + 其 Volume。
- 立项:settings 7 字段非空 + `NovelReference.count>0` / `WorldEntry 核心数>0` / `Volume.count>0` / `Arc.count>0` / `Character.count>0`。
- 覆盖:`Volume.count` / `Arc.count` / `ChapterOutline.count`(plannedChapters);`plannedRemaining = max(ChapterOutline.chapterOrder) - frontier + 1`。
- 健康:`StoryEvent` OPEN/PROGRESSING 计数 + stale(复用 `listOpen` 的 stale 逻辑)计;`Event` MAJOR 计。
- recentPhase:取最后一条 `Message.activities`,映射末个工具→阶段(服务端小 map:`append_section→写正文`、`set_world_entry→建世界观`、`set_volume/set_chapter_plan/set_arc→建大纲`、`set_character→建角色`、`set_references→建参考`、`report_review→校验`、`write_summary→结算`)。
- nextStep:函数——CONCEPT 且 basics 未齐→`collect_basics`;齐但无世界观→`build_world`;有世界观无大纲→`plan_outline`;ACTIVE 且 plannedRemaining≤阈值(如≤3)→`plan_more`;无主角档案→`build_characters`;否则→`write_next`。

### 【小说态势】slice(注入 main,精简版)

ContextAssembler 调 `statusService.getOverview`,拼成精简一行式 slice(置最前,最高层定位):

```
【小说态势】45000字·8章·卷1《初入江湖》弧2「拜师」| 立项:基础✓参考✓世界✓大纲✓弧✓角色✗ | 细纲剩13章可写 | 开放伏笔7(⚠️2) | 下一步:建角色
```

> 与既有 slice 不重复:【当前弧线】给细节,态势给「全局位置 + 进度 + 下一步」;【未回收伏笔】给清单,态势给计数。

### FE「📊 态势」tab

新 ResourceKey `'overview'`,IconRail 加 `{ key: 'overview', icon: '📊', label: '态势' }`(现有 `status` tab 是伏笔,不撞)。OverviewView:
- 进度环:已写字数 / 已写章数 / frontier;若有 targetChapters,显示 `8/200 章`。
- 立项 checklist:7 项 + 5 个建置项,各 ✓✗,卡点高亮。
- 覆盖条:卷/弧/细纲已规划/距 frontier 剩余。
- 健康微标:开放伏笔/⚠️陈久/MAJOR 事件。
- 下一步:nextStep 文案。
- 刷新:复用一个 writeSeq(章节/大纲/事件/角色写入都改变态势 → 复用最宽的 `chapterWriteSeq` 或新 `overviewSeq`)。

### API

`GET /novels/:id/status` → `StatusService.getOverview`。只读。

## 改动面

### server
| 文件 | 改动 |
|---|---|
| `src/novel/status.service.ts`(新)+ spec | StatusService.getOverview(全量派生 + recentPhase/nextStep) |
| `src/novel/novel.module.ts` | 注册 StatusService |
| `src/novel/novel.controller.ts` | `GET :id/status` |
| `src/novel/novel.service.ts` 或 update-novel 工具 | settings JSON 已是 JsonValue,`targetChapters/targetVolumes` 经 update_novel 透传(类型放宽即可,无 DTO 改动) |
| `src/agentos/context-assembler.service.ts` | 注入 StatusService + 【小说态势】slice(最前) |
| `src/agentos/agentos.module.ts` | StatusService 可注入(NovelModule 导出) |
| `src/agentos/agent-prompts.ts`(MAIN) | 状态指令引用【小说态势】(main 据其 nextStep 编排) |

### agent-ui
| 文件 | 改动 |
|---|---|
| `src/types/novel.ts` | `NovelStatus` 类型 |
| `src/api/routes.ts` + `novels.ts` | `NovelStatus` 路由 + `getStatus` client |
| `IconRail.tsx` / `ResourcePanel.tsx` / `page.tsx` | ResourceKey += `'overview'`;新 OverviewView 组件 |

## 显式不做(non-goals)

- **不建 NovelStatus 表**。除作者目标(settings)外全派生——零 drift。若日后派生成本成瓶颈再缓存。
- **不持久化 currentPhase 字段**。从最后一条 Message.activities 派生(已固化在 DB)。
- **不存 validator 均分**。分数只在活动流,未持久化结构化;health 暂用伏笔/事件计数,均分 defer。
- **不让 agent 主动报状态**。态势由系统派生,不靠模型 compliance。
- **不动既有 status(伏笔)/ info tab**。态势是独立新 tab。

## 测试

1. **StatusService 单测**:getOverview 各字段(CONCEPT/ACTIVE 两态、plannedRemaining、nextStep 路由、recentPhase 从 mock message 派生)。jest.fn() mock PrismaService + SessionsService。
2. **ContextAssembler slice**:加 statusService stub(返回固定 overview)→ 断言 prompt 含【小说态势】。
3. **回归**:`pnpm test` + `pnpm typecheck`;FE `pnpm validate`。

## 验证未覆盖

- 单测验派生逻辑;**态势是否真帮 main 编排(尤其 nextStep 驱动补细纲/建角色)、FE 面板渲染** 需活 E2E。本期不强制。

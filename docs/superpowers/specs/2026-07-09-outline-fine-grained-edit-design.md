# 大纲细粒度编辑(删除 + 字段级 patch)

- **日期**:2026-07-09
- **状态**:已通过 brainstorming,待写实现 plan
- **相关 Phase**:延续 Phase 18(总纲)/Phase 12(弧线)/Phase 10(细纲 rewrite feedback)
- **关联文件**:`server/src/agentos/tools/set-*.tool.ts`、`server/src/novel/outline.service.ts`、`server/src/agentos/agent-tree.config.ts`、`server/src/agentos/prompts/outliner-*.md`

## 1. 背景

大纲现有工具**全是 `set_*` upsert,无 delete、无 patch**:

- `set_master_outline` / `set_volume` / `set_arc` / `set_chapter_plan` —— 全量覆盖
- `get_outline` / `get_chapter_plan` / `get_arcs` —— 只读

两个痛点:

1. **删不掉**:大纲写错了,无法删卷/弧/细纲/总纲重来,只能靠 `set_*` 覆盖(但 `set_*` 是 upsert,无法减条目,只能改字段)
2. **改不便**:`set_chapter_plan` 的 `cbn`/`cpns`/`cen` 全是必填,只想改 CEN 也得把 CBN+CPNS 全重传

## 2. 决策(已对齐)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 触发方 | **纯 Agent 工具(chat 驱动)** | 沿用角色/世界观「agent 是唯一作者」铁律;FE 大纲面板继续只读 |
| 粒度 | **删除 + 字段级 patch** | 解决「删不掉」+「改不便」;不做调序/拆合(YAGNI) |
| 删卷级联 | **可选 `cascade`**(默认 false) | 默认显式逐条删最安全;agent 确认后传 `cascade=true` 一键清 |
| 删已写章细纲 | **软提醒**(代码不拦,prompt 拦) | 保护 validator dim12「细纲兑现」审计链,但不硬卡(硬卡会让合法「清空重来」走不通) |
| 后悔药 | **不做** snapshot/restore | 大纲改动小,靠对话历史回溯;正文已有 snapshot 机制兜底 |
| chapterOrder renumber | **永远不做** | `chapterOrder` 是章的身份号,renumber 会级联改 Chapter/Event/CharacterChange,灾难 |
| FE 改动 | **零** | OutlineView 继续只读;删完自然不显示,无需感知 |

## 3. 新增工具(5 个,全挂 `outline-writer`)

### 3.1 `delete_chapter_plan`

```
(chapterOrder: number) → { ok: true, chapterOrder, warned?: boolean, reason?: string }
```

- 删一条细纲
- `status === WRITTEN` 时返回 `{ ok: true, warned: true, reason: '本章已写,删除后 validator dim12 将失去审计依据' }` —— **代码不拦**,软提醒
- 删除后该章 `ChapterService.assertHasPlan` 会卡住写章(天然护栏),需重新 `set_chapter_plan` 才能写

### 3.2 `delete_volume`

```
(order: number, cascade?: boolean) →
  | { ok: true, order, deletedArcs: number, deletedChapterPlans: number }
  | { ok: false, error: 'HAS_DESCENDANTS', arcs: number, chapterPlans: number,
      hint: '请先删除/移走下属,或传 cascade=true' }
```

- `cascade` 默认 `false`
- `cascade=false` 且卷下有 arcs/chapterOutlines → **报错返回清单**(不偷删)
- `cascade=true` → prisma `$transaction` 一次性删 volume + 下属 arcs(按 volumeId)+ 下属 chapterOutlines(按 volumeId),保证不半残
- 显式预检 + 显式连删,**不依赖 DB 级联**(虽然 `Arc.volumeId`/`ChapterOutline.volumeId` 是 `SetNull`),便于返回精确数量

### 3.3 `delete_arc`

```
(order: number) → { ok: true, order }
```

- 干净删,零级联
- `ChapterOutline` 不引用 `Arc` FK(schema 确认:`ChapterOutline` 只有 `volumeId`,无 `arcId`)—— 删弧对细纲零影响

### 3.4 `clear_master_outline`

```
() → { ok: true, warned?: boolean, reason?: string }
```

- 删 `MasterOutline` 整行(1:1 Novel,`novelId @unique`)
- Novel 处于 `ACTIVE` 阶段时返回 warning「总纲是北极星,删除后 writer 将失去战力/主线/三幕锚点」,但**不拦**
- 重建走现有 `set_master_outline` upsert

### 3.5 `patch_chapter_plan`

```
(chapterOrder: number, {
  title?: string,
  cbn?: OutlineNode,
  cpns?: OutlineNode[],
  cen?: OutlineNode,
  mustCover?: string[],
  forbidden?: string[],
  volumeOrder?: number,   // 解析成 volumeId,跟 set_chapter_plan 一致
}) → { ok: true, chapterOrder, updatedFields: string[] }
```

- **全 optional,只改传了的字段**(未传字段零变更)
- 数组字段(`cpns`/`mustCover`/`forbidden`)**整体替换**,不做按索引合并(按索引 patch 脆弱,语义复杂)
- 单对象字段(`cbn`/`cen`)**整体替换**
- `chapterOrder` 不可改(身份号)
- 返回 `updatedFields` 清单,方便 agent 自检改了啥

## 4. 不做(YAGNI 清单)

- ❌ `patch_volume` / `patch_arc`:`set_volume`/`set_arc` 除 `title` 外字段本就 optional,改 `goal` 只需重传 `title`,痛点远小于细纲(细纲是 cbn+cpns+cen 全必填)。后续若发现卷/弧改得频繁,按同模式补即可
- ❌ `move_chapter_plan`(调序):风险高,需求未现
- ❌ `split` / `merge` 细纲:极细粒度,需求未现
- ❌ 大纲 snapshot / restore:正文已有 snapshot 兜底;大纲改动小,靠对话历史回溯
- ❌ FE 改动:OutlineView 继续只读(「agent 是唯一作者」一致性)
- ❌ chapterOrder renumber:永远不做

## 5. 关键语义

### 5.1 chapterOrder 不 renumber

删第 5 章细纲,第 6 章还是 6,**留洞**。洞可以用 `set_chapter_plan(5, …)` 补回。理由:`chapterOrder` 是章的身份号,renumber 会级联改 `Chapter.order` / `Event.chapterOrder` / `CharacterChange.chapterOrder` / `ChapterSummary` 等一串字段,风险远大于价值。

### 5.2 删卷的事务性

`delete_volume(cascade=true)` 必须用 prisma `$transaction`:

```ts
await prisma.$transaction([
  prisma.arc.deleteMany({ where: { volumeId } }),
  prisma.chapterOutline.deleteMany({ where: { volumeId } }),
  prisma.volume.delete({ where: { novelId_order: { novelId, order } } }),
]);
```

保证不半残(若中间失败,事务回滚)。

### 5.3 WRITTEN 细纲软护栏实现

```ts
if (existing.status === 'WRITTEN') {
  // 删,但返回 warning(代码层不拦,prompt 层让 agent 删前征得作者同意)
  await prisma.chapterOutline.delete(...);
  return { ok: true, chapterOrder, warned: true, reason: '本章已写,删除后 validator dim12 将失去审计依据' };
}
```

不二次确认(避免 LLM 工具调用陷入多轮 confirm 死循环)。

### 5.4 工具归属(挂哪)

| Agent | 新增工具 |
|---|---|
| `outline-writer` | `delete_chapter_plan` / `delete_volume` / `delete_arc` / `clear_master_outline` / `patch_chapter_plan` |
| `outline-critic` | (无,继续只读) |
| `main` | (无,继续只读,改大纲走 `task` 委派 outliner) |

挂 outline-writer 一致:**写者即编者**。critic 只评审不带删权;main 是编排者,编辑能力走委派。

## 6. Schema / DB 改动

**零迁移**。全部操作走现有表结构:

- delete = `prisma.X.delete` / `deleteMany`
- patch = `prisma.X.update`(partial fields)

`Arc.volumeId` / `ChapterOutline.volumeId` 虽是 `SetNull`,但 `delete_volume(cascade=false)` 时**不依赖 SetNull**,而是预检拒绝;`cascade=true` 时显式连删(返回精确数量)。

## 7. Prompt 改动(3 处)

### 7.1 `OUTLINER_ORCH`(`prompts/outliner-orchestrator.md`)

任务清单加一类「**改/删大纲节点**」task type(现有:建总纲 / 分卷 / 补细纲 / 改写细纲)。委派给 outline-writer 时明确告诉它:

- 删已写章细纲前必须先问作者确认
- 批量删优先走 `delete_volume(cascade=true)` / 多条 `delete_*`,而非一条条改

### 7.2 `OUTLINE_WRITER`(`prompts/outline-writer.md`)

`【工具使用】` 段加 delete/patch 用法:

- **patch 优先于 set**:改细纲字段时,用 `patch_chapter_plan` 而非重传整条 `set_chapter_plan`(省 token、少出错)
- **删已写章细纲前必须先问作者确认**(软护栏的 prompt 层兜底)
- **批量删优先级**:删整卷用 `delete_volume(cascade=true)`,删散点逐条 `delete_*`
- **clear_master_outline 是危险操作**:仅在作者明确要求重建总纲时调用

### 7.3 `MAIN`(`prompts/main.md`)

委派协议补一句:「作者要删/改大纲 → 委派 outliner」(现有委派协议已有「建大纲 / 补细纲 / 改写细纲」,加一条「删/改大纲节点」)。

## 8. 测试

### 8.1 L0 单元(`outline.service.spec.ts` 新增)

- `delete_chapter_plan`:
  - 删 DRAFT 细纲 → ok
  - 删 WRITTEN 细纲 → ok + warned=true + reason
  - 删不存在的细纲 → 404
- `delete_volume`:
  - `cascade=false` 且无下属 → ok
  - `cascade=false` 且有下属 → `HAS_DESCENDANTS` + 数量清单
  - `cascade=true` → 连删 volume + arcs + chapterOutlines,事务原子
- `delete_arc`:删干净,无副作用
- `clear_master_outline`:删整行,ACTIVE 小说返 warning
- `patch_chapter_plan`:
  - 只改 cen → 仅 cen 更新,cbn/cpns 零变更
  - 只改 mustCover → 数组整体替换
  - chapterOrder 不可改(签名无此字段)
  - 不存在的章 → 404(patch 不是 upsert,要新建走 `set_chapter_plan`)

### 8.2 L1 smoke(`test/smoke/l1-integration.spec.ts`)

加一轮:

1. `set_chapter_plan(1, …)` 建细纲
2. `patch_chapter_plan(1, { cen: … })` 改 CEN,assert 其他字段不变
3. `delete_chapter_plan(1)`,assert `assertHasPlan` 卡住写章
4. `delete_volume(1, cascade=true)` 连删,assert 卷+弧+细纲全清

### 8.3 Prompt spec(`agent-prompts.spec.ts`)

若 OUTLINE_WRITER 的 substring 断言因新增「patch 优先」段而变化,同步更新。

## 9. 实现顺序建议(给 plan 用)

1. `OutlineService` 加方法:`deleteChapterPlan` / `deleteVolume` / `deleteArc` / `clearMasterOutline` / `patchChapterPlan`
2. 5 个 tool factory(`delete-chapter-plan.tool.ts` 等)
3. `agent-registry.ts` 注册 5 个 tool
4. `agent-tree.config.ts`:outline-writer 的 `tools` 数组加 5 个 key
5. 3 处 prompt `.md` 编辑
6. 单测 + L1 smoke
7. 手动 E2E:chat「删掉第 3 章细纲」「把第 5 章的 CEN 改成 …」验证 agent 流程

## 10. 风险

- **删卷 cascade 误删**:agent 可能在作者只想删卷本体时误传 `cascade=true`。缓解:OUTLINE_WRITER prompt 明确「删卷前先问作者:只删卷本体(解绑下属)还是连下属一起删?」;`cascade=false` 是默认。
- **WRITTEN 细纲误删**:软护栏靠 prompt,agent 可能不问作者就删。缓解:OUTLINE_WRITER prompt 明确「删已写章细纲前必须先问作者确认」;validator dim12 失去依据时,作者可以从对话历史回溯计划。
- **patch 与 set 语义混淆**:agent 可能该用 patch 时用 set(重传整条)。缓解:prompt 明确「改字段优先 patch」;但 `set_chapter_plan` 不能删(它是 upsert),两者不互斥。

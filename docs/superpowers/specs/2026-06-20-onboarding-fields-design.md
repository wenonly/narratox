# Stage A1 — 补齐立项信息（coreConflict + chapterWordTarget）

> 日期：2026-06-20
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md) Stage A1
> 参考：[inkos](../../references/inkos-workflow-reference.md)（volume_map 规模 / book_rules）、[webnovel-writer](../../references/webnovel-writer-workflow-reference.md)（故事核 / 规模）

## 背景与问题

当前立项（CONCEPT 阶段）只收集 5 项基础信息：书名 / 类型 / 简介 / 世界观 / 文风（见 [get-novel-info.tool.ts:35](../../../server/src/agentos/tools/get-novel-info.tool.ts#L35) 的 `missing` 数组）。对照 inkos 与 webnovel-writer，缺两个直接影响写作质量的关键信息：

1. **核心冲突**——简介回答「讲什么」，核心冲突回答「主角欲望 vs 障碍」，决定全书张力。当前 writer 没有这个锚点。
2. **每章字数目标**——writer 没有长度预算，单章字数随机忽长忽短。注意：FE [types/novel.ts](../../../agent-ui/src/types/novel.ts) 与 server [dto/create-novel.dto.ts:18](../../../server/src/novel/dto/create-novel.dto.ts#L18) 都已埋了 `chapterWordTarget` 字段但从未接通——本设计只是把它连上。

北极星：让 AI 写章前「知道写什么、写多长」。

## 目标

- 让 writer 始终看到核心冲突与每章字数预算（被动注入 system prompt）。
- 让立项 agent 在 CONCEPT 阶段收集这两项（加入 `missing` 列表，软闸门）。
- 让作者在信息卡看到这两项被收集（FE 显示）。

## 非目标（YAGNI / 留后续）

- 不引入「必填 vs 推荐」正式区分——留给 Stage A2。
- 不做硬闸门拦截写章——留给 Stage A2 的 `run_pipeline` 前置条件。A2 会区分「必填 2 项卡写章」vs「推荐项只提醒」。
- 不加 protagonist / 力量体系 / 创意约束等其他字段——留后续 A1.2 / Stage B2。
- 不改 Prisma schema——零 migration（两字段存进 `Novel.settings` JSON，与 worldviewText/style 一致）。
- 不修信息卡未显示「世界观」的预存小缺口（除非另行要求）。

## 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 字段范围 | 仅 2 个：`coreConflict` + `chapterWordTarget` | 最小可验证；不与 Stage B2 角色资源重叠 |
| 存储 | `Novel.settings` JSON 子字段 | 与 worldviewText/style 一致；零 migration；FE/DTO 已埋 chapterWordTarget |
| 闸门 | 软闸门（加入 `missing`，agent 追问） | 硬拦截机制（run_pipeline）是 A2 才建，现在强拦会与之冲突 |
| 前端 | 后端 + FE 信息卡显示 + Novel 类型 | 完整纵切；作者能看到被收集的信息 |
| 字数目标传递 | **被动注入** system prompt（`【每章字数目标】N 字`） | writer 每轮都看得到，无需额外工具往返；与「世界观/文风被动注入」一致 |

## 字段定义

| 字段 | 类型 | settings 子字段名 | 含义 |
|---|---|---|---|
| 核心冲突 | string | `settings.coreConflict` | 主角欲望 vs 障碍，一句话 |
| 每章字数目标 | number | `settings.chapterWordTarget` | writer 单章字数预算 |

命名对齐：FE 与 server DTO 都已用 `chapterWordTarget`，沿用不改名。ROADMAP 散文里的 `targetWordsPerChapter` 顺手改为 `chapterWordTarget` 以保持一致。

## 后端改动（server）

### 1. `src/agentos/context-assembler.service.ts`
- `NovelSettings` 接口加 `coreConflict?: string` 与 `chapterWordTarget?: number`。
- `buildSystemPrompt`：在 `【简介】` 之后注入 `【核心冲突】${coreConflict}` 与 `【每章字数目标】${chapterWordTarget} 字` 两行（让 writer 始终看到长度预算）。
- CONCEPT 状态 prompt：把「需要收集以下 5 项基础信息」更新为 7 项（新增「核心冲突」「每章字数目标」），并更新对 `missing` 的说明。

### 2. `src/agentos/tools/update-novel.tool.ts`
- Zod schema 加 `coreConflict: z.string().optional()` 与 `chapterWordTarget: z.number().int().positive().optional()`。
- 合并进 `merged` settings（仿现有 worldviewText/style 的 merge 逻辑：`if (coreConflict) merged.coreConflict = coreConflict`）。
- 工具 description 同步更新字段列表。

### 3. `src/agentos/tools/create-novel.tool.ts`
- schema 加两字段；建书时映射进初始 settings（与 worldviewText 同处理）。

### 4. `src/agentos/tools/get-novel-info.tool.ts`
- settings 类型拓宽，返回 `coreConflict` / `chapterWordTarget`（`?? null`）。
- `missing` 数组加两项：`!settings.coreConflict ? '核心冲突' : null`、`!settings.chapterWordTarget ? '每章字数目标' : null`。
- 工具 description 更新。

### 5. `src/novel/dto/create-novel.dto.ts`
- settings 注释更新：`{ style?, language?, chapterWordTarget?, worldviewText?, coreConflict? }`（对齐实际）。

### 软闸门语义
`missing` 含全部立项字段（A1 后为 7 个），agent 在 CONCEPT 阶段据 `missing` 收集。A2 将区分必填 2 项（卡写章）与推荐 5 项（只提醒）。A1 不引入此区分，保持最小。

## 前端改动（agent-ui）

### 1. `src/types/novel.ts`
- `NovelSettings` 加 `coreConflict?: string`（`chapterWordTarget` 已存在）。

### 2. `src/components/workspace/ResourcePanel.tsx` — `InfoView`
- `settings` 类型从 `{ style?: string }` 拓宽为含 `coreConflict?` / `chapterWordTarget?`。
- 信息卡 `rows` 加两行：核心冲突（`settings.coreConflict`）、每章字数目标（`settings.chapterWordTarget ? N 字 : '—'`）。
- 位置：建议放在「简介」之后（核心冲突）与「文风」前后（字数目标），与 prompt 注入顺序呼应。

## 测试

后端 jest specs 同步更新（保持绿）：
- `update-novel.tool.spec.ts`：两字段写入 settings；merge 不覆盖既有字段。
- `create-novel.tool.spec.ts`：建书时两字段进 settings。
- `get-novel-info.tool.spec.ts`：返回两字段；缺时进 `missing`。
- `context-assembler.service.spec.ts`：prompt 含 `【核心冲突】` / `【每章字数目标】`；CONCEPT prompt 列 7 项。
- `context-assembler.memory.spec.ts`：memory slice 注入不受新字段影响（回归）。

前端无测试运行器，靠 `pnpm validate`（lint + format + typecheck）把关。

## 验收

- agent 在 CONCEPT 阶段会追问「核心冲突」与「每章字数目标」。
- `update_novel` 写入后，信息卡显示这两项。
- writer 的 system prompt 含 `【核心冲突】` 与 `【每章字数目标】N 字`。
- `pnpm --dir server test` 全绿；`pnpm --dir agent-ui validate` 通过。

## 依赖与衔接

- 无外部依赖；零 schema migration。
- 为 Stage A2（真 `run_pipeline` + 硬闸门）提供必填字段基础。
- 不触碰 Stage B（记忆/伏笔）、Stage C（大纲）。

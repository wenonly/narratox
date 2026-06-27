# 角色管理完善：上下文分层注入 + 面板档案渲染

- 日期：2026-06-27
- 状态：已批准，待实现
- 前序：Phase 5（[2026-06-24-agent-config-character-phase-design.md](./2026-06-24-agent-config-character-phase-design.md)）已建好 character agent 子树 + 5 个 stable-profile 字段；本 spec 是它的直接跟进，补上当时 defer 的两件事。

## 背景与动机

Phase 5 让 Character 在**后端**已经相当完整：数据模型（稳定身份 + 事件时间线）、`character` 编排子树（char-writer/char-critic + `report_character_review`）、`set_character`/`get_character` 工具、`characterWriteSeq` 自动刷新——都已就位。

但有两个结构性缺口，正是"长篇小说丢角色设定"的根因：

1. **Character 是唯一一个不被动注入 agent 上下文的一等资源。** `ContextAssembler.forSession()` 每轮注入【世界观】【前情】【未回收伏笔】【写作参考】，唯独没有角色。写到第 30 章时，agent 上下文里**完全没有**角色档案——除非它凭 prompt 纪律"自觉"调 `get_character()`。世界观/伏笔都有被动注入保底，角色没有。这是长篇漂移的结构性原因。
2. **char-writer 辛苦建的 5 个 stable-profile 字段（appearance/personality/motivation/arcGoal/voice）+ faction/background 在前端面板完全不渲染。** 作者看不到 agent 建了什么，无法校对。对比大纲/世界观面板都把结构化字段全展示出来了。

## 目标

1. **【核心】角色 slice 分层注入** —— 让 agent 每轮都带着角色档案写作，长篇不丢设定。
2. **前端角色面板渲染档案字段** —— 作者能看见 agent 建的人物档案。
3. **`get_characters` 工具字段对齐** —— 消除与 `get_character` 的不对称（顺手小修）。

## 非目标（明确不做）

经讨论确认，以下本期**不做**：

- ❌ **手动编辑/删除角色**：agent 是角色档案的唯一作者；作者要修正，通过聊天让 agent 改（走 char-writer → `set_character`）。理由：手编若不保护会被 agent 覆写，加锁定又会导致 agent 无法更新——与其引入别扭的锁，不如保持单一数据源。前端角色面板保持**只读**。
- ❌ 锁定标志（`manualLocked` 之类）——随上一条一并排除。
- ❌ 章节结算时的角色一致性 critic ——分层注入本身让 agent"看见"档案，已大幅降低漂移；critic 留待后续。
- ❌ 关系/知情范围矩阵（inkos `character_matrix` / webnovel-writer 6 表那套）——大工程，defer。

## 设计

### 1. 角色 slice 分层注入（核心）

#### 位置

`ContextAssembler.forSession()`（[context-assembler.service.ts](../../../server/src/agentos/context-assembler.service.ts)）。在现有 `slices[]` 里、**【世界观】之后、【前情】之前**插入【角色】slice。最终 slice 顺序：世界观 → **角色** → 前情 → 未回收伏笔 → 写作参考（把"稳定设定"——世界观+卡司——聚在一起，置于"动态"——前情+伏笔——之前）。

注入点复用现有机制：slice 拼好后整体插到 base prompt 的 `规则:不要编造与设定冲突的情节` 之前（现有逻辑，无需改）。

#### 活跃 / 沉默分类

分类逻辑封装在 `CharacterService.listForContext(userId, novelId, currentChapter, activeWindow=5)` 里（见下），返回 `{ active: [...], dormant: [...] }`。判定规则：

- `PROTAGONIST` / `ANTAGONIST` → **永远活跃**（驱动主线）。
- 其他角色：
  - `lastChapter === null`（从未出场，含"刚由 char-writer 建好还没用上"）→ **活跃**（种子卡司，避免新角色被误判沉默）。
  - 否则 `currentChapter - lastChapter <= activeWindow`(默认 5) → **活跃**。
  - 其余 → **沉默**。

`lastChapter` = 该角色 `CharacterChange` 记录里最大的 `chapterOrder`（settler 每次出场都记一条 `field=appearance` 的 change，可可靠派生）。`currentChapter` 复用 `forSession()` 已算好的 `maxCh._max.order`。

#### 注入格式

```
【角色档案 · 活跃】(写涉及他们时以这些设定为准)
- 林墨(主角) [别名:墨哥] | 阵营:青云宗 | 背景:废柴下山 | 外貌:清瘦黑发 | 性格基调:隐忍果决 | 动机:查清身世 | 弧光目标:证道 | 语言风格:简短冷峻 | 当前态(第12章): 情绪=冷静 | 能力=筑基三层 | 状态=被通缉
- 苏晚(反派) | ...
【角色名册 · 沉默】(近期未出场;若要写他们,先 get_character 取最新档案)
- 陈叔(配角)[老陈] — 性格:隐忍寡言;动机:护主
- 王管事(配角) — 性格:圆滑;动机:中饱私囊
```

- **活跃行**：name(role) + 别名 + 全部非空 profile 字段（阵营/背景/外貌/性格基调/动机/弧光目标/语言风格，` | ` 分隔）+ 派生当前态（排除 `field=appearance` 的出场记录，与 FE 一致）。
- **沉默行**：name(role) + 别名 + essence（`性格:…;动机:…`，复用现有字段，**不新增字段**）。即便 essence 为空，name+role+aliases 仍能提醒 agent"这个人存在"。
- 任一数组为空则省略对应小节；两数组皆空（无任何角色）则不插 slice，prompt 与现状完全一致。

#### Token 预算

活跃行 ~150-300 tokens/角色，沉默行 ~30-50 tokens/角色。50 角色 / 8 活跃 → 约 8×250 + 42×40 ≈ 3.7k tokens/轮。这些模型上下文 128k+，无能力压力，仅钱。可接受。

#### 工具保留

`get_character` / `get_characters` 不动其语义——沉默角色重出场时 agent 仍可按需取完整档案。注入 slice（被动）+ 工具（主动）= 双保险。

### 2. 前端角色面板渲染档案字段

#### 现状

`CharactersView`（[ResourcePanel.tsx:681-812](../../../agent-ui/src/components/workspace/ResourcePanel.tsx)）的角色卡：折叠态显示 name + 前 3 条 currentState；展开态只显示变化时间线。**5 个 profile 字段 + faction/background 从不渲染。** 数据其实已经在前端（`getCharacters` → `listCharacters` 返回 `...ch` 全字段 + `changes` + `currentState`），所以**无需改 API / 类型**，纯 JSX 改动。

#### 改动

每张角色卡重组为三段（展开态）：

1. **完整档案** —— 渲染非空的 profile 字段，中文标签：外貌 / 性格基调 / 动机 / 弧光目标 / 语言风格 / 阵营 / 背景。长文本（外貌/背景）用 `MarkdownRenderer`，短字段纯文本。空字段**不显示**（不逐个塞"未填写"，避免噪声）；若 7 个字段全空，显示一行淡色提示「档案尚未建立（char-writer 建档后显示）」。
2. **当前态** —— 现有 currentState 派生态（从折叠态迁过来）。
3. **变化时间线** —— 现有时间线（不动）。

**折叠态**：name + 别名 + 一行 essence（`性格基调:… · 动机:…`，非空才显示）——一眼看清身份。不再在折叠态显示 currentState 预览（迁入展开态第 2 段），减少折叠卡噪声。

定义一个 `PROFILE_FIELDS` 常量数组（key→中文 label）驱动渲染，避免散落的硬编码。

#### 只读

无任何编辑/删除 UI（符合非目标）。作者校对后若发现问题，通过聊天让 agent 修正。

### 3. `get_characters` 工具字段对齐

[get-characters.tool.ts](../../../server/src/agentos/tools/get-characters.tool.ts) 现在只投影 `name/role/faction/currentState`，与 `get_character`（返回全字段）不对称。补上 appearance/personality/motivation/arcGoal/voice + background（约 5 行），让 agent 列表时也能看到档案。注入 slice 走 CharacterService 直连不受影响，这纯粹是消除工具层的困惑。

## 文件级改动清单

**Server**
- [server/src/novel/character.service.ts](../../../server/src/novel/character.service.ts) — 新增 `listForContext(userId, novelId, currentChapter, activeWindow=5)`：load 角色 + changes(取 50)，派生 currentState + `lastChapter`，按规则分类，返回 `{ active, dormant }`（active 带全 profile + currentState，dormant 只带 name/role/aliases/personality/motivation）。复用私有 `deriveCurrentState`。
- [server/src/agentos/context-assembler.service.ts](../../../server/src/agentos/context-assembler.service.ts) — 构造函数注入 `CharacterService`（与现有 `WorldEntryService`/`NovelReferenceService` 同模式，NovelModule 已 export）；在 `forSession()` 里 `currentChapter` 已算好后调用 `listForContext`，按格式拼【角色】slice 推入 `slices[]`（插在【世界观】之后）。内联 `ROLE_LABEL` / `STATE_LABEL` 小表。
- [server/src/agentos/tools/get-characters.tool.ts](../../../server/src/agentos/tools/get-characters.tool.ts) — projection 补 5 个 profile 字段 + background。

**Frontend**
- [agent-ui/src/components/workspace/ResourcePanel.tsx](../../../agent-ui/src/components/workspace/ResourcePanel.tsx) — `CharactersView` 卡片重组：新增 `PROFILE_FIELDS` 常量；展开态三段（档案/当前态/时间线）；折叠态改 essence 行。无 API/类型改动。

**无 DB 迁移** —— 所有需要的字段 Phase 5 已加好。

## 测试策略

**Server（jest 单测）**
- `character.service.spec.ts` 新增 `listForContext` 用例：覆盖分类边界——PROTAGONIST 永远活跃；最近出场在窗口内→活跃；超出窗口→沉默；`lastChapter===null`→活跃；`currentChapter===0`（无章）→全部活跃。用 `jest.fn()` mock PrismaService（沿用现有 spec 模式）。
- `context-assembler` slice 拼接可顺带加一个轻量用例（active/dormant 各一条 → 两个小节都出现；全空 → 不插 slice），若现有 assembler 无 spec 则至少覆盖 service 层。

**Frontend** —— 无测试 runner；质量门是 `pnpm validate`（lint + format + typecheck）。改动后跑一遍确保通过。

## 风险与权衡

- **活跃窗口 N=5 是经验值**：不同节奏的小说可能要调。做成 `listForContext` 的参数（默认 5），未来要调只改一处，无需改架构。
- **`lastChapter===null`→活跃** 会让"建了但从没用过"的角色一直占活跃位。token 成本可忽略；若日后成问题，再加基于 `createdAt` 或显式删除路径（本期不做）。
- **注入增加了每轮 prompt 长度**：约 +3-4k tokens/轮（大卡司）。`createSummarizationMiddleware` 已在压缩旧上下文，且模型上下文充裕，不构成能力问题，仅 API 输入成本上升——可接受。

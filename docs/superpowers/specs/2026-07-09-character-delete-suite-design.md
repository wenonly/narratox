# 角色删除/清空套件(对标大纲细粒度编辑)

- **日期**:2026-07-09
- **状态**:已通过 brainstorming,待写实现 plan
- **相关 Phase**:延续 Phase 6(角色上下文注入)/Phase 21(小传 + changes 瘦身)/2026-07-09 大纲细粒度编辑(对称实现)
- **关联文件**:`server/src/agentos/tools/set-character.tool.ts`、`server/src/novel/character.service.ts`、`server/src/agentos/agent-tree.config.ts`、`server/src/agentos/prompts/char-writer.md`、`character-orchestrator.md`、`main.md`

## 1. 背景

角色资源(`Character` + `CharacterChange`)目前**只读 + upsert,无任何删除能力**:

- `set_character`(char-writer)—— 字段级 merge upsert(已正确:未传字段保留旧值)
- `get_character` / `get_characters` / `get_character_history`(writer/validator/main/char-*)—— 只读
- `report_character_review`(char-critic)—— 评审,无 DB 写入

与刚完成的「大纲细粒度编辑」对照,**delete 侧完全真空**:

| 能力 | 大纲(已加) | 角色 |
|---|---|---|
| Patch field | `patch_chapter_plan` | **`set_character` merge 已覆盖** |
| Delete single | `delete_chapter_plan` | ❌ 无 |
| Delete container | `delete_volume`/`delete_arc` | ❌ 无 |
| Clear all | `clear_master_outline` | ❌ 无 |
| 显式清空某字段 | patch with "" | ❌ 无(`null`/undefined 都 = skip,不 = clear) |

三个具体痛点:

1. **删不掉废弃角色**:支线砍掉/设定重做,角色行无法从 bible 移除;ContextAssembler 仍会注入它,writer 可能继续给「已死」角色安排戏份(drift 风险)
2. **无法清空全书角色**:重建(换流派/重做角色体系)时,只能一条条 `set_character` 覆盖,但旧行仍在
3. **无法显式清空某字段**:写错 `personality` 想回到空让 char-writer 重新填—— 现在不传 = 不改,无法表达「清空」

## 2. 决策(已对齐)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 触发方 | **纯 Agent 工具(chat 驱动)** | 沿用「agent 是唯一作者」铁律;FE CharactersView 继续只读 |
| 范围 | **全 3 件套** | 对标 outline 套件,完整闭环;不做半套留尾巴 |
| 删角色变迁史 | **可选 `cascade`**(默认 false) | 对标 `delete_volume`;默认显式拒绝给 count,agent 确认后传 `cascade=true` 连删 |
| ACTIVE 护栏 | **`clear_characters` 软提醒;`delete_character` 不拦** | clear 是核武(对标 `clear_master_outline`);单删是显式请求,错了 char-writer 重建 |
| 字段清空机制 | **`set_character` 加 `clear_fields: string[]` 参数** | 可从 schema 发现,不破坏现有 `null=skip` 语义(改 null 语义有炮筒风险,见 §5.4) |
| 改名 | **= 新建旧删** | 不做 rename 工具;name 是身份,改名等于换人 |
| FE 改动 | **零** | CharactersView 继续只读 |

## 3. 新增工具(2 个新 + 1 个改,全挂 `char-writer`)

### 3.1 `delete_character`(新)

```
(name: string, cascade?: boolean) →
  | { ok: true, name: string, deletedChanges: number }
  | { ok: false, error: 'HAS_CHANGES', changes: number, hint: string }
  | { ok: false, reason: 'not_found' }
```

- 按 `(novelId, name)` 查角色(user-scoped via `novel.user`);不存在返 `not_found`
- 无 `CharacterChange` → 直接删 character 行,返 `deletedChanges: 0`
- 有 `CharacterChange` + `cascade=false`(默认)→ **拒绝返清单**(不偷删):`{ ok: false, error: 'HAS_CHANGES', changes: N, hint: '该角色有 N 条变迁史,删除前请确认:传 cascade=true 连带删,或保留变迁史(角色删了变迁史成孤儿)' }`
- 有 `CharacterChange` + `cascade=true` → prisma `$transaction` 连删 character + 其 changes,返 `deletedChanges: N`
- **不拦 ACTIVE 小说**:单个删是显式请求,错误重建走 char-writer

### 3.2 `clear_characters`(新)

```
() →
  | { ok: true, deletedCharacters: number, deletedChanges: number, warned: boolean, reason?: string }
  | { ok: false, reason: 'empty' }
```

- 该 novel 下无任何 character → `{ ok: false, reason: 'empty' }`
- Novel 处于 `ACTIVE` → **仍删,但返 warning**(对标 `clear_master_outline`):
  - `warned: true`
  - `reason: '全书角色 bible 已清空(ACTIVE 小说),writer/validator 将失去角色档案依据,下一轮写章前请重建 bible'`
- CONCEPT → 删,无 warning(还在立项,角色 bible 本就在重塑)
- 实现:prisma `$transaction` 删全部 character + 全部 CharacterChange(按 novelId)
- **危险操作**:仅在作者明确要求「重建角色体系」时调用

### 3.3 `set_character` 增 `clear_fields` 参数(改 schema)

```
set_character({
  name: string,
  role?, aliases?, faction?, background?, appearance?, personality?,
  motivation?, arcGoal?, voice?, growth?, flaw?,   // 原 11 个字段,nullish = 跳过保留
  clear_fields?: string[],                          // 新增:显式列字段名清空成 ""
})
```

- `clear_fields: ['appearance', 'personality']` → 服务层把这两个字段 set 为 `''`,其他字段不受 merge 影响
- 可清空字段(9 个文本字段,非身份字段):`faction` / `background` / `appearance` / `personality` / `motivation` / `arcGoal` / `voice` / `growth` / `flaw`
- **不在白名单的字段名** → `not_found`(防 typo 静默丢数据)
- `name` / `role` / `aliases` 不进 `clear_fields`:
  - `name` 是身份(改名 = 新建旧删)
  - `role` 直接用 `set_character({ role: 'PROTAGONIST' })` 改
  - `aliases` 直接传空数组 `aliases: []` 改

## 4. 不做(YAGNI 清单)

- ❌ `patch_character`:**`set_character` 的 merge 已是 field-level patch**(运行时等价 `patch_chapter_plan`),重造轮子。两者差异仅在工具名「patch」更明确,但服务层行为已对齐。
- ❌ `delete_character_history`(单删某条变迁史):变更史是稀疏事实流,删单条价值低;若作者要清整段就用 `delete_character(cascade=true)`。
- ❌ `rename_character`:`name` 是身份号(对标 `chapterOrder` 不 renumber);改名 = 新建旧删。
- ❌ 软删除(`deletedAt` flag):增加复杂度;bible 应是「真状态」而非「带墓碑」;删就是删。
- ❌ `delete_character` 在 ACTIVE 上软提醒:单删是显式请求(用户明说「删掉 XX」才触发),与 `clear_characters`(可能误清全书)不同量级。
- ❌ FE 手动 UI:沿用「agent 是唯一作者」。
- ❌ 删角色级联 Event:事件表不存 `characterId` FK,`involvedCharacters` 是字符串数组(名字引用);删角色不会动 Event,但 Event 里的角色名会变 dangling—— **接受这个 dangling**,因为 Event 是事实点(「这章出现了 X」),就算 X 被删,事实仍发生。

## 5. 关键语义

### 5.1 CharacterChange 是真级联(对标 Arc 无 FK 不同)

`Character` ←→ `CharacterChange` 是 schema 级 FK(`characterId`)。删除时:
- `cascade=false`(默认):**预检拒绝**(返 count + hint),不偷删
- `cascade=true`:`$transaction` 原子连删

对比 `delete_arc`:Arc 无任何 FK 依赖(`ChapterOutline` 不引用 ArcId),所以 `delete_arc` 零级联直接删。Character 不行—— CharacterChange 是真实 FK 依赖。

### 5.2 clear_characters 的事务性

```ts
await prisma.$transaction([
  prisma.characterChange.deleteMany({ where: { novelId } }),
  prisma.character.deleteMany({ where: { novelId } }),
]);
```

顺序:先删 changes(子)再删 characters(父),避免引用约束。事务保证不半残。

### 5.3 ACTIVE 软护栏实现

```ts
if (novel.status === 'ACTIVE') {
  // 删,但返 warning(代码层不拦,prompt 层让 agent 在 clear 前征得作者同意)
  await txDeleteAllCharactersAndChanges(novelId);
  return { ok: true, deletedCharacters: N, deletedChanges: M, warned: true, reason: '...' };
}
```

不二次确认(避免工具调用陷入多轮 confirm 死循环)。

### 5.4 为什么不改 null 语义(历史背景)

`set_character` 的 `.nullish()` schema 是为修一个 bug 加的:**模型会发 null(本意是「不提供」),旧 zod schema 拒 null 触发重试,陷入循环**。修复方案是接受 null,语义上等同 undefined(都 = skip)。

如果现在改「null = clear」,等于把这个修复倒退回炮筒—— 模型发 null 可能本意仍是「skip」,但实际会清空字段,数据丢失风险。**所以选 `clear_fields` 参数**:意图显式,不会被误解。

### 5.5 工具归属

| Agent | 新增/改动 |
|---|---|
| `char-writer` | `delete_character` / `clear_characters` / `set_character(+clear_fields)` |
| `char-critic` | (无,继续只读评审) |
| `main` | (无,继续只读;改角色走 `task` 委派 character) |
| `writer` / `validator` | (无,继续只读) |

挂 char-writer 一致:**角色作者是唯一编辑者**。critic 评审不带删权;main 是编排者,编辑能力走委派。

## 6. Schema / DB 改动

**零迁移**。全部操作走现有表结构:

- `prisma.character.delete` / `deleteMany`
- `prisma.characterChange.deleteMany`
- `prisma.character.update`(merge + clear_fields 都走 update)

`CharacterChange.characterId` 在 schema 中是 required FK(非 SetNull),所以必须 `$transaction` 连删—— 否则删除 character 时数据库会拒绝(引用约束)。

## 7. Prompt 改动(3 处)

### 7.1 `CHAR_WRITER`(`prompts/char-writer.md`)

`【工具使用】` 段加【删除/清空 — 用法纪律】section:

- **删角色前问作者 cascade 意愿**:该角色有变迁史(CharacterChange),删了变迁史是 character-history 工具的数据源,问作者「保留变迁史(角色删了变迁史成孤儿)还是一起删(cascade=true)」
- **`clear_characters` 是危险操作**:仅在作者明确要求「重建角色体系」时调用;不是「重写某个角色」的快捷方式(那是 `set_character` merge)
- **`clear_fields` 优先**:想清空某字段(回到空让 char-writer 重新填)用 `set_character({ name, clear_fields: ['personality'] })`,比传空串更明确
- **改名 = 新建旧删**:`name` 是身份,不做 rename;旧名 `delete_character` + 新名 `set_character`
- **ACTIVE 小说 clear 会 warning**:不拦,但 prompt 层先问作者确认

### 7.2 `CHARACTER_ORCH`(`prompts/character-orchestrator.md`)

任务清单加一类「**删/清角色**」task type(现有:建角色 bible / 修订角色)。委派给 char-writer 时明确:

- 删单个角色前问作者 cascade 意愿
- 批量清(clear_characters)只在作者明确要求「重建体系」时触发

### 7.3 `MAIN`(`prompts/main.md`)

character 委派协议补一句:「作者要删/清角色 → 委派 character」(现有协议有「建角色 bible」,加一条「删/清角色」)。

## 8. 测试

### 8.1 L0 单元(`character.service.spec.ts` 新增)

**`deleteCharacter`**:
- 删无 changes 的角色 → ok, deletedChanges: 0
- 删有 changes + `cascade=false` → `HAS_CHANGES` + count + hint
- 删有 changes + `cascade=true` → 连删,事务原子,返 deletedChanges
- 删不存在的角色 → `not_found`

**`clearCharacters`**:
- 无任何角色 → `empty`
- CONCEPT → 删,无 warning
- ACTIVE → 删 + warned=true + reason
- 删后 character + characterChange 表均空(事务原子)

**`upsertCharacter` clear_fields**:
- `clear_fields: ['appearance']` → 该字段变 `''`,其他字段保留
- 多字段 `clear_fields: ['appearance', 'personality']` → 都清空
- 未知字段名 `clear_fields: ['typo_field']` → throw not_found
- 试图清 `name` / `role` / `aliases` → 拒绝(不在白名单)
- 与 merge 共存:`set_character({ name, personality: '新', clear_fields: ['appearance'] })` → personality 改新值,appearance 清空

### 8.2 L0 tool spec(5 个新)

每个 tool factory 一个 spec:delete_character.tool.spec.ts(3 例:正常/has-changes/cascade)、clear_characters.tool.spec.ts(3 例)、set-character.tool.spec.ts(已存在,新增 clear_fields 用例 4-5 例)。

### 8.3 配置 spec

- `agent-tree.config.spec.ts`:char-writer 工具快照加 `delete_character` / `clear_characters`
- `agent-prompts.spec.ts`:substring 锁仍通过(本期不动已锁 prompt 主体,只加 section)

### 8.4 L1 smoke(`test/smoke/l1-integration.spec.ts`)

加一轮(若角色 fixture 支持):

1. `set_character({ name: '甲', personality: '旧' })`
2. `set_character({ name: '甲', clear_fields: ['personality'] })` → assert personality='',其他字段不变
3. `set_character({ name: '乙', appearance: '…' })` + 触发变更(若 smoke 不便造 changes,跳过 cascade 路径)
4. `delete_character('乙', cascade=false)` → ok(deletedChanges: 0)
5. `clear_characters()` → 全清,assert 表空

## 9. 实现顺序建议(给 plan 用)

1. `CharacterService` 加方法:`deleteCharacter` / `clearCharacters` / `upsertCharacter` 扩 clear_fields 处理
2. 改 `set-character.tool.ts` schema 加 `clear_fields` + 注释
3. 2 个新 tool factory:`delete-character.tool.ts` / `clear-characters.tool.ts`
4. `agent-registry.ts` 注册 2 个新 tool
5. `agent-tree.config.ts`:char-writer 的 `tools` 数组加 2 个 key
6. 3 处 prompt `.md` 编辑(char-writer / character-orchestrator / main)
7. 单测 + L1 smoke
8. 手动 E2E:chat「删掉角色 XX」「把 XX 的外貌清空」「重建角色体系」验证 agent 流程

## 10. 风险

- **`delete_character(cascade=true)` 误删变迁史**:agent 可能未问作者就传 cascade=true。缓解:CHAR_WRITER prompt 明确「删角色前问作者 cascade 意愿」;`cascade=false` 是默认。
- **`clear_characters` 误清**:核武级操作,一旦清空 writer/validator 立即失去依据。缓解:ACTIVE 软护栏 + prompt 明确「只在作者明确要求重建时调用」;char-critic 可补一条「角色 bible 为空」的 dim 检查(本期不做,Phase 21 后续可加)。
- **Event 角色名 dangling**:`Event.involvedCharacters` 是字符串数组,删角色后这些名字无 canonical 解析。缓解:接受 dangling(Event 是事实点,「这章出现了 X」的事实不因 X 被删而失效);writer 若用到该名,`get_character` 返 null 自然会提示角色不存在。
- **`clear_fields` typo 静默丢数据**:模型可能传错字段名。缓解:不在白名单 → throw(服务层硬校验,见 §3.3)。
- **改 null 语义的诱惑**:未来有人想「统一 null = clear」,会触发本设计 §5.4 的炮筒。缓解:本 spec 显式记录历史背景;`clear_fields` 是长期方案。

## 11. 与大纲套件的对称性总结

| 操作 | 大纲(2026-07-09) | 角色(本期) |
|---|---|---|
| Patch field | `patch_chapter_plan`(显式 patch 工具) | **`set_character` merge 已覆盖**(隐式 patch,功能等价) |
| Delete single | `delete_chapter_plan` | `delete_character` |
| Delete container | `delete_volume` / `delete_arc` | `clear_characters`(唯一容器=全书) |
| Clear all | `clear_master_outline` | `clear_characters` |
| Clear field | patch with ""(patch 工具自带) | `set_character(clear_fields=[...])`(因 null 语义不能改) |
| Cascade 选项 | `delete_volume(cascade?)` | `delete_character(cascade?)` |
| ACTIVE 软护栏 | `clear_master_outline` warn | `clear_characters` warn |
| FE 改动 | 零 | 零 |
| DB 迁移 | 零 | 零 |

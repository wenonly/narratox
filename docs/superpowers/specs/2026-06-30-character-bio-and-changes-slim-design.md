# 人物小传(growth/flaw)+ changes 瘦身(significance)— 设计

## 目标

两件事合成一期:
1. **角色创建时建「人物小传」**(按文章三大支柱:出身/社会/心理;检验:来路/执念/挣扎/归宿),**按 role 分复杂度**(主角/反派深,配角精简)。
2. **CharacterChange 瘦身**:现在 settler 每章每角色都记(`appearance=appeared` 噪音 + 瞬时 emotion),长篇 token 爆炸。回归用户初衷——**只记重大性格/人格蜕变**,「发生了什么」交给 Event(Phase 11)。

## 统一三层模型(两需求合一)

| 层 | 内容 | 存储 | 写入 | token |
|---|---|---|---|---|
| ① 小传(稳定身份) | 来路/执念/挣扎/归宿,不随章变 | `Character` 字段(+growth/flaw) | character-writer 建一次 | 固定 |
| ② 重大蜕变(稀疏) | 性格/能力/地位/关系的实质转变 | `CharacterChange`(+significance) | settler 只记实质 | 稀疏、分级 |
| ③ 事件(发生了啥) | 这章谁出场/做了啥/情绪 | `Event`(Phase 11,已有 MAJOR/MINOR) | settler 已在记 | 已分级 |

现状把 ②③ 混进 changes。拆开后信噪比更高,不牺牲效果——丢的只是冗余(appearance=appeared,与 Event.involvedCharacters 重复)和瞬时波动(emotion)。

## 诊断:token 爆炸三源头

1. **`appearance=appeared` 噪音**:settler 规定「每个出场角色至少记一条 appeared」→ 主角 100 章 = 100 条零信息记录,且与 `Event.involvedCharacters` 完全重复。
2. **瞬时 emotion 记进 changes**:emotion 作「当前态」语义可疑(每章变);该归 Event。
3. **FE `listCharacters` 无封顶**:[character.service.ts](../../../server/src/novel/character.service.ts) `include:{changes}` 无 take → 面板随章节线性膨胀。

## 方案 A:人物小传(growth/flaw + 按 role 分层)

文章「来路/执念/挣扎/归宿」映射:

| 文章 | 字段 |
|---|---|
| 来路(出身+成长) | `background`(出身)+ **`growth`(新:成长经历,塑造性格的重大事件——文章说这是防 OOC 最重要的一项)** |
| 执念 | `motivation` |
| 挣扎 | **`flaw`(新:弱点/执念阴暗面,挣扎与蜕变之源;与 motivation 想要啥 区分)** |
| 归宿 | `arcGoal` |

**按 role 分复杂度**(提示词层,不加 importance 字段——复用现有 PROTAGONIST/ANTAGONIST/SUPPORTING):
- **主角/反派**:小传全填深——出身 + 成长经历 + 社会阶层/地位 + 性格 + 动机 + 弱点 + 弧光 + 声音。
- **关键配角**:中等——身份 + 性格基调 + 动机 + 功能。
- **路人配角**:精简 essence——name/role/一句话功能。

## 方案 B:changes 瘦身(significance 分级)

**schema**:`CharacterChange + significance CharacterChangeSignificance @default(MINOR)` + 新 enum `CharacterChangeSignificance { MAJOR MINOR }`(照搬 EventSignificance 模式)。

**settler 记录规则改写**:
- **停止记 `appearance=appeared`**(纯噪音,Event 已覆盖出场)。真实外貌变化(受伤留疤等)按 significance 记。
- **只记实质、持久的转变**:personality/ability/status/relationship **真变了**才记;**瞬时 emotion 不记**(归 Event)。
- **判 significance**:MAJOR = 性格/弧光/能力/地位的**实质蜕变**(写后续章必须知道的);MINOR = 次要状态调整。reason 必填。

**getCharacter 注入策略**(确定性杠杆,不纯靠 LLM 自律):
- 返回 changes = **MAJOR 全量 + MINOR 最近 30 条**(合并按 chapterOrder desc),替代现在的 `take:50` 扁平。
- currentState 从该合并集派生(每 field 最新)。MAJOR 覆盖所有持久态字段 → currentState 正确。

**listCharacters(FE)**:`changes` 加 `take: 50`(对齐 getCharacter,面板不无限膨胀)。

## RoleChange 类型(significance 流两处)

`RoleChange`(write_summary 的 roleChanges 元素)加 `significance?: 'MAJOR'|'MINOR'`(默认 MINOR)。它同时流到:
1. `ChapterSummary.roleChanges` JSON(每章快照,带 significance 无害);
2. `CharacterChange` 行(时间线,significance 是重点)——`recordChanges` 写入 `significance ?? MINOR`。

## 改动清单

| 层 | 文件 | 改动 |
|---|---|---|
| schema | [schema.prisma](../../../server/prisma/schema.prisma) | Character +`growth`+`flaw`;CharacterChange +`significance`;新 enum `CharacterChangeSignificance`;一条 migration |
| service | [character.service.ts](../../../server/src/novel/character.service.ts) | upsertCharacter +growth/flaw;recordChanges 写 significance;getCharacter MAJOR全量+MINOR近30;listCharacters changes take:50 |
| 类型 | RoleChange(`chapter-summary.service.ts` 或共享) | +significance? |
| tool | [set-character.tool.ts](../../../server/src/agentos/tools/set-character.tool.ts) | +growth/flaw |
| tool | [write-summary.tool.ts](../../../server/src/agentos/tools/write-summary.tool.ts) | roleChanges 项 +significance |
| prompt | [settler.md](../../../server/src/agentos/prompts/settler.md) | 去 appeared、只记实质持久转变、判 significance、emotion 归 Event |
| prompt | [character-writer.md](../../../server/src/agentos/prompts/character-writer.md) | 三支柱小传 + 来路执念挣扎归宿 + 按 role 分层 + 填 growth/flaw |
| prompt | [character-critic.md](../../../server/src/agentos/prompts/character-critic.md) | 小传深度匹配 role + growth↔personality 一致性 |
| FE type | [types/novel.ts](../../../agent-ui/src/types/novel.ts) | Character +growth/flaw;CharacterChangeEntry +significance |
| FE 视图 | CharactersView(若渲染 growth/flaw/changes) | 渲染 growth/flaw;changes 显 significance badge |
| test | character.service.spec | growth/flaw upsert + getCharacter significance 过滤(MAJOR 全留、MINOR 截断) |

## 测试

1. character.service.spec:upsert 带 growth/flaw → get 回含;set_character 透传。
2. getCharacter significance 过滤:造 MAJOR(旧)+ MINOR(多)→ 返回含全部 MAJOR + 最近 30 MINOR;currentState 从合并集派生正确。
3. recordChanges:roleChanges 带 significance → CharacterChange.significance 写入(默认 MINOR)。
4. 现有 agent-prompts.spec 锁的子串不破(settler/character-writer/character-critic 增量编辑)。
5. `pnpm test` 全绿;typecheck 干净;build 过(手动 prisma generate)。

## 效果论证(不牺牲)

writer/validator 拿到「**他是谁(小传,含成长/弱点)+ 他怎么变的(MAJOR 蜕变全留 + 近期 MINOR)+ 当前态(派生)**」+ Event 兜底「这章发生了什么」。比现在的「小传 + 一堆 appeared 噪音 + 瞬时 emotion」**信息量更高**。丢的只是冗余与瞬时波动——growth/flaw 反而补上了防 OOC 最关键的两块(成长经历 + 弱点)。

## 不在本期范围

- 不加 `importance` 字段(按 role 提示词分层已够,避免与 role 语义重叠)。
- 不删 `emotion` field 的历史数据(只是 settler 不再主动记;DB 兼容)。
- 不做「成长经历」的结构化(家庭/教育/事件分项)——`growth` 用自由文本,文章框架进提示词。
- 不动 Event(它已是 MAJOR/MINOR 分级的范本,本期照搬其模式)。

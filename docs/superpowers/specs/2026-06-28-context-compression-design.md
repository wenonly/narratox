# 上下文压缩:角色/世界观/伏笔按需加载 设计

> 日期:2026-06-28 · 关联 [Phase 6 角色分层](./2026-06-27-character-context-and-panel-design.md)、[Phase 11 事件](./2026-06-27-event-management-design.md)

## 问题诊断

长篇上下文有 3 个 slice **无界线性增长**,写到几百章/百角色会 token 爆炸:

1. **【角色】**([character.service.ts:201 listForContext](../../../server/src/novel/character.service.ts)):`findMany` 无 take,全量角色;`buildCharacterSlice` 注入活跃全档案(~300-800 tok/人)+ 沉默名册(~30-80 tok/人)。沉默名册随总角色数永久涨。**200 角色 ≈ 5-10k tok/轮**。
2. **【世界观】**([context-assembler.service.ts:196](../../../server/src/agentos/context-assembler.service.ts)):`listCore` 无 take,每条 `content` 全文不截断。
3. **【未回收伏笔】**([story-event.service.ts:52 listOpen](../../../server/src/memory/story-event.service.ts)):无 take;ENDGAME 永不 stale。随未回收 hook 数涨。

**关键洞察**:这 3 个 slice 注入的是 **main 的** system prompt,但 main 是编排者——不写角色正文(writer 写,已用 `get_character` 拉)、不写设定(wb-writer 写,已用 `get_knowledge` 拉)。**全档案塞给 main 多数是浪费**;详情属于「写它的人」,而那些 agent 本来就按需拉。

## 目标

把 main 的 3 个 slice 压成**索引/简述**(定位用),详情一律按需 tool 拉。直击线性膨胀,且因「validator 复检兜底」(Phase 7 dim1)而**不损效果**。

## 设计原则:三层模型(已在库中部分成立)

| 层 | 职责 | 本期 |
|---|---|---|
| ① 索引/定位(main 常驻) | 知道「有谁/什么开放/什么设定在」 | **压成这层** |
| ② 按需拉详情(writer/subagent) | 写到某实体前 tool 拉全档案 | 工具齐备,加强别名解析 |
| ③ 审计兜底(validator) | 写完用全量 bible 复检一致性 → 修订 | Phase 7 已建,是效果保证 |

效果保证:就算 writer 忘拉写出 OOC,validator dim1 拿全量角色 bible 复检 → 驱动修订。所以激进压缩安全。

## 具体压缩

### 1.【角色】→ 名字(+role)索引
```
【角色】张三(主角)、李四(反派)、王五(配角)、…(共 87 个;写涉及某角色前 get_character(name) 读档案+当前态,get_characters 列查询)
```
- **`CharacterService.listIndex(userId, novelId)`**:lean 查询 `findMany({ select: { name, role }, orderBy:[{role},{name}] })`——不拉 profile/changes,极廉。
- 索引列 canonical 名(Character `@@unique([novelId,name])`,**无重复**)+ role tag(让 main 知道往哪个 agent 委派)。
- 超 N(默认 40)则截断 + 「另有 X 个」计数。
- **删除** 旧的 `listForContext` + `ContextCharacterActive/Dormant` 接口 + `ContextAssembler.buildCharacterSlice`(全档案注入的反模式,被索引取代)。

### 2.【世界观】→ 每条简述
```
【世界观】力量体系:炼气→筑基→金丹…(简述) / 总览:九州修仙界… / (get_world_entry(name) 查全文)
```
- 每条 `content` 截断到 **80 字**简述,name 保留(WorldEntry `@@unique([novelId,name])`,无歧义)。
- inline 截断(ContextAssembler 内),`listCore` 签名不变。

### 3.【未回收伏笔】→ 核心★+近期+计数
```
【未回收伏笔】核心★:身世、灭门真相 · 进行中(近):A、B、C · 另有 X 个开放(⚠️Y 陈久),get_events 查询
```
- 核心★ 全留(必追的承诺);非核心 active 按 `lastAdvancedAt` 取 **top 5**;stale 与其余 → 计数 stub。
- `listOpen` 查询不变(DB 行廉价,token 成本在格式化串,封顶格式化即够)。

### 4. `get_character` 别名感知(压缩的前置)
正文叫的常是别名(「老张」),canonical 是「张三」;甚至别名跨角色撞名。压缩后 writer 更依赖拉取,解析缺口必须补:
- `CharacterService.getCharacter` 改:`findFirst({ where: { novelId, novel:{userId}, OR: [{ name }, { aliases: { has: name } }] } })`。
- 正文叫啥都能解析到 canonical。返回值带 canonical 名,让 agent 知道实际命中的是谁(撞名时取 canonical 匹配优先)。

## 改动面

| 文件 | 改动 |
|---|---|
| `server/src/novel/character.service.ts` | +`listIndex`;`getCharacter` 别名感知;删 `listForContext` + `ContextCharacter*` 接口 |
| `server/src/agentos/context-assembler.service.ts` | 3 slice 重写(角色索引/世界观简述/伏笔封顶);删 `buildCharacterSlice`;改用 `listIndex`;import 清理 |
| `server/src/novel/character.service.spec.ts` | `listForContext` 用例 → `listIndex` 用例;加 `getCharacter` 别名解析用例 |
| `server/src/agentos/context-assembler.service.spec.ts` | 角色切片断言更新(索引而非全档案) |

**不动**:writer/validator prompt(它们本就 tool 拉,不受 main slice 压缩影响);DB(零迁移);FE;subagent。

## 显式不做(non-goals)

- **不压缩已封顶 slice**(总纲/态势/弧线/前情/近期事件)——每 token 价值高,再压得不偿失。
- **不做向量检索/相关性 top-K**(千章级终局方案,defer)。
- **不动线程 tool-I/O 堆积**(summarization 配置/trimming 单独立项,P3)。
- **不删 `get_characters` 工具**(索引 + 工具双保留)。

## 测试

- `character.service.spec`:删 `listForContext` 3 用例,加 `listIndex`(返回 name+role、lean)、`getCharacter` 别名解析(传别名→命中 canonical、canonical 直传仍工作、撞名时 canonical 优先)。
- `context-assembler.service.spec`:角色 slice 断言改为「索引含 name(role)、含 tool 指引、超 N 截断」。
- 回归:`pnpm test` + `typecheck`。

## 验证未覆盖

- 压缩后 writer 是否真「拉再写」依赖模型——validator 兜底是保证,但 live E2E 是唯一实证(写一章看是否调 get_character、validator 是否复检)。
- 别名解析在别名撞名时的命中优先级(canonical > alias)——单测覆盖,真实撞名场景罕见。

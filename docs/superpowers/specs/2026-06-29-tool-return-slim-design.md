# 工具返回瘦身:get_characters lean + get_outline 未写计划 + 参考按需提示

> 日期:2026-06-29 · 关联 [Phase 19 上下文压缩](./2026-06-28-context-compression-design.md)

## 问题诊断

Phase 19 压了 main 的主动注入 slice;但 **pull-time(工具返回)还有两个「一调就爆」的全量反模式**,以及参考资料的过度查询:

1. **`get_characters`**([tool:18-30](../../../server/src/agentos/tools/get-characters.tool.ts#L18)):返回**全部**角色**全档案**(11 字段),无封顶。writer/validator 一调,200 角色全档案涌入——和 Phase 19 压掉的 slice 是同一反模式,只是换到工具层。
2. **`get_outline`**([tool](../../../server/src/agentos/tools/get-outline.tool.ts)):`chapters` = **全部**章细纲标题/状态,随章数线性(500 章 = 500 行)。但已写章是历史(【前情】/事件/`get_chapter` 覆盖),get_outline 列已写章目是重复。
3. **参考资料**:精要+索引注入已支持按需 `get_reference`,但缺「别盲查」的提示,agent 可能过度查询。

## 目标

把工具返回也纳入「索引/简述 + 按需详情」范式,与 Phase 19 一致;**不影响剧情走向理解、不遗漏**。

## 设计

### 1. `get_characters` → lean(索引里没有的 = 当前态)

main 已有 `name+role` 索引。`get_characters` 该补的是**索引没有、且一致性检查要用的 = currentState(易漂移)**:

```ts
characters: list.slice(0, 30).map((c) => ({
  name, role, aliases, currentState,
})),
// + (共 N 个,超 30 用 role 过滤;稳定档案 get_character(name) 单查)
```

- 稳定档案(appearance/personality/motivation/arcGoal/voice/faction/background)只走 `get_character(name)`(已存在,返回全)。
- 封顶 30:大卡司用 `role` 过滤;char-critic 评审时按需 `get_character` 拉它要审的几个(一次性建置,可接受)。
- **不动 `listCharacters`**(FE REST `GET /characters` 仍返全量渲染面板)——只改工具 shaping。

### 2. `get_outline` → 未写计划(to-do)+ 已写计数

`chapters` 改为只返回**未写计划**(status ∈ DRAFT/APPROVED)+ `writtenCount`(WRITTEN 数)。master/volumes/arcs/nextChapterOrder 不变。

```ts
chapters: chapterOutlines
  .filter((c) => c.status !== 'WRITTEN')   // 未写 = upcoming 方向
  .map((c) => ({ chapterOrder, title, status })),
writtenCount: chapterOutlines.filter((c) => c.status === 'WRITTEN').length,
```

**为什么不损效果**:
- **走向完整**:卷 + 弧 + 「接下来 N 章未写计划」= 完整 upcoming 方向,不漏。
- **已写不列**:历史靠【前情】(last 5 摘要)/【近期事件】/`get_chapter(N)`,get_outline 不重复。
- **天然有界**:未写计划受 outliner 规划批量约束(~20-30 章),500 章书也只返那 20-30 条 to-do。
- **边界**:全写完 → to-do=[] + writtenCount=N → agent 知「该补细纲」。
- **FE 不受影响**:FE 走 REST `listOutline`(全量)渲染面板,本工具 shaping 独立。

### 3. 参考资料按需提示(slice 脚注)

`buildReferenceSlice`([reference-slice.ts](../../../server/src/agentos/reference-slice.ts))返回末尾加一行,让所有拿到精要的 agent 知道**别盲查**:

```
（仅当写到上述【按需索引】明确指向的场景,才 get_reference(title) 拉那条;否则勿查）
```

精要本身已是打磨过的上下文,索引只指「需要时去哪拉」。**不封顶**(参考资料是一次性 curator 产出,慢增长),靠提示词约束查询纪律。

## 改动面

| 文件 | 改动 |
|---|---|
| `server/src/agentos/tools/get-characters.tool.ts` | map 改 lean(name/role/aliases/currentState)+ slice 30 + 超量提示 |
| `server/src/agentos/tools/get-outline.tool.ts` | chapters 改未写计划 + writtenCount |
| `server/src/agentos/reference-slice.ts` | 末尾加「按需、勿盲查」脚注 |
| `server/src/agentos/tools/get-outline.tool.spec.ts` | 断言更新(未写过滤 + writtenCount) |
| `server/src/agentos/reference-slice.spec.ts` | 断言含脚注 |
| `server/src/agentos/tools/get-characters.tool.spec.ts` | **新增**:lean shape + 封顶 |

**不动**:listCharacters / listOutline 服务端(FE 全量);DB;FE;子 agent prompt。

## 显式不做

- **不封顶参考资料索引**(慢增长,靠提示词约束)。
- **不动 `get_character`(单查)** 已返全档案,是详情入口。
- **不加 get_outline 分页**(未写计划天然有界,无需)。
- **不动线程 tool-I/O 堆积**(P3,deferred)。

## 测试

- `get-characters.tool.spec`(新):lean shape(只 4 字段)、slice 30 截断。
- `get-outline.tool.spec`(改):WRITTEN 章不进 chapters;writtenCount 正确;未写章进 chapters。
- `reference-slice.spec`(改):slice 含按需脚注。
- 回归:`pnpm test` + `typecheck`。

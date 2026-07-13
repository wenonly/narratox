# Worldbuilder 任务路由 + 减法工具补齐

- **日期**:2026-07-13
- **状态**:已通过 brainstorming,待写实现 plan
- **相关 Phase**:延续 Phase 2(世界观资源)/ Phase 19(上下文压缩:世界观条目 content 截 80 字简述);以及 2026-07-13 outliner / character 任务路由(模板源)
- **关联文件**:`server/src/agentos/tools/delete-world-entry.tool.ts`(新)、`server/src/agentos/tools/clear-worldview.tool.ts`(新)、`server/src/novel/world-entry.service.ts`、`server/src/agentos/agent-registry.ts`、`server/src/agentos/agent-tree.config.ts`、`server/src/agentos/prompts/worldbuilder-*.md`、`server/src/agentos/agent-prompts.spec.ts`

## 1. 背景

2026-07-13 outliner / character 任务路由 spec 立了「子 orchestrator 自判 4 类路线」模板(创建/改写/微调/删除;微调+删除跳 critic)。本期把模板应用到 `worldbuilder`。

**调查发现的根本缺口**:**worldbuilder 完全没有减法工具**——工具列表只有 `set_world_entry`(upsert)、`get_world_entry`/`get_worldview`(只读)、`report_worldview_review`,**没有 `delete_world_entry`、没有 `clear_worldview`、没有 `patch_world_entry`**。

这意味着:
- 用户没法让 agent 删某条 world_entry(agent 没工具)
- 用户没法让 agent 清空世界观重来
- 「删后自作多情重建」这个症状在 worldbuilder 这里目前**根本无法发生**——但这是因为缺能力,不是因为控制好

本期要做两件事:
1. **补齐减法工具**(对标 character 的 `delete_character` / `clear_characters`),让 worldbuilder 具备减法能力
2. **套用 4 类路由模板**,确保减法能力一加上去,就有「删完即停、不评 critic、禁止顺手补全」的纪律兜底,不会重蹈 outliner 当初的覆辙

**为什么补工具 + 套模板必须一起做**:如果只补工具不套路由,加上的删除工具立刻就会触发「critic 看到空世界观→触发 wb-writer 重写」的 outliner 老问题。必须同步。

## 2. 决策(已对齐)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 模板复用 | **沿用 outliner / character 的 4 类路由** | 创建/改写 → 完整流程;微调/删除 → 跳 critic 直接返回 |
| 减法工具 | **加 2 个**:`delete_world_entry`(单条)+ `clear_worldview`(全清) | 对标 character 的 `delete_character` / `clear_characters` |
| `delete_world_entry` 是否要 cascade | **不要** | WorldEntry 是孤立条目,无 FK 关联(CharacterChange 之类),没有 cascade 语义 |
| `clear_worldview` 是否 ACTIVE warning | **要**(软提醒,不拦) | 对标 `clear_characters` / `clear_master_outline`;世界观是 writer/validator 写作依据,删了会失锚——但硬拦会让合法「重建世界观」走不通 |
| patch_world_entry 工具 | **不加** | YAGNI;`set_world_entry` 部分字段覆盖(全字段 upsert)已能做字段级操作。character 也没加 patch_character |
| 微调 vs 改写边界 | **靠「条目数 + 字段范围」语义判** | 单条字段改 = 微调,多条重写或推翻力量体系 = 改写 |
| DB 改动 | **零** | WorldEntry 表已存在;只加 service 方法 + 工具 |
| FE 改动 | **零** | 沿用「FE 只读,agent 是唯一作者」 |

## 3. 设计

### 3.1 工具层:新增 2 个工具

#### `delete_world_entry`(单条删除,by name)

参考 `delete-character.tool.ts`(无 cascade 简化版):

```ts
// server/src/agentos/tools/delete-world-entry.tool.ts
export function makeDeleteWorldEntryTool({
  userId, novelId, world,
}: {
  userId: string;
  novelId: string;
  world: WorldEntryService;
}) {
  return tool(
    async ({ name }) => world.deleteEntry(userId, novelId, name),
    {
      name: 'delete_world_entry',
      description:
        '删单条世界观条目(by name)。条目不存在返 404。无关联数据(WorldEntry 是孤立条目),无需 cascade。需要重建某条 = 直接 set_world_entry 覆盖,不必先删。',
      schema: z.object({
        name: z.string().describe('条目名(如「玄天宗」「灵气修炼」)'),
      }),
    },
  );
}
```

**不存在时**:抛 `NotFoundException`(对标 character 的 cascade 拒绝清单模式,但 worldbuilder 没有关联,简化为 404)。

#### `clear_worldview`(清空全书世界观)

参考 `clear-characters.tool.ts`:

```ts
// server/src/agentos/tools/clear-worldview.tool.ts
export function makeClearWorldviewTool({
  userId, novelId, world,
}: {
  userId: string;
  novelId: string;
  world: WorldEntryService;
}) {
  return tool(
    async () => world.clearAll(userId, novelId),
    {
      name: 'clear_worldview',
      description:
        '清空全书世界观(全部 WorldEntry,$transaction 原子)。ACTIVE 小说返 warning(worldview 是 writer/validator 的写作依据),但不拦。仅在作者明确要求「重建世界观」时调用。不是「重写某条」的快捷方式(那是 set_world_entry 覆盖)。',
      schema: z.object({}),
    },
  );
}
```

### 3.2 WorldEntryService 加 2 个方法

在 `server/src/novel/world-entry.service.ts` 加:

```ts
/** 删单条(by name,user-scoped)。不存在抛 404。 */
async deleteEntry(userId: string, novelId: string, name: string) {
  await this.assertOwned(userId, novelId);
  const existing = await this.prisma.worldEntry.findFirst({
    where: { novelId, name, novel: { userId } },
  });
  if (!existing) throw new NotFoundException(`WorldEntry "${name}" not found`);
  return this.prisma.worldEntry.delete({ where: { id: existing.id } });
}

/** 清空全书世界观。返回 { count, warned }。ACTIVE 返 warning(不拦)。 */
async clearAll(userId: string, novelId: string) {
  await this.assertOwned(userId, novelId);
  const novel = await this.prisma.novel.findFirst({
    where: { id: novelId, userId },
    select: { status: true },
  });
  const count = await this.prisma.worldEntry.count({
    where: { novelId, novel: { userId } },
  });
  await this.prisma.worldEntry.deleteMany({
    where: { novelId, novel: { userId } },
  });
  return {
    count,
    warned: novel?.status === 'ACTIVE' ? 'ACTIVE' : null,
  };
}
```

### 3.3 工具注册 + agent 工具清单

**`agent-registry.ts`**:
- 顶部 import 2 个新工厂
- 注册 `delete_world_entry` / `clear_worldview` 到 `TOOL_REGISTRY`(走 `world: WorldEntryService`)

**`agent-tree.config.ts`**:`wb-writer` 的 `tools` 数组加 2 项:

```ts
tools: [
  'list_knowledge',
  'get_knowledge',
  'set_world_entry',
  'get_worldview',
  'get_world_entry',
  'get_novel_info',
  'delete_world_entry',  // 新
  'clear_worldview',     // 新
],
```

**wb-critic 不加**(critic 只读 + 评审,不删)。

### 3.4 worldbuilder-orchestrator.md 改动

**新增段落【任务路由】**(放在【建世界观流程】之前):

```markdown
【任务路由】接到 task 后,先按语义判断类型,选对应路线:

- 创建类(新建/丰富/补世界观条目) → 走【建世界观流程】完整四步
- 改写类(推翻重写力量体系 / 全套规则,set_world_entry 多条覆盖) → 走【建世界观流程】完整四步
- 微调类(改某条目字段/补一项/修个规则)→ 【直接结束】
- 删除类(删某条 world_entry/清空全书世界观)→ 【直接结束】

铁律:
- 微调/删除类任务,wb-writer 返回后【可以直接结束】,不调 wb-critic
- task 消息里出现「只改」「只删」「不要重建」「不要顺手补」等限定词,强制走简化路线(微调/删除)
- 路由判断模糊时(既像改写又像微调),按「条目数 + 字段范围」判:多条重写或推翻核心条目(concept/powerSystem)= 改写,单条字段改 = 微调
```

**改【铁律】第一条**(line 23):

- 原:`- wb-writer 返回后【绝对不能结束】——必须继续 wb-critic。没评审的世界观不算完成。`
- 改为:`- **创建/改写类任务**:wb-writer 返回后【绝对不能结束】——必须继续 wb-critic。没评审的世界观不算完成。**微调/删除类任务**:wb-writer 返回后【直接结束】,不调 wb-critic(详见【任务路由】)。`

### 3.5 worldbuilder-writer.md 改动

**新增段落【删除/清空 — 用法纪律】**(放在【修订模式】之后、【铁律】之前):

```markdown
【删除/清空 — 用法纪律】你拥有 `delete_world_entry` / `clear_worldview` 工具。这些是危险操作,严格守纪律:

- **删前确认条目存在**:delete_world_entry(by name)对不存在条目返 404。改前可 get_world_entry(name) 看当前内容再决定。
- **重建某条 = 直接 set_world_entry 覆盖,不必先删**:set_world_entry 是 upsert,改名/改类型/改内容都走它,不需要 delete+set 两步。
- **clear_worldview 是核武**:仅在作者明确要求「重建世界观体系」时调用。不是「重写某条」的快捷方式(那是 set_world_entry 覆盖)。ACTIVE 小说会返 warning——看到了不要慌,这是软提醒,你已经在删前问过作者就 OK。
- **减法任务完成后,禁止顺手调用 set_world_entry 补全**:除非 task 明确要求「重建/重生/补一份新的」,否则删完/clear 完/部分字段改完就是终态,直接返回结论。严禁看到「世界观空了」「某条目空了」就自动重建或重填——这是越权(用户没说建就别建)。
```

### 3.6 main.md 不动

沿用前两期决策:main 该怎么委派还怎么委派,orchestrator 自己负责判断 task 类型。

## 4. 测试

### 4.1 工具单测

**`delete-world-entry.tool.spec.ts`**(新):
- 正常删:existing entry → deleteEntry 返回 deleted row;DB 里查不到
- 不存在:`deleteEntry('不存在')` 抛 `NotFoundException`
- 跨用户隔离:userA 的 entry,userB 调 deleteEntry → 404(不偷删)
- 跨小说隔离:novelA 的 entry,用 novelB 调 deleteEntry → 404

**`clear-worldview.tool.spec.ts`**(新):
- CONCEPT 小说:clearAll 返回 `{ count: N, warned: null }`;DB 里 WorldEntry 全删
- ACTIVE 小说:clearAll 返回 `{ count: N, warned: 'ACTIVE' }`(不拦);DB 里 WorldEntry 全删
- 跨用户隔离:userA 的 entry,userB 调 clearAll → count=0,不偷删 userA 的

参考现有 `delete-character.tool.spec.ts` / `clear-characters.tool.spec.ts` 的测试结构。

### 4.2 L0 prompt substring 锁

在 `agent-prompts.spec.ts` 加:

```ts
it('worldbuilder-orchestrator 含 4 类路由表与简化路线铁律', () => {
  expect(WORLDBUILDER_ORCHESTRATOR_PROMPT).toContain('【任务路由】');
  expect(WORLDBUILDER_ORCHESTRATOR_PROMPT).toContain('微调/删除类任务');
  expect(WORLDBUILDER_ORCHESTRATOR_PROMPT).toContain('不调 wb-critic');
});

it('worldbuilder-writer 含减法任务禁止补全纪律 + 删除工具', () => {
  expect(WORLDBUILDER_WRITER_PROMPT).toContain('减法任务完成后');
  expect(WORLDBUILDER_WRITER_PROMPT).toContain('禁止顺手调用');
  expect(WORLDBUILDER_WRITER_PROMPT).toContain('delete_world_entry');
  expect(WORLDBUILDER_WRITER_PROMPT).toContain('clear_worldview');
});
```

**保留**原 `SUBSTRINGS` 表里的特征子串(`WORLDBUILDER_ORCHESTRATOR_PROMPT: '取KB→建条目→评审'` 和 `WORLDBUILDER_WRITER_PROMPT: '遵循 KB 五字诀'`),改后 prompt 里这两句仍在。

### 4.3 L1 集成

不加(沿用前两期决策)。

## 5. 后续 follow-up

- **chapter-orchestrator**:本系列最后一个,最复杂(clear_chapter + writer→settler→validator 三层)。下一期 spec
- **curator**:单 agent 无 critic 环节,已排除

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM 路由误判(把改写判成微调,跳 critic) | task 限定词兜底;L0 测试锁定 prompt 含路由表 |
| worldbuilder 无 patch 工具,微调/改写边界模糊 | prompt 明示「条目数 + 字段范围」判据;不加 patch 工具(YAGNI) |
| clear_worldview 后 wb-writer 自动重建 | writer 加「减法任务完成后禁止顺手补全」纪律(本期核心) |
| 用户说「删」其实想「删重建」 | writer 加「clear_worldview 仅在作者明确要求重建时调用」纪律 |
| 新工具跨用户/跨小说隔离漏洞 | 工具单测锁定「跨用户/跨小说 404」+ service `assertOwned` |

## 7. 不在范围(明确排除)

- `patch_world_entry` 工具:不加(YAGNI;`set_world_entry` 全字段 upsert 替代)
- chapter orchestrator 路由改造:下一期 spec
- worldbuilder-critic.md 改动:不动
- main.md 改动:不动
- DB / FE 改动:零
- L2 live scenario 测试:本期不跑

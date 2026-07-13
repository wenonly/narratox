# Character 任务路由(4 类完整化)

- **日期**:2026-07-13
- **状态**:已通过 brainstorming,待写实现 plan
- **相关 Phase**:延续 Phase 5(角色 agent)/ Phase 6(角色上下文注入)/ Phase 21(小传 + changes 瘦身);以及 2026-07-13 outliner 任务路由(模板源)
- **关联文件**:`server/src/agentos/prompts/character-orchestrator.md`、`server/src/agentos/prompts/character-writer.md`、`server/src/agentos/agent-prompts.spec.ts`

## 1. 背景

2026-07-13 outliner 任务路由 spec(`docs/superpowers/specs/2026-07-13-outliner-task-routing-design.md`)立了「子 orchestrator 自判 4 类路线」的模板(创建/改写/微调/删除;微调+删除跳 critic)。本期把模板应用到 `character-orchestrator`,作为 follow-up 的第一个扩展。

**character 现状比 outliner 当初健康**:已有【删/清角色流程】段落(line 22-26)明说「删/清完不需要 critic 评审,直接回主 agent 一句结论」——这是已经手工做了一半的路由。但仍有三个缺口:

1. **没有显式的 4 类路由段落**:创建和删除分流了,但「改写」和「微调」没有显式分类。当前【建角色档案流程】对所有「建/改」任务一视同仁跑完整 writer→critic→revision→re-eval。
2. **【铁律】第一条自相矛盾**:line 29「char-writer 返回后【绝对不能结束】——必须继续 char-critic」没有为删除/微调开例外,和下面的【删/清角色流程】直接冲突——LLM 读到这条铁律可能误判「删完也得评 critic」。
3. **character-writer 缺「减法任务禁止顺手补全」纪律**:已有「修订模式只改被点名的」和「clear_characters 是核武」纪律,但没有显式禁止「删/清完后看到角色空了自动重建」——同 outliner 的盲点。

**用户痛点(借鉴 outliner 场景)**:让 agent 删某角色或清空角色库时,char-writer 可能「顺手」重建一份。虽然 character 的删/清段落已经存在,但因为没有「禁止顺手补全」的显式纪律,且【铁律】自相矛盾,这个风险仍然存在。

## 2. 决策(已对齐)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 模板复用 | **沿用 outliner 4 类路由** | 创建/改写 → 完整流程;微调/删除 → 跳 critic 直接返回 |
| 微调 vs 改写边界 | **靠「字段范围」语义判**(无 patch 工具) | character 没有 patch_character;`set_character` 部分字段 = 微调,全档案重写 = 改写。语义判靠 LLM,但加「只改 X」限定词兜底 |
| patch_character 工具 | **不加** | YAGNI;`set_character` + `clear_fields` 已能做字段级操作。加 patch 工具会与 set_character 职责重叠 |
| critic 要不要动 | **不动** | critic 自身没问题;orchestrator 决定要不要调它 |
| clear_fields 优先级提示 | **保留 writer 现有纪律**(已有 line 39) | 不重复 |

## 3. 设计

### 3.1 4 类路线对 character 的映射

| 类型 | 触发语义 | 执行路线 | character 对应 |
|---|---|---|---|
| **创建** | 新建/丰富/补角色档案(主角/反派/配角) | writer → critic → (若 passed=false) revision → critic re-eval | 【建角色档案流程】 |
| **改写** | 推翻重写某角色(set_character 全字段覆盖) | writer → critic → (若 passed=false) revision → critic re-eval | 同【建角色档案流程】 |
| **微调** | 改某角色单字段(`set_character` 部分字段)/清空某字段(`clear_fields`)/补一项 | writer(部分 set_character) → **直接返回** | **新路线**(从【建】流程分出来,跳 critic) |
| **删除** | 删某角色 / 清空全书角色 | writer(只删) → **直接返回** | 【删/清角色流程】(已有) |

**关键差异**:
- 创建/改写:走 critic(因为有完整档案「成品」要评)
- 微调:**跳 critic**(单字段改动没有「成品」要评,critic 6+1 维审计对单字段 patch 是浪费)
- 删除:**跳 critic**(已有纪律)

### 3.2 character-orchestrator.md 改动

**新增段落【任务路由】**(放在【建角色档案流程】之前,作为「流程选择器」):

```markdown
【任务路由】接到 task 后,先按语义判断类型,选对应路线:

- 创建类(新建/丰富/补角色档案) → 走【建角色档案流程】完整四步
- 改写类(推翻重写某角色档案,set_character 全字段覆盖) → 走【建角色档案流程】完整四步
- 微调类(改某角色单字段/补一项/clear_fields 清空某字段)→ 【直接结束】
- 删除类(删某角色/清空全书角色)→ 【直接结束】(详见【删/清角色流程】)

铁律:
- 微调/删除类任务,char-writer 返回后【可以直接结束】,不调 char-critic
- task 消息里出现「只改」「只删」「不要重建」「不要顺手补」等限定词,强制走简化路线(微调/删除)
- 路由判断模糊时(既像改写又像微调),按「字段范围」判:整份档案重写(背景+性格+弧光多个字段都动)= 改写,只动单字段 = 微调
```

**改【铁律】第一条**(line 29):

- 原:`- char-writer 返回后【绝对不能结束】——必须继续 char-critic。没评审的角色档案不算完成。`
- 改为:`- **创建/改写类任务**:char-writer 返回后【绝对不能结束】——必须继续 char-critic。没评审的角色档案不算完成。**微调/删除类任务**:char-writer 返回后【直接结束】,不调 char-critic(详见【任务路由】)。`

**不删【删/清角色流程】段落**——它仍然详细描述了 cascade 询问 / clear_characters 核武警告等纪律,和【任务路由】是「具体流程 vs 路由选择」的关系,互补。

### 3.3 character-writer.md 改动

在【删除/清空 — 用法纪律】段落末尾(line 40 之后)加一条新纪律:

```markdown
- **减法任务完成后,禁止顺手调用 set_character 补全**:除非 task 明确要求「重建/重生/补一份新的」,否则删完/clear_fields 清完/部分字段改完就是终态,直接返回结论。严禁看到「角色库空了」「某字段空了」就自动重建或重填——这是越权(用户没说建就别建)。
```

### 3.4 character-critic.md 不动

critic 自身没问题(6+1 维审计是正确的)。问题在 orchestrator 错误地对所有任务都调 critic。

### 3.5 main.md 不动

沿用 outliner 路由 spec 的决策:main 该怎么委派还怎么委派,orchestrator 自己负责判断 task 类型。

## 4. 测试

### 4.1 L0 单元(prompt substring 锁)

在 `server/src/agentos/agent-prompts.spec.ts` 新增独立测试(沿用 outliner spec 的模式):

```ts
it('character-orchestrator 含 4 类路由表与简化路线铁律', () => {
  expect(CHARACTER_ORCHESTRATOR_PROMPT).toContain('【任务路由】');
  expect(CHARACTER_ORCHESTRATOR_PROMPT).toContain('微调/删除类任务');
  expect(CHARACTER_ORCHESTRATOR_PROMPT).toContain('不调 char-critic');
});

it('character-writer 含减法任务禁止补全纪律', () => {
  expect(CHARACTER_WRITER_PROMPT).toContain('减法任务完成后');
  expect(CHARACTER_WRITER_PROMPT).toContain('禁止顺手调用');
});
```

**保留**原 `SUBSTRINGS` 表里的特征子串(`CHARACTER_ORCHESTRATOR_PROMPT: '取KB→建档案→评审'` 和 `CHARACTER_WRITER_PROMPT: '弧光目标 arcGoal'`),这两句在改后 prompt 里依然存在(【建角色档案流程】段落和【第二步】段落都未删)。

### 4.2 L1 / L2

不加(沿用 outliner 决策:L1 测数据管道不测 agent graph 行为;L2 live scenario 后续统一考虑)。

## 5. 后续 follow-up

- **chapter-orchestrator**:clear_chapter 是同类问题(clear 后不应自动重写)。最复杂(writer→settler→validator 三层,settler 还有提取/压缩任务)。下一期 spec
- **worldbuilder**:删 world_entry 后不应自动重建。结构简明(wb-writer→wb-critic)
- **curator**:单 agent 无 critic 环节,不需要路由(已排除)

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM 把「改写」判成「微调」跳过 critic | task 限定词兜底;L0 测试锁定 prompt 含路由表 |
| character 无 patch 工具,微调/改写边界模糊 | prompt 明示「字段范围」判据;不加 patch 工具(YAGNI) |
| 【删/清角色流程】与【任务路由】内容部分重叠 | 不冲突:前者是「具体流程」,后者是「路由选择」。保留两者 |
| 用户说「删」其实想「删重建」 | writer 已有「问作者 cascade」纪律;orchestrator 路由表里明说「除非 task 明确要求重建」 |

## 7. 不在范围(明确排除)

- 新工具(patch_character):不加
- chapter / worldbuilder orchestrator 的路由改造:后续 spec
- character-critic.md 改动:不动
- main.md 改动:不动
- DB / FE 改动:零
- L2 live scenario 测试:本期不跑

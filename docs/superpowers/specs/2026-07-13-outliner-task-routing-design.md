# Outliner 任务路由(子 agent 自判路线)

- **日期**:2026-07-13
- **状态**:已通过 brainstorming,待写实现 plan
- **相关 Phase**:延续 Phase 10(细纲 rewrite feedback)/ Phase 16(交互式编排)/ 2026-07-09 大纲细粒度编辑
- **关联文件**:`server/src/agentos/prompts/outliner-orchestrator.md`、`server/src/agentos/prompts/outline-writer.md`、`server/src/agentos/agent-prompts.spec.ts`

## 1. 背景

用户反馈:**让 agent 删大纲时,它不光删,还会自作主张重新生成一份新大纲填回去**。这是「主 agent 给子 agent 转述命令后,行为不可控」的一个具体症状。

排查后,直接根因在 **`outliner-orchestrator.md`**:

- line 28-33 【铁律】:「outline-writer 返回后**绝对不能结束**——必须继续 outline-critic。没评审的大纲不算完成。」
- 该铁律**对所有任务一视一律**,没有为「减法任务」(删除/清空/patch)开例外
- 链路:删完 → orchestrator 强制送 critic → critic 看到「空/不完整」喷意见 → 触发 outline-writer 再写一份 → 「自作多情重新生成」

对照 `character-orchestrator.md` line 22-26 已有【删/清角色流程】明说「删/清完不需要 critic 评审,直接回主 agent 一句结论」——这个范式 outliner 没抄过来。

更深层问题是:**当前 orchestrator 没有「任务路由」的概念**。它把所有 task 类型(建/补/改/删/patch)混在一条固定流水线里跑。这导致任何「减法任务」都会被错误地塞进「创建+评审」的完整流程。

## 2. 决策(已对齐)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 路由判据层 | **orchestrator 层判断**(非 leaf 层、非两层都判) | orchestrator 本来就是编排者,负责「指挥词」;leaf(writer)是被指挥方。把判断挪到 leaf 会破坏 orchestrator 职责 |
| 路线粒度 | **中粒度,4 类**:创建 / 改写 / 微调(patch)/ 删除 | 粗粒度(3 类)混了改写与 patch(前者要 critic,后者不要);细粒度(5+)LLM 易判错 |
| 路由回执 | **隐式**(orchestrator 自己判,不强制输出路由结果) | 显式回执 token 成本 vs 调试价值不划算;靠 L1/prompt 单测锁定行为即可 |
| 本期范围 | **只改 outliner + outline-writer** | 用户痛点所在;chapter/worldbuilder/character 列为 follow-up(单独 spec) |
| main 改不改 | **不改** | main 该怎么委派还怎么委派;orchestrator 自己负责判断(否则就成了转述失真 hard rule,不是路由器) |
| 路由模板抽象 | **不抽象成共享文件**(本期) | 各 orchestrator 的 task 类型不一样(outliner 有「补细纲」、character 没有),抽象成共享表反而绑手绑脚;每个 orchestrator 自己写一份路由段落,后期若重复再抽 |

## 3. 设计

### 3.1 4 类路线定义

| 类型 | 触发语义 | 执行路线 |
|---|---|---|
| **创建** | 新建/补/生成/分卷/建纲/补细纲(第 M-N 章) | writer → critic → (若 passed=false) revision → critic re-eval |
| **改写** | 重写/换方向/推翻重来/正文偏离后改细纲就实 | writer → critic → (若 passed=false) revision → critic re-eval |
| **微调** | 改某字段/patch/补一条 mustCover/修个错字 | writer(只 patch) → **直接返回** |
| **删除** | 删/清空/移除/去掉/清纲/清卷 | writer(只删) → **直接返回** |

**关键差异**:
- 创建/改写:走 critic(因为有「成品」要评)
- 微调/删除:**跳过 critic**(没有「成品」可评,patch 完/删完就是终态)

### 3.2 outliner-orchestrator.md 改动

**新增段落【任务路由】**(放在【任务类型】之后、【大纲流程】之前,作为「流程选择器」):

```
【任务路由】接到 task 后,先按语义判断类型,选对应路线:

- 创建类(新建/补/生成/分卷/建纲/补第 M-N 章细纲) → 走【大纲流程】完整四步
- 改写类(重写/换方向/推翻重来/正文偏离后改细纲) → 走【大纲流程】完整四步
- 微调类(改某字段/patch_chapter_plan 补一条 mustCover/修个 CEN 错字)→ 【直接结束】
- 删除类(删某卷/弧/细纲/总纲、清空大纲)→ 【直接结束】

铁律:
- 微调/删除类任务,outline-writer 返回后【可以直接结束】,不调 outline-critic
- task 消息里出现「只删」「只改」「不要重建」「不要顺手补」等限定词,强制走简化路线(微调/删除)
- 路由判断模糊时(既像改写又像微调),按「动作幅度」判:整条 CBN/CPNs/CEN 都换 = 改写,只动一个字段 = 微调
```

**改写【大纲流程】开头的措辞**:把「严格按序」改成「**创建/改写类任务**按序」,显式标注适用范围。

**改写【铁律】**:
- 原 line 29:「outline-writer 返回后【绝对不能结束】——必须继续 outline-critic。没评审的大纲不算完成。」
- 改为:「**创建/改写类任务**:outline-writer 返回后【绝对不能结束】——必须继续 outline-critic。没评审的大纲不算完成。**微调/删除类任务**:outline-writer 返回后【直接结束】,不调 critic。」

### 3.3 outline-writer.md 改动

在【删除/字段级改 -- 用法纪律】段落(line 69-76)末尾加一条:

```
- **减法任务完成后,禁止顺手调用 set_*(set_master_outline/set_volume/set_arc/set_chapter_plan)补全**:
  除非 task 明确要求「重建/重生/补一份新的」,否则删完/patch 完就是终态,直接返回结论。
  严禁看到「大纲空了」就自动重建——这是越权(用户没说建就别建)。
```

### 3.4 main.md 不动

main 的委派协议保持原样。orchestrator 自己负责判断 task 类型,不依赖 main 给出显式 tag。

## 4. 测试

### 4.1 L0 单元(prompt substring 锁)

在 `server/src/agentos/agent-prompts.spec.ts`:

- **保留**原 `SUBSTRINGS` 表里的特征子串(包括 `OUTLINER_ORCHESTRATOR_PROMPT: '改写细纲(因正文偏离)'`——【任务类型】段落未删,该子串仍在;`OUTLINE_WRITER_PROMPT: '立总纲(全书北极星'`——同样未删)。这是迁移保真锁,不动。

- **新增**独立测试用例,锁新加入的段落与纪律(避免单 prompt 锁多 substring 难维护):

```ts
it('outliner-orchestrator 含 4 类路由表与简化路线铁律', () => {
  expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('【任务路由】');
  expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('微调/删除类任务');
  expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('不调 outline-critic');
});

it('outline-writer 含减法任务禁止补全纪律', () => {
  expect(OUTLINE_WRITER_PROMPT).toContain('减法任务完成后');
  expect(OUTLINE_WRITER_PROMPT).toContain('禁止顺手调用');
});
```

### 4.2 L1 集成

不加。L1 测数据管道 + 关卡,不跑 agent graph。prompt 行为无法在 L1 验证。

### 4.3 L2 live scenario(本期不跑,记为后续)

未来在 `scripts/smoke/l2-scenario.ts` 加一个 act:让 agent 删一个 chapter plan,断言 tool 序列里**没有** `set_chapter_plan`/`set_master_outline` 跟在 `delete_chapter_plan` 后面。本期靠 L0 + 用户实测验证。

## 5. 后续 follow-up(单独 spec)

本期的「任务路由」是通用架构原则。后续按需扩展到其他 orchestrator:

- **chapter-orchestrator**:clear_chapter 是同类问题(清章后不应自动重写)。需要 4 类路由:写新章 / 重写 / 字段级 patch(暂无工具)/ 清章
- **worldbuilder**:删 world_entry 后不应自动重建
- **character-orchestrator**:已有【删/清角色流程】段落,扩展为完整 4 类路由(创建/丰富档案、改写、字段级 patch、删除)
- **curator**:单 agent 无 critic 环节,不需要路由(确认排除)

每个子 agent 一份独立 spec,沿用本期的 4 类模板 + 「减法任务跳过 critic」原则。本期只锁 outliner,不强行铺开。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM 路由误判(把改写判成微调,跳过 critic) | task 消息里出现「只删/只改」限定词时强制走简化路线;L0 锁定 prompt 含路由表;用户实测反馈 |
| prompt 膨胀(outliner-orchestrator 增加 ~25 行) | 可接受;outliner 本来就长。后期若所有 orchestrator 都加,再考虑抽象共享模板 |
| 用户说「删」其实想「删重建」 | outline-writer 已有「问作者确认」纪律;orchestrator 路由表里明说「除非 task 明确要求重建」 |
| main 转述失真(把「只删第 3 章」说成「处理一下第 3 章」) | 本期不解决;orchestrator 路由靠语义判,限定词兜底。若普遍出现失真,后续做「主→子任务转述结构化」(本期 B 路线)另起 spec |

## 7. 不在范围(明确排除)

- 主→子任务转述结构化(B 路线):本期不改 main 委派协议、不加 task 消息三段式结构
- chapter / worldbuilder / character orchestrator 的路由改造:follow-up
- 任何 DB schema 变更:零
- 任何 FE 改动:零
- 任何新工具:零
- L2 live scenario 测试:本期不跑

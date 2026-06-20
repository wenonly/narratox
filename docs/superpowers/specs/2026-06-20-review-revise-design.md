# D1 设计：validator→writer 修订闭环（结构化多维审计 + 最高分回滚）

> 日期：2026-06-20
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md) Stage D1
> 参考：[inkos](../../references/inkos-workflow-reference.md)（33 维 ContinuityAuditor + 最高分回滚）、[webnovel-writer](../../references/webnovel-writer-workflow-reference.md)（reviewer 六维 + blocking）
> 前序：[A2 结算关卡](./2026-06-20-a2-settlement-gate-design.md)（关卡 vs prompt 原则）

## 背景与问题

当前 validator 跑完只回**散文**（「1-3 句评价 + 通过/需修订」），判定不结构化、「需修订」之后**什么都不发生**——闭环断开，validator 形同摆设。

对比 inkos（33 维 + 评分 + 最高分回滚）与 webnovel（6 维 + blocking），结论：散文太弱，但 33 维是为 autonomous writer 设计、对 copilot 过度。**取中间**：webnovel 式 6-7 维结构化审计 + inkos 的最高分回滚（防越改越差）。

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 审计形态 | **6-7 维结构化**（非散文、非 33 维） | 命名维度=清单，覆盖可靠、反馈可定位；聚焦长篇真崩点，不为 niche 维度（套路密度等）付费 |
| 防越改越差 | **最高分回滚** | LLM 修订可能引入新错；修订后分数更低则回到原版 |
| 闭环驱动 | **prompt 驱动**（非代码） | 修订是质量打磨非数据完整性；与写章流水线一致（skill 化）。模型若跳过只是少打磨，不崩 |
| 轮次 | **最多 1 轮修订** | 控成本、防失控 |
| 持久化 | **瞬态**（不存 Review 表） | 结果走 tool result 驱动闭环；活动流可见。Review 历史/校验视图留后续 |

## 审计维度（6-7 维，聚焦长篇崩点）

1. **人物一致** — 名字/性格/关系不与已有矛盾
2. **设定·世界观一致** — 对齐 WorldEntry（力量体系、规则、地点）
3. **战力·力量体系** — 不崩战力（网文经典 bug）
4. **伏笔连贯** — 没回收未埋的、不与已结算伏笔冲突
5. **时间线·逻辑** — 时序、因果合理
6. **文风·视角** — 文风统一、POV 一致

## 方案组件

### 1. `report_review` 工具（validator 结构化输出）
```
report_review({
  passed: boolean,              // blockingIssues 为空则 true
  score: number,                // 0-100,用于回滚比较(全局质量分)
  dimensions: [{ name, status: 'pass'|'issue', issue?: string }],  // 每维判定
  blockingIssues: string[],     // 会导致崩、必须修的(驱动修订)
  notes: string                 // 非阻塞建议
})
```
validator 调它（而非散文）。瞬态——结果经 tool result 回到 main agent。

### 2. 章节快照（回滚支撑）
`RevisionSnapshotService`：进程内 `Map<novelId:order, string>` 存修订前的章节正文。
- `snapshot(userId, novelId, order)` — 读当前 `Chapter.content` 入 map。
- `restore(userId, novelId, order)` — 把 map 内容写回 `Chapter.content`（经 ChapterService，user-scoped）。

> 进程内即可：修订闭环在单个 runAgent turn 内完成,无需跨重启持久化。key 覆盖写,不清理(小)。

两个 main agent 工具：`snapshot_chapter(order)`、`restore_chapter(order)`。

### 3. Prompts
- **VALIDATOR_AGENT_PROMPT**：用 `report_review` 输出结构化判定;逐维 pass/issue;`blockingIssues` 只收「会让读者出戏/设定崩」的(人物/设定/战力/伏笔/逻辑冲突),文风吹毛求疵放 notes;`score` 全局 0-100。
- **MAIN_AGENT_PROMPT 写章流程**加闭环：
  ```
  ... settler 结算 → validator(调 report_review,得 score S1)
  → 若 passed=false:
      1. snapshot_chapter(N)            // 存修订前正文
      2. 再委派 writer 做定点修订(task:"按 blockingIssues 修正第N章:X、Y",用 replace_text/insert 小改)
      3. validator 再校验(得 score S2)
      4. 若 S2 < S1:restore_chapter(N)  // 越改越差 → 回滚原版
  → 最多 1 轮修订。
  ```

## 数据流
```
writer → settler → validator(report_review, S1)
   → [passed] 完成
   → [!passed] snapshot → writer spot-fix → validator(S2)
        → [S2≥S1] 完成   → [S2<S1] restore → 完成(回滚原版)
```

## 测试（TDD）

- **report_review 工具**：schema、返回 shape（不持久化）。
- **RevisionSnapshotService**：snapshot 存内容、restore 写回、无快照时 restore 安全 no-op；user-scoped。
- **snapshot_chapter / restore_chapter 工具**：委派 service、闭包注入。
- prompt 改动无直接单测（validator/main），靠 `pnpm dev` 实测闭环。

## 实现阶段

1. **report_review 工具 + VALIDATOR prompt**：结构化多维审计。
2. **RevisionSnapshotService + snapshot/restore 工具**：回滚支撑。
3. **MAIN_AGENT_PROMPT 闭环**：修订 + 回滚编排。

每阶段独立可测、可提交。

## 非目标（YAGNI / 留后续）

- **不做 33 维 / 5 修订模式 / anti-AI 检测**（autonomous writer 专属）。
- **不持久化 Review**（瞬态；Review 历史/校验视图留后续）。
- **不做代码级循环强制**（质量打磨用 prompt；数据完整性才用关卡）。
- 回滚仅比较 score 高低,不做 per-dimension 精细回滚判定。

## 与 ROADMAP 的关系
本功能 = ROADMAP **Stage D1**。实现后更新 ROADMAP D1 + README checkbox。

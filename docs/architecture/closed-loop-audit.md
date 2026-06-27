# 写小说全闭环审计(Phase 5-14 后)

> 2026-06-27 · 实测核对 controller / chapter.service / novel.service / context-assembler

## 结论先行

**核心写章环结构上闭合**(有硬关卡),但**依赖 prompt 多跳委派的几个环从未活体验证过——可能"看似闭合实则静默断裂"**。另有 3 类真正缺失(完成态 / 故障恢复 / 向量召回)。**最该做的不是加功能,是 E2E 把这些环逐个跑通,暴露真实断点。**

---

## 一、已闭合的环(有硬关卡/结构保证)✅

| 环 | 闭合保证 | 位置 |
|---|---|---|
| 立项→写:无细纲不写 | `assertHasPlan`(本章必须有 ChapterOutline) | chapter.service.ts:142 |
| 顺序写:跳章被拒 | `assertFrontier`(前驱章必须已结算=有 ChapterSummary) | chapter.service.ts:111 |
| CONCEPT→ACTIVE | 首次 append_section 翻 ACTIVE(幂等) | novel.service.ts:81-89 |
| 写→结算→校验→修订 | chapter 编排器流程 + snapshot/restore(1 轮) | CHAPTER_ORCH prompt |
| 事实持久化 | settler 经 write_summary 写 摘要/角色/伏笔/事件/弧线 | write-summary.tool |
| 记忆再注入 | ContextAssembler 8 slice 每轮拼进 main system prompt | context-assembler |
| 多租户隔离 | userId/novelId 闭包注入工具,不来自 LLM | TOOL_REGISTRY |

这些是**结构闭合**的——有代码/关卡兜底,不靠模型自觉。

---

## 二、看似闭合、实则「prompt 多跳、未验证」的环 ⚠️(最高风险)

这些环全靠 prompt 驱动的多 agent 委派链,任何一跳模型没照做就**静默断裂**,且单测验不出来:

### 1. 大纲偏离 → 改写回馈(Phase 10)—— 4 跳链,最脆
`validator dim12 标「细纲过时」` → `CHAPTER_ORCH 结论带回` → `main 识别` → `main 委派 outliner 改写`。
任何一跳失败 → 大纲回冻(Phase 8 老问题复发)。**完全未验。**

### 2. settler 提取完整性 —— 全记忆的单点依赖
settler **必须**在 write_summary 里带上 `plotEvents`(事件)+ `currentArcSummary/currentVolumeArcSummary`(弧/卷)+ hooks + roleChanges。漏带哪个,那层记忆就**静默空**(事件面板空、弧线无进展、伏笔丢)。settler 是**唯一记账员**,无提取质量校验。**未验。**

### 3. validator 真用工具 —— dim 不再空跑
Phase 7 修过「validator 没 get_character → dim1 空跑」。现在工具有了(dim1 角色、dim12 细纲、+get_events),但**validator 是否真调**这些工具再核,未验。不调就回退到 query_memory 二手信息空跑。

### 4. writer 写前 step0 真读
Phase 8(相邻章)+ Phase 14(step0:细纲→相邻章→弧线→角色)都是 prompt 指令。writer 是否真在动笔前读了,未验。不读 → 接缝穿帮、跑偏出弧。

### 5. 伏笔回收 —— 永远 OPEN 的软开口
settler plant/advance/resolve;【未回收伏笔】slice + stale⚠️ + validator dim4 都**提示**,但**没有任何机制强制回收**。一个伏笔可以永远 OPEN。长篇里这是「坑越挖越多不填」的来源。

---

## 三、真正缺失(无代码)✗

### 1. 完成态(小说/卷/弧 都没有 "done")
- `Novel.status` 只有 CONCEPT|ACTIVE,**无 COMPLETED**。态势 `nextStep` 永远是 write_next/plan_more,**永远不报「写完了」**。作者/agent 都不知道何时该停。
- 弧/卷同理:Arc.summary 滚动,但**无 arc-done/volume-done**;写完一个弧没有任何过渡。

### 2. 故障恢复(崩溃/结算失败 → 卡死)
- 写章中途崩溃(模型 400/超时)→ 章**半写** 或 **写了未结算**。
- `assertFrontier` 会拦下一章(好),但**无自动恢复**:没有「重跑 settler」「续写半章」机制,作者得自己发现 + chat 修。长篇里这是稳定性黑洞。

### 3. 向量召回(长篇记忆天花板)
`query_memory` 是关键词 `contains`(无向量)。200 章小说里,「主角第 12 章见过这 NPC?」靠 LLM 猜关键词,猜不中就召不回。这是「超 5 章遗忘」的终局解,Phase 8 审视标的,一直 defer。事件系统(Phase 11)部分缓解(结构化召回),但 query_memory 本身仍弱。

### 4. 手动纠错路径
agent 是唯一作者(角色/事件/大纲 都无手动编辑端点)。agent 提取错了(漏事件/伏笔标错/大纲跑偏),纠错只能 chat 重新委派——**无直接编辑**。与「agent 唯一作者」哲学一致(用户早期认可),但它是恢复链的缺口。

---

## 四、优先级建议

| 优先级 | 动作 | 理由 |
|---|---|---|
| **P0** | **E2E:写一本 10-20 章中篇实测** | 10 phase 全理论;第二节 5 个「看似闭合」环里,真实断点只能靠跑暴露。这是性价比最高的——不写新代码就能发现真问题。 |
| P0(+) | 据 E2E 修 settler 提取可靠性 / Phase10 漂移链 | 大概率 E2E 先崩在这两处(settler 单点 + 4 跳链)。 |
| P1 | 完成态:`Novel.status COMPLETED` + 态势 nextStep `done`;弧/卷 done 标记 | 小改动,闭合「何时写完」。 |
| P1 | 故障恢复:failed settler → 自动/半自动重结算;半写章续写 | 稳定性刚需,否则长篇必卡。 |
| P2 | 向量召回(query_memory 上 embedding) | 长篇记忆终局解;大基建,建议 E2E 后定要不要。 |
| P3 | 手动纠错端点(角色/事件/大纲 直编) | 与 agent-author 哲学冲突,看是否要做。 |

## 五、一句话

**骨架闭合,血肉未验。** 别再加功能了——先写一本,让第二节那 5 个环在真模型下现原形,再有的放矢地修(大概率是 settler + 漂移链),然后补完成态和恢复。向量召回是最后的终局解,放 P2。

# 确定性正文守卫层(prose-guard)设计

> 参考：[oh-story-claudecode 创作闭环参考](../../references/oh-story-claudecode-reference.md) 第 6/9 节（守卫 hook + 去 AI 味三层防御）。
> 动议来源：oh-story 给 narratox 的最大启发是「把 LLM 裁判管不了的事下沉成确定性守卫」。narratox 的 12 维 validator + writer 去 AI 指纹提示**全部是 LLM-as-judge**，存在一类结构性盲区：退化模型判不了自己的退化、机械句式不该花模型调用、字数不该问 LLM。本设计补这一层。
> 日期：2026-06-30

---

## 1. 背景与问题

narratox 经 Phase 5–21 已建起精密的一致性引擎：12 维 validator、writer【去 AI 指纹】+【作者声音】提示、settler 事实结算、chapter-orchestrator 的写→结算→校验(+≤1 轮修订)闭环。**但所有质检闸门都是 LLM 当裁判。**

这造成一类**模型在结构上自检不到**的失败无法被可靠捕获：

| 失败类型 | 为什么 LLM 裁判抓不到 |
|---|---|
| 模型退化（逐字复读/打转/末尾截断/拒绝语） | 退化的模型判不了自己的退化，盲区 |
| 工程词泄漏（CBN/CPN/任务描述 等作者工具元词汇进了正文） | 正则即可，不该调模型 |
| 机械句式（破折号泛滥/碎句号/句长过匀） | 纯计数 |
| 字数欠账 | `len(content)` 一行代码 |
| 机械标点残留（`�`/`--`/独立 `---`） | 无歧义垃圾，应自动归一 |

oh-story 的解法是把它们下沉到确定性脚本（`check-ai-patterns.js`/`check-degeneration.js`/`normalize-punctuation.js`），model-independent、零 token、零幻觉。**narratox 缺的就是这一层闸门。** 本设计新增一个确定性守卫层，嫁接到现有 writer→validator 修订闭环上。

---

## 2. 核心设计

**新增 `ProseGuardService`（纯 TS 确定性函数，无 DB）+ 一个 `check_prose` 工具，挂在 `CHAPTER_ORCH` 上，在 settler 与 validator 之间执行。**

### 2.1 章流（线性，无短路）

```
writer → settler → check_prose(持有结果) → validator
                         │
                         └ blocking 与 validator.blockingIssues 取并集
```

修订判定：

1. `unionBlocking = check_prose.blocking ∪ validator.blockingIssues`；`advisory = check_prose.advisory`（由 orchestrator 格式化成【守卫证据】写进委派 validator 的 task 消息，供 dim10/dim7 参考）。
2. `unionBlocking` 为空 → pass，结束。
3. `unionBlocking` 非空 → `snapshot_chapter(N)` → 委派 writer 定点修订（载荷 = unionBlocking）→ 复跑 `check_prose` + validator。
4. 复跑后：check_prose 仍有 blocking **或** 新 validator score < 原 score（越改越差）→ `restore_chapter(N)` 回滚 + 结论标注；否则通过。
5. **≤1 轮修订硬上限不变**（复用现有铁律）。

> **为什么用并集而不是「退化命中即短路跳过 validator」**：并集保证退化一定被抓（check_prose.blocking 恒进并集，与 validator 怎么说无关），且线性无分支；短路仅省下退化这一罕见场景的 1 次 validator 调用，却引入提示分支 + 「退化吃掉修订预算」的副作用——收益不抵复杂度。退化时 validator 顺带在 dim10 给出「AI 味浓」的佐证，反而强化重写信号。

### 2.2 为什么是显式工具，而非塞进 settler / report_review

- 塞 settler：混淆「提取事实」与「质检」职责，污染 write_summary 返回 shape，难单独测。
- 塞 report_review（validator）：违背初衷——确定性闸门的价值正是让机械问题**不**经 LLM。
- 显式 `check_prose`：可单测、activity 流可见、与 `snapshot_chapter`/`restore_chapter` 同级（CHAPTER_ORCH 本就持有直接工具 + task 委派），符合 narratox「工具即扩展缝」。

---

## 3. 检测目录与阈值

**总原则（照搬 oh-story「宁可漏拦不可误伤」）：拿不准的一律降为 advisory，不阻断。** blocking 只留两类：① 模型结构上自检不到的退化；② narratox 作者工具元词汇泄漏（正文绝不该出现）。

### 3.1 BLOCKING（进 unionBlocking，驱动修订）

| 检测 | 规则 | 备注 |
|---|---|---|
| 逐字复读/打转 | 相邻内容行**完全相同**且 ≥8 字 | 排比/弹幕相似非全等，不误伤（oh-story 实证） |
| 落盘失败/没写完 | 正文 <500 字节 **且** 末行无终止标点（。！？…」』"） | 双条件防误伤风格性开放结尾 |
| 拒绝语（非对话行） | `作为(AI\|人工智能\|大?语言模型)` / `Sure\|Certainly\|Here's\|Of course` / `我无法(继续\|生成)` | 对话行内的「Sure」不命中（见 3.4） |
| 工程词泄漏（tier1，仅 narratox 内部词） | `CBN\|CPN\|CEN\|功能标签\|章首钩子\|任务描述` | 这些是工具元词汇，正文绝不该出现 |

> `细纲\|情节点\|卷纲` 等**可能**在元小说对话里合法出现 → 降为 advisory（见 3.3），不阻断。

### 3.2 AUTO-FIX（机械归一，原地写回，不过模型）

只动**无歧义垃圾**，绝不碰风格性标点：

- 替换字符 `�` → 删除
- 残留双连字符 `--` / 独立行 `---` → 归一
- 风格性 `——` / `……` **不动**（合法，泛滥归 advisory）

`check_prose` 经 `ChapterService` 原地更新 content + 返回 `autoFixed[]`，契约上是 deterministic formatter。只对无歧义残留动手，保证不改坏作者的合法用笔。auto-fix 发生在 snapshot 之前（详见 6.2）。

### 3.3 ADVISORY（格式化成【守卫证据】，经 orchestrator 注入 validator task 消息）

| 检测 | 规则 | 与现有 validator 的关系 |
|---|---|---|
| 破折号泛滥 | `——` >2 次/千字 | 补 dim10 硬计数 |
| 句长过匀 | 连续三句长度差 ≤2 字（排除纯对话行） | 补 dim10（AI 匀速破绽） |
| 碎句号 | 连续 ≥3 个短叙述句（≤8 字、非对话）无呼吸 | 易误伤 → 故意只 advisory |
| 字数欠账 | `chapterWordTarget` 已设 且 实际 < 90% | 补 dim7（dim7 判「偏短=剧情不足」语义；本项给机械阈值+定位） |
| AI 套话 | `此外\|至关重要\|仿佛…一般\|作为…的证明\|标志着\|象征着` 等（扩自 writer.md 已列词表） | 补 dim10 |
| 工程词泄漏（tier2，可能合法） | `细纲\|情节点\|卷纲` | 元小说可能合法 → advisory |

### 3.4 中文分句与对话感知

句长/碎句检测依赖分句器 `splitSentences(content)`：

- 按中文终止标点（。！？…」』"）切分；省略号 `……` 视为终止。
- **对话感知**：纯对话行（被「」/""包裹）**排除**出「句长过匀」/「碎句号」检测——网文对话本就短促，纳入会大量误伤。
- 拒绝语/工程词检测**排除对话行**（角色可能台词里说「Sure」或讨论「细纲」）。

---

## 4. 数据结构与工具契约

```ts
type FindingType =
  | 'verbatim-repeat' | 'truncation' | 'refusal' | 'leak-tier1'
  | 'em-dash' | 'uniform-length' | 'period-stutter'
  | 'word-count' | 'ai-cliche' | 'leak-tier2';

interface Finding {
  type: FindingType;
  severity: 'blocking' | 'advisory';
  evidence: string;    // 原文摘录，定位用
  location?: string;   // 如「第3段」
  suggestion: string;  // 给 writer 的修订提示
}

// check_prose(chapterOrder) 返回
interface ProseGuardReport {
  blocking: Finding[];
  advisory: Finding[];
  autoFixed: string[];                  // 如 ['删除 2 处 \\uFFFD', '归一 1 处 --']
  nextAction: 'pass' | 'revise' | 'proceed-validator'; // 给 orchestrator 的明确路由提示
  stats: { wordCount: number; dashPer1k: number; sentenceLens: number[] };
                                         // 句长序列检测本就要算 → 顺手留给未来文风指纹复用
}
```

`nextAction` 让 orchestrator 的路由近乎确定化（不依赖 LLM 自行推断）：blocking 非空 → `revise`；blocking 空、advisory 非空 → `proceed-validator`；皆空 → `pass`。

`check_prose` 经 closure 注入 `userId`/`novelId`（同所有工具），读 `ChapterService.getChapter` 取正文 + 读 `Novel.settings.chapterWordTarget`。**`chapterWordTarget` 为空时跳过字数检测，不误阻断。**

---

## 5. 改动面

| 类型 | 文件 | 说明 |
|---|---|---|
| 新增 | `server/src/agentos/prose-guard.service.ts` (+spec) | 纯检测函数 `check(content, {chapterWordTarget})` + `splitSentences` |
| 新增 | `server/src/agentos/tools/check-prose.tool.ts` (+spec) | 封 service，注册 TOOL_REGISTRY，closure 注入 userId/novelId |
| 改 | `server/src/agentos/agent-tree.config.ts` | CHAPTER_ORCH `tools` 加 `'check_prose'` |
| 改 | `server/src/agentos/agent-registry.ts` | 注册 check_prose 工厂 |
| 改 prompt | `prompts/chapter-orchestrator.md` | settler 后加 check_prose 步 + 并集修订规则 + nextAction 说明 |
| 改 prompt | `prompts/writer.md` | 小补：blocking 来自 check_prose = 退化段，按「重写干瘪段落」路线（已有能力，不新增） |
| 改 prompt | `prompts/validator.md` | 小补：task 消息可能含【守卫证据】，dim10/dim7 据此判 |
| 改测试 | `server/test/smoke/l1-integration.spec.ts` | appendSection 后调 check_prose，退化 fixture 断言 blocking |

**无 DB 迁移、无 FE、无新 agent、无 AGENT_TREE 结构变更。**

---

## 6. 边界与风险

### 6.1 持久化（v1 = 不持久化）
findings 只活在 orchestrator 当轮上下文（工具返回 → 委派消息 → activity 帧），turn 结束即弃。blocking 驱动当轮修订，advisory 当轮被 validator 消费，皆无跨轮需求。`Chapter.qualityReport` JSON 持久化 + FE 质量面板为 deferred。

### 6.2 auto-fix 与 snapshot 时序
auto-fix（`�`/`--`/`---`）发生在 check_prose 内，**早于**修订闭环的 `snapshot_chapter`。即 snapshot 存的是已去垃圾的版本——这是期望行为（auto-fix 只删无歧义垃圾）。restore 回滚到此版本同样干净。

### 6.3 settler 在修订后的陈旧性（**预存问题，不在本范围**）
现有 chapter-orchestrator 修订闭环（step 4）writer 改完不重跑 settler，故修订后摘要/events 可能与正文略脱节。这是 Phase 4 起就存在的，**本设计不引入也不修复**——check_prose 保持 settler 之后，最小改动流程。若要彻底防退化污染 settler 记忆，需把 check_prose 前置于 settler 并加重跑，超出 v1。

### 6.4 L2/L3 不可脚本化
退化是弱模型概率事件，无法稳定脚本化，不作为 L2 断言；标注「发生时由守卫兜，不脚本化」。L0 单测是护城河（纯函数，100% 确定）。

### 6.5 编码/跨平台
narratox 是 TS/Nest + Prisma/PG（UTF-8 统一），**不存在** oh-story 守卫里一半复杂度（Windows GBK / `python3` 占位 / 盘符路径）。所有检测对 JS string 跑。

---

## 7. 不在范围（deferred）

- 文风指纹（`Novel.settings.styleProfile`，settler 刷新，writer 注入）——v1 已在 `stats.sentenceLens` 留复用入口，独立 Phase 做。
- `Chapter.qualityReport` 持久化 + FE 质量面板。
- 修订后重跑 settler（见 6.3）。
- check_prose 前置于 settler 的数据卫生重排。
- 短路优化（已评估并拒绝，见 2.1）。

---

## 8. 验收标准

- `ProseGuardService.check` 单测：每类检测正例 + 关键负例（合法排比不命中复读、合法开放结尾不命中 blocking、合法破折号不被 auto-fix、对话行「Sure」不命中拒绝语、对话行不计入句长过匀）。
- L1：appendSection 后 check_prose 跑通；退化 fixture 命中 blocking 并进修订。
- 章流 e2e：blocking 并集驱动 writer 修订；越改越差触发 restore；≤1 轮上限不被突破。
- 现有所有单测不回归（check_prose 是 CHAPTER_ORCH 新增工具，不动既有路径）。

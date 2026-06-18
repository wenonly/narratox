# narratox 分段章节编辑工具 — 设计文档(v0.5.1)

- 日期:2026-06-19
- 状态:待 review(设计方向已与用户确认)
- 范围:把 Writer Agent 的「单次大参数 `write_chapter`」交付方式,改为**一组小参数的章节编辑工具**(`append_section` / `replace_section` / `insert_section` / `get_chapter`),让模型像代码编辑 agent 一样**一节节流式写/改正文**。根因修复 z.ai coding 端点「大工具参数生成 >60s 被掐」导致的 `terminated` 报错。
- 前置:v0.5.0(Analyst 结算 + 记忆)已实现;本次只动 **Writer 工具层 + streamTurn 信号 + Writer prompt**,swarm 结构 / Analyst / 记忆表 / 数据模型(Chapter.content 仍为 string)都不变。

---

## 1. 背景与根因(已由 9 个 spike 证实)

v0.5.0 联调时,「写完一章后重写」稳定报 `terminated`(~60s)。诊断结论(见 `server/scripts/spike-stream-timeout.ts` 的 9 次实验):

1. **不是端点流式天花板**:无工具纯生成能流 107s 不挂(spike #1)。
2. **不是上下文大小**:章节上下文 3000→600 字,卡的时间零差别(spike #5)。
3. **不是 clear+新生成能绕过**:即便指令"作废旧版从头写",只要旧正文还在上下文里,照样卡(spike #6)。
4. **根因 = `write_chapter` 工具参数太大**:模型被要求把**整章正文塞进 `write_chapter.content` 工具参数**生成;推理模型 GLM-5.2 生成大工具参数又慢又不稳,经常 >60s 才出第一个 token,撞 z.ai「~60s 内必须出首个正文/工具 token」的规则被掐(spike #7/8)。
5. **解法已被证实**:小参数工具调用(每节 ~300 字当参数)**稳定 14~23s、3/3 不卡**(spike #9)。

**结论**:把「整章一次落稿」改成「一节节小工具调用拼接/修订」,每个工具调用的 `content` 都是一小节 → 永不碰 60s 墙。

---

## 2. 目标

1. **根治 60s** —— Writer 永不再生成大工具参数;每次调用 ≤一节(~300-800 字),稳定 <60s。
2. **外科式修订** —— 支持「替换某段 / 插入某节」,不只是末尾追加;重写某章 = 多次 `replace_section`(每段一个小调用)。
3. **流式长出来** —— 正文一节节落库,前端逐节刷新(看着 AI 写)。
4. **零地基改动** —— 不动 swarm 结构、Analyst、记忆表、Chapter 数据模型。

---

## 3. 工具设计(替换 `write_chapter`)

**移除** Writer 当前的 `write_chapter(order, op, content)`(大参数)。**新增** 4 个工具,全部 userId/novelId 闭包注入(不从 LLM 入参取,防越权):

### 3.1 `append_section`
```
append_section({ chapterOrder: int, content: string })
  → 把 content 追加到第 chapterOrder 章末尾。
  → 章节不存在则自动创建(沿用 findOrCreateByOrder)。
  → 首次落内容时 novels.activate(CONCEPT→ACTIVE)。
  → 返回 { ok:true, chapterOrder, chars, totalChars }
```
- `content` ≈ 一节正文(~300-800 字)。prompt 约束模型每次只追加一节。
- 这是「写新章 / 续写」的主力工具。

### 3.2 `replace_section`
```
replace_section({ chapterOrder: int, anchor: string, content: string })
  → 在第 chapterOrder 章正文中定位 anchor(子串,首次出现),替换为 content。
  → anchor 找不到 → 返回 { ok:false, reason:'anchor_not_found' }(模型可重试)。
  → anchor 多次出现 → 替换首次 + 返回 warning('anchor_ambiguous')。
  → 返回 { ok:true, chapterOrder, replacedChars, totalChars }
```
- `anchor` 是要替换的那段的**一个标志性片段**(模型从 get_chapter 读到的原文里挑)。类比代码编辑工具按代码块定位。
- 这是「重写某节 / 修订」的工具(替代整章重写)。

### 3.3 `insert_section`
```
insert_section({ chapterOrder: int, after: string, content: string })
  → 在第 chapterOrder 章正文中定位 after(子串,首次出现),在其后插入 content。
  → after 找不到 → { ok:false, reason:'anchor_not_found' }。
  → 返回 { ok:true, chapterOrder, insertedChars, totalChars }
```
- 「在某处补写一段」的工具。

### 3.4 `get_chapter`(只读)
```
get_chapter({ chapterOrder: int })
  → 返回 { chapterOrder, title, content, chars }
```
- 改之前先读现状。返回的是**输入**(ToolMessage 进上下文),不触发 60s(60s 只看模型输出)。模型据此挑 anchor / 决定追加。
- 与现有 `list_chapters`(只给 order/title/status/字数,不给全文)互补:get_chapter 给全文。

> **保留** `list_chapters`(章节清单,轻量)。**新增** `query_memory`(v0.5.0 已加)不动。

---

## 4. 数据模型与编辑语义

**`Chapter.content` 仍是单个 string**(不改 schema)。编辑语义在 `ChapterService` 新增方法(均先 `assertOwned` 归属校验):

```ts
appendSection(userId, novelId, order, content): Promise<Chapter>
  // findOrCreateByOrder → content = (chapter.content ?? '') + content → update
replaceSection(userId, novelId, order, anchor, content): Promise<{ok, replaced?}>
  // 取 content;首次 indexOf(anchor);找不到 → {ok:false};找到 → 替换 → update
insertSection(userId, novelId, order, after, content): Promise<{ok, inserted?}>
  // 类似,定位 after 后插入
getChapter(userId, novelId, order): Promise<{content, title, order} | null>
  // 只读
```

**锚点匹配规则(v1,简单可靠)**:`String.prototype.indexOf` 首次匹配;anchor/after 由模型提供(建议 ≥10 字以降低歧义)。找不到 → 工具返回 `ok:false`,模型据 prompt 引导重试(换更准的锚点)。不做模糊/正则匹配(P2 再加)。

**CONCEPT→ACTIVE**:首次 `append_section`(或任意编辑工具)落非空内容时,`novels.activate`(与原 `write_chapter` 一致,幂等)。

**走不走 mutation 层**:新工具**直接调 ChapterService 方法**(不经 ResourceRegistry/ChapterHandler),与 v0.5.0 Analyst 写记忆表一样走 service。原 `write_chapter` 走的 ChapterHandler append/set 随 `write_chapter` 一并弃用(可留代码,标注 deprecated;或一并删除,实现时定)。

---

## 5. Writer Agent 与 prompt

- **工具集**:Writer 持有 `append_section` / `replace_section` / `insert_section` / `get_chapter` / `list_chapters` / `query_memory` / `transfer_to_main`。(移除 `write_chapter`。)
- **prompt 改造**(WRITER_AGENT_PROMPT):
  - 「**不要**一次写整章、**不要**把整章塞进一个工具。」
  - 「写新章:先 `list_chapters`/`get_chapter` 了解,再多次 `append_section`,每次一节(~300-800 字),直到本章写完。」
  - 「重写/修订某节:先 `get_chapter` 读现状,再用 `replace_section`(anchor 用原文里的标志性片段)逐段改;不要整章重写。」
  - 「补写:`insert_section`。」
  - 「每次工具调用后,正文会实时落库;用户能看到。一节写完可停下来问是否继续,或继续下一节。」

---

## 6. 流信号与前端(逐节刷新)

### 6.1 streamTurn 信号
当前:`write_chapter` 的 AIMessage tool_call → yield `WritingChapter{order}`;ToolMessage ok → 标记 settle。

改为:**任一章节编辑工具**(`append_section`/`replace_section`/`insert_section`)的 **AIMessage tool_call** → yield 既有 `{ type:'writing-chapter', order }`(**复用现有信号,不改名**——它本就表示「该章正在被写/更新」)。ToolMessage ok → 把该 order 记入「本轮已编辑章节」集合(供轮末 settle)。

> 不新增信号类型、不改 store:复用既有 `WritingChapter` 事件 + `writingChapterOrder`。每次编辑工具调用都发一次该信号(一节一次),前端据此刷新。

### 6.2 前端
- `useAIStreamHandler`:沿用现有 `WritingChapter` 事件分支;改动只是**每收到一次就触发一次 novel/chapter 刷新**(原来仅 turn-end 刷一次),ChapterPreview 实时显示不断增长的正文。
- 骨架逻辑(写作中 skeleton + 自动打开章节面板)沿用不变。
- 不新增 store 字段。

---

## 7. Analyst 结算触发(改为轮末)

当前:`write_chapter` 落稿 → fire-and-forget `analyst.settle(order)`。

改为:streamTurn 遍历时,把本轮所有「编辑工具 ok」涉及的 order 收进 `Set<number>`;**流结束后**,对集合里每个 order `void analyst.settle({order})`(per-novel 锁天然去重,多次只跑一个)。这样一章被多次 append 拼写时,只在本轮末结算一次(而不是每节都 settle)。

> settle 仍异步 fire-and-forget、仍只读+写新表、失败静默(v0.5.0 不变)。

---

## 8. 范围与分期

**本 spec 目标设计 = 全部 4 个工具**(append/replace/insert/get)。实现**分期**:

- **Phase 1(先验证全链路)**:`append_section` + `get_chapter` + Writer prompt(分节写)+ `chapter-updated` 信号 + 轮末 settle。跑通「一节节流式写进正文、不卡、记忆气泡弹出」。
- **Phase 2(扩展修订)**:`replace_section` + `insert_section`(外科式改/重写某节)。

> 分期理由:append 是主线(写新章/续写);replace/insert 是增强(重写/补写)。先证明全链路(含 60s 修复 + Analyst 气泡)再扩。

**非目标**:
- 不改 swarm 结构(createSwarm + transfer)。
- 不改 Analyst / 记忆表(ChapterSummary/StoryEvent)。
- 不改 Chapter 数据模型(content 仍 string;不做「章节=多 section 实体」的结构化拆分)。
- 不做锚点模糊/正则匹配(P2)。
- 不做非推理模型切换(本 spec 用工具改造解决;模型切换是另一条路,留作备选)。

---

## 9. 风险

- **多工具往返的延迟与成本**:一章 ≈ N 节 × ~20s ≈ 2-3 分钟写完。比一次大生成慢,但**永不卡**且可流式观看。可调:每节字数上限放宽到 ~800 字,减少往返次数(仍 <60s)。
- **锚点匹配失败**:`replace_section`/`insert_section` 的 anchor 找不到 → 工具返回 ok:false,prompt 引导模型重试。Phase 1 只用 append 不受影响。
- **模型不遵守「分节」**:可能仍想一次写多。prompt 强约束 + 工具 description 强调「每次一节」。spike #9 证明小参数调用本身快,主要风险是 prompt 引导,联调时验证。
- **轮末 settle 的 order 集合**:若一轮编辑了多章(跨章续写),对每个 order 触发 settle;per-novel 锁去重。可接受。
- **FE 高频刷新**:每节一次刷新,novel GET 频率上升;一章 ~7 节 = ~7 次刷新,可接受(轻量)。如需,可节流。

---

## 10. 参考

- 9 个诊断 spike:`server/scripts/spike-stream-timeout.ts`(根因:大工具参数 >60s;小参数 14-23s 稳)。
- v0.5.0 Analyst spec/plan(记忆表 + 轮末 settle + 异步,本次复用)。
- 代码 agent 的「小编辑工具」范式(Cline/Cursor 按代码块改)。

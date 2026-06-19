# 交错内联活动时间线 — 设计文档

- 日期:2026-06-19
- 状态:已与用户确认方向(think/tool 折叠标记内联、按时序交错、**刷新后保留**),待 review
- 范围:把 agent 消息从「正文在上 + 活动时间线在下」改为**统一的、按时序交错的块流**——think/tool 折叠成紧凑标记内联在真实发生位置,content 作为正文块夹在中间。**并持久化 activities,使刷新/重开后交错时间线保留。** 前端渲染 + 后端持久化。
- 依赖:v0.6.0-foundation(扁平活动流协议 + `message.activities[]` 已落地)

---

## 1. 背景:现在的渲染丢了时序

v0.6.0 落地的扁平活动流,**数据层是按时序的**(`message.activities[]` 按到达顺序 push,content 条目也在数组里),但**渲染层把它拆成了两块、压平了时序**:

1. `message.content`(所有正文)→ 消息主体,MarkdownRenderer 渲染在**最上面**。
2. `message.activities[]`(think/tool/stage)→ 时间线,渲染在**正文下方**。

于是无论 think / 工具调用发生在哪个时刻,都被**整体挪到正文末尾**。真实流程「想 → 说一句 → 调工具 → 想 → 说一句 → 写章 → 收尾」被显示成「[全部正文] + [全部活动堆在底下]」。流式期间,思考阶段只看到底部时间线在动,正文区冻住——削弱了 foundation 引入 reasoning_content 想解决的"卡顿"观感。

## 2. 目标

把一条 agent 消息当成**一个按时序排列的块序列**统一渲染:

- think / tool:**默认折叠成紧凑标记**,内联在真实发生位置;点开看推理全文 / 工具参数与返回(主流做法,同 Claude/ChatGPT 的折叠 reasoning 块)。
- content:作为 Markdown 正文块,**夹在中间**,流式增长。
- 全部按时序自上而下。

这样:思考阶段看到 `🧠 思考 ·N字` 标记字数实时上涨(消除冻屏);工具调用在它真实发生的时刻出现、调用完填 `✓`;正文按段实时刷在时序位置。

## 3. 数据层改动(`useAIStreamHandler.tsx`)

`ActDelta` 处理修正:

- **现状(错)**:content 增量写进 `message.content`。
- **改为**:content 增量写进**对应 content 活动条的 `activity.text`**(按 id 找到 `act === 'content'` 的条目,append)。
- `message.content` **不再在流式期间累计**;它由 `RunCompleted.content`(后端已累计好的全文)在流末一次性赋值,继续承担**持久化(Message 表)+ 历史恢复**职责。

> 结果:`message.activities[]` 成为唯一的、按时序的、含 content 的**真值来源**;`message.content` 退化为持久化/历史载体。think 的增量仍累计进对应 think 条目的 `activity.text`(不变)。

## 4. 渲染层改动

### 4.1 `MessageItem.tsx`
- 当 `message.activities?.length > 0`:**用 `<ActivityTimeline>` 取代正文 MarkdownRenderer** 作为消息主体。
- 否则(历史恢复的消息没有 activities,或无活动的回复):回退到 `message.content` 经 MarkdownRenderer 渲染(与今天一致)。

### 4.2 `ActivityTimeline.tsx`
- 去掉 `filter((a) => a.act !== 'content')`,**原样按时序渲染全部**活动条。

### 4.3 `ActivityItem.tsx` —— 四种条目
- `stage` → `▶ writer` / `▶ settler` 分隔条(不变)。
- `think` → 折叠标记 `🧠 思考 ·234字 ▸`,默认折叠,点开看推理全文(`activity.text`)。
- `tool` → 折叠标记 `🔧 {label} {状态} ▸`(`状态`:进行中无标 / `✓` ok / `⚠` error),默认折叠,点开看参数(`toolArgs`)+ 返回(`toolResult`)+ 概要(`summary`)。
- `content` → **Markdown 正文块**(不可折叠),渲染 `activity.text`,流式增长。

### 4.4 流式观感
- 思考:`🧠 思考 ·N字` 标记,N 实时上涨 → 不冻屏。
- 工具:标记在真实时刻出现,调用完填 `✓` 与返回。
- 正文:按段实时刷在时序位置。
- 全程按时序,呈现真实流程。

## 5. 持久化(刷新/重开保留交错时间线)

只在前端做的话,activities 是流式期间的内存态,刷新即丢。用户要求保留 → **落库**。

### 5.1 数据模型(Prisma)
- `Message` 加可空列 `activities Json?`(旧数据 / user 消息为 null)。一次 `prisma migrate dev`。
- 与 `content` 并存:`content` 仍是 agent 的完整文字回复(搜索/兜底用),`activities` 是按时序的块序列(交错渲染用)。content 与 activities 里的 content 块文本有少量冗余,可接受。

### 5.2 后端:聚合 + 存储 + 回读
- **聚合 helper** `aggregateActivities(events: ActivityEvent[]): Activity[]`(放 `server/src/pipeline/activity-aggregator.ts`):按 id 分组,累计 `text`、填 `toolArgs`/`toolResult`/`status`/`summary`,产出与 FE `Activity` 同款形状。**服务端聚合**,存紧凑形式(而非数百条原始 delta)。
- **Controller**(`agentos.controller.ts`):emit 时除了写帧 + 累计 `fullReply`,再把每条原始 `ActivityEvent` push 进一个数组;`runTurn` 结束后 `aggregateActivities(collected)` → 作为 `appendTurn` 的新参存到 assistant 消息行。会话 agent + 流水线的事件都汇入同一 emit,故存下的是整轮完整时间线。
- **SessionsService**:`appendTurn(userId, sessionId, userContent, assistantContent, activities?)` 写入;`getRuns` 返回每轮的 `activities`(FE 据此重建)。

### 5.3 前端:加载还原
- session 恢复路径(`useSessionLoader` / `getSessionRuns` 消费处):把返回的 `activities` 赋给对应 agent 消息的 `message.activities`。刷新后 `MessageItem` 见 activities 存在 → 走 `<ActivityTimeline>`,交错时间线完整重现。
- 注意:加载来的 activities 是已聚合的 `Activity[]`,无需再走流式聚合。

## 6. 边界与取舍

- **章节正文仍在右侧 ChapterPreview**:writer 的 `append_section` 落库 + `chapterWriteSeq` 刷新驱动预览;聊天气泡里的 content 只是 agent 的简短话语(如"第1章已写完")。不重复进气泡。
- **思考全文一起存**:每轮约数 KB(写章轮可能 10-20KB),长篇累计可接受;要省体积可后续裁剪 think 文本(只存"N字"标记)。本期存全量。
- **v1 不做缩进嵌套**:`run_pipeline` 内部的 writer/settler 条目与外层平级,靠 `▶ stage` 分隔条做视觉分组。从扁平协议推断"归属"以缩进较脆,留作后续。
- **聚合逻辑两处**:服务端 `aggregateActivities`(存库用)与 FE 流式 handler(实时渲染用)是两份同构实现(agent-ui / server 是独立项目,本就不共享代码,Act* 类型也已双份)。接受。

## 7. 非目标(后续)

- 缩进/折叠整条 `run_pipeline` 成单个标记(需要归属信息或协议扩展)。
- 裁剪/压缩持久化的 think 文本控体积。
- 思考"边想边展开、结束后收起"的混合态(本期统一折叠)。

## 8. 改动文件

**前端:**
- `agent-ui/src/hooks/useAIStreamHandler.tsx` — `ActDelta` content → `activity.text`;`message.content` 改由 `RunCompleted` 赋值。
- `agent-ui/src/components/chat/ChatArea/Messages/Activity/ActivityItem.tsx` — 加 `content` 分支(Markdown 正文块);think/tool 维持折叠标记。
- `agent-ui/src/components/chat/ChatArea/Messages/Activity/ActivityTimeline.tsx` — 去掉 content 过滤。
- `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx` — activities 存在时优先于正文。
- `agent-ui/src/hooks/useSessionLoader.tsx`(或 `getSessionRuns` 消费处)— 把回读的 `activities` 赋给 agent 消息。

**后端:**
- `server/prisma/schema.prisma` — `Message.activities Json?` + 迁移。
- `server/src/pipeline/activity-aggregator.ts`(新)— `aggregateActivities(events) → Activity[]`。
- `server/src/agentos/agentos.controller.ts` — emit 收集原始事件 + 聚合 + 传入 `appendTurn`。
- `server/src/agentos/sessions.service.ts` — `appendTurn(..., activities?)` 写入;`getRuns` 返回 activities。

## 9. 验证

- 质量门:server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`;FE `pnpm validate && pnpm build`。
- 冒烟(浏览器 + curl,人工):新建小说 → 立项 → 写一章,确认
  1. 思考标记 `🧠 ·N字` 在思考阶段字数上涨(不冻屏),出现在它真实的位置;
  2. 工具标记 `🔧` 在文本流中间出现、调用完填 `✓`,点开看参数/返回;
  3. 正文按段夹在中间、实时增长;
  4. 章节正文在右侧 ChapterPreview 一节节长出;
  5. **刷新页面后,交错时间线完整保留**(think 折叠标记 + 工具 + 正文都在);
  6. `GET /sessions/:id/runs` 返回里含 activities;
  7. 多轮无 400。

# 交错内联活动时间线 — 设计文档

- 日期:2026-06-19
- 状态:已与用户确认方向(Markdown 嵌套组件渲染、think/tool 折叠、刷新后保留),待 review
- 范围:把 agent 消息渲染成**一篇 Markdown 文档**,`think`/`tool`/`stage` 作为文档里的**自定义指令组件**嵌套在真实发生位置,正文是普通 Markdown。取代"正文在上 + 活动时间线卡片在下"的双区结构。并**持久化**,使刷新/重开保留。前端渲染(走 Markdown 管线)+ 后端持久化。
- 依赖:v0.6.0-foundation(扁平 `Act*` 活动流协议 + `message.activities` 已落地)

---

## 1. 背景:现在的渲染丢了时序,且是两套样式

v0.6.0 落地的扁平活动流**数据层按时序**(`message.activities[]` 按到达顺序 push),但**渲染层拆成两块**:

1. `message.content`(所有正文)→ MarkdownRenderer,在最上面。
2. `message.activities[]`(think/tool/stage)→ `ActivityTimeline` 卡片列表,在正文下方。

两个问题:(a) think/工具无论发生在哪个时刻都被挪到正文末尾,时序丢失;(b) 时间线是一列独立带背景/圆角的卡片,与正文是**两套样式**,不随 Markdown 扩展。流式期间思考阶段只看到底部卡片在动,正文区冻住——削弱了 foundation 引入 `reasoning_content` 想解决的卡顿观感。

## 2. 目标

把一条 agent 消息渲染成**一篇 Markdown 文档**:

- 正文 = 普通 Markdown(走现有 `prose` + `remark-gfm`,未来任何 Markdown 样式/扩展自动对整篇生效)。
- `think` / `tool` / `stage` = Markdown 里的**自定义指令标记**,渲染时映射成折叠/分隔**组件**,嵌套在真实发生位置。它们是文档一等公民,不是外挂卡片。
- think/tool **默认折叠**成紧凑标记(主流做法,同 Claude/ChatGPT 折叠 reasoning);点开看推理全文 / 工具参数与返回。
- 全部按时序,刷新/重开后保留。

## 3. 渲染模型:Markdown 嵌套组件(remark-directive)

渲染栈:`react-markdown` v9 + `remark-gfm` + `rehype-raw`/`rehype-sanitize`,有 `components` 映射。新增 `remark-directive`:

- 在 Markdown 串里用**自定义指令**标记 think/tool/stage,例如:
  ```
  好的，让我先看看设定……

  ::think[id=t1]
  ::

  我来写第1章。

  ::tool[id=tool3]
  ::

  第1章已写完。
  ```
  (具体指令语法——leaf/container directive——在 plan 里定;标记只携带活动 `id`。)
- 一个极小的 remark 插件把 `think`/`tool`/`stage` 指令节点设 `data.hName`(转成对应 HAST 元素),`react-markdown` 的 `components` 映射把它们渲染成 `ThinkBlock` / `ToolBlock` / `StageBlock` 组件。
- 组件按标记里的 `id` 从一个 **activities 查找表**(React context 提供)取细节:`ThinkBlock` 显示折叠的推理全文(字数流式上涨);`ToolBlock` 显示工具名 + 状态(✓/⏳/⚠),点开看参数/返回;`StageBlock` 是 `▶ writer` 分隔条。
- `rehype-sanitize` 的 schema 白名单放行 `think`/`tool`/`stage` 标签及其 `id` 等属性(否则被 sanitize 清掉)。
- **`MessageItem` 始终是一个 `<MarkdownRenderer>`**(包在 activities context Provider 里),不再有 `ActivityTimeline`。历史/无标记消息(纯 content)照常当普通 Markdown 渲染——天然降级,无需 if/else 分支。

## 4. 数据模型

### 4.1 形状
- **`message.content`** = **带标记的 Markdown 串**:正文段 + `::think[id]` / `::tool[id]` / `::stage[id]` 标记,按活动到达(即真实)顺序拼接。content 的正文直接在串里;think/tool/stage 只放标记,细节在查找表。
- **`message.activities`** = **id → 细节 查找表**(对象/Record):
  - think → `{ act:'think', text }`(推理全文,ActDelta 累计)。
  - tool → `{ act:'tool', label, toolArgs, toolResult, status, summary }`。
  - stage → `{ act:'stage', label }`。
  - content **不进表**(其文本已在 content 串里)。

### 4.2 流式构建(前端 `useAIStreamHandler.tsx`)
处理 `Act*` 事件,增量维护 `message.content`(只追加:正文 delta 接到串尾;遇到 think/tool/stage 的 `Act` 就追加对应标记到串尾)+ `message.activities` 查找表(按 id 累计 text、填 args/result/status)。串本身纯追加,顺序天然正确。

> `RunCompleted` 的角色变化:以前 FE 在 `RunCompleted` 用 `chunk.content` 覆盖 `message.content`。新模型下 FE 已在流式期间把带标记 content 建好,**`RunCompleted` 不再提供展示用 content**(改为只标记流结束;FE 保留自建的 content)。FE 的 `RunCompleted` 分支相应调整(不再覆盖有 activities 的 agent 消息的 content)。展示由 FE 自建、持久化由服务端聚合(§5.2),二者同构。

### 4.3 服务端聚合(存库用,`pipeline/activity-aggregator.ts`)
服务端从它 emit 的 `Act*` 事件,用**同构逻辑**一遍扫出 `{ contentMarkdown, activitiesLookup }`。与前端流式构建是两份实现(agent-ui / server 独立项目,本不共享代码;`Act*` 类型也已双份)。接受。

## 5. 持久化(刷新/重开保留)

### 5.1 数据模型(Prisma)
- `Message` 加可空列 `activities Json?`(旧数据 / user 消息为 null)。一次 `prisma migrate dev`。
- `content` 列继续存"带标记的 Markdown 串";`activities` 存查找表。二者并立:`content` 是可搜索/兜底的文档文本,`activities` 是组件细节。content 串里已含正文,与 activities 无文本重叠(think 文本只在表里)。

### 5.2 后端
- **Controller**(`agentos.controller.ts`):emit 时收集每条原始 `ActivityEvent`;`runTurn` 结束后用聚合器产出 `{ contentMarkdown, activitiesLookup }` → 作为 `appendTurn` 新参存到 assistant 消息行(取代现在只存 `fullReply` 正文)。
- **SessionsService**:`appendTurn(userId, sessionId, userContent, assistantContentMarkdown, activities?)` 写入;`getRuns` 返回每轮的 `content`(带标记)+ `activities`。

### 5.3 前端加载还原
- `useSessionLoader`(getRuns 消费处):把 `content` + `activities` 赋给 agent 消息。刷新后 MarkdownRenderer 渲染带标记的 content,组件按 id 从 activities 取细节 → 交错文档完整重现。无需重新聚合(存的就是聚合后的查找表)。

## 6. 流式观感(对应"消除卡顿"目标)

- GLM 思考阶段:`ThinkBlock` 折叠标记显示 `🧠 思考 ·N字`,**N 实时上涨** → 不冻屏;标记在它真实位置。
- 工具调用:`ToolBlock` 标记在真实时刻出现,调用完填 `✓` 与返回;点开看参数/返回。
- 正文:按段实时刷在时序位置,纯 Markdown 样式。
- 全程一篇文档,呈现"想 → 说 → 调工具 → 想 → 说 → 写章 → 收尾"的真实流程。

## 7. 边界与取舍

- **章节正文仍在右侧 ChapterPreview**:writer 的 `append_section` 落库 + `chapterWriteSeq` 刷新驱动预览;聊天气泡里的 content 只是 agent 的简短话语。不重复进气泡。
- **思考全文一起存**:每轮约数 KB(写章轮可能 10-20KB),长篇累计可接受;要省体积可后续裁剪 think 文本(只存"N字"标记)。本期存全量。
- **聚合/构建逻辑两处**:服务端聚合器(存库)与前端流式构建(实时渲染)同构两份,接受(项目不共享代码)。
- **v1 不做缩进嵌套**:`run_pipeline` 内部条目与外层平级,靠 `StageBlock`(`▶ writer`/`▶ settler`)做视觉分组。从标记位置推断归属做缩进较脆,留作后续。
- **`message.content` 保留**:见专门讨论——它是带标记的 Markdown 文档串,是稳定可搜索的文本载体;user 消息、旧数据、无 activities 兜底都需要它。不因 activities 存在而去掉。

## 8. 非目标(后续)

- 缩进/折叠整条 `run_pipeline` 成单个标记(需归属信息或协议扩展)。
- 裁剪/压缩持久化的 think 文本控体积。
- 思考"边想边展开、结束后收起"的混合态(本期统一折叠)。

## 9. 改动文件

**前端:**
- `src/components/ui/typography/MarkdownRenderer/` — 加 `remark-directive` + 指令→HAST 的小插件 + `components` 映射加 `think`/`tool`/`stage` + `rehype-sanitize` schema 白名单。
- 新 `ThinkBlock.tsx` / `ToolBlock.tsx` / `StageBlock.tsx`(指令组件;放 MarkdownRenderer 附近,归入"Markdown 组件"体系)+ 一个 activities context(Provider 在 MessageItem,组件按 id 取细节)。
- `src/components/chat/ChatArea/Messages/MessageItem.tsx` — 渲染 `<MarkdownRenderer>`(包 activities Provider);删除 `ActivityTimeline` 引用。
- 删 `src/components/chat/ChatArea/Messages/Activity/ActivityTimeline.tsx`;`ActivityItem.tsx` 拆成上述三个 Block 组件(或删后新建)。
- `src/hooks/useAIStreamHandler.tsx` — `Act*` → 增量构建 `message.content`(带标记)+ `message.activities` 查找表(取代现在的 activities 数组)。
- `src/hooks/useSessionLoader.tsx` — getRuns 的 `content` + `activities` 赋给 agent 消息。
- `src/types/os.ts` — `Activity`(查找表条目形状)+ 相关类型。

**后端:**
- `prisma/schema.prisma` — `Message.activities Json?` + 迁移。
- `src/pipeline/activity-aggregator.ts`(新)— `Act*` 事件 → `{ contentMarkdown, activitiesLookup }`。
- `src/agentos/agentos.controller.ts` — emit 收集事件 + 聚合 + 传入 `appendTurn`(存带标记 content + activities)。
- `src/agentos/sessions.service.ts` — `appendTurn(..., activities?)` 写入;`getRuns` 返回 content + activities。

## 10. 验证

- 质量门:server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`;FE `pnpm validate && pnpm build`。
- 冒烟(浏览器 + curl,人工):新建小说 → 立项 → 写一章,确认
  1. agent 回复是一篇 Markdown 文档,正文是纯 Markdown 样式;
  2. `🧠 思考 ·N字` 在思考阶段字数上涨(不冻屏),出现在真实位置,点开看推理;
  3. `🔧` 工具组件在文本流中间出现、调用完填 `✓`,点开看参数/返回;
  4. `▶ writer`/`▶ settler` 分隔条做视觉分组;
  5. 章节正文在右侧 ChapterPreview 一节节长出;
  6. **刷新页面后,带标记的文档 + 组件完整保留**;
  7. `GET /sessions/:id/runs` 返回里含 content(带标记)+ activities;
  8. 多轮无 400。

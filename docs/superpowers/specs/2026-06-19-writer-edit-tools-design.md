# Writer 编辑工具(AI 编程式查找/替换/插入)— 设计文档

- 日期:2026-06-19
- 状态:已与用户确认方向(SEARCH/REPLACE 式查找替换;不改数据模型;含 set_chapter_title;不做 replace_all),待 review
- 范围:**纯后端**。给 writer 专家补齐编辑能力——`replace_text` / `insert_text` / `delete_text` / `set_chapter_title`,沿用 Aider/Cursor 的 SEARCH/REPLACE 思路(AI 读原文、逐字引用要改的片段、精确查找)。`Chapter.content` **仍是单字符串**,不改模型、不迁移。
- 依赖:v0.6.x 的 writer 专家(`server/src/pipeline/writer.agent.ts`)+ `ChapterService`。

---

## 1. 背景:writer 只能追加

writer 现在只有 `append_section`(末尾加一小节)、`get_chapter`、`list_chapters`、`query_memory`。**不能改、删、插中间,也不能改标题**。要修订已写的正文(润色、删冗余、中间插一段、改章节名)都做不到。

用户要求:像 AI 编程工具(Aider SEARCH/REPLACE / Cursor edit)那样,支持查找/替换/插入/删除。

## 2. 目标

新增 4 个工具(SEARCH/REPLACE 风格),**不改数据模型**:

| 工具 | 作用 |
|---|---|
| `replace_text({chapterOrder, find, replace})` | 在第 N 章找到 `find` 原文 → 替换为 `replace`(第一处) |
| `insert_text({chapterOrder, after, content})` | 在 `after` 原文**之后**插入 `content`(`after=""` → 插在最前) |
| `delete_text({chapterOrder, find})` | 删除第 N 章里的 `find` 原文(第一处) |
| `set_chapter_title({chapterOrder, title})` | 改第 N 章标题 |

`append_section` / `get_chapter` / `list_chapters` / `query_memory` **不变**。writer 工具集升到 8 个。

## 3. 可靠性:让查找替换在散文上真能用(核心)

AI 引用原文时,空格/换行常有小偏差。直接 `indexOf` 精确匹配会大量"找不到"。所以匹配策略:

1. **先精确匹配**(`content.indexOf(find)`)。
2. **精确不到 → 空白归一化匹配**:把 `content` 和 `find` 的连续空白(`/\s+/`)都折叠成单空格后再比对;命中后**映射回原文区间**应用替换(保留原文其余空白,不破坏排版)。
3. **找不到** → 返回 `{ ok:false, reason:'not_found' }`,提示"请先 `get_chapter` 看原文、逐字引用";AI 自动重试。
4. **多处匹配** → 替换第一处,结果里带 `matchCount` 并提示"共 N 处,已改第 1 处;如非所愿请引用更长/更独特的片段"。
5. **颗粒度小段**(每个工具一次处理一段,同 `append_section`)——不触发 z.ai ~60s 首 token 超时。

匹配逻辑抽成**纯函数**(独立 util `server/src/novel/content-match.ts`,便于隔离单测):
- `findContentRange(content, find): { start, end } | null` —— 精确 → 空白归一化,返回原文区间或 null。
- `countMatches(content, find): number` —— 统计命中数(供多处匹配提示)。
`insert_text`/`delete_text`/`replace_text` 都复用 `findContentRange` 定位区间。

## 4. ChapterService 新方法

`server/src/novel/chapter.service.ts` 加(均按 user/novel 隔离,复用 `assertOwned`):

- `replaceText(userId, novelId, order, find, replace)`:findByOrder → `findContentRange(content, find)` → 找不到抛/返 not_found → `newContent = content.slice(0,start) + replace + content.slice(end)` → update content + `status: COMMITTED`。返回 `{ ok, matchCount, totalChars }`。
- `insertText(userId, novelId, order, after, content)`:after="" → 插在 0;否则 `findContentRange` 定位 after 区间 → 在 `end` 处插入 content → update。返回 `{ ok, totalChars }`。
- `deleteText(userId, novelId, order, find)`:定位区间 → 删除 → update。返回 `{ ok, totalChars }`。
- `setChapterTitle(userId, novelId, order, title)`:findByOrder → update title。返回 `{ ok, title }`。

> 章节不存在(`findByOrder` 返回 null)→ 返回 `{ ok:false, reason:'no_such_chapter' }`(不自动建章——编辑必须针对已存在章节)。

## 5. 工具工厂

`server/src/agentos/tools/` 新增(镜像 `append-section.tool.ts` 的工厂模式,userId/novelId 闭包注入):

- `replace-text.tool.ts` → `makeReplaceTextTool({ userId, novelId, chapters })`
- `insert-text.tool.ts` → `makeInsertTextTool(...)`
- `delete-text.tool.ts` → `makeDeleteTextTool(...)`
- `set-chapter-title.tool.ts` → `makeSetChapterTitleTool(...)`

每个:zod schema + 调对应 ChapterService 方法 + 返回结果对象。**userId/novelId 永远闭包注入,不从 LLM 入参取**(防越权)。

## 6. writer 接线 + prompt

- `writer.agent.ts`:把 4 个新工具加入 `tools` 数组(append/get/list/query 不变)。
- `agent-prompts.ts` 的 `WRITER_AGENT_PROMPT`:加编辑纪律——
  - **改旧文前先 `get_chapter` 看原文**,再逐字引用要改的片段。
  - `replace_text`/`insert_text`/`delete_text` 用于修订已写正文;`append_section` 用于加新内容。
  - 引用片段要**够独特**(避免多处匹配),一次改一小段。
  - `set_chapter_title` 改标题。

## 7. 边界与取舍(YAGNI)

- **不做 `replace_all`**:散文里易误伤;改名用多次精确 `replace_text` 更安全。
- **不引入 Section 结构 / 不改 `Chapter.content` 模型**:用户选了查找替换路线,不建表、不迁移。
- **不做移动/重排小节**:超出查找替换范畴。
- **编辑不自动建章**:replace/insert/delete/title 要求章节已存在(`append_section` 仍自动建章)。

## 8. 改动文件

- `server/src/novel/chapter.service.ts` — 加 `findContentRange`(或独立 util)+ `replaceText`/`insertText`/`deleteText`/`setChapterTitle`。
- `server/src/novel/chapter.service.spec.ts`(或新 util spec)— TDD:`findContentRange`(精确/归一化/找不到)+ 各方法。
- 新 `server/src/agentos/tools/replace-text.tool.ts` / `insert-text.tool.ts` / `delete-text.tool.ts` / `set-chapter-title.tool.ts`。
- `server/src/pipeline/writer.agent.ts` — 接 4 个新工具。
- `server/src/agentos/agent-prompts.ts` — `WRITER_AGENT_PROMPT` 编辑纪律。

## 9. 验证

- 质量门:server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。
- **TDD 重点**:`findContentRange` 单测(精确命中 / 空白差异归一化命中 / 多余空白保留 / 找不到返 null / 多处返回第一处);`replaceText`/`insertText`/`deleteText`/`setChapterTitle` 单测(含越权隔离、章节不存在、多处匹配提示)。
- 冒烟(人工/聊天):让 AI「把第1章第2段的'少年'改成'青年'」「删掉第1章里的某句」「在开头插入一段」「把标题改成 X」——确认精确替换、归一化容错、找不到时重试、标题修改都正常,且 writer 不踩 60s。

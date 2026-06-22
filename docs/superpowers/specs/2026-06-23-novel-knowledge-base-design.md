# 写作知识库（Novel Knowledge Base）设计

**日期**: 2026-06-23
**状态**: 设计稿，待评审
**关联**: 语料产物见 `知识库/`（633 条 / 6 类，生成脚本 `build_kb_index.py` 等，记忆 `writing-knowledge-base-corpus`）

## 1. 目标

让 narratox 在写小说时能利用一批现成的写作方法论/案例/词汇素材。两条独立诉求：

1. **可查阅**：主页左侧加「写作知识库」入口，能在页面上浏览全局知识库（633 条、6 分类、可搜索）。
2. **可被写作利用**：收集信息完成后，由一个 curator 子 agent **为这本小说量身提炼一份专属参考资料**（去冗余、留所需），固化进小说 DB；之后全程只从这份小说级资料里取——大纲规划与写正文时，标注了 agent 的条目自动注入对应 context，其余条目由 agent 通过工具按需拉取。

## 2. 两层知识，边界清晰

| | 全局知识库 | 小说级参考资料 |
|---|---|---|
| **存哪** | 文件（`知识库/kb_index.json` + `条目/<分类>/*.md`），**不进 DB** | DB（`NovelReference` 表，属 novel 数据） |
| **内容** | 633 条原始条目（方法论/拆文/词汇/须知/模板/人设） | curator 为某本小说**提炼**出的若干条目 |
| **谁读** | `/knowledge` 浏览页 + curator 子 agent（仅立项时） | workspace「参考资料」面板 + main/writer context 注入 + `get_reference` 工具 |
| **何时读** | 浏览时按需；**仅 CONCEPT 立项时**由 curator 搜索 | 写作全程（每轮注入 + 工具拉取） |

> 「不用存数据库」针对的是全局语料正文（813 万字不进库）；小说级参考资料是 novel 数据，存 DB，与世界观/大纲/章节一致。

## 3. 数据模型

### 3.1 新增 `NovelReference`（Prisma）

```
model NovelReference {
  id        String   @id @default(cuid())
  novelId   String
  userId    String            // 多租户隔离
  title     String            // 条目标题，如「悬疑题材的钩子写法」
  category  String            // 方法论/案例/词汇/须知/模板/人设（沿用全局分类）
  content   String            // markdown，curator 提炼后的正文
  injectTo  String?           // 'main' | 'writer' | 'both' | null（null=仅工具可取）
  source    String?           // 来源 provenance：全局 KB 条目 id 列表（JSON 串），便于追溯
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id])
  @@index([novelId])
}
```

`Novel` / `User` 加反向关系字段 `novelReferences NovelReference[]`。

### 3.2 全局知识库（无 schema）

`KnowledgeService`（server 首个读文件的 service）启动时读一次 `知识库/kb_index.json`，内存缓存：
- 路径：`process.env.KB_DIR ?? path.resolve(process.cwd(), '..', '知识库')`（server 从 `server/` 启动，`..` 即仓库根）。
- 条目正文按需读 `条目/<分类>/<slug>.md`（解析 frontmatter 取 body）。

## 4. curator 子 agent（新增第 4 个 subagent）

加入 `createDeepAgent` 的 subagents（与 writer/settler/validator 并列）。

- **何时跑**：CONCEPT 收集 7 项信息齐（main 判定 `missing` 为空）时，main **先**委派 curator（`task`），**再**建世界观 + 大纲。确保大纲规划时参考资料已就位。
- **工具**：
  - `search_knowledge(query, category?, tags?)` → 查全局 KB（走 `KnowledgeService`），返回 top-k 条目的**完整**正文。**仅 curator 拥有**；curator 跑完后 main/writer 不再碰全局 KB。
  - `set_references(entries[])` → **批量覆写**该 novel 的 `NovelReference`（先清旧、再写新，保证 curator 重跑幂等；`userId`/`novelId` 闭包注入，安全同现有工具）。每条 entry = `{ title, category, content, injectTo }`。
- **职责（system prompt 要点）**：按小说 genre/简介/世界观/核心冲突，搜全局 KB → **分析、去重、删冗余、留本书所需** → 产出若干条结构化 `NovelReference`，并为每条**判定 `injectTo`**（大纲/方法论类→`main`；词汇/描写/题材案例类→`writer`；创作须知类→`both`；参考性弱但偶有用的→`null`）。
- **幂等**：curator 跑前清掉该 novel 旧的 `NovelReference`（支持重跑，如用户改了题材后手动再触发）。

## 5. context 注入语义（核心）

`NovelReference` 按 `injectTo` 决定去向；另维护一份**全量索引**让 agent 知道还有什么可拉。

### 5.1 索引（每轮注入，极小）

所有该 novel 的 `NovelReference` 压缩成一行式索引：
```
【参考资料目录】
- [main] 悬疑题材钩子写法（方法论）— 开篇如何抛悬念
- [writer] 情绪动作词库（词汇）— 哭/怒/惊的动词与神态
- [both] 女频审核红线（须知）— 规避点
- [—] 复仇文爆款拆解（案例）— 工具按需取
```
（`[—]` 即 injectTo=null，标明「工具可取」。）

### 5.2 main agent（ContextAssembler.forSession）

在现有 slices 里追加 **【写作参考】**：
- 全量索引（5.1）
- `injectTo ∈ {main, both}` 条目的**完整 content**

### 5.3 writer subagent（DeepAgentService 建 agent 时）

writer 的 system prompt（`WRITER_PROMPT`）由静态常量改为**每轮动态拼**：
- 原始 `WRITER_PROMPT`
- + **【写作参考】** = 全量索引 + `injectTo ∈ {writer, both}` 条目的完整 content

> writer 每轮直接拿到（不靠 main 转发，免遗忘——满足此前讨论）。main/writer 都拿全量索引，故都能「按索引指导」调用工具拉取 injectTo=null 的条目。

### 5.4 `get_reference` 工具（main + writer）

```
get_reference(by: { id? | title? | category? | query? }) → 返回匹配 NovelReference 的完整 content（top 3）
```
用于按需拉取 injectTo=null 的条目，或重新取某条全文。**不读全局 KB**。

## 6. 前端

### 6.1 全局知识库浏览页 `/knowledge`（布局 B）

- [AppSidebar.tsx](agent-ui/src/components/layout/AppSidebar.tsx) `TABS` 加 `{ key:'knowledge', label:'写作知识库', href:'/knowledge' }`，`active` 联合类型加 `'knowledge'`。
- `app/knowledge/page.tsx`：复用 settings 页骨架（`RequireAuth` + `AppSidebar active="knowledge"` + 客户端组件）。
- `components/knowledge/KnowledgeBrowser.tsx`：**两栏**——
  - 左栏：顶部搜索框；可折叠分类树（6 类 + 计数）；分类下的条目列表（标题 + 描述 + 标签）。
  - 右栏：选中条目的 markdown 正文阅读器（复用 `MarkdownRenderer`）。
- `api/knowledge.ts` + `routes.ts`：`Knowledge`（列表/分类）、`KnowledgeEntry`（单条正文）。

### 6.2 工作台「参考资料」资源面板

- IconRail（`components/workspace/`）加一项 `{ 参考资料 }`，对应 ResourcePanel 新视图。
- 视图：列出该 novel 的 `NovelReference`，每条显示 `injectTo` 徽标（main/writer/both/工具可取）、分类、标题；点击右栏读正文。可选：支持编辑（改 content/injectTo，存回）。
- 数据走现有 novel API 扩展：`GET /novels/:id/references`、`PATCH /novels/:id/references/:rid`。

## 7. 后端组件清单

| 组件 | 位置 | 职责 |
|---|---|---|
| `KnowledgeService` | `server/src/knowledge/`（新模块） | 读 `知识库/` 文件，缓存 index，按需读正文；提供 `search(query, category, tags)`（curator 用）与 `list/getEntry`（浏览页用） |
| `KnowledgeController` | 同上 | `GET /knowledge`、`GET /knowledge/:id`、`GET /knowledge?search=&category=&tag=`。**JWT 保护（默认全局 guard，不加 `@Public`）**，全只读；全局 KB 是所有用户共享的参考资料（无 user 维度），故不做按 user 隔离——只是「登录才能看」 |
| `NovelReferenceService` | `server/src/novel/`（或 memory/） | `NovelReference` CRUD，按 novelId/userId 范围；`listForInject(novelId, role)` 返回该角色该注入的条目 + 全量索引 |
| `ContextAssembler` | 改 | `forSession` 追加【写作参考】slice（main 的注入条目 + 索引） |
| `DeepAgentService` | 改 | 建 agent 时把 writer 的注入条目 + 索引拼进 writer prompt；注册 `get_reference` 工具给 main+writer |
| curator 子 agent | `agent-prompts.ts` + `deep-agent.service.ts` | 新 subagent；工具 `search_knowledge`（curator only）+ `add_reference`/`set_references` |
| 工具工厂 | `server/src/agentos/tools/` | 新增 `search_knowledge`（curator）、`set_references`（curator）、`get_reference`（main+writer）；均 `userId`/`novelId` 闭包注入 |
| `app.module.ts` | 改 | 注册 `KnowledgeModule` |
| Prisma 迁移 | `server/prisma/schema.prisma` | 加 `NovelReference` + 反向关系 |

## 8. 关键流程

### 8.1 立项 → 生成参考资料
1. 用户建小说（CONCEPT），main 收集 7 项（`update_novel`）。
2. `missing` 为空 → main 委派 curator（`task`）。
3. curator 调 `search_knowledge` 查全局 KB → 分析提炼 → `set_references` 写入 `NovelReference`（带 `injectTo`）。
4. curator 返回 → main 建世界观（`set_world_entry`）→ 规划大纲（`set_volume` / `set_chapter_plan`）（此时【写作参考】已注入 main context）。

### 8.2 写正文
1. ACTIVE 态，main 委派 writer 写章。
2. writer prompt 含【写作参考】（writer/both 条目全文 + 索引）。
3. writer 写作中如需更多（如某 injectTo=null 的案例），调 `get_reference` 拉取。
4. writer 完稿 → settler 结算 → validator 校验（不变）。

## 9. 边界与延后

- **OCR 来源降权**：全局 KB 中 97 条 `source_ocr` 条目，curator 搜索结果里降权（或仅当高度相关才纳入）。
- **重跑 curator**：用户改了题材后可手动重触发（清旧 NovelReference 重生成）；MVP 不自动检测题材变更。
- **参考资料编辑**：workspace 面板支持查看为主；编辑（改 content/injectTo）为可选增强。
- **全局 KB 不再被 main/writer 直查**：写作阶段仅 curator 用全局 KB；main/writer 只用 `NovelReference` + `get_reference`。
- **token 预算**：注入条目数由 curator 控制（建议 main/writer 各自动注入 ≤6 条，索引始终全量）。若超预算，后续可按章节相关性裁剪。

## 10. 不在本期范围

- 向量化 / 语义检索（pgvector）——本期 `search_knowledge` 用关键词+标签匹配即可。
- 全局 KB 的在线编辑/上传——仍由 `build_kb_index.py` 离线生成。
- 参考资料的版本历史。

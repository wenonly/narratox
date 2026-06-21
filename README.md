# narratox

> 人机协作的 AI 长篇小说写作工作区。作者主导立项与 steering，AI 负责写章、结算事实、维护一致性——目标是**让 AI 写长篇网文能真实落地，写到第 200 章一致性不崩**。
>
> 当前阶段：**Phase 4**（deepagents 迁移 + 多 provider 模型配置已完成；记忆层骨架已搭好，正在补齐长篇一致性能力）。

---

## 这是什么

narratox 是一个多项目 monorepo，由两个互通的应用组成：

- **`agent-ui/`** — Next.js 15 + React 18 + TypeScript 的小说写作工作区（`server` 的专属前端）：小说库、3 区写作工作台（资源导航 / 对话 / 章节预览）、登录注册、模型设置页。
- **`server/`** — NestJS 11 + Prisma 7（PostgreSQL）API：JWT 鉴权、基于 `deepagents` 的写作 Agent（主 agent + writer/settler/validator 子 agent）、小说/章节 CRUD、每用户可配置的多 provider 模型、结构化「事实/伏笔」记忆层。
- **`langchain-learn/`** — 仅参考材料（deep-agents 教程），不构建、不被引用。

> 根 `package.json` 只做编排（`npm-run-all2` 并行跑子项目），**不是 pnpm workspace**，子项目各自需要 `pnpm install`。

---

## 核心特性（已实现）

- ✅ **对话驱动的写作工作台** — 复用 chat 基础设施，AI 通过工具自动写/改章节正文，无需手动「采纳」。
- ✅ **立项 → 写作 状态机** — `Novel.status: CONCEPT | ACTIVE`，立项中收集基础信息，齐了进入写作。
- ✅ **多 agent 分工** — 主 agent 编排，`writer`（写正文）/ `settler`（结算摘要/角色/伏笔）/ `validator`（一致性校验）子 agent 各司其职、温度分层。
- ✅ **结构化记忆层** — `ChapterSummary`（章节摘要 + 角色变化 + 实体）+ `StoryEvent`（伏笔账本，OPEN/RESOLVED），每章结算自动维护。
- ✅ **被动 + 主动记忆** — 每轮注入【前情】（最近章节摘要）+【未回收伏笔】；`query_memory` 工具按关键词检索已记住的事实。
- ✅ **每用户多 provider 模型配置** — OpenAI 兼容（GLM / DeepSeek / Moonshot / Qwen / OpenAI）/ Anthropic / Gemini，在 `/settings` 配置与激活，API key 不离开服务端。
- ✅ **多租户隔离** — 所有数据按 `user.id` 作用域；`userId`/`novelId` 在工具构造时闭包注入，模型无法越权。

---

## 快速开始

**前置**：Node.js、pnpm、PostgreSQL。

```sh
# 1. 根目录装编排工具（只装 npm-run-all2）
pnpm install

# 2. 两个子项目各自装依赖
pnpm --dir agent-ui install
pnpm --dir server install

# 3. 配置 server 环境（gitignored）
cp server/.env.example server/.env
#   填入 DATABASE_URL（PostgreSQL）、JWT_SECRET
#   注意：模型 provider 的 API key 不在 .env，而是在 /settings 页面按用户配置

# 4. 初始化数据库（Prisma 7 配置驱动，无需 --schema）
pnpm --dir server exec prisma migrate dev

# 5. 一键并行启动
pnpm dev
#   → agent-ui  http://localhost:3000
#   → server    http://localhost:3001   （根脚本把 server 固定在 :3001，避免与 agent-ui 冲突）
```

打开 http://localhost:3000 → 注册 → 在 `/settings` 添加并激活一个模型 → 回首页「新建小说」。

### 常用命令

```sh
pnpm dev              # 并行启动前端 + 后端
pnpm build            # 并行构建

# 前端（cd agent-ui）
pnpm dev | build | lint | typecheck | validate   # validate = lint && format && typecheck
# 注意：agent-ui 无测试运行器，质量门是 pnpm validate

# 后端（cd server）
pnpm start:dev | build | test | typecheck
pnpm test -- novel.service.spec.ts      # 单文件
pnpm test -- -t "should return ..."     # 单用例
```

完整命令与架构细节见 [CLAUDE.md](./CLAUDE.md)。

---

## 架构一览

```
agent-ui (Next.js :3000)                         server (NestJS :3001)
┌──────────────────────────┐         ┌─────────────────────────────────────┐
│ /            小说库        │         │ AuthModule     JWT 全局守卫          │
│ /novels/[id] 写作工作台    │ ──API──▶│ AgentosModule  deepagents 写作 Agent │
│ /settings    模型配置      │  Bearer │ NovelModule    小说/章节 CRUD + 变更层 │
│ /login /register          │         │ SettingsModule 每用户模型配置         │
└──────────────────────────┘         │                                     │
   Zustand store (token)             │ Prisma (PostgreSQL)                 │
                                     │   User / Novel / Chapter / Session  │
                                     │   ChapterSummary / StoryEvent       │
                                     │   ModelConfig                       │
                                     └─────────────────────────────────────┘
```

**写作 Agent 流程**（层级多 agent）：主 agent 收到「写章」指令 → 委派 **`chapter` 编排子 agent** → 它在自己的聚焦上下文里依次委派 `writer`（写正文入 `Chapter.content`）→ `settler`（结算摘要/角色/伏笔入 `ChapterSummary` + `StoryEvent`）→ `validator`（`report_review` 多维审计 + 分数）→ 必要时修订闭环（`snapshot_chapter` → writer 定点修订 → 复校 → `restore_chapter` 回滚）。活动流以扁平 `ActivityEvent` 帧流式返回前端。

> 主 agent 不再在长线程里临场串 writer/settler/validator——下沉到 `chapter` 编排 agent 的聚焦上下文（webnovel 式聚焦过程），可靠跑完 写→结算→校验(+修订) 全链。详见 [docs/ROADMAP.md](./docs/ROADMAP.md)。

---

## 路线图 / 待办

> 完整规划、依赖排序与方法论依据见 **[docs/ROADMAP.md](./docs/ROADMAP.md)**。北极星：**写到第 200 章一致性不崩**。

### Stage A — 地基与确定性（P0，长篇落地门槛）
- [x] A1 补齐立项必填信息：`chapterWordTarget` + `coreConflict`（settings JSON、软闸门、prompt 注入、FE 信息卡）
- [ ] A1.2 立项推荐信息：总篇幅 / 主角骨架 / 力量体系 / 创意约束 / 目标平台 / POV
- [x] A2 结算关卡：`ChapterService.assertFrontier` 领域关卡（前驱未结算则拒绝推进）+ `MAIN_AGENT_PROMPT` 编号化写章流程 skill + 移除幻影 `run_pipeline`
- [ ] A3 写章前的轻规划步（产出本章焦点 + hook account）

### Stage B — 记忆与一致性骨干（P0/P1）
- [x] B1 伏笔生命周期：`StoryEvent` + `payoffTiming`（分层陈旧）+ `PROGRESSING` + `advancedCount` + `coreHook` + `dependsOn`（伏笔↔伏笔依赖）+ 状态面板（HooksView 分组：核心/进行中/⚠️陈旧/已回收）+ 自动刷新
- [ ] B2 角色信息边界（character_matrix：关系 + 知情范围）
- [ ] B3 `current_state` 聚合视图

### Stage C — 结构化大纲与按需上下文（P1/P2）
- [x] 世界观 codex：`WorldEntry`（8 类 type 条目）+ 工具（set/get）+ 核心条目（concept+powerSystem）被动注入 + WorldView（按类型分组）+ 自动刷新
- [x] C1 结构化大纲：Volume + ChapterOutline（CBN/CPNs/CEN 节点）+ 工具（set/get）+ 写章双关卡 + OutlineView（Option A 时间线）
- [ ] C2 ContextAssembler 按相关性 + token 预算注入（替代「最近 5 章」）
- [ ] C3 模块化按需加载 prompt（拆出审查维度/结算规则/题材规则）

### Stage D — 质量闭环与安全网（P1/P2）
- [x] D1 validator→writer 修订闭环：`report_review`（6-7 维结构化审计 + score）+ 修订闭环（snapshot→writer spot-fix→复校→`restore` 回滚，max 1 轮）
- [ ] D2 长度归一化（用 A1 的字数目标）
- [ ] D3 章节快照/回滚 + `state-degraded` 安全
- [ ] D4 类型化事件 + 投影路由（webnovel 事件溯源，长期）

### Stage E — 体验与扩展（P2/P3）
- [ ] E1 项目体检 / Dashboard（一致性报告）
- [ ] E2 短篇独立闭环
- [ ] E3 题材 profiles（玄幻/都市/科幻…）
- [ ] E4 Anti-AI-tells 检测 + API key 加密存储

---

## 参考与致谢

narratox 的长篇一致性方法论参考了两个开源项目（**学方法论，不照搬架构**）：

- **[inkos](https://www.npmjs.com/package/@actalk/inkos)**（`@actalk/inkos`，MIT）— autonomous AI 写小说 agent，7 份真相文件 + Hook 生命周期 + 多温度分阶段。分析见 [docs/references/inkos-workflow-reference.md](./docs/references/inkos-workflow-reference.md)。
- **webnovel-writer**（GPL v3，作者 lingfengQAQ）— Claude Code 插件形态，事件溯源 + CQRS + 结构化章纲节点 + 三层记忆。分析见 [docs/references/webnovel-writer-workflow-reference.md](./docs/references/webnovel-writer-workflow-reference.md)。

技术栈致谢：[deepagents](https://github.com/langchain-ai/deepagents)、[LangChain](https://github.com/langchain-ai/langchain)、[NestJS](https://nestjs.com/)、[Next.js](https://nextjs.org/)、[Prisma](https://www.prisma.io/)、[shadcn/ui](https://ui.shadcn.com/)。前端起源于 Agno「Agent UI」模板并已重构为小说工作区。

---

## 文档导航

- [CLAUDE.md](./CLAUDE.md) — 给 AI 助手的完整工程指南（架构、命令、约定）
- [docs/ROADMAP.md](./docs/ROADMAP.md) — 演进路线图与「skill 化」思考
- [docs/references/](./docs/references/) — inkos / webnovel-writer 参考项目分析
- [docs/logging.md](./docs/logging.md) — 日志约定

---

*私有项目（`private: true`）。当前为前期开发阶段。*

# oh-story-claudecode 创作闭环参考

> 参考项目：`~/project/oh-story-claudecode`（`worldwonderer/oh-story-claudecode` v0.6.21，MIT，纯 Markdown + bash/python/node 守卫，无构建/无运行时）
> 用途：为 narratox 演进提供**与 inkos / webnovel-writer 完全不同范式**的对照参考——不是自主流水线、不是 Web copilot，而是 **skill 包**：作者主导 + AI 每步辅助 + 守卫脚本兜底。
> 配套文档：[inkos-workflow-reference.md](./inkos-workflow-reference.md)（autonomous pipeline）、[webnovel-writer-workflow-reference.md](./webnovel-writer-workflow-reference.md)（类似形态的另一对照）。
> 分析日期：2026-06-30

---

## 0. 一句话定位

oh-story-claudecode 是一个 **Claude Code / OpenCode / Codex / OpenClaw 四端通用的网文写作 skill 包**——不是"陪作者聊天"，也不是"AI 自己写完"，而是 **把网文工业化流程（扫榜 → 拆文 → 写作 → 去 AI 味）拆成 13 个 skill + 7 个 subagent + 7 个守卫 hook**，作者在每一步主导，AI 用 prompt + 守卫兜底确保交付质量。

这是三个项目里**最反 LLM-as-magic 的方案**。它假设：① 模型会漂、会偷懒、会漏步骤；② 长篇一致性靠**人 + 文件系统 + 守卫**三角保证，不靠一个"全知 agent"。所以它花大量工程在**确定性脚本、文件目录契约、阻断式 hook** 上。

| | inkos | narratox（Phase 1 现状） | oh-story-claudecode |
|---|---|---|---|
| 形态 | 自主流水线（10-agent） | Web copilot（chat → 采纳） | skill 包（13 skill + 7 agent + 7 hook） |
| 主导者 | AI | 人类作者（采纳） | 人类作者（每步参与） |
| 一致性机制 | 7 份真相文件 + Hook ledger + 状态快照 | per-novel system prompt + 最近章节摘要 | **文件系统 7 类目录**（设定/大纲/正文/对标/拆文库/追踪/参考资料）+ 守卫 hook |
| 多 CLI 适配 | 单 CLI（Ink/React TUI） | 单 Web 客户端 | **4 CLI 共一份 canonical**（OpenCode/Codex/OpenClaw 自动生成） |
| 守卫强度 | 33 维审计 + 修订循环 | 无 | **PreToolUse 阻断式**（写正文前必须有细纲）+ PostToolUse 兜底 |
| 去 AI 味 | anti-AI-tells 层 | 无 | **三层防御**（banned-words + 句式 detector + narrative-writer 7 Gate） |

它解决的**核心硬问题**与 inkos 相同——"写到第 200 章如何保持一致性"——但用**不同的杠杆**：inkos 押注"状态机 + 真相文件 + 审计循环"，oh-story 押注"作者 steering + 文件契约 + 确定性守卫"。

---

## 1. 项目形态

- **Stack**：Markdown（`SKILL.md` + `references/*.md`）+ 守卫脚本（bash/python/node，跨平台兼容）。**无构建、无运行时、无 DB、无 server**。
- **分发**：`npx skills add worldwonderer/oh-story-claudecode -g`，把 `skills/*` 复制到 `~/.claude/skills/`；项目级用 `/story-setup` 把 hooks/agents/rules 部署到用户项目 `.claude/`。
- **目标平台**：中文网文（起点 / 番茄 / 晋江 / 七猫 / 刺猬猫 / 知乎盐言 / 番茄短篇），全中文。
- **CI**：GitHub Actions 矩阵跑 ubuntu/windows/macos，20+ 个 `scripts/check-*.sh / test-*.sh` 守卫脚本。

---

## 2. 全流程总览（流水线）

```
/story-setup     环境（hooks/agents/rules/CLAUDE.md 部署）
    ↓
scan（扫榜）  ── analyze（拆文）── write（写作）── deslop（去 AI 味）
    ↓               ↓               ↓              ↓
 选题决策.md    拆文库/{书}/      正文/          干净正文
                对标/{书}/
```

每段都有长篇/短篇两个 skill 分支（`story-long-*` / `story-short-*`），加上 `story`（路由器）、`story-import`（逆向导入已有小说为续写工程）、`story-review`（多视角审稿）、`story-cover`（封面生成）、`browser-cdp`（CDP 复用登录态抓数据），共 13 个 skill。

每个 skill 内部是 **Phase 化流程**（Phase 0/1/2/3...），由 `SKILL.md` 顶部声明，`references/*.md` 按需加载（不预占上下文）。

---

## 3. Skill 内部结构（核心可迁移设计）

每个 skill 三件套：

```
skills/{skill-name}/
├── SKILL.md          # 入口：frontmatter + 路由 + Phase 流程
├── references/       # 按需加载的方法论知识库（10-40 个 .md）
└── scripts/          # 部分 skill 自带的确定性脚本（如 check-ai-patterns.js）
```

**Frontmatter 硬约束**（OpenClaw 兼容）：

```yaml
---
name: skill-name
description: "一句话描述。触发方式：/skill-name、触发词1、触发词2"
metadata: {"openclaw":{"source":"https://github.com/..."}}
---
```

`description` 不用块语法，`metadata` 必须是单行 JSON。

**关键不变量**：references 是**按需加载**，不预占上下文；同一 skill 内不重复内容；跨 skill 用路径引用而非复制（除少数字节同步的共享文件如 `banned-words.md` / `anti-ai-writing.md` / `check-ai-patterns.js`）。

---

## 4. 跨 CLI 适配（最重要的架构事实）

同一套 skill 同时跑在 **Claude Code（primary）/ OpenCode / Codex CLI / OpenClaw（Phase 1 skills-only）** 四端。后三端的适配层**自动生成**，不是手维护的第二份：

| 产物 | 来源 | 何时重生成 |
|---|---|---|
| `skills/story-setup/references/opencode/agents/*.md`、`AGENTS.md.tmpl` | `scripts/sync-opencode.py` 从 `templates/agents/*.md` + `CLAUDE.md.tmpl` 生成 | 改任一 Claude 模板后必跑 |
| `.codex/agents/*.toml`（部署态）/ `codex/agents/`（生成源） | `scripts/generate-codex-agents.py` 从 `templates/agents/*.md` 生成 | 改任一 Claude agent 模板后必跑 |
| OpenClaw | 不复制第二份；仓库根 `skills/` 即 canonical，`.agents/skills` 是指向 `../skills` 的**相对** symlink | 必须 `git config core.symlinks=true`（Windows） |

**改了 `skills/story-setup/references/templates/agents/*.md` 或 `CLAUDE.md.tmpl` 后，必须**：

1. `python3 scripts/sync-opencode.py`（生成 OpenCode 侧）
2. `python3 scripts/generate-codex-agents.py`（生成 Codex 侧）
3. `bash scripts/check-opencode-adapter.sh && bash scripts/check-codex-adapter.sh`

否则 CI 红。

### 跨平台硬约束（hooks 翻车集中区）

`/story-setup` 部署的 hook 在三平台 + 四 CLI 共 12 种组合跑，最容易翻车的地方都有强制规则：

| 风险 | 守卫 |
|---|---|
| Windows 中文系统 GBK 区域把 UTF-8 字面量按多字节误解码 | 所有 hook **先 `export LC_ALL=C`** 再做匹配（issue #164） |
| Windows `python3` 命中 Microsoft Store 占位程序、exit 49 | **禁止裸调 `python3`**，必须按 `python3 → python → py` 探测实跑 `-c ""` |
| Windows 内嵌 python stdout 默认 cp936 编码中文路径成 GBK | 必须 `sys.stdout.buffer.write(...encode('utf-8'))` 直写字节 |
| Codex Windows 用 `%COMSPEC% /C`（cmd.exe）跑 hook | Codex `hooks.json` 每个 event 同时带 `command`（POSIX sh）和 `commandWindows`（cmd.exe） |
| 盘符绝对路径（`F:/work/...` / `F:\work\...`）被当相对路径拼错 | `[A-Za-z]:[/\\]*` case 命中盘符，反斜杠统一成正斜杠 |
| PreToolUse 拦截语义各 CLI 不同 | Claude Code 用 `exit 2`；Codex 用 `hookSpecificOutput.permissionDecision: "deny"` JSON；OpenCode 部分 hook 无对应事件 |

**字节同步共享文件**（`check-shared-files.sh` 强制）：`banned-words.md`、`anti-ai-writing.md`、`check-ai-patterns.js`、`normalize-punctuation.js` 在多个 skill 下有副本，改一处必须同步所有副本。

---

## 5. 7-Agent 体系 + full/lean/solo 降级

`/story-setup` 把 7 个 agent 部署到项目 `.claude/agents/*.md`（OpenCode → `.opencode/agents/`，Codex → `.codex/agents/*.toml`）：

| Agent | 模型 | 职责 | 工具 |
|---|---|---|---|
| **story-architect** | Opus | 故事架构：题材定位、大纲结构、钩子/反转、情绪弧线 | Read/Glob/Grep/Write/Edit |
| **character-designer** | Sonnet | 角色设计：角色档案、语言风格、动机链、对话创作 | Read/Glob/Grep/Write/Edit |
| **narrative-writer** | Sonnet | 叙事写手：正文写作、去 AI 味、格式合规 | Read/Glob/Grep/Write/Edit |
| **consistency-checker** | Haiku | 一致性：grep-first 事实冲突扫描、伏笔追踪、S1-S4 分级报告 | 只读 |
| **story-researcher** | Sonnet | 资料：CDP 搜索+正文提取、多源交叉验证、结构化参考输出 | 全 |
| **story-explorer** | Haiku | 故事查询：角色/伏笔/设定/进度只读查询，日更上下文快速加载 | 只读 |
| **chapter-extractor** | Haiku | 章节提取：摘要+情节点+角色提及，**并行拆文核心单元** | 只读 |

### 关键设计 1：Agent 在会话启动时注册

Claude Code / Codex 只在会话启动时扫描 `.claude/agents/` 注册 `subagent_type`。`/story-setup` 写入后**必须新开会话**，否则 `story-review` / `story-long-write` spawn 时拿到「subagent_type 不可用 / unknown agent_type」并降级 solo。判断是否生效：新会话跑 `/story-review`，报告头 `Effective Mode: full/lean` 即注册成功。

### 关键设计 2：full/lean/solo 三级降级（永不硬失败）

`story-review` 是降级模式最完整的 skill——**永远不硬失败**：

```
full → 4 个 agent 并行（architect + character-designer + narrative-writer + consistency-checker）
lean → 2 个 agent（architect + consistency-checker）
solo → 主会话直接审
```

降级触发条件（任一命中即降级并在报告中明示 `Fallback: ... -> solo`）：

| 触发 | 报告字段 |
|---|---|
| 当前已在子代理内（递归保护） | `subagent recursion guard -> solo` |
| 必需 agent 文件缺失 | `missing agents -> solo` |
| agent frontmatter/TOML malformed 或 `name:` 不匹配 | `malformed agents -> solo` |
| `.story-deployed.agents_version` < 16（旧版部署） | `stale agents -> solo` |
| Agent/Task 工具不可用 | `agent tool unavailable -> solo` |
| spawn 返回 unknown agent_type / 运行时失败 | `spawn failed -> solo` |

报告强制 5 个英文 key 逐字输出（不翻译）：`Requested Mode` / `Effective Mode` / `Fallback` / `Rubric` / `Rubric Source`。

### 关键设计 3：subagent 不继承父上下文，prompt 必须自包含

每个 spawn 的 prompt 必须内联：项目路径、审查范围、文件路径、必要摘录、**审查基准包摘要**、`Rubric Source`、统一 Findings Schema。**不要求子 agent 必须读 `references/*`**——主会话把 rubric 内联进去。子 agent 可读 `story-setup/references/agent-references/*` 作补充，但不是前提。

### 关键设计 4：内置 fallback（参考文件不可读时）

每个 skill 内置一份压缩的**审查基准包 / 禁用词速查 / 平台 rubric 摘要**——参考文件读不到时报告 `Rubric Source: embedded fallback` 继续，不降级为"无 rubric"。这是 **fail-soft** 设计：宁可走内置规则，不让 skill 停摆。

### 关键设计 5：Codex OpenCode 子代理按成本自动配模型

OpenCode 子代理不指定 `model:` 会继承主模型，导致 haiku-only 任务烧 opus 额度。`/story-setup` 的 2.4.4 步执行**模型分级**：

1. 跑 `opencode models --verbose`（含 cost/context/capabilities metadata，60s 超时因为首次加载 models.dev 缓存）
2. **优先按 cost 分级**（免费模型归低端，不按名字营销词如 `nemotron-3-ultra-free`）；无 `--verbose` 时回退**关键词分级**（`haiku/flash/mini/nano/lite` → 低，`sonnet/plus` → 中，`opus/pro/ultra/max` → 高）
3. 按 低→中→高 三级，每级用 `AskUserQuestion` 让用户选（候选最多 5 个，含"自定义输入" / "保留现有模型" / "跳过用主模型"）
4. 写入 `.opencode/agents/*.md` frontmatter 顶层 `model: provider/model-id`

**Step 0 缓存保护**：OpenCode agents 是 replace 部署，先扫描现有 `model:` 缓存；检测失败/超时回填缓存值，避免抹掉用户上次配的低成本模型。

---

## 6. Hooks 守卫（强制 + advisory）

`/story-setup` 部署的 7 个 hook，覆盖会话生命周期、写作流程、git commit：

| Hook | 触发 | 类型 | 功能 |
|---|---|---|---|
| `session-start.sh` | 会话开始 | advisory | 显示分支、进度快照、拆文状态 |
| `session-end.sh` | 会话结束 | advisory | 记录会话日志到 `追踪/session-log.txt` |
| `detect-story-gaps.sh` | 会话开始 | advisory | 检测设定缺口、大纲缺失、伏笔断线、跨批连续性、章节标题去重 |
| `pre-compact.sh` | 上下文压缩前 | advisory | 保存进度快照路径和行数摘要 |
| `post-compact.sh` | 上下文压缩后 | advisory | 提示读取进度快照恢复上下文 |
| `validate-story-commit.sh` | git commit | advisory | 检查硬编码属性、设定必填字段（仅警告） |
| **`guard-outline-before-prose.sh`** | PreToolUse(Write/Edit) | **BLOCKING（exit 2）** | **写正文前必须有对应细纲/小节大纲**，否则阻断 |
| **`check-prose-after-write.sh`** | PostToolUse(Write/Edit) | advisory | 正文落盘后自动跑确定性兜底网（截断/拒绝语/工程词/复读/落盘失败/字数欠账） |

### 关键设计：阻断式大纲守卫（最强约束）

`guard-outline-before-prose.sh` 是**唯一阻断式 hook**，强制"先搭大纲再写正文"：

- **长篇**：`{书}/正文/第N章_*.md` 必须有同书 `大纲/细纲_第N章.md`（容忍补零差异与标题后缀，按整数章号匹配）
- **短篇**：`{书}/正文.md` 必须有同目录 `小节大纲.md`（且同目录有 `设定.md` 信号，避免误伤 `docs/正文.md`）
- **正文已存在则放行**（续写/改稿/去 AI 味）
- **`拆文库/{书名}/` 存在时放行**（`/story-import` 迁移：正文先于细纲迁移是正常流程，细纲由章节摘要反推）

设计原则：**宁可漏拦不可误伤**，任何不确定都 `exit 0`。

### 关键设计：PostToolUse 确定性兜底（模型无关）

`check-prose-after-write.sh` 的核心价值是**"即使主会话漏跑收尾步骤，这些硬信号也保证被抓"**——压缩/弱模型/分心都不会漏。只兜"硬信号"：

- **落盘检测**：正文 < 200 字节 → 疑似未写完/落盘失败
- **截断检测**：最后一条内容行末字不是终止/闭合标点
- **AI 自指 / 拒绝语**（非对话行）：`作为(AI|人工智能|大?语言模型)` / `Sure/Certainly/Here's` / `我无法(继续|生成)`
- **工程词泄漏**：`细纲/情节点/卷纲/功能标签/章首钩子/任务描述`（tier1 硬信号）
- **占位符**：`(此处省略)` / `TODO` / `占位符`
- **紧邻整行复读**：相邻内容行完全相同且 ≥ 8 字（通俗网文排比/弹幕是相似非全等，不命中）
- **乱码**：`�` 替换字符
- **字数欠账**：长篇分章正文，从 `大纲/细纲_第N章.md` 读字数目标，实际 < 90% 提示

非阻塞（`exit 0`，advisory 提醒，不挡写作）；无发现完全静默（不污染 context）；解释器不可用静默放行（兜底不能反过来卡流程）。

### 已知边界（写在 hook 注释里）

- `cat>` / `tee` / `cp` / `mv` 等 Bash 写正文路径**绕过 PostToolUse hook**（Claude/OpenCode 侧 Bash 只做 pre-guard，无 post-write 兜底）；这类路径由 Codex Stop 回合末 git 改动集扫描兜全
- `check-prose-after-write.sh` 不部署也不依赖 `check-ai-patterns.js` / `check-degeneration.js`——是独立轻量网，advisory 类（碎句号/长段落/破折号/tier2 歧义词）仍由 workflow 收尾步骤跑

---

## 7. 文件系统状态管理（7 类目录）

这是 oh-story **最值得 narratox 借鉴**的部分之一。所有"长期一致性"靠**文件系统 7 类目录 + 命名契约**：

```
{书名}/                         ← 长篇
├── 设定/
│   ├── 世界观/                 # 背景、力量体系等，按主题拆文件
│   ├── 角色/                   # 每人物一文件（沈栀.md、陆衍止.md）
│   ├── 势力/                   # 每势力/组织一文件（天机阁.md）
│   ├── 关系.md                 # 角色关系映射
│   ├── 题材定位.md             # 题材核心梗 + 对标分析（含 `主对标书` 字段，多对标必填）
│   └── 文风.md                 # 自定义文风（用户自写、不被导入/拆解覆盖）·优先级最高
├── 大纲/
│   ├── 大纲.md                 # 全书卷级结构
│   ├── 卷纲_第N卷.md           # 每卷一个：爽点节奏+情绪弧线+人物弧线+伏笔+反转+对标结构坐标
│   └── 细纲_第NNN章.md         # 每章一个：内容概括+情节安排+人物关系+情节细化+钩子
├── 正文/
│   └── 第NNN章_章名.md
├── 对标/{对标书名}/             # 写作项目内的引用视图（与拆文库的子集同步）
│   ├── 原文/
│   ├── 角色/ 剧情/ 设定/       # 结构化资产
│   ├── 剧情/节奏.md            # 关键信息推进 / 情绪触动点 / 爆发节奏（权威节奏索引）
│   ├── 剧情/情绪模块.md        # 读者需求 / 情绪引擎 / 可复现模块卡（权威模块索引）
│   ├── 文风.md                 # 句长/标点/对话潜台词 + 原文锚点
│   └── 拆文报告.md
├── 追踪/                        ← 跨章节连续性
│   ├── 上下文.md               # 写作上下文（compact 恢复用 + 文风指纹/目标句长带）
│   ├── 伏笔.md                 # 伏笔埋设/回收状态表（跨卷级）
│   ├── 时间线.md               # 故事内时间线（全书级）
│   ├── 角色状态.md             # 角色当前状态快照（章节级）
│   └── 归档/第XXX-YYY章.md     # 每 50 章 / 一卷结束时归档
└── 参考资料/                    # story-researcher 输出

拆文库/{书名}/                   ← analyze skill 的源数据（source of truth），写作通过 对标/ 消费
.active-book                     # 项目根文本文件，内容是当前活跃书目的相对路径
.story-deployed                  # sentinel 文件，含 agents_version / setup_skill_version / target_cli / references_dir
```

短篇瘦身：`短篇/{标题}/{正文.md, 小节大纲.md, 设定.md, 拆文库/}`。

### 关键设计 1：JSON 不是真相源，Markdown 才是

与 inkos **完全相反**——inkos 是 JSON authoritative + markdown 投影；oh-story 是 **markdown 直接读写**，没有 schema 校验层。一致性靠**命名契约**（`第NNN章_*` / `细纲_第NNN章_*` / `卷纲_第N卷.md`）+ hook 守卫强制。

> **narratox 启示**：narratox 已是 Postgres + Prisma，关系模型 + Zod 校验天然更稳。oh-story 这套**目录命名契约**在 narratox 不必照搬，但**「文件即上下文窗口」**的设计哲学可借鉴——见第 12 节。

### 关键设计 2：`.active-book` 单行相对路径

项目根一文本文件，内容是当前活跃书目的**相对路径**。所有 hook 和 skill 据此定位当前项目。多书项目里切书 = 改这一行。

### 关键设计 3：`.story-deployed` sentinel

YAML `key: value` 格式，hook 用 `lib/sentinel.sh` 读。字段含 `agents_version: 16`——低于这个版本就提示重新部署。

### 关键设计 4：归档机制（轻量）

每 50 章 / 一卷结束时，对 `追踪/上下文.md` 做一次轻量归档：保留最近 5 章详记，更早压缩到 `追踪/归档/第XXX-YYY章.md`，并在上下文保留归档索引。**伏笔/时间线/角色状态不归档**——它们是活跃线索。

### 关键设计 5：上下文.md 的「文风指纹」

`追踪/上下文.md` 不只记进度，还存 **「文风指纹/目标句长带」+ 「文风指纹/来源」**——一个 `{短句<15字占比, 中句, 长句, 平均句长}` 快照。narrative-writer 每章写完自动刷新；续写时按这个带子检查是否漂移（碎句成逗号结巴体是典型漂移）。**来源字段防过期**：用户新加/改了 `设定/文风.md` 时，旧指纹「来源」对不上就视为过期，重刷。

---

## 8. 对标拆文 → 写作消费的资产链路

这是 oh-story 独有的设计——**把"看懂别人的爆款"工程化**。

### 8.1 拆文库（analyze 产出）vs 对标（write 消费）

```
拆文库/{书名}/                  ← analyze 的原始产出（source of truth）
├── 原文/
├── 章节/
│   ├── 第1章_深度拆解.md        # 黄金三章深度分析
│   ├── 第1-N章_摘要.md          # 每章摘要 + 情节点 + 角色提及
├── 角色/{角色名}.md             # 结构化角色卡
├── 剧情/
│   ├── 故事线.md                # 框架识别 + 剧情线
│   ├── 节奏.md                  # 关键信息推进 / 情绪触动点 / 爆发节律
│   ├── 情绪模块.md              # 读者需求 / 情绪引擎 / 可复用模块卡
│   └── README.md                # 剧情目录索引（权威范围声明）
├── 设定/世界观/ + 势力/
├── 文风.md                      # 句长/标点/对话潜台词/情绪节奏 + 原文锚点
└── 拆文报告.md                  # 五维评分 + 爽点密度 + 可借鉴套路

对标/{书名}/                     ← 写作项目内的引用视图（与拆文库的子集同步）
```

### 8.2 路径查找回退（canonical read order）

所有对标数据加载都用「对标书路径查找」规则：

1. 优先 `{项目}/对标/{书名}/`
2. 回退 `拆文库/{书名}/`

### 8.3 权威优先级（防止子文件相互冲突）

写作时，**对标分析权威优先级**固定（不是平的）：

1. `剧情/情绪模块.md` 是**读者需求 / 情绪引擎 / 爽文套路框架 / 可复现模块**的权威来源
2. `剧情/节奏.md` 是**关键信息推进 / 章节扩写技法聚合 / 情绪触动点 / 爆发节奏**的权威来源
3. `文风.md` 只管句长/标点/对话潜台词/原文锚点；**不能覆盖情绪模块或节奏意图**
4. `章节/第K章_摘要.md` 是具体章节证据，用来校验和补足权威索引，**不反向覆盖**
5. `拆文报告.md`、`剧情/故事线.md` 是投影/摘要；与权威冲突时以权威为准

### 8.4 自定义文风 first-class citizen

`设定/文风.md`（用户自写、不被导入/拆解覆盖）**优先级高于对标 `文风.md`**：

- 含实质内容（去空白 ≥200 字，或含 句长/标点/对话/锚点/笔调 小节且小节内有可执行约束）→ 作权威风格基（句长/软标点/潜台词/情绪交替），对标降为参考与句长数值兜底
- 空/仅空白/仅标题/占位 stub（`待办`/`待补充`/`___`）→ 视为不存在
- **fail-fast**：未进入自定义文风模式**且**对标 `文风.md` 不存在 → 直接报错「请用 `/story-long-analyze` 跑 Stage 6 生成文风，再 `/story-import` 同步」，**不 inline 生成**（不信任模型临时编的风格）

命中硬安全线的写法（`……` / 破折号 / 段间空行 / 碎句）仍按 narrative-writer 归一，**自定义文风不让位硬安全线**。

### 8.5 缺失文件分级回退（legacy vs v12 新契约）

写作前的对标数据加载，按对标书拆文库版本分级处理：

- **v12 新契约拆文库缺 `剧情/情绪模块.md` / `剧情/节奏.md`**（拆文报告已含相关摘要或导入未标 `legacy_deconstruction: true`）→ **停下提示重跑 `/story-long-analyze` Stage 3+ 或重新 `/story-import`**，不假装已召回
- **legacy 拆文库缺 `剧情/情绪模块.md`** → 依次回退 `拆文报告.md` 读者需求摘要、`文风.md` 可借鉴技巧、匹配章摘要，记录 `legacy_deconstruction: true` + `module_missing`
- 完全无对标项目 → 跳过文风召回、不阻塞

### 8.6 多对标书（`cross-book-recall.md`）

主对标（`设定/题材定位.md` 的 `主对标书` 字段）提供：文风、原文锚点、`selected_emotion_module`、`rhythm_reference`。副对标按**阶段预算**提供结构化摘要表，**不限制登记书目**，**不读副书 `文风.md` / 原文**——超过预算时裁条目不裁书目记录。

---

## 9. 去 AI 味三层防御（oh-story 的差异化竞争力）

这是 inkos 和 narratox **都没有**的层。oh-story 把"去 AI 味"作为**一等公民工作流阶段**，三层防御：

### Layer 1：banned-words.md（词表）

一级词（高频 AI 腔）命中即替换；二级词（低频/语境相关）高频出现时替换。`banned-words.md` 跨多 skill 字节同步。

### Layer 2：check-ai-patterns.js（确定性句式 detector）

`node scripts/check-ai-patterns.js --check <正文文件>` 报告四类问题，**只报告不修改**：

| 类别 | severity | 处理 |
|---|---|---|
| **先否定再肯定翻转句式**（`not-is-comparison`） | blocking（S2） | 删否定铺垫，直接写后项；或改为动作/细节呈现 |
| **破折号**（`em-dash`） | blocking（S2） | 按功能改写：打断→动作 beat/短句，拖长音→省略或动作，插入说明→逗号/冒号，**不一律改句号** |
| **碎句号**（`period-stutter`） | advisory（S4） | 连续短叙述句无呼吸，按目标句长合并成中长句 |
| **长段落**（`long-paragraph` > 200 字） | advisory（S4） | 按镜头/新动作/视线切换断段 |

normalize-punctuation.js 做机械兜底：清除残留 `……`、漏网破折号 `——`/`—`、双连字符 `--`、独立行 `---`。

### Layer 3：narrative-writer 7 Gate（creative rewrite）

subagent 做需要文学判断的改写：

| Gate | 内容 | 例外 |
|---|---|---|
| **A 禁用词替换** | 命运齿轮 / 如潮水般 / 仿佛春风 / 心猛地一沉等 | 硬约束，文风不让位 |
| **B 句式去套路** | 连续排比 / 刻意对称 / 空洞抒情打散；硬禁先否定再肯定翻转 | 文风可优先 |
| **C 心理描写外化** | 默认情绪词 → 身体状态（Show Don't Tell） | 短篇题材包「情绪直给+焊体感」例外 |
| **D 节奏打碎** | 长句拆短、同构句打散；按动作/信息变化断段，不机械按字数 | 文风可优先 |
| **E 对话去腔调** | 角色差异化、对话标点跟权力位置/情绪匹配 | — |
| **F 结尾去升华** | 大段抒情收尾 → 安静细节收尾 | 硬约束 |
| **G 去解释腔/上帝感/安排感** | 叙述者跳出角色当下的解释/剧透/定性/升华全删（`之所以` / `原来` / `这意味着` / `她不知道的是` / `殊不知` / `多年以后` / `演得真好`） | 这是"说教感/上帝感/机械感/安排感"的根治 Gate |

系统性去 AI 三遍法：Pass 1 去泛化（抽象词→具体细节）→ Pass 2 去书面化（书面腔→口语/动作）→ Pass 3 回自然感（注入停顿、犹豫、矛盾、口语感）。

### Layer 4：check-degeneration.js（模型退化检测）

正文落盘后再跑 `node scripts/check-degeneration.js --check 正文/第N章_*.md`，**确定性检测模型退化**——退化的模型自己发现不了，只能靠脚本兜（弱模型如 m3/GLM 概率性退化）：

| severity | 类型 | 处理 |
|---|---|---|
| **blocking** | 逐字复读/打转、末尾截断、`作为AI`类拒绝语、tier1 纯工程词（`细纲`/`情节点`/`卷纲`/`功能标签`） | **只重写受影响的那一章**，把证据当约束回喂 narrative-writer，最多重写 2 次；仍命中停下报用户 |
| **advisory** | tier2 章节/歧义词（`本章`/`下一章`/`读者`/`伏笔`/`任务描述`，有「例外：…」条款） | 只提示、不自动回炉——先按例外条款自查，确属泄漏才改写 |

**保守豁免**：体裁内的排比/复沓/弹幕刷屏/重复台词不算退化，只报告不改写。

### 关键原则：删最少，效果最大

去 AI 味**不等于重写**。目标是改最少的字让整段"味"变过来：

- 能改一个词就不改一句，能删一句就不重写一段
- 没有问题的句子保留原句；人名/地名/数字/章节名/专有名词优先保留
- **过度去 AI 味保护**：不得整段删除正文；删除比例上限按 AI 味等级分级（轻度 ≤15%、中度 ≤25%、重度 ≤35%）
- 逐句修改后某段仍不满意 → 标 `[需复核]` 不删除
- 疑似 AI 味但不确定 → 标 `[需复核]` 不插入正文

---

## 10. 章节定位与张弛（v0.6.20 新设计）

破「每章像短篇」——按章在一级结构里的位置标**章节定位**：

| 定位 | 钩子/爽点要求 | 字数倾向 |
|---|---|---|
| **高压** | 配齐钩子+爽点+悬念 | 中长 |
| **推进** | 同高压 | 中长 |
| **修炼试错** | 无显性爽点、弱钩子，功能是喘息/铺垫 | 中 |
| **关系回收** | 弱钩子或仅情绪钩子 | 中 |
| **低压生活** | 弱钩子或留阶段目标 | 中短 |
| **信息整理** | 无钩子，功能是转场 | 短 |
| **（留空）** | 按推进章处理 | — |

**底线**：每章都给读者一个往下看的理由（微好奇/阶段目标/暧昧期待），**相邻章不情绪趋同**。低压+关系+过场合计不超约 15%。

卷纲情绪弧线表加章节定位列，细纲加章节定位字段，留空即按推进章不阻塞。

### 章节定位契约（注入 story-architect）

```
每章按它在一级结构里的位置标定位{高压/推进/修炼试错/关系回收/低压生活/信息整理；可留空=推进}
——只有高压/推进章配齐钩子+爽点+悬念，低压/关系/修炼/信息整理章允许无显性爽点、
弱钩子或仅情绪钩子，但每章都要留一个往下看的理由（微好奇/阶段目标/暧昧期待），
相邻章别情绪趋同
```

### 对标节奏回流（v0.6.20）

卷纲定稿前做一次：读主对标 `对标/{书}/剧情/节奏.md`（缺失回退 `章节/*_摘要.md` + `拆文报告.md`），按 `outline-structure-theory.md`「对标节奏迁移」把对标的一级结构关键点（1/4·中点·3/4）换素材排进本卷卷纲「对标结构坐标」。无对标书则按八节点占比自排。

---

## 11. 与 narratox 现状对照

| oh-story 概念 | oh-story 实现 | narratox 现状 | narratox 落点 |
|---|---|---|---|
| 部署 | `/story-setup` 写 hooks/agents/rules 到 `.claude/` | agent-tree.config.ts + Postgres | 不适用（不同形态） |
| Skill 入口 | SKILL.md + frontmatter + Phase 流程 | AGENT_TREE 节点 + prompts/*.md | 不适用（不同形态） |
| 7-Agent | .claude/agents/*.md + full/lean/solo 降级 | AGENT_TREE + DeepAgentService，**无降级** | **加降级**：spawn 失败 → solo（不硬失败） |
| 大纲先于正文 | guard-outline-before-prose.sh **阻断** | assertHasPlan（tool 内校验） | 已有但不是 hook 级；可加 hook |
| 字数下限 | check-prose-after-write.sh advisory + 细纲字数预算 | 无 | **可加** writer 端硬约束 |
| 去 AI 味 | 4 层防御（词表+句式 detector+7 Gate+退化检测） | 无 | **可加**：banned-words + check-ai-patterns 等价 |
| 文风指纹 | 上下文.md 存句长带 + 来源防过期 | 无 | **可加** Novel.settings 文风字段 |
| 对标系统 | 拆文库/ + 对标/ + 权威优先级 | 无 | narratox 是 DB，**对标系统值得设计** |
| 多对标 | 主对标+副对标阶段预算 | 无 | — |
| 文件系统状态 | 7 类目录 + 命名契约 | DB（Prisma） | 不必照搬；目录组织可借鉴 |
| 上下文恢复 | pre/post-compact + 上下文.md | Phase 14 MAIN_ROLE_REMINDER + summarization | narratox 已有；可学 sentinel 设计 |
| 章节定位 | v0.6.20 高压/推进/低压分级 | 无 | **可加** Arc.goal 已部分覆盖 |
| 跨 CLI 适配 | 单 canonical + 自动生成 3 端 | 单 Web | 不适用 |
| 命名契约 | `第NNN章_*` / `细纲_第NNN章_*` | DB ID | DB 已是更高层抽象 |

---

## 12. 对 narratox 的具体建议（按优先级）

### P0 — 高价值低成本（可立即做）

**12.1 引入 banned-words + 句式 detector**

oh-story 的 `check-ai-patterns.js` 是纯 node 脚本，与 narratox 的 NestJS 栈完全兼容。可以：

- 直接移植 `banned-words.md`（一级/二级词表）作为 `validator` 的一个新 dim（建议作为 dim 13「文字自然度」或独立 polish step）
- 在 writer 落盘后跑 `check-ai-patterns.js --check` 等价检查（破折号 / 翻转句式 / 碎句号 / 长段落），不通过的进 `validator` 报告
- `check-degeneration.js` 直接移植——narratox 已有 L1 integration test，加一个"模型退化防护"测试

**12.2 字数下限硬约束**

oh-story 的「字数未达标禁止结束本章」是 writer prompt 注入的硬约束。narratox writer 已有 prompt，可以加：

- writer 在 `write_chapter` 工具调用前从细纲读字数目标
- 落盘后立刻 `len(content)` 校验，<90% 则回到第 N 章补展开（按细纲字数预算定位欠账的密点）
- 避免反复回炉：一次重写到位

**12.3 文风指纹（防续写漂移）**

`追踪/上下文.md` 的「文风指纹/目标句长带 + 来源」设计直接可迁移：

- narratox 已有 `Novel.settings` JSON，可加 `styleProfile: {shortRatio, midRatio, longRatio, avgLen, source}`
- writer augment 注入；settler 每章刷新（`NovelSettingsService.update`）
- 来源防过期：用户改 `Novel.styleGuide` 时强制重刷

### P1 — 中价值中成本

**12.4 章节定位（破「每章像短篇」）**

narratox 的 `Chapter` 表已支持加字段。可以：

- 加 `Chapter.pacing: HIGH|PROGRESS|PRACTICE|RELATION|LOW|INFO|TRANSITION`
- outline-writer 分章时按位置打标
- writer 按 pacing 分配钩子/爽点密度（高压/推进配齐，低压/关系允许弱钩子）
- validator dim 12「细纲兑现」可加：pacing 与实际章密度匹配度

**12.5 full/lean/solo 降级**

narratox `DeepAgentService.buildAgentGraph` 目前不降级——subagent 调用失败就整轮失败。可以借鉴 oh-story 的设计：

- `task` delegation 失败 → 主 agent 直接执行（不等同于 skip，是 fallback）
- 报告里写明 `Effective Mode: full/fallback` 让用户知道
- 适用于 `validator` 的多 dim 检查：单 dim 失败不影响其他 dim

**12.6 自定义文风 > 对标文风优先级**

narratox 没有"对标"概念，但可以迁移这套优先级思想到 `styleGuide`：

- `Novel.styleGuide`（用户写）> 全局 `styleGuide`（题材默认）
- 用户填了含实质内容的 styleGuide → 作权威风格基
- 用户没填 → 走题材默认，不 inline 编

### P2 — 架构演进（按需）

**12.7 对标系统设计（narratox 缺失的能力）**

oh-story 的「拆文库 + 对标」是 narratox **完全没有**的能力。narratox 是从零创作，没有"看懂别人的爆款"这一步。可以考虑：

- 加 `Benchmark` 模型（用户的对标书库）：上传/导入对标书 → AI 拆文（角色/剧情/设定/文风/节奏/情绪模块）→ 写作时按权威优先级召回
- 不需要 oh-story 那么细的目录结构，DB 表 + JSON 字段足够
- 这是 narratox 一个**独立的大方向**，超出 Phase 21 范围，建议作为未来 Phase 单独立项

**12.8 守卫 hook 思想（即使 narratox 是 Web）**

narratox 没有用户可编辑的 `.claude/hooks/`，但**守卫思想**可迁移：

- writer 工具落盘前 hook 等价 → `assertHasPlan` / `assertFrontier` 已有，可扩展加 `assertStyleProfile` / `assertPacingMatch`
- 落盘后 hook 等价 → writer 返回后异步跑 `check-ai-patterns` 等价检查，结果存 `Chapter.qualityReport` JSON
- 失败不阻断写入，但写入 `validator` 待审队列

### P3 — 后续可选

- **跨 CLI 适配**：narratox 是 Web，不适用
- **文件系统状态**：narratox 已是 DB，不必回退
- **多对标书**：等对标系统建好再说

---

## 13. 不建议照搬的部分

| oh-story 设计 | 不照搬原因 |
|---|---|
| 文件系统作为主存储 | narratox 已用 Postgres + Prisma，关系模型 + Zod 校验天然更稳 |
| 跨 CLI 自动生成 | narratox 是单 Web 客户端，不适用 |
| Markdown 作为真相源（无 schema 校验） | narratox 已有 Zod，不应回退到无 schema |
| `banned-words.md` 跨 skill 字节同步 | narratox 单 service，一处定义即可 |
| SKILL.md frontmatter 单行 JSON metadata | narratox 用 TS config，不需要 |
| `.active-book` 单行文件 | narratox 用 URL 路由 `/novels/[id]`，不需要 |
| 完整 13 skill 体系 | narratox 是 chat agent，不分 skill；AGENT_TREE 已是更优解 |
| Codex `commandWindows` 双语法 | narratox 不跑 hook |
| `check-shared-files.sh` 字节同步守卫 | narratox 单 service 无副本问题 |
| 命名契约（`第NNN章_*`） | narratox 用 DB ID，已是更高层抽象 |

---

## 14. 一页纸总结

narratox 应该向 oh-story-claudecode 学**守卫与去 AI 味**，不学**形态**：

1. **去 AI 味是一等公民工作流**（4 层防御：banned-words + check-ai-patterns + narrative-writer 7 Gate + check-degeneration）——narratox 完全缺失，**P0 立即做**。
2. **字数下限是硬约束**（落盘即校验，<90% 回炉）——narratox 没有，**P0**。
3. **文风指纹防漂移**（上下文.md 句长带 + 来源防过期）——narratox 没有，**P0**。
4. **章节定位破每章像短篇**（高压/推进/低压分级）——narratox Arc.goal 已部分覆盖，**P1**。
5. **full/lean/solo 降级永不硬失败**（spawn 失败 → solo + 报告 Effective Mode）——narratox `task` delegation 可借鉴，**P1**。
6. **对标系统**（拆文库 + 对标 + 权威优先级）——narratox 完全缺失，是**独立大方向**，建议单独立项。

**但保持 narratox 的"DB + 单 Web 客户端"形态**：
- 不要回退到文件系统存储
- 不要做跨 CLI 适配
- 不要做无 schema 校验的 markdown
- 不要拆成 13 skill（AGENT_TREE 已是更优解）
- 不要做 hooks（用工具内校验 + assert 等价）

把 oh-story 当**网文写作工程方法论的参考实现**（守卫 + 去 AI 味 + 对标 + 文风指纹），而非产品范本。

---

## 附：关键文件索引（如需深入查阅 oh-story-claudecode 源码）

### 顶层
- 项目说明：`README.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`CHANGELOG.md`
- 仓库脚本：`scripts/README.md`（20 个脚本的索引与调用关系）
- 升级检测：`skills/story-setup/UPGRADING.md`

### 跨 CLI 适配（最重要的架构事实）
- OpenCode 生成：`scripts/sync-opencode.py`
- Codex 生成：`scripts/generate-codex-agents.py`
- 适配守卫：`scripts/check-opencode-adapter.sh`、`scripts/check-codex-adapter.sh`、`scripts/check-openclaw-skills.sh`
- 静态检查：`scripts/static-check.sh`（skill 结构、frontmatter、引用路径、死文件）
- 共享文件字节同步：`scripts/check-shared-files.sh`

### Skill 入口（13 个 SKILL.md）
- 部署：`skills/story-setup/SKILL.md`（最复杂，含部署清单 + 跨 CLI 合并算法）
- 路由：`skills/story/SKILL.md`
- 长篇：`skills/story-long-{scan,analyze,write}/SKILL.md`
- 短篇：`skills/story-short-{scan,analyze,write}/SKILL.md`
- 去味：`skills/story-deslop/SKILL.md`
- 导入：`skills/story-import/SKILL.md`
- 审查：`skills/story-review/SKILL.md`（含 full/lean/solo 降级完整实现）
- 封面：`skills/story-cover/SKILL.md`
- 浏览器：`skills/browser-cdp/SKILL.md`

### Agent 定义（7 个）
- `skills/story-setup/references/templates/agents/{story-architect,character-designer,narrative-writer,consistency-checker,story-researcher,story-explorer,chapter-extractor}.md`

### Hooks（7 个 + lib）
- `skills/story-setup/references/templates/hooks/{session-start,session-end,detect-story-gaps,pre-compact,post-compact,validate-story-commit,guard-outline-before-prose,check-prose-after-write}.sh`
- 公共库：`skills/story-setup/references/templates/hooks/lib/{common.sh,sentinel.sh}`

### 模板规范源（部署到用户项目的 canonical）
- `skills/story-setup/references/templates/{CLAUDE.md.tmpl,上下文.md.tmpl,settings-hooks.json}`
- `skills/story-setup/references/templates/rules/*.md`（4 条 path-scoped 规则）
- `skills/story-setup/references/agent-references/*.md`（agent 共享的方法论副本）

### 去 AI 味确定性脚本
- `skills/story-deslop/scripts/check-ai-patterns.js`（句式 detector，4 类问题）
- `skills/story-deslop/scripts/normalize-punctuation.js`（机械兜底）
- `skills/story-deslop/scripts/check-degeneration.js`（模型退化检测）

### 真实产出样例
- 长篇拆文：`demo/拆文库-盘龙/`（完整结构化目录）
- 短篇拆文：`demo/拆文库-曾将爱意私藏/`
- 长篇续写工程：`demo/让你管账号，你高燃混剪炸全网/`（20 章续写 bible）
- 封面：`demo/封面-剑道独尊.png`

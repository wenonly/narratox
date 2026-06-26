# 作者画像(Author Voice Profile)— 设计

- **日期**:2026-06-26
- **状态**:草案 v2(交互已可视化确认;待 review)
- **阶段**:P1.5(P1「网文技法 + 去 AI 指纹」prompt 已落地;本篇把 prompt 里的【作者声音】从通用规则升级成**作者本人**的声音)
- **相关**:[2026-06-24-agent-config-character-phase](./2026-06-24-agent-config-character-phase-design.md);KB `知识库/创作须知/文笔与文采.md`;研究来源 Humanizer-zh、StoryScope、36kr《去 AI 味手册》

> **v2 变更(相对 v1)**:画像从「4 个结构化字段(JSON)」改为「**一份 Markdown 文档**」,并由**专用 agent 从作者样本归纳生成**。理由:Markdown 比死板字段更能表达声音;agent 归纳免去手敲;且 agent 把样本**蒸馏**成紧凑文档,注入比原始样本省 token(顺带解掉 v1 的 validator 注 32k 字成本风险)。

---

## 1. 背景与问题

P1 给 `WRITER_AGENT_PROMPT` 加了【作者声音】块,但那是**通用规则**——writer 会自洽地建立一种腔调,但那是 AI 自选的,不是**作者本人**的声音。`Novel.settings.style`(free-text 文风)已注入【文风】,但单行、不够结构化,也无法让 validator「拿作者的文当尺子」比对。

**目标**:让作者把自己的声音录成一份 Markdown「作者画像」,agent 可从作者样本**自动归纳**,注入 writer 指导腔调、注入 validator 做比对,从而真正去 AI 指纹 + 全书(及该作者所有书)声音一致可辨认 + validator 能判断「这章写得像不像你」。

## 2. 目标 / 非目标

**目标**
- 全局 per-user 画像(一个作者一套声音,跨所有小说共用),存 `User.voiceProfile`(Markdown 字符串)。
- **专用「画像 agent」**:从作者粘贴的样本(其写作)归纳生成/刷新 Markdown 画像;轻量(单次归纳 + 可选自审,不上 writer→critic 全树)。
- **默认初始化**:首次进入 seed 一份带占位说明的模板 Markdown,从不空屏。
- writer 每轮注入画像 Markdown 作【作者声音】slice;空画像回落 P1 默认规则。
- validator 注入同一份画像,新增第 11 维「作者声音匹配」(centaur:对照画像判腔调偏离 + 扫禁词);无画像时跳过该维。
- `/settings` 加「作者画像」区:三状态交互(空 CTA → 生成 → 就绪编辑器)。

**非目标(留作后续)**
- per-novel 覆盖(作者模板 + 每书微调)——本篇只 per-user。
- 统计层 centaur(burstiness / perplexity 客观比对)——本篇 centaur 走 prompt 层 LLM 判断。
- **agent 自动读作者已有小说章节**归纳画像(v2 魔法功能)——v1 只用设置页粘贴的样本。
- 画像 agent 在小说工作流内被触发(如 main 发现声音漂移自动刷新)——v1 只在 /settings 手动触发。
- 画像用于 outliner/worldbuilder/character(非 writer/validator)——暂不。

## 3. 设计

### 3.1 数据模型

`User` 加一个可空 Markdown 文本列(非破坏性迁移):

```prisma
model User {
  ...
  voiceProfile String?   // Markdown 作者画像;null=未设置,走默认
}
```

画像是一份 Markdown,建议结构(模板 seed + agent 产出都遵循):

```markdown
# 作者画像
## 语调与节奏
(雷厉风行 / 短句密集 / 紧张处一字成句…)
## 标志句式
- 段尾爱用「倒是」「也行吧」
- 人物定调:「X这人,Y」
## 专属意象(跨场景复现)
- 锈 / 塑料味 / 断了的筷子
## 要避免(AI 套路)
- 此外 / 仿佛…一般 / 胸口发紧 / 排比三连
## 代表性片段
> (从作者样本摘 1-2 段,作 validator 尺子)
```

### 3.2 API

扩 `SettingsModule`,新增 `VoiceProfileService` + 路由(均 `@CurrentUser` 注入 userId,全程 userId scope):

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/settings/voice` | 返回 `{ profile: string \| null }`。用户自己的数据,不脱敏。 |
| PUT | `/settings/voice` | 整体覆盖画像(body `{ profile: string }`,空串=清空)。校验长度上限(如 ≤ 8000 字)。 |
| POST | `/settings/voice/generate` | 跑画像 agent:body `{ samples: string[] }`(1-8 段,每段 ≤ 4000 字)→ 返回 `{ profile: string }`(Markdown)。**不落库**(回前端供审,用户点「保存」才 PUT)。 |

### 3.3 画像 agent

- **独立触发,不进小说 AGENT_TREE**:per-user、不绑小说线程,故不走 `/agents/:id/runs`(那是 novel-session 级)。`/settings/voice/generate` 直接跑一个轻量 agent。
- **实现**:复用 agentos 的模型解析(`buildChatModel` + 用户 active 配置),用 `createAgent` + 一个 `PROFILE_BUILDER_PROMPT`(分析样本 → 归纳成上述 Markdown 结构),单次归纳 + 可选一轮自审(自我挑刺再定稿)。不委派子 agent、不带写小说的工具。
- **输入**:`samples`(用户在设置页粘贴的 1-8 段其写作),经 prompt 注入。
- **输出**:Markdown 画像(经结构化返回或直接文本)。
- **无模型配置时**:与 runTurn 一致,抛"尚未配置模型"。

### 3.4 注入(控制 token)

画像 Markdown 通常几百~千字(样本已蒸馏),比原始 8 段样本省得多——这正是 v2 相对 v1 的红利。

- **writer(每轮)**:`ContextAssembler` / `DeepAgentService` 读一次 `voiceProfile`,构造【作者声音】slice 注入 writer system prompt(整份 Markdown,或截断到 ~1500 字):
  ```
  【作者声音 — 照作者本人的腔调写,不是 AI 自选】
  {voiceProfile 全文}
  ```
  画像为空 → 不注入,writer 用 P1 默认【作者声音】规则。
- **validator(每章校验)**:注入同一份画像 + 第 11 维(见 3.6)做 centaur。
- 读 voiceProfile 与读 active 模型配置同轮合并,避免额外 DB 往返。

### 3.5 前端 UI(`/settings`)—— 三状态交互(已可视化确认)

`/settings` 标题改「设置」,「作者画像」作第二个区块(平级,滚动)。新组件 `src/components/settings/VoiceProfile.tsx`:

**状态机**:
- **空(首次/未设置)**:CTA —— `［从我的写作生成］` / `［手动编辑模板］`。说明文案:可选、AI 照它写 + 当尺子校验、留空用默认。
- **生成**:点「生成」→ 内联/小框粘贴 1-5 段样本 → `POST /settings/voice/generate` → spinner「正在归纳你的声音…」→ 结果回填编辑器供审(不直接保存)。
- **就绪(常态)**:Markdown 编辑器。
  - 工具栏:`✎ 编辑 ⇄ 👁 预览` 切换 + `↻ 重新生成` + `保存`(脏态高亮,保存 → `PUT`,toast)。
  - 编辑态:textarea(Monospace);预览态:MarkdownRenderer 渲染。
  - 首次 seed 模板(带占位说明的上述结构),从不空屏。
  - 底部:「保存后即时生效 · 下次写章即注入」。

`types/settings.ts` 加 `VoiceProfile`(profile string);`api/settings.ts` 加 `getVoiceProfile/putVoiceProfile/generateVoiceProfile`。

### 3.6 validator 第 11 维(条件性)

画像存在时,validator system prompt 注入画像 + 该维说明;无画像时不含此维:

```
11. 作者声音匹配(仅当提供了作者画像时审计)——把本章与【作者画像】对照:
    语调/节奏/句式/用词偏好是否一致(像不像同一个作者);画像「要避免」项是否命中;
    标志句式/专属意象是否在合适处复现(不强制每章,但全书要有)。
    严重偏离作者声音(像换了个 AI 写的)= issue;命中「要避免」项 = issue。
```

## 4. 决策与权衡

| 决策 | 选择 | 理由 |
|---|---|---|
| 归属范围 | per-user(全局) | 作者跨书笔名腔调一致;「我的个人指纹」语义 |
| 画像形态 | **Markdown 文档**(非结构化字段) | 比死板字段更能表达声音;agent 可生成/人可编辑;蒸馏后省 token |
| 生成方式 | **专用 agent 从样本归纳** | 免手敲;centaur 反向(从样本推尺子);默认模板兜底 |
| centaur 机制 | prompt 层 LLM 判断 | validator 本就 LLM 维度制,加一维成本最低;统计层要模型权限、复杂 |
| 样本存储 | **不长期存**,只作生成输入 | 全蒸馏进 Markdown;省存储/省注入 token;重生成时重贴 |
| 生成输入(v1) | 设置页粘贴样本 | 简单;自动读小说章节留 v2 |
| 数据位置 | `User.voiceProfile String?` | 一个可空列,非破坏性迁移 |

## 5. 备选方案(已否决)

- **结构化 4 字段(JSON)**(v1):口头禅/意象/禁词/样本 数组。死板、表达力弱、样本注入贵。改为 Markdown + agent。
- **统计层 centaur**:算 burstiness/perplexity 对比。客观但 perplexity 需模型 logits、复杂、收益边际。留作未来增强(可先上「禁词频次 + 句长方差」两条不要模型权限的轻量统计)。
- **per-novel 画像**:与「作者跨书一致的个人指纹」诉求不符;per-novel 覆盖留作「作者模板 + 每书微调」。
- **agent 自动读小说章节归纳**(v2 魔法):要跨小说读章节的工具 + 更多基建。v1 用粘贴样本。
- **画像 agent 上 writer→critic 全树**:过重;单次归纳 + 轻自审足够。

## 6. 风险与开放问题

- **agent 归纳质量**:从样本推画像,可能漏掉作者本人都没意识到的特征,或过度泛化。缓解:生成后回编辑器给作者审/改(不直接保存);模板结构锚定具体可填项。
- **LLM 判声音的主观性**:centaur 依赖 LLM 判「像不像」。缓解:锚定到可检项(「要避免」命中、标志句式复现、节奏),降低纯主观比重。
- **Markdown 注入长度**:画像若被作者写得很长,writer 每轮注入会吃 token。缓解:PUT 校验上限(≤ 8000 字);writer 注入时截断到 ~1500 字(或只注「标志句式/要避免/专属意象」段)。
- **空画像体验**:默认(P1 规则)和有画像两套路径都要测,确保空画像不报错、不注入空 slice。
- **多用户隔离**:`voiceProfile` 在 User 上,API/服务全程 userId scope,天然隔离(与 P0-1 教训一致)。
- **画像 agent 与小说 agent 共用模型配置**:generate 端点也读用户 active 模型;无配置时与 runTurn 一致抛错。

## 7. 实现切片(供 writing-plans 细化)

1. schema:`User.voiceProfile String?` + 迁移。
2. 后端:`VoiceProfileService`(get/upsert/generate,userId scope)+ `/settings/voice` GET/PUT + `/settings/voice/generate` POST + DTO 校验 + 单测。
3. 画像 agent:`PROFILE_BUILDER_PROMPT` + 轻量 createAgent 调用(复用 buildChatModel)+ generate 服务方法 + 单测(mock 模型)。
4. 注入:writer Markdown slice(context-assembler/deep-agent 读 voiceProfile,空则跳过,超长截断);validator 注画像 + 第 11 维(条件性)。
5. prompt:`VALIDATOR_AGENT_PROMPT` 加第 11 维文案;`PROFILE_BUILDER_PROMPT` 新增。
6. 前端:`VoiceProfile.tsx`(三状态 + Markdown 编辑/预览 + 生成/保存)+ `types/settings.ts` + `api/settings.ts` + 挂到 settings page。
7. 验证:server typecheck/lint/jest;agent-ui typecheck/lint/format。

## 8. 参考

- Humanizer-zh(op7418,基于 Wikipedia《Signs of AI writing》)— 去表层 AI 痕迹 + 「个性与灵魂」注入。
- StoryScope 论文(arXiv:2604.03136)— 叙事层指纹;centaur 需对照真实样本。
- 36kr《去除「AI 味」不完全手册》— 「注入肉身」+ 风格样本投喂。
- KB `知识库/创作须知/文笔与文采.md` — 文采六美 / 个人语感。

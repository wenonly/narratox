# 作者画像(Author Voice Profile)— 设计

- **日期**:2026-06-26
- **状态**:草案(待 review)
- **阶段**:P1.5(P1「网文技法 + 去 AI 指纹」prompt 已落地;本篇是它的数据化延续——把 prompt 里的「作者声音」从通用规则升级成**作者本人**的声音)
- **相关**:[2026-06-24-agent-config-character-phase](./2026-06-24-agent-config-character-phase-design.md);KB `知识库/创作须知/文笔与文采.md`;研究来源 Humanizer-zh、StoryScope、36kr《去 AI 味手册》

---

## 1. 背景与问题

P1 给 `WRITER_AGENT_PROMPT` 加了【作者声音】块,但那是**通用规则**(固定标志句式 / 视角有偏 / 专属意象复现 / 允许人味)——writer 会**自洽地建立一种腔调**,但那是 AI 自己挑的,不是**作者本人**的声音。

同时,`Novel.settings` 已有 free-text `style`(文风)字段并已注入【文风】,但它是单行描述、不够结构化,也无法让 validator「拿作者的文当尺子」比对。

**目标**:让作者把自己的声音(口头禅 / 专属意象 / 禁用词 / 风格样本)录进系统,注入 writer 指导腔调、注入 validator 做比对,从而:
- 真正去掉 AI 指纹(按**作者本人的**语感写,而非 AI 自选的安全腔调);
- 全书(及该作者所有书)声音一致、可辨认;
- validator 能判断「这章写得像不像你」。

## 2. 目标 / 非目标

**目标**
- 全局 per-user 画像(一个作者一套声音,跨所有小说共用),存 `User.voiceProfile`。
- 4 类字段:口头禅/标志句式、专属意象、禁用词、风格样本(2-5 段真实文段)。
- writer 每轮注入**紧凑列表**(口头禅/意象/禁词)作【作者声音】slice;空画像回落到 P1 默认规则。
- validator 注入**全部样本** + 列表,新增「作者声音匹配」维度(centaur:对照样本判腔调偏离 + 扫禁词 + 查标志句式是否用上);无画像时该维跳过。
- `/settings` 加「作者画像」编辑区(3 个标签输入 + 样本大文本框)。

**非目标(留作后续)**
- per-novel 覆盖(作者模板 + 每书微调)——本篇只做 per-user。
- 统计层 centaur(burstiness / perplexity 客观比对)——本篇 centaur 走 prompt 层 LLM 判断;统计层留作增强。
- 从样本自动归纳画像(用 LLM 读作者样本反推口头禅/意象)——可作「智能填充」便利功能,不在本篇。
- 把画像用于 outliner/worldbuilder/character(非 writer/validator 的 agent)——暂不。

## 3. 设计

### 3.1 数据模型

`User` 加一个可空 JSON 列(非破坏性迁移):

```prisma
model User {
  ...
  voiceProfile Json?
}
```

```ts
// server/src/settings/voice-profile.types.ts
export interface VoiceProfile {
  signaturePhrases: string[]; // 口头禅 / 标志句式(如 "段尾爱用『倒是』"、"人物定调:『X这人,Y』")
  imagery: string[];          // 专属意象(如 "锈"、"塑料味"、"断了的筷子")
  bannedWords: string[];      // 禁用词 / 套话(如 "此外"、"仿佛……一般"、"胸口发紧")
  samples: string[];          // 2-5 段作者真实文段(每段建议 ≥200 字,作 validator 尺子)
}
```

可空 = 用户不填则 `null`,writer/validator 走默认。

### 3.2 API

扩 `SettingsModule`,新增 `VoiceProfileService` + 路由(`/settings` 已是 `@Public`-外的受保护区,`@CurrentUser` 注入 userId):

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/settings/voice` | 返回当前用户的 `VoiceProfile`(或 `null`)。是用户自己的数据,不脱敏。 |
| PUT | `/settings/voice` | 整体覆盖 `VoiceProfile`(传完整 4 字段;空数组合法)。校验:每个数组元素为非空字符串;`samples` 长度 ≤ 8、每段 ≤ 4000 字。 |

无 DELETE(传 `{signaturePhrases:[],...,samples:[]}` 即清空;或 PUT `null` 视为清空)。

### 3.3 注入(核心——控制 token)

**关键原则**:writer 每轮跑(且一章 append 多次),必须便宜;validator 每章校验时跑(低频),可承受样本开销。

**writer(每轮,紧凑列表)**:
- `ContextAssembler.forSession` / `DeepAgentService.buildAgentGraph` 读一次 `voiceProfile`(与 `getActive` 模型配置同轮读),构造【作者声音】slice 注入 writer system prompt:
  ```
  【作者声音 — 照作者本人的腔调写,不是 AI 自选】
  口头禅/标志句式:{signaturePhrases}
  专属意象(跨场景复现):{imagery}
  禁用词/套话(出现即换说法):{bannedWords}
  ```
- 画像为空 → 不注入该 slice,writer 用 P1 的【作者声音】默认规则。
- 注意:不把 `samples` 注入 writer(太重,且 writer 不需要比对,只需遵循腔调)。

**validator(每章校验,centaur)**:
- validator 的 system prompt 注入 `samples` + 3 个列表,新增第 11 维(见 3.5)。
- 样本可能较大(8×4000 = 32k 字上限);仅注 validator(低频),可接受。若日后 token 吃紧,再考虑只注 2 段最短样本或摘要。

### 3.4 前端 UI(`/settings`)

`/settings` 现只有「模型配置」。加一个「作者画像」区(平级 section):
- 3 个标签输入(`signaturePhrases`/`imagery`/`bannedWords`):回车添加、× 删除的 chip 输入(复用现有 ui 组件风格)。
- `samples` 用「添加一段」按钮式的多文本框(每段一个 textarea,可增删),而非单大文本框靠空行切分——避免段落内空行被误切。
- 保存按钮 → `PUT /settings/voice`;加载时 `GET /settings/voice` 回填。
- 说明文案:「可选。填写后,AI 会照你的腔调写、并用你的样本当尺子校验。留空则用默认写作风格。」
- 不阻塞:画像空也能正常写作。

### 3.5 validator 第 11 维(条件性)

`VALIDATOR_AGENT_PROMPT` 加(画像存在时才注入该维的说明;无画像时 validator 不含此维):

```
11. 作者声音匹配(仅当提供了作者样本时审计)——把本章与【作者样本】对照:
    腔调/句式节奏/用词偏好是否一致(像不像同一个作者写的);bannedWords 是否命中;
    signaturePhrases 是否在合适处用上(不强制每章用,但全书要有复现)。
    严重偏离作者声音(读起来像换了个 AI 写的)= issue;命中禁用词 = issue。
```

样本通过 validator 的 system prompt 注入(centaur 模式)。

## 4. 决策与权衡

| 决策 | 选择 | 理由 |
|---|---|---|
| 归属范围 | **per-user(全局)** | 作者跨书笔名腔调一致;「我的个人指纹」语义;一处设好处处生效 |
| 字段 | **全套含样本** | 样本是 centaur 比对的尺子,去 AI 指纹 + 个性化最强 |
| centaur 机制 | **prompt 层 LLM 判断** | validator 本就是 LLM 维度制,加一维成本最低;统计层(perplexity)要模型 logits 访问、复杂、收益边际 |
| writer 注入 | **仅紧凑列表,不含样本** | writer 高频(每 append),样本太重;writer 只需遵循腔调,无需比对 |
| 数据位置 | **User.voiceProfile Json?** | 一个可空列,非破坏性迁移;JSON 免字段级迁移 |

## 5. 备选方案(已否决)

- **统计层 centaur**:算 burstiness/perplexity/禁词频次对比样本。客观,但 perplexity 需模型 logits 访问、实现复杂,且对「声音像不像」这种整体感受,统计量不如 LLM 整体判断直观。留作未来增强(可先上轻量「禁词频次 + 句长方差」两条不要模型权限的统计)。
- **per-novel 画像**:每本书独立声音。贴合现有 `Novel.settings.style` per-novel 模式,但与「作者跨书一致的个人指纹」诉求不符;且用户已选 per-user。per-novel 覆盖可作未来「作者模板 + 每书微调」。
- **从样本自动归纳画像**:LLM 读作者样本反推口头禅/意象/禁词,做成「智能填充」按钮。好功能,但增加复杂度与一轮 LLM 调用;留作便利增强。

## 6. 风险与开放问题

- **样本 token 成本**:validator 注 8×4000=32k 字样本,会显著抬高 validator 的输入。缓解:限制 samples ≤ 8 段、每段 ≤ 4000 字(见 3.2);日后可只注最短 2 段或样本摘要。需实测 validator 输入是否触及模型上下文上限。
- **LLM 判声音的主观性**:prompt 层 centaur 依赖 LLM 判「像不像」,可能不稳。缓解:把判定锚定到具体可检项(bannedWords 命中、signaturePhrases 复现、句长节奏),降低纯主观比重。
- **空画像体验**:默认(P1 规则)和有画像两套路径都要测,确保空画像不报错、不注入空 slice。
- **多用户隔离**:`voiceProfile` 在 User 上,天然按 userId 隔离;API/服务全程 userId scope,无跨租户风险(与 P0-1 教训一致)。

## 7. 实现切片(供 writing-plans 细化)

1. schema:`User.voiceProfile Json?` + 迁移。
2. 后端:`VoiceProfileService`(get/upsert,userId scope)+ `/settings/voice` GET/PUT + DTO 校验 + 单测。
3. 注入:writer 紧凑 slice(context-assembler / deep-agent 读 voiceProfile,空则跳过);validator 注样本 + 第 11 维(条件性)。
4. prompt:validator 加第 11 维文案。
5. 前端:`/settings` 作者画像区(chip 输入 + 样本框 + GET/PUT)。
6. 验证:server typecheck/lint/jest;agent-ui typecheck/lint/format。

## 8. 参考

- Humanizer-zh(op7418,基于 Wikipedia《Signs of AI writing》)— 去表层 AI 痕迹 + 「个性与灵魂」注入法。
- StoryScope 论文(arXiv:2604.03136)— 叙事层指纹(centaur 比对需对照真实样本)。
- 36kr《去除「AI 味」不完全手册》— 「注入肉身」+ 风格样本投喂(centaur)。
- KB `知识库/创作须知/文笔与文采.md` — 文采六美 / 个人语感。

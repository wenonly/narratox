# 多作者画像 + 每小说选择(Multi Author Voice Profiles)— 设计

- **日期**:2026-06-27
- **状态**:草案(待 review)
- **阶段**:P1.6 —— 演进 [P1.5 单作者画像](./2026-06-26-author-voice-profile-design.md)。把"一个全局画像"升级为"用户画像库 + 每本小说选一个",这样不同类型小说(修真/科幻/都市…)可以挂不同声音,互不限制。
- **分支**:在 `feat/p1.5-author-voice-profile`(未合并)上演进,不另开分支。P1.5 的画像 infra(service / 画像 agent / writer+validator 注入)大部分复用,核心是**数据模型从"User 列"改为"VoiceProfile 表 + Novel 外键"** + 选择 UX。

---

## 1. 背景与问题

P1.5 做的是**一个 per-user 全局画像**(`User.voiceProfile` Markdown)。问题是:一个作者写多种类型(修真吐槽风 vs 硬科幻 vs 都市)时,单一画像会把所有书锁成同一种腔调,反而限制。读者要的是"每本书有自己的声音",而作者本人可能掌握多种风格。

**目标**:让作者在 `/settings` 维护一个**画像库**(多个命名画像),每本小说**选一个**挂上;writer/validator 注入这本小说选中的画像;工作台左侧能查看/切换当前小说的画像。

## 2. 目标 / 非目标

**目标**
- `VoiceProfile` 表:per-user 画像库,CRUD 在 `/settings`(列表/新建/编辑/删除)。
- 画像 agent(P1.5 已有)从样本归纳 Markdown,**新建**一个画像(name + md)。
- `Novel.voiceProfileId` FK:每本小说选一个画像(可空)。
- 工作台 `IconRail` 加「画像」按钮 → 抽屉面板:**渲染查看**当前小说选中画像 + **下拉切换**用哪个画像。
- 注入:writer/validator 读**小说选中的**画像(非用户单一画像);空 → P1 默认规则。
- 首写软引导:未选画像时面板提示 + main agent 可提一句(非强制门禁)。
- 迁移:现有 `User.voiceProfile` → 种子成一个命名画像;列删除。

**非目标(留作后续)**
- 画像跨用户共享 / 画像市场。
- 从小说已有章节自动归纳画像(仍在 /settings 手动贴样本生成)。
- 工作台面板就地编辑画像内容(编辑统一去 /settings)。
- 强制门禁(没选画像不让写)——只软引导。

## 3. 设计

### 3.1 数据模型

新增 `VoiceProfile` 表;`Novel` 加外键:

```prisma
model VoiceProfile {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String                    // 画像名,如「修真吐槽风」
  profile   String                    // Markdown 画像
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

model Novel {
  ...
  voiceProfileId String?                // 选中的画像(null=未选,走 P1 默认)
  voiceProfile   VoiceProfile? @relation(fields: [voiceProfileId], references: [id], onDelete: SetNull)
}
```

User 侧加反向关系 `voiceProfiles VoiceProfile[]`;**删除 `User.voiceProfile` 列**(迁移见 3.6)。

### 3.2 后端 API

画像库 CRUD(均 `@CurrentUser`,userId scope):

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/settings/voice-profiles` | 列出当前用户全部画像(`{id,name,profile,updatedAt}`,profile 全量给——是自己的) |
| POST | `/settings/voice-profiles` | 新建 body `{ name, profile }`(profile 是已生成的 Markdown;生成走独立 `/generate` 不落库,前端拿到 md 命名后 POST 此接口)→ 返回新建行 |
| PATCH | `/settings/voice-profiles/:id` | 改 name / profile(整体覆盖)|
| DELETE | `/settings/voice-profiles/:id` | 删(删后,引用它的小说 voiceProfileId 自动 SetNull)|
| POST | `/settings/voice-profiles/generate` | 样本 → Markdown(P1.5 画像 agent 原样搬,**不落库**,回前端命名后 POST 新建)|

小说选画像(**新独立接口**,不复用 PATCH /novels/:id):

| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/novels/:id/voice-profile` | body `{ voiceProfileId: string \| null }` → 设/清当前小说的画像。校验:voiceProfileId 属于该用户(跨租户防护,同 P0-1 教训);null=取消选择 |

服务层:`VoiceProfileService` 改为对 `VoiceProfile` 表的 CRUD(userId scope)+ generate;`NovelService.setVoiceProfile(userId, novelId, voiceProfileId)`(assertOwned + 校验画像归属)。

### 3.3 注入改动

`DeepAgentService.runTurn`:不再 `voiceProfile.get(userId)`,改为读小说选中的画像:
- `voiceProfileMd = await this.voiceProfiles.getForNovel(userId, novelId)` → 内部 `novel.findFirst({where:{id:novelId,userId},select:{voiceProfile:{select:{profile:true}}}})`。
- 其余不变:有则拼 `voiceSlice`(writer)+ `validatorSlice`(validator),各截 1500;空则两 slice=''(P1 默认)。
- `Promise.all` 与 active 模型配置同轮读(保留 P1.5 的合并优化)。

### 3.4 FE `/settings` —— 画像库

`作者画像` 区改为**画像库**:
- 画像卡片列表(每张:名称 + Markdown 预览(截断)+ 「编辑」「删除」)。
- 「新建画像」→ 走 P1.5 的三状态流程(空 CTA:贴样本生成 / 手动模板)→ 命名 → 保存(POST 新建)。
- 现有 `VoiceProfile.tsx` 拆成 `VoiceProfileList.tsx`(库)+ `VoiceProfileEditor.tsx`(单张编辑/新建,复用三状态)。

类型:`VoiceProfile { id, name, profile, updatedAt }`;`api/settings.ts` 加 list/create/update/delete/generate;`api/novels.ts` 加 `setNovelVoiceProfile(novelId, voiceProfileId|null)`;`routes.ts` 加对应路由。

### 3.5 FE 工作台 —— IconRail「画像」按钮 + 抽屉面板

- `IconRail` 加「画像」按钮(新 icon)→ 打开一个**抽屉/overlay 面板**(不挤占 3 栏 `[IconRail][ChatPanel][ResourcePanel]`)。
- 面板内容:
  - **下拉选择器**:列出用户全部画像 + 「无(默认风格)」;当前小说选中的高亮。切换 → `PUT /novels/:id/voice-profile` → toast。
  - **渲染预览**:选中画像的 Markdown(用 MarkdownRenderer)。
  - 未选时:提示「未选择画像 — 选一个,或用默认风格」(软引导)。
- 不在面板编辑内容(去 /settings)。

### 3.6 迁移

- 新建 `VoiceProfile` 表 + `Novel.voiceProfileId` 列。
- **数据迁移**:把每用户现有 `User.voiceProfile`(非空)seed 成一条 `VoiceProfile`(name 用「默认画像」,profile=原值),并把这些用户的小说 `voiceProfileId` 暂**不自动指**(留给用户在工作台选;或可选:把 seed 画像指给该用户所有已有小说——**默认不指**,保持中立)。
- 删除 `User.voiceProfile` 列。
- 迁移用 Prisma migration + 一段数据迁移 SQL/脚本(把 User.voiceProfile 搬进 VoiceProfile 表)。

### 3.7 首写软引导

- 工作台面板:未选画像时显示提示(3.5)。
- `MAIN_AGENT_PROMPT` 加一句:若 `get_novel_info` 显示当前小说未选作者画像,可顺带提醒用户「左侧画像面板可挑一个」;**不阻塞写作**。

## 4. 决策与权衡

| 决策 | 选择 | 理由 |
|---|---|---|
| 画像归属 | per-user 库 + 每小说选 | 作者多风格;不同书挂不同声音 |
| 选画像接口 | **新独立** `PUT /novels/:id/voice-profile` | 用户明确要新接口,语义清晰、不污染 novel update DTO |
| 首写引导 | 软引导(面板提示 + agent 提) | 不阻塞写作;尊重用户"先写再说" |
| 面板能力 | 查看 + 切换(编辑去 /settings) | 面板轻量;编辑集中在一处 |
| 面板形态 | 抽屉/overlay(非第 4 栏) | 不破坏 3 栏布局 |
| 已有小说是否自动指画像 | 否,留空让用户选 | 中立,不替用户决定哪本用哪个声音 |
| 删 User.voiceProfile | 是,migration 搬走 | 避免双轨 |

## 5. 备选(已否决)

- **复用 PATCH /novels/:id 加 voiceProfileId 字段**:用户明确要独立接口。
- **工作台面板就地编辑画像**:会让面板变重,且编辑同一画像影响多本书——集中到 /settings 更安全。
- **强制门禁(没选不让写)**:与"软引导"决策相悖,降低体验。
- **每小说独立拥有画像(非共享库)**:重复维护;库 + 选择更省事。

## 6. 风险与开放问题

- **迁移数据完整性**:User.voiceProfile → VoiceProfile 的搬迁脚本要幂等、按 userId 去重(同用户只 seed 一次)。需测空值用户。
- **删画像的连锁**:删一个被多本小说引用的画像 → `onDelete: SetNull` 自动把这些小说置空(走 P1 默认)。UI 删除前可二次确认。
- **跨租户**:PUT /novels/:id/voice-profile 必须校验 voiceProfileId 属于该用户(防 P0-1 同类的越权)。
- **注入读取多一次 join**:`getForNovel` 是 novel→voiceProfile 一次查询(join),与现有 references.listAll 同量级,可接受。
- **FE 改动量**:`VoiceProfile.tsx` 拆 list/editor + 新工作台抽屉面板 + IconRail 按钮 —— 是 P1.5 之后又一次中等 FE 改动。

## 7. 实现切片(供 writing-plans 细化)

1. schema:`VoiceProfile` 表 + `Novel.voiceProfileId` + User 反向关系 + 迁移(含 User.voiceProfile→VoiceProfile 数据搬迁 + 删列)。
2. 后端:`VoiceProfileService`(CRUD userId-scope + generate 改造)+ `/settings/voice-profiles` 路由 + `NovelService.setVoiceProfile` + `PUT /novels/:id/voice-profile`(含跨租户校验)+ 单测。
3. 注入:`DeepAgentService` 改 `getForNovel(userId, novelId)`(Promise.all 合并)+ 改掉旧 `voiceProfile.get(userId)`。
4. prompt:`MAIN_AGENT_PROMPT` 加首写软引导句。
5. FE 类型/API:`VoiceProfile` 类型 + `api/settings` CRUD/generate + `api/novels.setNovelVoiceProfile` + `routes`。
6. FE `/settings`:`VoiceProfileList` + `VoiceProfileEditor`(三状态复用)替换旧单画像组件。
7. FE 工作台:`IconRail` 画像按钮 + 抽屉面板(下拉切换 + MarkdownRenderer 预览 + 未选提示)。
8. 验证:server typecheck/lint/jest;agent-ui typecheck/lint/format;迁移脚本幂等性测。

## 8. 参考

- [P1.5 作者画像 spec](./2026-06-26-author-voice-profile-design.md)(单画像 → 本篇演进为其多画像版)
- P1「网文写作技法 + 去 AI 指纹」prompt:作者声音维度的来源。

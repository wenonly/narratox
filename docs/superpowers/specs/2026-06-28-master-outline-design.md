# 总纲 + 弧线暴露 + 卷纲轻量补 设计

> 日期:2026-06-28 · 关联 [Phase 12 arc/volume](./2026-06-27-arc-volume-summary-design.md)、[Phase 10 living outline](./2026-06-27-outline-rewrite-feedback-design.md)

## 问题诊断

大纲层级分析暴露三个长篇 coherence 缺口:

1. **总纲结构上不存在。** 全书脊梁只有 `Novel.synopsis`(自由文本一行)。outliner prompt **嘴上**写「建总纲」([agent-prompts.ts:391](../../server/src/agentos/agent-prompts.ts#L391)),实际只产 `Volume.synopsis` 字符串——全书级思考(主线脉络/结局/力量进阶曲线/暗线时刻表)在规划时蒸发,既没落库、也没每轮注入。后果:**战力崩坏**(无升级时刻表,writer 放飞)+ **暗线遗忘/过早揭晓**(无埋·推进·揭示计划)+ **主线漂移**(无结局倒推锚点)。
2. **弧线建了却没 UI。** `Arc` 模型(Phase 12)存在,但 `get_outline` 不返 arcs、`OutlineView` 不渲染——用户连"它存在"都看不到。中程结构(卷内分弧)对作者不可见。
3. **卷纲太薄。** `Volume` 只有 title/goal/synopsis/arcSummary,缺「承上启下」(本卷如何承接上卷、为下卷埋什么)与「主线推进点」(本卷主线走到哪)。
4. **per-turn 只有局部方向。** ContextAssembler 只注入【当前弧线】(当前卷+当前弧),writer/main 看不到全书北极星——这是长篇漂移的结构性根因。

## 目标

- **补总纲**:新增全书级 `MasterOutline`(1:1 Novel),固化 6 个直接对应长篇杀手的字段;由 outline-writer 在分卷前「立总纲」;**每轮注入【总纲】slice 给 main + writer** 作为稳定北极星。
- **暴露弧线 UI**:`get_outline` 增返 arcs;大纲面板每卷展开后先列弧线、再列细纲。
- **卷纲轻量补**:`Volume` 加 `bridge`(承上启下)+ `mainProgress`(主线推进点);`set_volume` 增参;UI 卷头展示。
- **一条迁移**承载以上结构变更。

## 设计

### 1. `MasterOutline` 模型(1:1 Novel)

`server/prisma/schema.prisma` 新增:

```prisma
/// 总纲(全书级蓝图,1:1 Novel):固化主线/结局/力量进阶曲线/暗线时刻表/卷划分。
/// 长篇最稳定的一层,每轮注入 main+writer 作北极星,锁战力崩坏 + 暗线遗忘 + 主线漂移。
model MasterOutline {
  id        String   @id @default(cuid())
  novelId   String   @unique
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  theme     String   @default("")   // 故事核 + 主题(一句话定调)
  mainLine  String   @default("")   // 主线脉络(起承转合关键节点/走向)
  ending    String   @default("")   // 结局(先定→倒推铺垫)
  powerProgression Json @default("[]") // [{ volume:Number, level:String, note:String }] 力量/金手指进阶曲线
  hiddenLines Json   @default("[]") // [{ name, type, plant, advance:[], reveal }] 暗线/核心伏笔时刻表
  volumeSplitLogic String @default("") // 卷划分逻辑(为何这么分,每卷在全书角色)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([novelId])
}
```

- `Novel` 增 `masterOutline MasterOutline?`(1:1,novelId @unique 在子侧)。
- `User` 增 `masterOutlines MasterOutline[]` 反向关系。
- `userId` 多租户隔离(同 NovelReference/Volume 模式)。

`Volume` 增两字段:

```prisma
bridge       String   @default("")   // 承上启下(承接上卷 + 为下卷埋线)
mainProgress String   @default("")   // 本卷主线推进点(本卷主线走到哪)
```

### 2. `MasterOutlineService`(`server/src/novel/master-outline.service.ts`)

```ts
upsert(userId, novelId, { theme, mainLine, ending, powerProgression, hiddenLines, volumeSplitLogic })
get(userId, novelId): Promise<MasterOutline | null>
```

均 `assertOwned(novelId 属 userId)`(同 NovelReferenceService 模式)。upsert 按 novelId(unique)幂等。

### 3. `buildMasterOutlineSlice(master)` 纯函数

新文件 `server/src/agentos/master-slice.ts`(镜像 `reference-slice.ts` 模式):

```ts
export function buildMasterOutlineSlice(m: MasterOutlineLike | null): string {
  if (!m) return '';
  // 各字段格式化,powerProgression →「卷1:炼气→筑基」,hiddenLines →「身世线:埋卷1→推卷3·5→揭卷6」
  // 返回 '【总纲】\n故事核:...\n主线:...\n结局:...\n力量进阶:...\n暗线:...\n卷划分:...' 或 ''
}
```

无总纲 → `''`(不注入)。main(ContextAssembler)与 writer(runTurn augment)共用,消除重复。

### 4. 注入【总纲】slice → main + writer

- **main**:`ContextAssembler.forSession` 取 `masterOutlineService.get(userId, novel.id)`,把 `buildMasterOutlineSlice(master)` 作为**第一个** slice(north star,在【小说态势】之前)。
- **writer**:`DeepAgentService.runTurn` 取同一 master,`buildMasterOutlineSlice` 经新 `masterSlice` 入参传给 `buildAgentGraph`;`resolvePrompt` 在 `promptAugment==='writer'` 时追加(`prompt += masterSlice + voiceSlice`)。

> writer 必须拿到总纲:战力崩坏是 writer 写出来的,main 隔层 task 委派传不到位(子 agent 不继承 slice)。总纲浓缩后 token 成本可接受(writer 已有 references+voice slice)。

### 5. `set_master_outline` 工具(新,on outline-writer)

`server/src/agentos/tools/set-master-outline.tool.ts`,params:theme/mainLine/ending/powerProgression/hiddenLines/volumeSplitLogic(均可选,upsert 全量)。注册 `TOOL_REGISTRY`,加入 `outline-writer.tools`。

### 6. `set_volume` 增参(卷纲轻量补)

`set-volume.tool.ts` schema 增 `bridge?:string`、`mainProgress?:string`;`OutlineService.upsertVolume` 接收并写入。

### 7. `get_outline` 增返 master + arcs

- `OutlineService.listOutline` 注入 `MasterOutlineService` + `ArcService`,返回 `{ master, volumes, arcs, chapterOutlines }`。
- `get-outline.tool.ts` 序列化 master(各字段)+ arcs(`order/title/goal/第from-to章/summary/volumeOrder`)进返回。
- outline-critic 据此审「卷/细纲是否服务总纲」+ 总纲自身完整性。

### 8. OUTLINER prompt 改造

- **OUTLINER_WRITER**:
  - 新增 **【第零步 — 立总纲】**(set_master_outline):theme/mainLine/ending + **powerProgression**(哪卷跨哪个门槛,锁战力)+ **hiddenLines**(身世/家族/幕后黑手,埋·推进·揭示卷,长篇发动机)+ volumeSplitLogic。强调:结局先定倒推、力量曲线覆盖全书、每条暗线必有 reveal 计划。
  - 原「第二步 建总纲」**改名「分卷」**(那是 volume-building,不是总纲)。
  - 分卷 step 增填 `bridge`(承上启下)+ `mainProgress`(主线推进点)。
- **OUTLINER_ORCH**:建大纲任务的委派指示增「先立总纲再分卷」。
- **OUTLINER_CRITIC**:dim 1(故事核匹配)→ 读 master 审「卷/细纲是否服务总纲」;新增总纲自检(力量曲线覆盖全书?暗线有 reveal 计划?结局倒推?)。blockingIssues 点名卷/章惯例不变。

### 9. FE:总纲区 + 弧线区 + 卷纲字段

- `types/novel.ts`:`OutlineData` 增 `master` + `arcs`;`Volume` 增 `bridge/mainProgress`;新增 `Arc`/`MasterOutline` FE 类型。
- `OutlineView`(`ResourcePanel.tsx`):
  - **顶部【总纲】区**(可折叠):theme/mainLine/ending + 力量进阶 + 暗线时刻表 + 卷划分。只读。
  - 每卷展开:**弧线子区**(`🎬 title · 第N-M章 · goal` + summary,按 volumeId 归卷)→ **卷头字段**(目标/承上启下/主线推进)→ **细纲**(ChapterPlanCard 不变)。
  - 未挂卷的弧线进「未分卷」桶(同细纲)。
- 空态文案补「总纲/弧线」。

## 数据模型(迁移)

一条迁移:
- 新增 `MasterOutline` 模型 + `Novel.masterOutline?` + `User.masterOutlines` 关系。
- `Volume` 加 `bridge` + `mainProgress`。
- **手动 `pnpm --dir server prisma generate`**(Prisma 7:migrate dev 不自动 regen client,[prisma7-generate-gotcha](../memory) 已知)。
- 历史行:Volume 新字段 default "",无总纲行(注入返 '',不回归)。

## 改动面

| 文件 | 改动 |
|---|---|
| `server/prisma/schema.prisma` | +MasterOutline 模型 + Novel/User 关系 + Volume.bridge/mainProgress |
| `server/src/novel/master-outline.service.ts` | **新增**:upsert/get |
| `server/src/novel/outline.service.ts` | upsertVolume 增 bridge/mainProgress;listOutline 增返 master+arcs(注入两 service) |
| `server/src/novel/novel.module.ts` | 注册 MasterOutlineService |
| `server/src/agentos/master-slice.ts` | **新增**:buildMasterOutlineSlice 纯函数 |
| `server/src/agentos/context-assembler.service.ts` | 注入 MasterOutlineService;【总纲】作首个 slice |
| `server/src/agentos/deep-agent.service.ts` | 注入 MasterOutlineService;runTurn 取 master 建 masterSlice 入参;resolvePrompt writer 追加 |
| `server/src/agentos/tools/set-master-outline.tool.ts` | **新增** |
| `server/src/agentos/tools/set-volume.tool.ts` | +bridge/mainProgress params |
| `server/src/agentos/tools/get-outline.tool.ts` | 增返 master+arcs |
| `server/src/agentos/agent-registry.ts` | 注册 set_master_outline |
| `server/src/agentos/agent-tree.config.ts` | outline-writer.tools +set_master_outline |
| `server/src/agentos/agent-prompts.ts` | OUTLINER_WRITER(+立总纲/改名/卷纲字段)+ ORCH + CRITIC |
| `agent-ui/src/types/novel.ts` | +MasterOutline/Arc 类型 + OutlineData/Volume 字段 |
| `agent-ui/src/api/novels.ts` | getOutline 映射新字段 |
| `agent-ui/src/components/workspace/ResourcePanel.tsx` | OutlineView:总纲区 + 弧线区 + 卷头字段 |

## 显式不做(non-goals)

- **不拆章纲/细纲**(上轮已判断 ROI 低、复杂度高;粒度悬崖靠总纲长程视野 + 细纲往远多规划填补)。
- **不手动编辑总纲/弧线**(agent sole author,同角色/事件;作者经 chat → main → outliner 改)。
- **coreForeshadowing 不单列**(与 `StoryEvent` 伏笔台账重叠;统一进 `hiddenLines` 计划态,StoryEvent 管 live 台账)。
- **不注入总纲给 critic/settler/orchestrator**(它们非内容产出;main+writer 已覆盖北极星 + 写作源头)。
- **不做力量曲线/暗线的结构化校验自动化**(critic prompt 审即可;硬校验 deferred)。

## 测试

- **新增** `master-slice.spec.ts`:有总纲格式化各字段 / 无总纲返 `''` / hiddenLines 与 powerProgression 格式。
- **新增** `master-outline.service.spec.ts`:upsert 幂等 / get / 多租户隔离。
- **扩展** outline 相关:listOutline 返回 master+arcs;upsertVolume 写 bridge/mainProgress。
- **回归**:`pnpm --dir server test && typecheck`、`pnpm --dir agent-ui validate`。
- **L2/活 E2E**(prompt 行为唯一真验证):建大纲看是否先立总纲、力量曲线/暗线是否落库注入。

## 验证未覆盖

- 总纲字段是否被 outline-writer(deepseek)认真填、力量曲线/暗线是否高质量依赖模型——L2 实测是唯一手段,可能需多轮调 prompt。
- 总纲注入 main+writer 的 token 成本随字段膨胀——靠 buildMasterOutlineSlice 截断兜底,实测观察。

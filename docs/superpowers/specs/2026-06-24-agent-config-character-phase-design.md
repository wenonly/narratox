# Agent 配置化 + 角色档案 Agent + 顶栏实时阶段状态

- 日期:2026-06-24
- 状态:已评审,待实现
- 关联:[deep-agent.service.ts](../../../server/src/agentos/deep-agent.service.ts)、[agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts)、[ChatPanel.tsx](../../../agent-ui/src/components/workspace/ChatPanel.tsx)

## 背景与动机

agent 系统已从「main + 3 子 agent」长成 **3 层树**:main → 4 个编排 agent(chapter / curator / worldbuilder / outliner)→ 各自的叶子(writer/settler/validator、wb-writer/wb-critic、outline-writer/outline-critic)。结构本身合理(每个编排 agent 把 writer→critic 流程关进聚焦上下文),但有两个问题:

1. **整棵树是写在 [deep-agent.service.ts:292-646](../../../server/src/agentos/deep-agent.service.ts#L292-L646) 里的字面量**——名字/prompt/工具/model 档位全耦合。每加一个 agent 都要手改那一大坨嵌套对象,越加越乱;且所有角色共用一个模型 + 一个温度,无法按角色调。
2. **角色是最薄弱的一等公民**:现在由 main 内联调 `set_character` 建 3 个主要角色、无评审循环;且 `Character` 稳定身份只有 5 个字段(name/role/aliases/faction/background),撑不起一个像样的角色档案。

外加一个 UX 小瘤:工作台顶栏硬显「正在读 第 N 章 · 标题(agent 可见)」,建世界观/大纲时(CONSEPT 阶段)它一直指着占位的第 1 章,纯误导。

## 目标

1. **配置化重构**:把 agent 树抽成声明式数据结构(`AgentSpec` 树 + 工具/prompt 注册表),`buildAgentGraph` 改为「读配置 → 递归建图」。配置支持按角色的 **maxTokens 档位 + temperature**;**按角色换 model provider 的形状留好但本期不接**(需 DB+UI,显式 deferred)。现有 4 编排分支迁移后**行为等价**。
2. **新增角色档案 agent**:作为配置项落地(顺带证明配置结构可扩展)。`character` 编排 → `char-writer` / `char-critic`,平行于 worldbuilder/outliner。配套扩展 `Character` 稳定身份字段(唯一 DB migration)。
3. **顶栏实时阶段状态**:去掉静态「第 N 章」,改为反映当前真正在做的事(流式时按工具映射出阶段;空闲时按 `Novel.status` 出阶段)。

## 非目标(YAGNI)

- 不做 `/settings` 里「按角色配模型/温度」的 UI(本期仅配置结构;UI 留后续)。
- 不做按角色换 model provider(只有一个活动 ModelConfig;`AgentSpec` 留 `modelOverride` 位置但不接)。
- 不新增「连贯性巡检 agent」(本期评估为可选/推迟)。
- 不改 `ContextAssembler`(角色按需 `get_characters` 取,不注入 slice)。
- FE 角色面板展示新字段是 nice-to-have 跟进,不在本 spec 范围(数据会经 `get_character` 自动带出)。

## 设计

### ① 配置化:agent 树从字面量 → 声明式配置

**核心类型**(`agent-tree.config.ts`):

```ts
export type ModelTier = 'long' | 'short'; // long=16_000, short=6_000(集中映射,不再散落)

export interface AgentSpec {
  name: string;                // task 委派目标名(如 'chapter'、'char-writer')
  description: string;         // 给父 agent 看的「何时委派」
  promptKey: string;           // 指向 PROMPTS 注册表
  promptAugment?: 'writer';    // 动态切片钩子(只有 writer 需要 references slice)
  modelTier: ModelTier;        // 解析为 maxTokens;temperature 见下
  temperature?: number;        // 可选按角色覆盖;undefined → activeConfig.temperature(本期全部 undefined=保持现状)
  tools: string[];             // TOOL_REGISTRY 的 key,构建时解析
  subagents?: AgentSpec[];     // 递归 → 嵌套 createSubAgentMiddleware
  // 未来扩展位(本期不读):modelOverride?: { configId: string }
}
```

**两本注册表**(`agent-registry.ts`,机械搬运现有工厂,不是新逻辑):

- `TOOL_REGISTRY: Record<string, (d: ToolDeps) => Tool>`,其中 `ToolDeps = { userId, novelId, novels, chapters, outlines, world, characters, references, knowledge, snapshots, summaries, events, prisma }`。每个条目把现有工厂包一层,集中服务装配,例如:
  ```ts
  append_section: (d) => makeAppendSectionTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters, novels: d.novels }),
  set_character:  (d) => makeSetCharacterTool({ userId: d.userId, novelId: d.novelId, characters: d.characters }),
  ```
  这取代现存的 `writerTools()` / `wbWriterTools()` / `outlineWriterTools()` 三个 helper(装配逻辑从散落改为集中)。
- `PROMPTS: Record<string, string>`:把 [agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts) 的导出常量收成 map(`'MAIN' | 'CHAPTER_ORCH' | 'WRITER' | 'SETTLER' | 'VALIDATOR' | 'CURATOR' | 'WB_ORCH' | 'WB_WRITER' | 'WB_CRITIC' | 'OUTLINER_ORCH' | 'OUTLINE_WRITER' | 'OUTLINE_CRITIC' | 'CHAR_ORCH' | 'CHAR_WRITER' | 'CHAR_CRITIC'`)。

**模型解析**:`resolveModel(spec, activeConfig)` 缓存 key 从 `${id}:${maxTokens}` 升级为 `${id}:${maxTokens}:${effectiveTemp}`,`effectiveTemp = spec.temperature ?? activeConfig.temperature`。有覆盖则 clone config 改温度再 `buildChatModel`。[model-factory.ts](../../../server/src/agentos/model-factory.ts) 不动。本期全部 `temperature` undefined → `effectiveTemp` 恒等于活动配置温度 → 缓存行为与今天逐字一致(回归安全)。

**`buildAgentGraph` 重写**为递归走配置:
- `buildNode(spec, ctx)`:解析 prompt(`PROMPTS[spec.promptKey]`,若 `promptAugment==='writer'` 则 `+ ctx.writerSlice`)、解析 model(`resolveModel`)、解析 tools(`spec.tools.map(k => TOOL_REGISTRY[k](ctx.deps))`);若 `spec.subagents` 非空,挂 `createSubAgentMiddleware({ defaultModel, generalPurposeAgent:false, defaultMiddleware: subagentStack(), subagents: spec.subagents.map(c => buildNode(c, ctx)) })`。
- 根 createAgent 用 `buildNode` 展开 main 的直接子节点;main 自身的 systemPrompt = `args.systemPrompt || PROMPTS['MAIN']`(保留状态感知回退);middleware 栈 = `[createSubAgentMiddleware(...), createSummarizationMiddleware, createPatchToolCallsMiddleware]`(框架机制,不进配置)。

**留在配置之外(框架机制,非 per-agent 旋钮)**:`generalPurposeAgent:false`、`subagentStack()`(仅 patch)、`StateBackend`+summarization、checkpointer 接线、`recursionLimit: 10_000`、`createSubagentTransformer`。

**整棵树**(配置化后的目标形态,②的新分支标 ← NEW):

```
main [MAIN, long]
  tools: get_novel_info, update_novel, get_reading_chapter, get_outline, get_chapter_plan,
         get_worldview, get_world_entry, get_character, get_characters, get_reference
  subagents:
  - chapter [CHAPTER_ORCH, long]  tools: snapshot_chapter, restore_chapter
    subagents:
    - writer [WRITER + augment, long]  (writer 全套工具)
    - settler [SETTLER, short]         get_chapter, write_summary
    - validator [VALIDATOR, short]     get_chapter, query_memory, report_review
  - curator [CURATOR, long]            list_knowledge, get_knowledge, set_references, get_reference
  - worldbuilder [WB_ORCH, long]       tools: []
    subagents:
    - wb-writer [WB_WRITER, long]
    - wb-critic [WB_CRITIC, short]     get_worldview, get_world_entry, get_novel_info, report_worldview_review
  - outliner [OUTLINER_ORCH, long]     tools: []
    subagents:
    - outline-writer [OUTLINE_WRITER, long]
    - outline-critic [OUTLINE_CRITIC, short]  get_outline, get_chapter_plan, get_novel_info, get_worldview, get_world_entry, query_memory, report_outline_review
  - character [CHAR_ORCH, long]  tools: []                              ← NEW
    subagents:
    - char-writer [CHAR_WRITER, long]                                    ← NEW
    - char-critic [CHAR_CRITIC, short]  + report_character_review        ← NEW
```

> main 的 `set_character`(写)**移除**,改为只读 `get_character`/`get_characters`——与 main 对 outline/worldview 的只读策略对齐。角色写入统一走 char-writer。

### ② 角色档案 agent(配置项落地)

**何时委派**:main 在世界观 + 大纲就绪后(角色弧光依赖大纲),或用户要求「丰富人物」时,`task` 委派 `character`。建议顺序:curator → worldbuilder → outliner → **character** → 写正文。(现 prompt 把角色放在大纲之前/并行;改为大纲之后,弧光才有所依。)

**char-writer 工具**:`set_character` / `get_character` / `get_characters` / `get_worldview` / `get_world_entry` / `get_outline` / `get_chapter_plan` / `get_novel_info` / `list_knowledge` / `get_knowledge` / `query_memory`。从世界观(势力/能力体系)+ 大纲(角色戏份/弧光)+ KB 人物方法论建丰富档案。

**char-critic 工具**:`get_character` / `get_characters` / `get_worldview` / `get_world_entry` / `get_outline` / `get_novel_info` / `query_memory` / `report_character_review`(新工具,瞬态、镜像 `report_outline_review`)。6 维:区分度 / 一致性(对齐世界观势力与力量体系)/ 弧光可行性(对齐大纲)/ 语言风格区分 / 关系合理性 / 动机可信。`blockingIssues` 须点名是哪个角色,驱动 char-writer 外科式修订。

**三个新 prompt**(风格镜像 WORLDBUILDER/OROUTLINER 三件套):
- `CHAR_ORCH`:收「建/丰富角色档案」→ task char-writer(取 KB 人物方法论 → 对齐故事核+世界观+大纲 → `set_character` 建主要角色丰富档案)→ task char-critic(6 维 → `report_character_review`)→ 修订最多 1 轮(只改被点名角色)→ 回复结论(角色数 + score)。铁律:char-writer 返回后必继续 char-critic;不写世界观/大纲/正文。
- `CHAR_WRITER`:取 KB(优先「设定三技·人物·世界观·金手指」人物部分)→ `get_novel_info`+`get_worldview`+`get_outline` 对齐 → `set_character` upsert 主要角色,填全:稳定身份 + 外貌/性格基调/动机/弧光目标/语言风格。修订模式:只改被点名角色。
- `CHAR_CRITIC`:读全(`get_characters`+`get_character` 核心角色 + 世界观 + 大纲 + 故事核)→ 6 维审计 → 必调 `report_character_review`。

**MAIN_AGENT_PROMPT 改动**:把现「建角色」段(内联 `set_character`)改为「`task` 委派 character 子 agent」,与 worldbuilder/outliner 段同款;并调整顺序到 outliner 之后。

### ② 配套:Character 稳定身份字段扩展(唯一 DB migration)

`Character` 模型新增 5 个**可空**字段(additive,无破坏):

| 字段 | 含义 |
|---|---|
| `appearance` | 外貌 |
| `personality` | 性格基调 |
| `motivation` | 动机/欲望 |
| `arcGoal` | 弧光目标(成长终点) |
| `voice` | 语言风格/口头禅 |

这些都是**稳定/前史/基线**属性(不随章节变),归稳定身份;易变状态仍由 settler 写 `CharacterChange` 时间线。架构上正确,非 hack。

- `upsertCharacter` 接受新字段(同现有 optional 模式);`get_character` / `get_characters` 已 spread 整行 → 新字段自动带出,无需改读路径。
- `set_character` tool schema 加这 5 个 optional 字段。
- FE 角色面板展示新字段:nice-to-have 跟进,不在本 spec。

### ③ 顶栏:静态「第 N 章」→ 实时阶段状态

**两层信号**,空闲显示阶段、流式显示当前动作:

**流式动作(主信号)**——在 [phase.ts](../../../agent-ui/src/lib/phase.ts) 里一张 `TOOL_TO_PHASE` 映射,数据来自 useAIStreamHandler 已在处理的 tool activity 的 `label`:

| 工具 label | 阶段文案 |
|---|---|
| `set_world_entry` | 构建世界观中 |
| `set_volume` / `set_chapter_plan` | 构建大纲中 |
| `set_character` | 建角色档案中 |
| `append_section` / `replace_text` / `insert_text` / `delete_text` / `clear_chapter` / `set_chapter_title` | 写作中·第 {writingChapterOrder} 章 |
| `write_summary` | 结算中 |
| `report_review` / `report_worldview_review` / `report_outline_review` / `report_character_review` | 评审中 |
| `set_references` | 整理参考资料中 |
| (流式中无工具命中) | 思考中… |

**空闲阶段**——纯函数 `deriveIdlePhase(novel)`:`status==='CONCEPT'` → `立项中(尚未开写)`;`status==='ACTIVE'` → `写作中 · 第 {currentChapterOrder ?? 最新章} 章 / 共 {chapters.length} 章`。无需 FE 拿 worldview/outline 是否存在,数据现成。

**改动**:
- [store.ts](../../../agent-ui/src/store.ts):加 `activePhase: string | null` + `setActivePhase`。
- [useAIStreamHandler.tsx](../../../agent-ui/src/hooks/useAIStreamHandler.tsx):处理 tool activity 时按 `TOOL_TO_PHASE` 映射 `setActivePhase`(写作类用 `writingChapterOrder`);run 结束/出错处清空(与 `writingChapterOrder` 同处清,[L562](../../../agent-ui/src/hooks/useAIStreamHandler.tsx#L562)/[L601](../../../agent-ui/src/hooks/useAIStreamHandler.tsx#L601))。
- [ChatPanel.tsx:106-116](../../../agent-ui/src/components/workspace/ChatPanel.tsx#L106-L116):右侧 pill 改为 `activePhase ?? deriveIdlePhase(novel)`;**去掉「(agent 可见)」**。

## 数据流

配置树(纯数据)→ `buildAgentGraph` 递归走 `TOOL_REGISTRY` / `PROMPTS` / `resolveModel` 建 langgraph 图 → stream / emitter / rewind / checkpointer 全不变。FE:tool activity → `TOOL_TO_PHASE` → `activePhase` → 顶栏;空闲走 `Novel.status`。

## 测试

- **配置树纯数据**:所有 `promptKey` 在 PROMPTS 里存在;所有 `tools` key 在 TOOL_REGISTRY 里存在;`modelTier` 合法;树结构快照(名字+工具集)与今天逐字一致(回归保护)。
- **resolveModel**:temperature 覆盖进 cache key;无覆盖时 `effectiveTemp`==活动配置温度(行为同今天)。
- **buildAgentGraph**:用极小 fake 树断言递归建图形状(有/无 subagents 两条路径)。
- **character**:char-writer/char-critic 在树里且工具可解析;`upsertCharacter` 接受并持久化 5 个新字段;`report_character_review` 工具结构化返回。
- **FE**:`deriveIdlePhase`(CONCEPT/ACTIVE 两档)+ `TOOL_TO_PHASE` 映射纯函数测试。

## 文件影响

**Server**
- 新增:`agent-tree.config.ts`、`agent-registry.ts`、`tools/report-character-review.tool.ts`。
- 改:`deep-agent.service.ts`(buildAgentGraph 走配置;resolveModel temp key;删内联树与三个 *Tools helper)、`agent-prompts.ts`(+CHAR_ORCH/CHAR_WRITER/CHAR_CRITIC;改 MAIN_AGENT_PROMPT 角色段)、`prisma/schema.prisma`(Character +5 字段)+ 迁移、`novel/character.service.ts`(upsertCharacter +5)、`tools/set-character.tool.ts`(schema +5)。

**Frontend**
- 新增:`lib/phase.ts`(`TOOL_TO_PHASE` + `deriveIdlePhase`)。
- 改:`store.ts`(+activePhase)、`hooks/useAIStreamHandler.tsx`(set/clear activePhase)、`components/workspace/ChatPanel.tsx`(顶栏)。

## 风险

- **行为等价回归**:迁移现有 4 分支必须逐字等价(prompt/工具/档位不变)。缓解:配置树快照测试 + writer 的 promptAugment 保留 writerSlice 拼接。
- **DB migration**:Character +5 可空字段,additive、低风险。注意 Prisma 7:`migrate dev` 后**必须手动 `pnpm --dir server prisma generate`**(否则 client 不含新字段,见 memory)。
- **main 失去 set_character**:行为变更。main 改为只读角色 + 委派 character agent。若 character agent 未委派就不建角色——由 MAIN_AGENT_PROMPT 引导(worldview+outline 后委派)。可接受。
- **顶栏阶段推断依赖 tool label**:若 activity 帧不带 tool 名则降级为「思考中…」。已确认 handler 能拿到 tool label(`activities[a.id].label`)。

## 开放问题

无(三个方向性分叉已在 brainstorming 阶段确认:配置仅结构 / 加角色 agent / 顶栏改实时阶段)。实现期若发现 activity 帧拿不到 subagent 路径,退化为纯 tool-label 映射(本设计已如此,不依赖 subagent 路径)。

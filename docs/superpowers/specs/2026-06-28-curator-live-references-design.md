# curator 资料系统「写活」设计

> 日期:2026-06-28 · 关联 [Phase 5 agent 配置树](./2026-06-24-agent-config-character-phase-design.md)、`ccbbebb`(库条目一律 null)

## 问题诊断

curator(参考资料策划)目前**写死**只服务两个 agent,且注入也是两条硬编码路径:

1. **产出写死** —— `CURATOR_AGENT_PROMPT`(`agent-prompts.ts:185-205`)明确指示「额外生成 main 精要 + writer 精要 两条」。新增 agent 不会被考虑。
2. **注入写死** —— 两条独立、重复的注入路径:
   - main:`ContextAssembler.forSession`(`context-assembler.service.ts:239-254`)inline 过滤 `injectTo==='main'||'both'` 拼 slice。
   - writer:`DeepAgentService.runTurn`(`deep-agent.service.ts:153-172`)inline 过滤 `injectTo==='writer'||'both'` 拼 `writerSlice`,经 `promptAugment:'writer'`(`resolvePrompt` `:367-373`)拼进 writer。
   - 其余 agent(chapter/curator/worldbuilder/outliner/character 编排器及其 writer/critic/settler/validator 叶子)**一律拿不到**参考资料 slice。
   - 两份代码字面重复(同样的 top6 + 500 字截断 + 全量索引格式)。
3. **精要没有「按需引导」** —— 精要正文里没有「写到 X 场景 → 去拉 Y 库文档」的指引;`injectTo=null` 的库条目(原始资料)只能靠 agent 自己猜去 `get_reference` 拉。
4. **UI 混排** —— `ReferencesView`(`agent-ui/.../ReferencesView.tsx`)按 `order` 扁平渲染,精要(有 tag)和库条目(null)混在一起,精要没置顶。

## 目标

把 curator 从「写死 main+writer」变成**声明式 + 通用注入**的全 agent 资料系统:

- curator 运行时读**活的** agent 名单(`AGENT_TREE` 实时生成),自行分析哪些 agent 受益,为受益者各写一条 `injectTo=<角色名>` 的专属精要。
- 注入**通用化**:任意 agent 都按自己的角色名拿到对应精要(若有);main 与所有子 agent 共用同一个 `buildReferenceSlice(role)` 纯函数,消除重复。
- 每条精要内含 **【按需索引】**(场景→库文档),agent 写到该场景经 `get_reference` 拉取对应 `injectTo=null` 库条目。
- 被打 tag 的角色**自动获得** `get_reference` 拉取能力(原来只有 main/writer 有)。
- UI 把有 tag 的精要**置顶**,库条目沉底。

用户已确认:**全 agent 自由**——curator 可给任意角色(含 critic/settler)打 tag,不预设候选集。

## 设计

### 1. 通用注入纯函数 `buildReferenceSlice`

新文件 `server/src/agentos/reference-slice.ts`:

```ts
export interface ReferenceLike {
  injectTo: string | null;
  title: string;
  category: string;
  content?: string | null;
}

/**
 * 拼某角色的【写作参考】slice:命中本角色精要(top6、各截 500 字)+ 全量索引(让 agent
 * 知道还有什么可拉)。无精要 → 返回 ''(不注入)。
 * 'both' 兼容:命中任意 role(历史 main+writer 语义;curator 今后用具体角色名)。
 * 纯函数,不带前导换行;调用方自行加间距(ContextAssembler 走 slices.join('\n');
 * resolvePrompt 走 prompt + '\n\n' + slice)。
 */
export function buildReferenceSlice(role: string, refs: ReferenceLike[]): string {
  const essence = refs.filter((r) => r.injectTo === role || r.injectTo === 'both');
  if (!essence.length) return '';
  const index = refs
    .map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category || '—'})`)
    .join('\n');
  const body = essence
    .slice(0, 6)
    .map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`)
    .join('\n\n');
  return `【写作参考】\n索引:\n${index}\n\n精要:\n${body}`;
}
```

消费方:
- `ContextAssembler.forSession`(`:239-254`)inline 段 → 改为 `const s = buildReferenceSlice('main', refsAll); if (s) slices.push(s);`
- `DeepAgentService.buildAgentGraph` 的 `resolvePrompt` → 每个 agent 拼 `buildReferenceSlice(spec.name, refsAll)`(缓存 per role)。

### 2. 注入通用化(`deep-agent.service.ts`)

`runTurn`(`:153-196`)重构:
- 仍 `refsAll = await this.references.listAll(...)`。
- **删除** inline 的 `writerRefs`/`refIndexLines`/`writerSlice` 计算(`:158-172`)。
- `voiceSlice`(writer 作者声音)、`validatorSlice`(validator 作者画像)保留不变。
- `buildAgentGraph` 入参由 `{ writerSlice }` 改为 `{ refsAll, voiceSlice, validatorSlice }`。

`buildAgentGraph` 的 `resolvePrompt`(`:367-373`)改写:

```ts
const refSliceCache = new Map<string, string>();
const refSliceFor = (role: string) => {
  let s = refSliceCache.get(role);
  if (s === undefined) { s = buildReferenceSlice(role, refsAll); refSliceCache.set(role, s); }
  return s;
};
const resolvePrompt = (spec: AgentSpec) => {
  let prompt = PROMPTS[spec.promptKey];
  if (spec.name === 'curator') prompt += '\n\n' + buildAgentRoster(); // 活名单,见 §4
  const refSlice = refSliceFor(spec.name);
  if (refSlice) prompt += '\n\n' + refSlice;
  if (spec.promptAugment === 'writer') prompt += voiceSlice;   // 仅作者声音
  if (spec.promptAugment === 'validator') prompt += validatorSlice;
  return prompt;
};
```

> 注意:main 不走 `resolvePrompt`(main 是 root,直接用 ContextAssembler 产出的 `systemPrompt`,已含 main slice)。`resolvePrompt` 只服务子 agent。

`rewind`(`:263-270`)同步改入参:`refsAll: []`、`voiceSlice: ''`(rewind 不跑 LLM,slice 内容无所谓,仅满足签名)。

### 3. tagged → 自动获得 `get_reference`(`deep-agent.service.ts` `buildNode`)

```ts
const buildNode = async (spec: AgentSpec) => {
  const tools = [...spec.tools];
  const hasEssence = refsAll.some(
    (r) => r.injectTo === spec.name || r.injectTo === 'both',
  );
  if (hasEssence && !tools.includes('get_reference')) tools.push('get_reference');
  const node = {
    name: spec.name,
    description: spec.description,
    systemPrompt: resolvePrompt(spec),
    model: await this.resolveModel(spec, activeConfig),
    tools: resolveTools(tools),
  };
  // ...(subagents 递归不变)
};
```

效果:curator 标了 `validator` → validator 本轮拿到 `get_reference`,可按精要里的【按需索引】拉库文档。没被标的 agent 不多拿工具。main/writer 本就静态有 `get_reference`,不回归。

### 4. curator 读「活的」agent 名单(`agent-tree.config.ts`)

新增导出纯函数(紧挨 `collectSpecs`):

```ts
/**
 * curator 用的 agent 名单(从 AGENT_TREE 实时遍历):角色名 + 职责描述。
 * 新增 agent → 自动进名单,curator 自动纳入考虑(prompt 无需改)。排除 curator 自身(它是生产者)。
 */
export function buildAgentRoster(): string {
  const lines = collectSpecs(AGENT_TREE)
    .filter((s) => s.name !== 'curator')
    .map((s) => `- ${s.name}:${s.description}`);
  return `【agent 名单 — 你可为之生成专属精要的角色】\n${lines.join('\n')}`;
}
```

`resolvePrompt` 里 `spec.name === 'curator'` 时追加(见 §2)。AGENT_TREE 静态 → 名单在每次 build 时现算,天然「活」。

### 5. CURATOR prompt 重写(`agent-prompts.ts:185-205`)

核心改动:
- 开头任务从「为 main 和 writer 各生成一份精要」改为「**读下方 agent 名单,分析哪些 agent 受益于写作参考资料,为受益者各写一条 `injectTo=<角色名>` 精要**」。
- 每条精要必须含 **【按需索引】**:把写作场景映射到该拉取的库条目(`injectTo=null`),格式「写 X 场景 → 《库条目标题》(分类)」,agent 经 `get_reference(title)` 拉取。
- **judiciousness**:不必每个 agent 都给;聚焦「产出/校验内容」且本书题材相关者;每条精要几百字、高度凝练可执行;细节一律靠 agent 按需 `get_reference` 拉。
- 库条目(原始资料)`injectTo` 一律 `null`(不变,`ccbbebb` 省上下文设计)。
- 保留:先 `list_knowledge`→`get_knowledge`→去重浓缩建库;最后 `set_references` 一次性写入(库条目 + 各角色精要)。

新 prompt 全文(见 plan Task 1)。

### 6. `set_references` 工具放宽 injectTo(`tools/set-references.tool.ts:47`)

```ts
injectTo: z
  .string()
  .optional()
  .describe('该条自动注入哪个 agent 的 context;填角色名(如 main/writer/validator/char-writer…);不填=仅工具可取(库原始资料)'),
```

description(`:40`)同步更新:不再枚举 main/writer/both,改为「填目标 agent 角色名」。`'both'` 仍可传(兼容旧语义),但 curator 今后用具体角色名。

### 7. UI 置顶 + badge 全角色(`ReferencesView.tsx`)

排序(有 tag 置顶,组内稳定):

```ts
const sorted = [...refs].sort((a, b) => {
  const at = a.injectTo ? 0 : 1;
  const bt = b.injectTo ? 0 : 1;
  return at - bt; // ES sort 稳定:同优先级保原序
});
```

badge 友好名补全已知角色,未知角色显示原名:

```ts
const BADGE: Record<string, string> = {
  main: '主 agent', writer: '写手', both: '主+写手',
  validator: '校验', settler: '结算', chapter: '章节编排',
  worldbuilder: '世界观编排', 'wb-writer': '世界观写手', 'wb-critic': '世界观评审',
  outliner: '大纲编排', 'outline-writer': '大纲写手', 'outline-critic': '大纲评审',
  character: '角色编排', 'char-writer': '角色写手', 'char-critic': '角色评审',
};
const badgeClass = (injectTo: string | null): string => {
  if (injectTo === 'both') return 'bg-brand/20 text-brand';
  if (injectTo) return 'bg-accent text-primary'; // 任意角色 tag
  return 'bg-primary/5 text-muted';
};
```

## 数据模型

**无 DB 迁移。** `NovelReference.injectTo` 已是 `String?`(`schema.prisma:305`),天然支持任意角色名。`'both'` 兼容保留(helper 命中任意 role)。

## 精要产出示例(curator,injectTo=writer)

```
### 写手精要 · 本书写战斗/情绪的要点
- 战斗:短句堆叠、动词驱动,忌能力越级(见 validator dim3)
- 情绪:用动作外化,少直接说"他很愤怒"
【按需索引 — 写到该场景就 get_reference 拉取】
- 写战斗场面 → 《战斗描写词汇汇编》(词汇素材库)
- 写权力博弈 → 《朝堂权谋套路》(公式模板)
- 写人物出场 → 《惊艳出场公式》(公式模板)
```

## 改动面

| 文件 | 改动 |
|---|---|
| `server/src/agentos/reference-slice.ts` | **新增**:`buildReferenceSlice(role, refs)` 纯函数 |
| `server/src/agentos/deep-agent.service.ts` | runTurn 删 inline writerSlice、改入参 `refsAll`+`voiceSlice`;`resolvePrompt` 通用化(每 agent 拼 refSlice + curator 追加 roster);`buildNode` tagged 条件补 `get_reference`;rewind 同步入参 |
| `server/src/agentos/context-assembler.service.ts` | main slice 段改用 `buildReferenceSlice('main', refsAll)` |
| `server/src/agentos/agent-tree.config.ts` | 新增 `buildAgentRoster()` 导出 |
| `server/src/agentos/agent-prompts.ts` | 重写 `CURATOR_AGENT_PROMPT`(读 roster→分析→按角色名打 tag→每条含【按需索引】) |
| `server/src/agentos/tools/set-references.tool.ts` | `injectTo` schema 放宽为 `z.string()` + description 更新 |
| `agent-ui/src/components/workspace/ReferencesView.tsx` | 有 tag 置顶排序 + badge 全角色友好名 |
| `server/src/novel/novel-reference.service.ts` | 视使用情况:移除/放宽已死的 `listForInject`(plan 中 grep 确认) |

## 显式不做(non-goals)

- **不**给库条目(null)加自动注入(`ccbbebb` 省上下文设计不变,仍按需 `get_reference`)。
- **不**做向量检索/语义拉取(`get_reference` 仍按 title/category 模糊查)。
- **不**强制每个 agent 都有精要(全自由 ≠ 必给;curator 自行判断)。
- **不**改全局 KB 浏览页(只动本小说参考资料面板)。
- **不**给 NovelReference 加 `tags` 列(分类 `category` 已够;tag 概念在全局 KB frontmatter,非本表)。

## 测试

- **新增** `reference-slice.spec.ts`:命中本角色精要 / `'both'` 命中 / 无精要返 `''` / top6 截断 / 500 字截断 / 索引含全量条目。
- **新增**(可选)`agent-tree.config` roster:`buildAgentRoster()` 含 writer/validator 等已知角色、排除 curator。
- **回归**:`pnpm test` + `pnpm typecheck`(server)、`pnpm validate`(agent-ui)。
- **L2 / 活 E2E**(prompt 行为验证,唯一真验证):立项后建参考资料,看 curator 是否产出**多角色**精要(非仅 main+writer)、各角色是否真注入、写到对应场景是否真 `get_reference`。

## 验证未覆盖

- curator 是否真能「judicious」地挑对角色、写好【按需索引】,依赖模型(deepseek)——L2 实测是唯一验证手段;可能需多轮调 prompt。
- 「全 agent 自由」下若 curator 给 critic/settler 也打 tag,是否过度注入噪声——靠 prompt 的 judiciousness 约束 + top6 截断兜底;实测观察。

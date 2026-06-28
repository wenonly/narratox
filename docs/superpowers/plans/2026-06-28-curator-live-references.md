# curator 资料系统「写活」实施计划

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** curator 从写死 main+writer 改为读「活的」agent 名单、按需给任意角色生成专属精要;注入通用化;精要含【按需索引】;UI 有 tag 置顶。

**Spec:** [2026-06-28-curator-live-references-design.md](../specs/2026-06-28-curator-live-references-design.md)

**Architecture:** 抽出纯函数 `buildReferenceSlice(role, refs)` 替代两份重复注入;`resolvePrompt` 通用化(每 agent 按角色名拼精要);tagged 角色条件补 `get_reference`;curator 运行时追加 `buildAgentRoster()`。

---

## Task 1:`buildReferenceSlice` 纯函数 + 单测

**Files:**
- Create: `server/src/agentos/reference-slice.ts`
- Test: `server/src/agentos/reference-slice.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/reference-slice.spec.ts`:
```ts
import { buildReferenceSlice } from './reference-slice';

const ref = (injectTo: string | null, title: string, category = '分类', content = '正文') =>
  ({ injectTo, title, category, content });

describe('buildReferenceSlice', () => {
  it('命中本角色精要 + 全量索引', () => {
    const refs = [
      ref('writer', '写手精要', '方法论', '写战斗要点'),
      ref(null, '战斗词汇', '词汇'),
      ref('main', '主精要', '方法论'),
    ];
    const s = buildReferenceSlice('writer', refs);
    expect(s).toContain('【写作参考】');
    expect(s).toContain('写手精要');
    expect(s).toContain('写战斗要点');
    // 索引含全量(含 null 与别的角色)
    expect(s).toContain('战斗词汇');
    expect(s).toContain('主精要');
  });

  it("'both' 命中任意 role(兼容)", () => {
    const refs = [ref('both', '通用精要')];
    expect(buildReferenceSlice('writer', refs)).toContain('通用精要');
    expect(buildReferenceSlice('validator', refs)).toContain('通用精要');
  });

  it('无精要返空串(不注入)', () => {
    const refs = [ref(null, '库条目'), ref('main', '主精要')];
    expect(buildReferenceSlice('validator', refs)).toBe('');
  });

  it('top6 截断 + 500 字截断', () => {
    const refs = Array.from({ length: 8 }, (_, i) =>
      ref('writer', `精要${i}`, 'c', 'X'.repeat(600)),
    );
    const s = buildReferenceSlice('writer', refs);
    expect((s.match(/### /g) || []).length).toBe(6);
    // 每条精要正文 ≤ 500('X'.repeat(500)),不含 600
    expect(s).not.toContain('X'.repeat(600));
    expect(s).toContain('X'.repeat(500));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- reference-slice.spec.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

Create `server/src/agentos/reference-slice.ts`:
```ts
export interface ReferenceLike {
  injectTo: string | null;
  title: string;
  category: string;
  content?: string | null;
}

/**
 * 拼某角色的【写作参考】slice:命中本角色精要(top6、各截 500 字)+ 全量索引。
 * 无精要 → 返回 ''(不注入)。'both' 兼容:命中任意 role。
 * 纯函数,不带前导换行;调用方自行加间距。
 */
export function buildReferenceSlice(role: string, refs: ReferenceLike[]): string {
  const essence = refs.filter(
    (r) => r.injectTo === role || r.injectTo === 'both',
  );
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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- reference-slice.spec.ts`
Expected: PASS(4 个)。

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/reference-slice.ts server/src/agentos/reference-slice.spec.ts
git commit -m "feat(reference): buildReferenceSlice 纯函数(通用按角色拼精要+索引)"
```

---

## Task 2:`buildAgentRoster()` + 单测

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`(紧挨 `collectSpecs` 后追加)
- Test: 同文件已有 `describeTree` 测试套路;新建 `server/src/agentos/agent-tree.roster.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/agent-tree.roster.spec.ts`:
```ts
import { buildAgentRoster, AGENT_TREE } from './agent-tree.config';
import { collectSpecs } from './agent-tree.config';

describe('buildAgentRoster', () => {
  it('含全部已知角色(除 curator 自身)', () => {
    const roster = buildAgentRoster();
    expect(roster).toContain('【agent 名单');
    for (const name of [
      'main', 'writer', 'validator', 'settler',
      'wb-writer', 'outline-writer', 'char-writer',
    ]) {
      expect(roster).toContain(name);
    }
    // curator 是生产者,不自标
    expect(roster).not.toContain('\n- curator:');
  });

  it('与 AGENT_TREE 同步:collectSpecs 去掉 curator 后一一对应', () => {
    const names = collectSpecs(AGENT_TREE)
      .map((s) => s.name)
      .filter((n) => n !== 'curator');
    const roster = buildAgentRoster();
    for (const n of names) expect(roster).toContain(n);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- agent-tree.roster.spec.ts`
Expected: FAIL(`buildAgentRoster` 未导出)。

- [ ] **Step 3: 实现**

在 `agent-tree.config.ts` 的 `collectSpecs` 函数之后追加:
```ts
/**
 * curator 用的 agent 名单(从 AGENT_TREE 实时遍历):角色名 + 职责描述。
 * 新增 agent → 自动进名单,curator 自动纳入考虑(prompt 无需改)。排除 curator 自身。
 */
export function buildAgentRoster(): string {
  const lines = collectSpecs(AGENT_TREE)
    .filter((s) => s.name !== 'curator')
    .map((s) => `- ${s.name}:${s.description}`);
  return `【agent 名单 — 你可为之生成专属精要的角色】\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- agent-tree.roster.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.roster.spec.ts
git commit -m "feat(agent-tree): buildAgentRoster() — curator 读活的 agent 名单"
```

---

## Task 3:ContextAssembler 用 `buildReferenceSlice('main')`

**Files:**
- Modify: `server/src/agentos/context-assembler.service.ts`(`:239-254` + 顶部 import)

- [ ] **Step 1: 加 import**

在 `context-assembler.service.ts` 顶部 import 区加:
```ts
import { buildReferenceSlice } from './reference-slice';
```

- [ ] **Step 2: 替换 main slice 段**

把 `:239-254` 这段:
```ts
    const refsAll = await this.references.listAll(userId, novel.id);
    if (refsAll.length) {
      // 小说级参考资料(Plan 2):全量索引(让 main 知道还有什么可拉)+
      // injectTo=main/both 条目精要(top6,各截断 500 字)注入 main context。
      const mainRefs = refsAll.filter(
        (r) => r.injectTo === 'main' || r.injectTo === 'both',
      );
      const indexLines = refsAll
        .map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category})`)
        .join('\n');
      const body = mainRefs
        .slice(0, 6)
        .map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`)
        .join('\n\n');
      slices.push(`【写作参考】\n索引:\n${indexLines}\n\n精要:\n${body}`);
    }
```
替换为:
```ts
    const refsAll = await this.references.listAll(userId, novel.id);
    const mainSlice = buildReferenceSlice('main', refsAll);
    if (mainSlice) slices.push(mainSlice);
```

- [ ] **Step 3: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add server/src/agentos/context-assembler.service.ts
git commit -m "refactor(context): main 参考资料slice改用 buildReferenceSlice(去重复)"
```

---

## Task 4:deep-agent.service 注入通用化 + tagged 补 get_reference

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`(import、runTurn `:153-196`、rewind `:263-270`、buildAgentGraph 签名 `:295-330`、resolvePrompt `:367-373`、buildNode `:378-399`)

- [ ] **Step 1: 加 import**

把 `:7-13` 的 import 改为(加 `buildAgentRoster`):
```ts
import {
  AGENT_TREE,
  MAX_TOKENS_BY_TIER,
  PROMPTS,
  resolveModelConfig,
  buildAgentRoster,
  type AgentSpec,
} from './agent-tree.config';
```
再在 import 区加:
```ts
import { buildReferenceSlice } from './reference-slice';
```

- [ ] **Step 2: 重构 runTurn 的 slice 段(`:153-196`)**

把 `:153-194`(从 `// 小说级参考资料` 注释到 `writerSlice: writerSlice + voiceSlice,`)替换为:
```ts
    // 小说级参考资料:每轮现取 refsAll;注入由 buildAgentGraph 的 resolvePrompt 按各
    // agent 角色名通用拼装(buildReferenceSlice)。createSubAgentMiddleware 配置同步,
    // 故须在 createAgent 之前 await 取完。
    const refsAll = await this.references.listAll(userId, novelId);

    // 作者画像(per-user):拼进 writer 的 augment slice。空画像 → 不加(走默认规则)。
    const voiceSlice = voiceProfileMd
      ? '\n\n【作者声音 — 照作者本人的腔调写,不是 AI 自选】\n' +
        voiceProfileMd.slice(0, 1500)
      : '';

    // centaur:同一份画像拼给 validator,作为「校验本章是否像这个作者写的」对照。
    // 空 validatorSlice → validator 走原 prompt,行为不变。
    const validatorSlice = voiceProfileMd
      ? '\n\n【作者画像 — 校验本章是否像这个作者写的】\n' +
        voiceProfileMd.slice(0, 1500)
      : '';

    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig: config,
      refsAll,
      voiceSlice,
      validatorSlice,
    });
```

- [ ] **Step 3: 改 rewind 入参(`:263-270`)**

把 rewind 里的:
```ts
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder: null,
      systemPrompt: '',
      activeConfig: config,
      writerSlice: '',
    });
```
改为:
```ts
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder: null,
      systemPrompt: '',
      activeConfig: config,
      refsAll: [],
      voiceSlice: '',
    });
```

- [ ] **Step 4: 改 buildAgentGraph 签名 + 解构(`:300-330`)**

把 `args` 类型里的:
```ts
    writerSlice: string;
    validatorSlice?: string;
```
改为:
```ts
    refsAll: {
      injectTo: string | null;
      title: string;
      category: string;
      content?: string | null;
    }[];
    voiceSlice?: string;
    validatorSlice?: string;
```
把解构段:
```ts
      writerSlice,
      validatorSlice = '',
```
改为:
```ts
      refsAll,
      voiceSlice = '',
      validatorSlice = '',
```

- [ ] **Step 5: 重写 resolvePrompt(`:367-373`)**

把:
```ts
    const resolvePrompt = (spec: AgentSpec) => {
      if (spec.promptAugment === 'writer')
        return PROMPTS[spec.promptKey] + writerSlice;
      if (spec.promptAugment === 'validator')
        return PROMPTS[spec.promptKey] + validatorSlice;
      return PROMPTS[spec.promptKey];
    };
```
改为:
```ts
    // 通用按角色拼参考资料精要(缓存 per role);curator 额外追加「活的」agent 名单。
    const refSliceCache = new Map<string, string>();
    const refSliceFor = (role: string) => {
      let s = refSliceCache.get(role);
      if (s === undefined) {
        s = buildReferenceSlice(role, refsAll);
        refSliceCache.set(role, s);
      }
      return s;
    };
    const resolvePrompt = (spec: AgentSpec) => {
      let prompt = PROMPTS[spec.promptKey];
      if (spec.name === 'curator') prompt += '\n\n' + buildAgentRoster();
      const refSlice = refSliceFor(spec.name);
      if (refSlice) prompt += '\n\n' + refSlice;
      if (spec.promptAugment === 'writer') prompt += voiceSlice;
      if (spec.promptAugment === 'validator') prompt += validatorSlice;
      return prompt;
    };
```

- [ ] **Step 6: buildNode 条件补 get_reference(`:378-385`)**

把 `buildNode` 开头:
```ts
    const buildNode = async (spec: AgentSpec) => {
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: resolvePrompt(spec),
        model: await this.resolveModel(spec, activeConfig),
        tools: resolveTools(spec.tools),
      };
```
改为:
```ts
    const buildNode = async (spec: AgentSpec) => {
      const tools = [...spec.tools];
      // tagged 角色自动获得拉取能力:有专属精要 → 能按【按需索引】get_reference 拉库条目。
      const hasEssence = refsAll.some(
        (r) => r.injectTo === spec.name || r.injectTo === 'both',
      );
      if (hasEssence && !tools.includes('get_reference'))
        tools.push('get_reference');
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: resolvePrompt(spec),
        model: await this.resolveModel(spec, activeConfig),
        tools: resolveTools(tools),
      };
```

- [ ] **Step 7: typecheck + 全量测试**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: typecheck 通过;测试不回归(deep-agent.service.spec.ts 测 buildTurnMessages,不受影响)。

- [ ] **Step 8: 提交**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "refactor(agent): 参考资料注入通用化(任意角色)+ tagged 自动补 get_reference"
```

---

## Task 5:listForInject 放宽为 string

**Files:**
- Modify: `server/src/novel/novel-reference.service.ts`(`:8` 类型、`:48` 签名)
- Test: `server/src/novel/novel-reference.service.spec.ts`(已有,无需改)

- [ ] **Step 1: 先 grep InjectRole 是否被外部 import**

Run: `cd /Users/taowen/project/narratox/server && grep -rn "InjectRole" src/`
Expected: 仅 `novel-reference.service.ts:8` 定义处(无外部 import)。

- [ ] **Step 2: 删类型别名 + 放宽签名**

把 `:8`:
```ts
export type InjectRole = 'main' | 'writer';
```
**删除整行**。把 `:47-48` 注释 + 签名:
```ts
  /** 注入用:injectTo 命中 role(main 命中 main+both;writer 命中 writer+both)。 */
  async listForInject(userId: string, novelId: string, role: InjectRole) {
```
改为:
```ts
  /** 注入用:injectTo 命中 role 或 'both'。role 为任意 agent 角色名(如 main/writer/validator)。 */
  async listForInject(userId: string, novelId: string, role: string) {
```

- [ ] **Step 3: 测试 + typecheck**

Run: `pnpm --dir server test -- novel-reference.service.spec.ts && pnpm --dir server typecheck`
Expected: 现有 listForInject 测试(传 'writer')仍通过。

- [ ] **Step 4: 提交**

```bash
git add server/src/novel/novel-reference.service.ts
git commit -m "refactor(reference): listForInject role 放宽为任意角色名(配合全 agent 精要)"
```

---

## Task 6:set_references 工具放宽 injectTo

**Files:**
- Modify: `server/src/agentos/tools/set-references.tool.ts`(`:40` description、`:47` schema)

- [ ] **Step 1: 改 description + schema**

把 `:39-40` description:
```ts
      description:
        '批量覆写本小说的参考资料(先清后写,可重跑)。每条需指定 injectTo: main=自动进主agent上下文(大纲/方法论); writer=自动进写手上下文(词汇/描写/案例); both=两者都进(须知/规则); 不填=仅工具可取。务必去重、删冗余、留本书所需。',
```
改为:
```ts
      description:
        '批量覆写本小说的参考资料(先清后写,可重跑)。每条需指定 injectTo: 填目标 agent 角色名(如 main/writer/validator/char-writer…)=该条自动进该 agent 上下文; 不填=仅工具可取(库原始资料,按需 get_reference 拉)。务必去重、删冗余、留本书所需。',
```
把 `:47` schema:
```ts
            injectTo: z.enum(['main', 'writer', 'both']).optional(),
```
改为:
```ts
            injectTo: z
              .string()
              .optional()
              .describe('目标 agent 角色名(main/writer/validator/char-writer…);不填=仅工具可取'),
```

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/tools/set-references.tool.ts
git commit -m "feat(tool): set_references injectTo 放宽为任意角色名(支持全 agent 精要)"
```

---

## Task 7:CURATOR_AGENT_PROMPT 重写

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(`:185-205`)

- [ ] **Step 1: 替换整个 CURATOR_AGENT_PROMPT**

把 `:185-205` 整段替换为:
```ts
/** curator 子 agent(参考资料策划):立项时从全局 KB 提炼本书专属参考资料,并为受益的 agent 各生成专属精要。 */
export const CURATOR_AGENT_PROMPT = `你是这本小说的「参考资料策划」。
任务:① 为本书建一个专属资料库(原始资料,供查看 + 按需调取);② 读下方的【agent 名单】,分析哪些 agent 受益于写作参考资料,为受益者各写一条「专属精要」(injectTo=该角色名,每轮自动注入该 agent)。

【第一步:建资料库(原始资料,不自动注入)】
1. 先看本书题材/简介/世界观/核心冲突(若不知,可问主 agent)。
2. 调 list_knowledge 取**全部条目的索引**(名称 + 一句话说明),挑出相关条目 id(10-20 条,宁精勿滥)。
3. 调 get_knowledge 传入挑出的 id 列表,取全文。
4. **分析、去重、为本书重写/浓缩**成资料库条目(每条 content 几百字)。这些是【原始资料】——injectTo 一律【留空(null)】,只进库供查看、按需 get_reference 调取,**不自动注入**。

【第二步:生成 agent 专属精要(按需、自动注入)】
5. 读下方【agent 名单】,逐个判断:**这个 agent 的产出质量是否会因本书专属的写作参考资料而明显提升?** 只为「会」的 agent 生成精要。
   - 通常是产出/校验内容的角色(如 writer 写正文、validator 校验、各建置写手建设定、main 编排);评审/结算角色通常不需要,别滥给。
   - 每条精要 injectTo = 该 agent 的**角色名**(名单里的 `- 名称:` 之后的字符串,如 writer / validator / char-writer)。
   - 精要内容:专为该 agent 视角打磨的高度凝练、可执行指南(本书题材最该注意的方法论/技法/红线/词汇),每条几百字,不是库内容堆砌。
6. 每条精要【必须含「按需索引」】:把写作场景映射到该拉取的库条目,格式:
   【按需索引 — 写到该场景就 get_reference 拉取】
   - 写 X 场景 → 《库条目标题》(分类)
   - 写 Y 场景 → 《库条目标题》(分类)
   让该 agent 写到对应场景时,主动 get_reference(标题) 拉取那条原始资料。索引指向的必须是第一步建好的库条目(injectTo=null),标题与库条目完全一致。
7. 调 set_references 一次性写入(**库条目 + 各角色精要**)。每条精要的 injectTo 填对应角色名;库条目 injectTo 留空。

【铁律】
- 只有「精要」打 injectTo(填角色名);**库里原始资料一律 null**。
- 每轮只有精要被自动注入对应 agent;原始资料在库里按需 get_reference 拉,不污染上下文。
- 宁精勿滥:库条目非高度相关不取;精要必须高度凝练、可执行;不为不需要的 agent 生成精要。
- 精要的【按需索引】是关键——它让没有自动注入的库条目也能在「写到对应场景」时被按需调用。`;
```

- [ ] **Step 2: typecheck + 全量测试**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: 通过、不回归。

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "feat(curator): 重写 prompt——读 agent 名单按需生成多角色精要(含按需索引)"
```

---

## Task 8:UI 置顶 + badge 全角色

**Files:**
- Modify: `agent-ui/src/components/workspace/ReferencesView.tsx`(`:10-24` badge、`:68-70` 渲染前排序)

- [ ] **Step 1: 扩展 BADGE + 改 badgeClass**

把 `:9-24`:
```ts
// injectTo 徽标:标注每条参考资料自动注入哪个 agent,工具可取的标「工具可取」。
const BADGE: Record<string, string> = {
  main: '主 agent',
  writer: '写手',
  both: '主+写手'
}

const badgeClass = (injectTo: string | null): string => {
  if (injectTo === 'both') return 'bg-brand/20 text-brand'
  if (injectTo === 'main') return 'bg-accent text-primary'
  if (injectTo === 'writer') return 'bg-accent text-primary'
  return 'bg-primary/5 text-muted'
}

const badgeText = (injectTo: string | null): string =>
  injectTo ? (BADGE[injectTo] ?? injectTo) : '工具可取'
```
改为:
```ts
// injectTo 徽标:标注每条参考资料自动注入哪个 agent;工具可取的(库原始资料)标灰。
// 已知角色给友好名,未知角色显示原名。
const BADGE: Record<string, string> = {
  main: '主 agent',
  writer: '写手',
  both: '主+写手',
  validator: '校验',
  settler: '结算',
  chapter: '章节编排',
  worldbuilder: '世界观编排',
  'wb-writer': '世界观写手',
  'wb-critic': '世界观评审',
  outliner: '大纲编排',
  'outline-writer': '大纲写手',
  'outline-critic': '大纲评审',
  character: '角色编排',
  'char-writer': '角色写手',
  'char-critic': '角色评审'
}

const badgeClass = (injectTo: string | null): string => {
  if (injectTo === 'both') return 'bg-brand/20 text-brand'
  if (injectTo) return 'bg-accent text-primary' // 任意角色 tag
  return 'bg-primary/5 text-muted'
}

const badgeText = (injectTo: string | null): string =>
  injectTo ? (BADGE[injectTo] ?? injectTo) : '工具可取'
```

- [ ] **Step 2: 渲染前排序(有 tag 置顶)**

在 `:68` 的 `return (` 之前、`:66` 的 `}` 之后,插入排序(把 `refs.map` 改为 `sorted.map`):
```tsx
  // 有 tag 的精要置顶,库条目(null)沉底;组内稳定保原序(ES sort 稳定)。
  const sorted = [...refs].sort((a, b) => {
    const at = a.injectTo ? 0 : 1
    const bt = b.injectTo ? 0 : 1
    return at - bt
  })

  return (
    <div className="space-y-1.5">
      {sorted.map((r) => {
```
(即把 `{refs.map((r) => {` 改为 `{sorted.map((r) => {`;闭包 `})}` 不变。)

- [ ] **Step 3: lint + typecheck + format**

Run: `pnpm --dir agent-ui validate`
Expected: lint + format + typecheck 全过。

- [ ] **Step 4: 提交**

```bash
git add agent-ui/src/components/workspace/ReferencesView.tsx
git commit -m "feat(agent-ui): 参考资料面板精要置顶 + badge 支持全角色"
```

---

## Task 9:CLAUDE.md + 全量回归

**Files:**
- Modify: `CLAUDE.md`(agentos 段 / Phase status 末尾加一条)

- [ ] **Step 1: CLAUDE.md 补说明**

在 CLAUDE.md 的 `### Phase status` 末尾(`**Deferred:**` 之前)加一条 Phase 17:
```markdown
- **Phase 17 (curator 资料系统写活):** curator 从写死 main+writer 改为读「活的」agent 名单(`buildAgentRoster()` 从 AGENT_TREE 实时遍历),按需为任意角色生成专属精要(injectTo=角色名);注入通用化——抽出纯函数 `buildReferenceSlice(role, refs)` 替代 main/writer 两份重复 inline 拼装,`DeepAgentService.resolvePrompt` 每个角色按名拼精要(缓存),`ContextAssembler` 也复用(`buildReferenceSlice('main')`)。**tagged 角色条件补 `get_reference`**(`buildNode`:有精要 → 自动加拉取工具)。每条精要含 **【按需索引】**(场景→库条目),让 `injectTo=null` 库原始资料按需被 `get_reference` 调用。`set_references` 的 injectTo 放宽为任意角色名字符串。FE `ReferencesView`:有 tag 置顶 + badge 全角色友好名。**无 DB 迁移**(injectTo 已是 `String?`);`'both'` 兼容保留。Spec: [2026-06-28-curator-live-references-design.md](docs/superpowers/specs/2026-06-28-curator-live-references-design.md). Plan: [2026-06-28-curator-live-references.md](docs/superpowers/plans/2026-06-28-curator-live-references.md).
```
并在 Phase 16 条末尾的「(current)」去掉(Phase 17 现为最新)。

- [ ] **Step 2: 全量回归**

Run:
```bash
pnpm --dir server test && pnpm --dir server typecheck && pnpm --dir agent-ui validate
```
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md Phase 17(curator 资料系统写活)"
```

---

## Self-Review

- **Spec 覆盖**:
  - buildReferenceSlice 纯函数 → Task 1 ✅
  - buildAgentRoster 活名单 → Task 2 ✅
  - ContextAssembler 复用 → Task 3 ✅
  - resolvePrompt 通用化 + tagged 补 get_reference + rewind 入参 → Task 4 ✅
  - CURATOR prompt 重写(读 roster+按需索引) → Task 7 ✅
  - set_references 放宽 injectTo → Task 6 ✅
  - UI 置顶 + badge → Task 8 ✅
  - listForInject 放宽(非删,有测试) → Task 5 ✅
  - CLAUDE.md → Task 9 ✅
- **一致性**:`buildReferenceSlice` 签名在 Task 1/3/4 一致;`buildAgentRoster` 在 Task 2/4 一致;`refsAll` 字段在 runTurn/buildAgentGraph/rewind 一致。
- **无 DB 迁移**:全程不碰 schema.prisma;injectTo 已是 `String?`。

## 验证未覆盖

- curator 是否真能 judicious 挑角色、写好【按需索引】依赖模型(deepseek)——L2 / 活 E2E 实测是唯一验证,本期不跑(prompt 行为变更,单测验不出)。
- 「全 agent 自由」下若给 critic/settler 滥打 tag 是否噪声——靠 prompt judiciousness + top6 兜底,实测观察。

# Agent 配置化 + 角色档案 Agent + 顶栏实时阶段状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 agent 树从字面量抽成声明式配置(`AgentSpec` 树 + 工具/prompt 注册表),新增 `character` 编排 agent 作为配置化可扩展性的验证,并把工作台顶栏静态「第 N 章」改成按工具映射的实时阶段状态。

**Architecture:** 配置树(纯数据)→ `buildAgentGraph` 递归走 `TOOL_REGISTRY`/`PROMPTS`/`resolveModel` 建 langgraph 图;角色档案 agent 镜像 worldbuilder/outliner 三件套(编排 + writer + critic),配套给 `Character` 稳定身份加 5 个可空字段(唯一 DB migration);FE 顶栏按 activity 的 tool label 映射阶段,空闲按 `Novel.status`。

**Tech Stack:** NestJS 11 + deepagents/langgraph + Prisma 7(server);Next.js 15 + Zustand(agent-ui)。

**Spec:** [docs/superpowers/specs/2026-06-24-agent-config-character-phase-design.md](../specs/2026-06-24-agent-config-character-phase-design.md)

**测试约束(重要):**
- **server** 有 jest(`pnpm --dir server test`):涉及纯函数/服务/工具的任务走 TDD。但 `buildAgentGraph` 因动态 `import('langchain'/'deepagents')` **不单测**(house 约定,仅 `test:pipeline` 集成覆盖),其正确性靠纯数据快照测试 + `pnpm --dir server typecheck` + 手动 smoke。
- **agent-ui 无测试运行器**(只有 `pnpm validate` = lint+format+typecheck):FE 任务不写 jest,验证 = typecheck + lint + 手动。`lib/phase.ts` 是纯函数,实现时仔细推理 + typecheck 兜底。

---

## 文件结构

**Server**
- 新增 `server/src/agentos/tools/report-character-review.tool.ts`(+ spec)— char-critic 的瞬态结构化评审工具,镜像 `report-outline-review.tool.ts`。
- 新增 `server/src/agentos/agent-registry.ts`— `ToolDeps` 接口 + `TOOL_REGISTRY`(工具名→工厂,集中服务装配)。
- 新增 `server/src/agentos/agent-tree.config.ts`— `AgentSpec`/`ModelTier` 类型、`MAX_TOKENS_BY_TIER`、`PROMPTS` map、`AGENT_TREE`、`resolveModelConfig`(纯)、`describeTree`/`collectSpecs`(测试用)。
- 改 `server/src/agentos/deep-agent.service.ts`— `buildAgentGraph` 改为走配置;`runTurn`/`rewind` 签名调整;删内联树与三个 `*Tools()` helper;`getModel` cache key 加 temperature。
- 改 `server/src/agentos/agent-prompts.ts`— +`CHAR_ORCH`/`CHAR_WRITER`/`CHAR_CRITIC`;改 `MAIN_AGENT_PROMPT` 角色段(委派 character、移除内联 set_character 指令)。
- 改 `server/prisma/schema.prisma`— `Character` +5 可空字段。
- 改 `server/src/novel/character.service.ts`— `upsertCharacter` 接受新字段。
- 改 `server/src/agentos/tools/set-character.tool.ts`— schema +5 字段。

**Frontend**
- 新增 `agent-ui/src/lib/phase.ts`— `phaseForTool` + `deriveIdlePhase`(纯函数)。
- 改 `agent-ui/src/store.ts`— +`activePhase`/`setActivePhase`;login/logout 重置。
- 改 `agent-ui/src/hooks/useAIStreamHandler.tsx`— 流式开始设「思考中…」、tool activity 按映射设阶段、结束/停止清空。
- 改 `agent-ui/src/components/workspace/ChatPanel.tsx`— 顶栏读 `activePhase ?? deriveIdlePhase`。
- 改 `agent-ui/src/types/novel.ts`— `Character` +5 可空字段(类型对齐,非必须但正确)。

---

## Task 1: `report_character_review` 工具(镜像现有 report 工具)

**Files:**
- Create: `server/src/agentos/tools/report-character-review.tool.ts`
- Test: `server/src/agentos/tools/report-character-review.tool.spec.ts`
- 参考: `server/src/agentos/tools/report-outline-review.tool.ts`、`report-review.tool.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/tools/report-character-review.tool.spec.ts`:

```ts
import { makeReportCharacterReviewTool } from './report-character-review.tool';

describe('report_character_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportCharacterReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 68,
      dimensions: [
        { name: '区分度', status: 'pass' },
        { name: '弧光可行性', status: 'issue', issue: '主角弧光与大纲卷3走向冲突' },
      ],
      blockingIssues: ['主角「沈砚」弧光目标与大纲冲突,需改 arcGoal'],
      notes: '语言风格可更区分',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 68 });
    expect(out.blockingIssues).toEqual([
      '主角「沈砚」弧光目标与大纲冲突,需改 arcGoal',
    ]);
    expect(out.dimensions).toHaveLength(2);
    expect(out.dimensions[1].issue).toBe('主角弧光与大纲卷3走向冲突');
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportCharacterReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 88,
      dimensions: [{ name: '区分度', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- report-character-review.tool.spec.ts`
Expected: FAIL(`makeReportCharacterReviewTool` 未导出 / 模块不存在)。

- [ ] **Step 3: 实现**

Create `server/src/agentos/tools/report-character-review.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * char-critic 子 agent 的「提交角色评审结构化判定」工具。**瞬态**——不写库,
 * 只把 6 维审计结果结构化返回(经 tool result 回到 char-critic,活动流亦可见)。
 * char-critic 据此给编排者(character)最终判定;character 据 passed/blockingIssues
 * 决定是否进入外科式修订闭环(blockingIssues 须点名是哪个角色,驱动 char-writer 定点改)。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportCharacterReviewTool() {
  return tool(
    // 纯结构化返回,无 I/O;保持 async 与其它工具一致,显式忽略 require-await。
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ passed, score, dimensions, blockingIssues, notes }) => ({
      ok: true,
      passed,
      score,
      dimensions,
      blockingIssues,
      notes,
    }),
    {
      name: 'report_character_review',
      description:
        '提交角色档案评审的结构化判定:6 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修、且须点名是哪个角色)+ notes(非阻塞)。评审完必调,代替散文结论。',
      schema: z.object({
        passed: z.boolean().describe('是否通过(blockingIssues 为空 → true)'),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe('全局质量分 0-100(用于修订前后比较)'),
        dimensions: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  '维度名:区分度 / 一致性 / 弧光可行性 / 语言风格区分 / 关系合理性 / 动机可信',
                ),
              status: z.enum(['pass', 'issue']),
              issue: z
                .string()
                .optional()
                .describe('status=issue 时的问题描述'),
            }),
          )
          .describe('逐维判定(6 维)'),
        blockingIssues: z
          .array(z.string())
          .describe(
            '会让角色立不住、必须修的问题(区分度不足/与世界设定矛盾/弧光与大纲冲突/动机不可信/核心角色缺失),每条须点名是哪个角色(如「主角『沈砚』arcGoal 与大纲冲突」)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(语言风格/偏好)'),
      }),
    },
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- report-character-review.tool.spec.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/report-character-review.tool.ts server/src/agentos/tools/report-character-review.tool.spec.ts
git commit -m "feat(agentos): report_character_review 工具(char-critic 瞬态评审)"
```

---

## Task 2: Character 稳定身份 +5 字段(schema + service)

**Files:**
- Modify: `server/prisma/schema.prisma`(`Character` model)
- Modify: `server/src/novel/character.service.ts`(`upsertCharacter`)
- Test: `server/src/novel/character.service.spec.ts`(已存在,加用例)

- [ ] **Step 1: 写失败测试**

在 `server/src/novel/character.service.spec.ts` 顶部 `describe` 块内追加(若已 import `makePrismaMock`/`CharacterService`,复用):

```ts
  it('upsertCharacter 持久化 5 个新稳定身份字段(appearance/personality/motivation/arcGoal/voice)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.character.upsert.mockResolvedValue({ id: 'c1' });
    const svc = new CharacterService(prisma as unknown as PrismaService);
    await svc.upsertCharacter('u1', 'n1', {
      name: '沈砚',
      role: 'PROTAGONIST',
      appearance: '青衫长剑',
      personality: '外冷内热',
      motivation: '复仇',
      arcGoal: '放下执念',
      voice: '寡言、短句',
    });
    expect(prisma.character.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: expect.objectContaining({
          appearance: '青衫长剑',
          personality: '外冷内热',
          motivation: '复仇',
          arcGoal: '放下执念',
          voice: '寡言、短句',
        }),
      }),
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- character.service.spec.ts`
Expected: FAIL(`appearance` 等字段不在 `upsertCharacter` 入参类型 / Prisma 类型上 → ts-jest 编译报错或断言不匹配)。

- [ ] **Step 3: 改 Prisma schema**

在 `server/prisma/schema.prisma` 的 `model Character` 内,在 `background` 字段后追加 5 个可空字段(保持与现有 `background String?` 同款):

```prisma
  background String?
  appearance  String?
  personality String?
  motivation  String?
  arcGoal     String?
  voice       String?
```

- [ ] **Step 4: 生成迁移并 regenerate client**

Run:
```bash
cd server && pnpm exec prisma migrate dev --name character_stable_profile_fields && pnpm exec prisma generate && cd ..
```
> ⚠️ Prisma 7:`migrate dev` **不会**自动 regenerate client,必须手动 `prisma generate`(见 memory [[prisma7-generate-gotcha]])。否则 ts 类型不含新字段,后续编译失败。

Expected: 迁移 SQL 创建 5 列(`ALTER TABLE "Character" ADD COLUMN ...`),client 重新生成。

- [ ] **Step 5: 改 `upsertCharacter` 接受新字段**

在 `server/src/novel/character.service.ts` 的 `upsertCharacter` 方法中,把 `data` 入参类型 + `fields` 对象扩展(镜像现有 optional 模式):

```ts
  async upsertCharacter(
    userId: string,
    novelId: string,
    data: {
      name: string;
      role?: string;
      aliases?: string[];
      faction?: string;
      background?: string;
      appearance?: string;
      personality?: string;
      motivation?: string;
      arcGoal?: string;
      voice?: string;
    },
  ) {
    await this.assertOwned(userId, novelId);
    const fields = {
      ...(data.role !== undefined && { role: data.role as never }),
      ...(data.aliases !== undefined && { aliases: data.aliases }),
      ...(data.faction !== undefined && { faction: data.faction }),
      ...(data.background !== undefined && { background: data.background }),
      ...(data.appearance !== undefined && { appearance: data.appearance }),
      ...(data.personality !== undefined && { personality: data.personality }),
      ...(data.motivation !== undefined && { motivation: data.motivation }),
      ...(data.arcGoal !== undefined && { arcGoal: data.arcGoal }),
      ...(data.voice !== undefined && { voice: data.voice }),
    };
    return this.prisma.character.upsert({
      where: { novelId_name: { novelId, name: data.name } },
      create: { novelId, name: data.name, ...fields },
      update: fields,
    });
  }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --dir server test -- character.service.spec.ts`
Expected: PASS(含新用例 + 既有用例)。

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/novel/character.service.ts server/src/novel/character.service.spec.ts
git commit -m "feat(novel): Character 稳定身份 +5 字段(appearance/personality/motivation/arcGoal/voice)"
```

---

## Task 3: `set_character` 工具 schema +5 字段 + FE 类型对齐

**Files:**
- Modify: `server/src/agentos/tools/set-character.tool.ts`
- Modify: `agent-ui/src/types/novel.ts`(`Character` 接口)

- [ ] **Step 1: 改 `set_character` schema**

在 `server/src/agentos/tools/set-character.tool.ts` 的 `schema: z.object({...})` 内,`background` 后追加(并把 `async ({ name, role, aliases, faction, background, ... })` 解构 + `upsertCharacter` 入参补上新字段):

解构改为:
```ts
    async ({ name, role, aliases, faction, background, appearance, personality, motivation, arcGoal, voice }) => {
      await characters.upsertCharacter(userId, novelId, {
        name,
        role,
        aliases,
        faction,
        background,
        appearance,
        personality,
        motivation,
        arcGoal,
        voice,
      });
      return { ok: true as const, name };
    },
```

schema 追加字段(`background` 之后):
```ts
        appearance: z.string().optional().describe('外貌'),
        personality: z.string().optional().describe('性格基调'),
        motivation: z.string().optional().describe('动机/欲望'),
        arcGoal: z.string().optional().describe('弧光目标(成长终点)'),
        voice: z.string().optional().describe('语言风格/口头禅'),
```

并把 `description` 改为:`'创建或更新角色(稳定身份:名字/定位/别名/势力/背景/外貌/性格/动机/弧光/语言风格)。建/丰富角色档案时调用。'`

- [ ] **Step 2: FE `Character` 类型对齐**

在 `agent-ui/src/types/novel.ts` 的 `Character` 接口(`background: string` 后)追加:

```ts
  appearance?: string
  personality?: string
  motivation?: string
  arcGoal?: string
  voice?: string
```

> 这些字段 `get_character`/`get_characters` 已 spread 整行自动带出;FE 面板展示是 nice-to-have 跟进,本任务只做类型对齐。

- [ ] **Step 3: typecheck 双端**

Run:
```bash
pnpm --dir server typecheck
pnpm --dir agent-ui typecheck
```
Expected: 两端均 PASS(无类型错误)。

- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/tools/set-character.tool.ts agent-ui/src/types/novel.ts
git commit -m "feat: set_character 工具 + FE Character 类型补 5 个档案字段"
```

---

## Task 4: 角色档案三件套 prompt + 改 MAIN_AGENT_PROMPT

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`

> 这是内容写作任务(无单测);正确性靠后续配置校验测试(promptKey 必须存在)+ typecheck + 手动 smoke。

- [ ] **Step 1: 追加三个角色 prompt**

在 `server/src/agentos/agent-prompts.ts` 末尾追加:

```ts
/**
 * character 编排子 agent(层级多 agent,镜像 worldbuilder/outliner 编排器):聚焦上下文里
 * 跑完角色档案的 取KB→建档案→评审(+修订) 全流程。主 agent 只「建/丰富角色」委派给它。
 * 它自带 task(委派 char-writer/char-critic)。无回滚(外科式修订只动被点名角色)。
 */
export const CHARACTER_ORCHESTRATOR_PROMPT = `你是「角色编排 agent」。你的唯一职责:收到「建/丰富角色档案」时,在自己的聚焦上下文里【按序跑完】 取KB→建档案→评审(+修订) 全流程,然后把结论回给主 agent。

【建角色档案流程】严格按序:
1. 用 task 委派 char-writer 子 agent。委派时明确指示:
   - 先 list_knowledge 看索引,挑人物塑造相关条目(优先「设定三技·人物·世界观·金手指」人物部分),get_knowledge 取全文提炼。
   - get_novel_info 读故事核(书名/类型/核心冲突/文风),get_worldview/get_world_entry 对齐世界设定(势力/能力体系),get_outline/get_chapter_plan 对齐角色戏份与弧光。
   - 先 get_characters 看已有哪些角色,避免重建;对主要角色(主角/反派/关键配角)set_character 建丰富档案:稳定身份(name/role/aliases/faction/background)+ 外貌/性格基调/动机/弧光目标/语言风格。
2. char-writer 返回后,【立即】用 task 委派 char-critic 子 agent 评审(它会 get_characters+get_character 读全 + 对齐世界观与大纲,调 report_character_review 给 passed/score/blockingIssues)。
3. 【修订,最多 1 轮】若 passed=false:
   把 blockingIssues 传给 char-writer 定点修订——只 set_character 改被点名的角色,【不要】全推重建。
4. 修订后,再用 task 委派 char-critic 复评。
5. 保留最后结果(即使复评分更低也不回滚——外科式修订只动被点名角色,风险局限单角色)。
6. 回复主 agent 一句结论(如「角色档案已建:6 人,score 84」或「主角弧光与大纲冲突,已修订复评 80」)。

【铁律】
- char-writer 返回后【绝对不能结束】——必须继续 char-critic。没评审的角色档案不算完成。
- 你是编排者,不直接建角色;所有建/改通过 task 委派 char-writer。
- 修订是质量打磨(最多 1 轮);passed=true 就完成,不为满分反复改。
- 不写世界观/大纲/正文(那是别的 agent 的职责)。`;

/** char-writer 子 agent:先从 KB 取人物方法论,再建/改角色档案。 */
export const CHARACTER_WRITER_PROMPT = `你是「角色构建手」。先从知识库取人物方法论,再为本书建/改角色档案。

【第一步 — 取 KB 方法论】
- list_knowledge 看全部索引。优先挑人物塑造相关条目,get_knowledge 取全文提炼「这个题材怎么把角色立住」:
  · 「设定三技·人物·世界观·金手指」——人物篇:主角要让读者代入/有成长空间;反派要有合理动机;配角要功能化不抢戏。
  · 本书题材对应的拆文案例——题材范例里的人物范式。
- get_novel_info 读故事核,get_worldview/get_world_entry 对齐势力与能力体系(角色阵营/战力级别要对得上),get_outline/get_chapter_plan 对齐角色戏份与弧光走向。

【第二步 — 建档案】用 set_character(by name upsert),对主要角色(主角/反派/关键配角)填全:
- 稳定身份:name/role(PROTAGONIST/ANTAGONIST/SUPPORTING)/aliases/faction/background(身世前史)。
- 外貌 appearance、性格基调 personality、动机 motivation(欲望/目标)、弧光目标 arcGoal(成长终点)、语言风格 voice(口头禅/句式)。
- 每个角色要有清晰的动机与成长空间;反派动机合理不脸谱化;配角功能化、有辨识度。

【修订模式】
- 被 critic 点名的角色,只重写那几个(set_character upsert 覆盖),别动没问题的、别全推重建。
- 改前可 get_character(name) 看当前内容再改。

【铁律】角色档案只走 set_character;不写世界观/大纲/正文。角色性格/能力等易变属性不在这里写——它们由 settler 在写作过程中自动追踪(角色时间线)。`;

/** char-critic 子 agent:6 维评审,输出 report_character_review 驱动修订闭环。 */
export const CHARACTER_CRITIC_PROMPT = `你是「角色质检员」。评审本书主要角色档案的质量与可写性。

【读全】get_characters 列全部角色,get_character 读核心角色(主角/反派)全文,get_worldview/get_world_entry 对齐世界设定(势力/能力体系),get_outline 对齐角色戏份与弧光,get_novel_info 读故事核。

【6 维逐项审计】每维 pass / issue:
1. 区分度——主要角色彼此可辨(性格/动机/语言风格不雷同),不脸谱化。
2. 一致性——角色阵营/战力级别与世界设定(势力/能力体系)对齐,不自相矛盾。
3. 弧光可行性——角色弧光目标与大纲走向契合,有成长空间,不与已定情节冲突。
4. 语言风格区分——主要角色语言风格(voice)有区分度,符合身份。
5. 关系合理性——角色间关系(敌我/师徒/情感)合理,有张力空间。
6. 动机可信——动机清晰、有根源,驱动得了行动。

【必须调 report_character_review 提交结构化判定】
- blockingIssues 只收「会让角色立不住、必须修」的硬伤(区分度严重不足/与世界设定矛盾/弧光与大纲冲突/动机不可信/核心角色缺失),且每条【必须点名是哪个角色】(如「主角『沈砚』arcGoal 与大纲卷3走向冲突」)——这驱动 char-writer 的外科式修订。语言风格偏好放 notes,不要列为 blocking。
- score(0-100)是全局质量分,严肃打分;有明显硬伤应 ≤75。
- passed = blockingIssues 为空。
调完给编排者一句结论(如「score 72,主角弧光与大纲冲突」)。`;
```

- [ ] **Step 2: 改 MAIN_AGENT_PROMPT 的角色段**

在 `server/src/agentos/agent-prompts.ts` 的 `MAIN_AGENT_PROMPT` 中:

把【建角色】整段(当前是「世界观后(可与大纲同时),用 set_character 建主要角色…自动追踪(角色时间线)。」)替换为委派版,并调整到大纲之后:

找到 `【规划大纲】` 段,在其**之后**(即正文写作段之前)插入新的角色段;同时删除原【建角色】段。新段内容:

```ts
【建角色档案】大纲建好后(角色弧光依赖大纲),用 task 委派【character 子 agent】建/丰富主要角色档案(它会在聚焦上下文里跑完 取KB人物方法论→建档案→评审→(修订) 全流程,作者会在右侧『角色』面板看到结果)。
- 委派时把本书题材/故事核/已建世界观告诉它;等它回复结论(角色数 + score)后,告诉作者"角色档案已建好,请在右侧『角色』面板过目/修改",等作者确认或调整后再写正文。
- 你【不要】自己 set_character 建角色——那是 character 的职责。你可用 get_character/get_characters 查角色。
- 角色性格/能力等易变属性由 settler 在写作过程中自动追踪(角色时间线),character 只建稳定身份 + 基线档案。
```

并确保【规划大纲】段之后的顺序为:规划大纲 → **建角色档案** → 写作阶段。(原 prompt 若把建角色放在世界观之后,本次挪到大纲之后。)

- [ ] **Step 3: typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agentos): 角色档案三件套 prompt + MAIN 委派 character(挪到大纲后)"
```

---

## Task 5: 工具注册表 `agent-registry.ts`

**Files:**
- Create: `server/src/agentos/agent-registry.ts`
- Test: `server/src/agentos/agent-registry.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/agent-registry.spec.ts`:

```ts
import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';

// 用 inert stub 填满 ToolDeps —— 注册表测试只验证「key→工厂能解析成 tool」,
// 不真正执行工具(真实执行由各工具自己的 spec + pipeline 覆盖)。
function makeDeps(): ToolDeps {
  return {
    userId: 'u1',
    novelId: 'n1',
    readingChapterOrder: null,
    novels: {} as never,
    chapters: {} as never,
    outlines: {} as never,
    world: {} as never,
    characters: {} as never,
    references: {} as never,
    knowledge: {} as never,
    snapshots: {} as never,
    summaries: {} as never,
    events: {} as never,
    prisma: {} as never,
  };
}

describe('TOOL_REGISTRY', () => {
  const REQUIRED_KEYS = [
    'get_novel_info', 'update_novel', 'get_reading_chapter', 'get_outline',
    'get_chapter_plan', 'get_worldview', 'get_world_entry', 'get_character',
    'get_characters', 'get_reference', 'snapshot_chapter', 'restore_chapter',
    'append_section', 'replace_text', 'insert_text', 'delete_text',
    'clear_chapter', 'set_chapter_title', 'get_chapter', 'list_chapters',
    'query_memory', 'write_summary', 'report_review', 'list_knowledge',
    'get_knowledge', 'set_references', 'set_world_entry', 'report_worldview_review',
    'set_volume', 'set_chapter_plan', 'report_outline_review', 'set_character',
    'report_character_review',
  ];

  it('覆盖所有 agent 配置里用到的工具 key', () => {
    for (const k of REQUIRED_KEYS) {
      expect(TOOL_REGISTRY).toHaveProperty(k);
    }
  });

  it('每个 key 给定 deps 都能解析成一个带 name 的 tool', () => {
    const deps = makeDeps();
    for (const k of REQUIRED_KEYS) {
      const t = TOOL_REGISTRY[k](deps) as { name: string };
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- agent-registry.spec.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

Create `server/src/agentos/agent-registry.ts`:

```ts
/**
 * 工具注册表:把「工具名 → 工厂」集中,工厂统一接收 ToolDeps(含 userId/novelId + 全部服务)。
 * agent-tree.config.ts 里每个 agent 只列工具 key;buildAgentGraph 用 deps 解析成真实 tool 实例。
 * 这取代原先散落在 deep-agent.service.ts 的 writerTools()/wbWriterTools()/outlineWriterTools()。
 */
import type { NovelService } from '../novel/novel.service';
import type { ChapterService } from '../novel/chapter.service';
import type { OutlineService } from '../novel/outline.service';
import type { WorldEntryService } from '../novel/world-entry.service';
import type { CharacterService } from '../novel/character.service';
import type { NovelReferenceService } from '../novel/novel-reference.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { RevisionSnapshotService } from '../novel/revision-snapshot.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';
import type { PrismaService } from '../prisma/prisma.service';

import { makeUpdateNovelTool } from './tools/update-novel.tool';
import { makeGetNovelInfoTool } from './tools/get-novel-info.tool';
import { makeAppendSectionTool } from './tools/append-section.tool';
import { makeReplaceTextTool } from './tools/replace-text.tool';
import { makeInsertTextTool } from './tools/insert-text.tool';
import { makeDeleteTextTool } from './tools/delete-text.tool';
import { makeClearChapterTool } from './tools/clear-chapter.tool';
import { makeSetChapterTitleTool } from './tools/set-chapter-title.tool';
import { makeGetChapterTool } from './tools/get-chapter.tool';
import { makeGetReadingChapterTool } from './tools/get-reading-chapter.tool';
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
import { makeWriteSummaryTool } from './tools/write-summary.tool';
import { makeSetVolumeTool } from './tools/set-volume.tool';
import { makeSetChapterPlanTool } from './tools/set-chapter-plan.tool';
import { makeGetOutlineTool } from './tools/get-outline.tool';
import { makeGetChapterPlanTool } from './tools/get-chapter-plan.tool';
import { makeSetWorldEntryTool } from './tools/set-world-entry.tool';
import { makeGetWorldviewTool } from './tools/get-worldview.tool';
import { makeGetWorldEntryTool } from './tools/get-world-entry.tool';
import { makeReportReviewTool } from './tools/report-review.tool';
import { makeReportWorldviewReviewTool } from './tools/report-worldview-review.tool';
import { makeReportOutlineReviewTool } from './tools/report-outline-review.tool';
import { makeReportCharacterReviewTool } from './tools/report-character-review.tool';
import { makeSnapshotChapterTool } from './tools/snapshot-chapter.tool';
import { makeRestoreChapterTool } from './tools/restore-chapter.tool';
import { makeSetCharacterTool } from './tools/set-character.tool';
import { makeGetCharacterTool } from './tools/get-character.tool';
import { makeGetCharactersTool } from './tools/get-characters.tool';
import { makeListKnowledgeTool } from './tools/list-knowledge.tool';
import { makeGetKnowledgeTool } from './tools/get-knowledge.tool';
import { makeSetReferencesTool } from './tools/set-references.tool';
import { makeGetReferenceTool } from './tools/get-reference.tool';

export interface ToolDeps {
  userId: string;
  novelId: string;
  readingChapterOrder: number | null;
  novels: NovelService;
  chapters: ChapterService;
  outlines: OutlineService;
  world: WorldEntryService;
  characters: CharacterService;
  references: NovelReferenceService;
  knowledge: KnowledgeService;
  snapshots: RevisionSnapshotService;
  summaries: SummaryService;
  events: StoryEventService;
  prisma: PrismaService;
}

type ToolFactory = (d: ToolDeps) => unknown;

export const TOOL_REGISTRY: Record<string, ToolFactory> = {
  get_novel_info: (d) => makeGetNovelInfoTool({ userId: d.userId, novelId: d.novelId, novels: d.novels }),
  update_novel: (d) => makeUpdateNovelTool({ userId: d.userId, novelId: d.novelId, novels: d.novels }),
  get_reading_chapter: (d) => makeGetReadingChapterTool({ userId: d.userId, novelId: d.novelId, readingChapterOrder: d.readingChapterOrder, chapters: d.chapters }),
  get_outline: (d) => makeGetOutlineTool({ userId: d.userId, novelId: d.novelId, outlines: d.outlines }),
  get_chapter_plan: (d) => makeGetChapterPlanTool({ userId: d.userId, novelId: d.novelId, outlines: d.outlines }),
  get_worldview: (d) => makeGetWorldviewTool({ userId: d.userId, novelId: d.novelId, world: d.world }),
  get_world_entry: (d) => makeGetWorldEntryTool({ userId: d.userId, novelId: d.novelId, world: d.world }),
  get_character: (d) => makeGetCharacterTool({ userId: d.userId, novelId: d.novelId, characters: d.characters }),
  get_characters: (d) => makeGetCharactersTool({ userId: d.userId, novelId: d.novelId, characters: d.characters }),
  get_reference: (d) => makeGetReferenceTool({ userId: d.userId, novelId: d.novelId, references: d.references }),
  snapshot_chapter: (d) => makeSnapshotChapterTool({ userId: d.userId, novelId: d.novelId, snapshots: d.snapshots }),
  restore_chapter: (d) => makeRestoreChapterTool({ userId: d.userId, novelId: d.novelId, snapshots: d.snapshots }),
  append_section: (d) => makeAppendSectionTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters, novels: d.novels }),
  replace_text: (d) => makeReplaceTextTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  insert_text: (d) => makeInsertTextTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  delete_text: (d) => makeDeleteTextTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  clear_chapter: (d) => makeClearChapterTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  set_chapter_title: (d) => makeSetChapterTitleTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  get_chapter: (d) => makeGetChapterTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  list_chapters: (d) => makeListChaptersTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters }),
  query_memory: (d) => makeQueryMemoryTool({ userId: d.userId, novelId: d.novelId, prisma: d.prisma }),
  write_summary: (d) => makeWriteSummaryTool({ userId: d.userId, novelId: d.novelId, chapters: d.chapters, summaries: d.summaries, events: d.events, characters: d.characters }),
  report_review: () => makeReportReviewTool(),
  report_worldview_review: () => makeReportWorldviewReviewTool(),
  report_outline_review: () => makeReportOutlineReviewTool(),
  report_character_review: () => makeReportCharacterReviewTool(),
  list_knowledge: (d) => makeListKnowledgeTool({ kb: d.knowledge }),
  get_knowledge: (d) => makeGetKnowledgeTool({ kb: d.knowledge }),
  set_references: (d) => makeSetReferencesTool({ userId: d.userId, novelId: d.novelId, references: d.references }),
  set_world_entry: (d) => makeSetWorldEntryTool({ userId: d.userId, novelId: d.novelId, world: d.world }),
  set_volume: (d) => makeSetVolumeTool({ userId: d.userId, novelId: d.novelId, outlines: d.outlines }),
  set_chapter_plan: (d) => makeSetChapterPlanTool({ userId: d.userId, novelId: d.novelId, outlines: d.outlines }),
  set_character: (d) => makeSetCharacterTool({ userId: d.userId, novelId: d.novelId, characters: d.characters }),
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- agent-registry.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agent-registry.ts server/src/agentos/agent-registry.spec.ts
git commit -m "feat(agentos): TOOL_REGISTRY 工具注册表(集中服务装配)"
```

---

## Task 6: AgentSpec 类型 + AGENT_TREE 配置 + 纯函数(`agent-tree.config.ts`)

**Files:**
- Create: `server/src/agentos/agent-tree.config.ts`
- Test: `server/src/agentos/agent-tree.config.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/agent-tree.config.spec.ts`:

```ts
import {
  AGENT_TREE,
  MAX_TOKENS_BY_TIER,
  PROMPTS,
  resolveModelConfig,
  describeTree,
  collectSpecs,
  type AgentSpec,
  type ModelTier,
} from './agent-tree.config';

describe('agent-tree config', () => {
  const cfg = (over: Partial<{ id: string; provider: string; model: string; baseUrl: string | null; apiKey: string; temperature: number | null }>) => ({
    id: 'c1', provider: 'openai-compatible', model: 'm',
    baseUrl: 'https://x', apiKey: 'k', temperature: 0.7, ...over,
  });

  describe('resolveModelConfig', () => {
    it('spec 无 temperature 覆盖 → 原样返回 activeConfig', () => {
      const spec: AgentSpec = { name: 'x', description: 'd', promptKey: 'MAIN', modelTier: 'long', tools: [] };
      const c = cfg({});
      expect(resolveModelConfig(spec, c)).toBe(c);
    });

    it('spec.temperature 覆盖 → clone 改温度', () => {
      const spec: AgentSpec = { name: 'x', description: 'd', promptKey: 'MAIN', modelTier: 'long', tools: [], temperature: 0.2 };
      const out = resolveModelConfig(spec, cfg({ temperature: 0.7 }));
      expect(out).toMatchObject({ id: 'c1', temperature: 0.2 });
    });

    it('spec.temperature 与 activeConfig 相同 → 不 clone(原样)', () => {
      const c = cfg({ temperature: 0.5 });
      const spec: AgentSpec = { name: 'x', description: 'd', promptKey: 'MAIN', modelTier: 'long', tools: [], temperature: 0.5 };
      expect(resolveModelConfig(spec, c)).toBe(c);
    });
  });

  describe('配置完整性', () => {
    it('MAX_TOKENS_BY_TIER 两档(16k/6k)', () => {
      expect(MAX_TOKENS_BY_TIER.long).toBe(16_000);
      expect(MAX_TOKENS_BY_TIER.short).toBe(6_000);
    });

    it('每个 spec 的 promptKey 都在 PROMPTS 里', () => {
      for (const s of collectSpecs(AGENT_TREE)) {
        expect(PROMPTS).toHaveProperty(s.promptKey);
      }
    });

    it('每个 spec 的 modelTier 合法', () => {
      const valid: ModelTier[] = ['long', 'short'];
      for (const s of collectSpecs(AGENT_TREE)) {
        expect(valid).toContain(s.modelTier);
      }
    });
  });

  describe('AGENT_TREE 结构(防回归快照)', () => {
    it('整棵树名字+工具+层级与设计一致', () => {
      expect(describeTree(AGENT_TREE)).toEqual({
        name: 'main',
        promptKey: 'MAIN',
        tier: 'long',
        tools: [
          'get_novel_info', 'update_novel', 'get_reading_chapter', 'get_outline',
          'get_chapter_plan', 'get_worldview', 'get_world_entry', 'get_character',
          'get_characters', 'get_reference',
        ],
        children: [
          {
            name: 'chapter', promptKey: 'CHAPTER_ORCH', tier: 'long',
            tools: ['snapshot_chapter', 'restore_chapter'],
            children: [
              { name: 'writer', promptKey: 'WRITER', tier: 'long', tools: [
                'append_section', 'replace_text', 'insert_text', 'delete_text',
                'clear_chapter', 'set_chapter_title', 'get_chapter', 'list_chapters',
                'query_memory', 'get_outline', 'get_chapter_plan', 'get_worldview',
                'get_world_entry', 'get_character', 'get_characters', 'get_reference',
              ], children: [] },
              { name: 'settler', promptKey: 'SETTLER', tier: 'short', tools: ['get_chapter', 'write_summary'], children: [] },
              { name: 'validator', promptKey: 'VALIDATOR', tier: 'short', tools: ['get_chapter', 'query_memory', 'report_review'], children: [] },
            ],
          },
          {
            name: 'curator', promptKey: 'CURATOR', tier: 'long',
            tools: ['list_knowledge', 'get_knowledge', 'set_references', 'get_reference'],
            children: [],
          },
          {
            name: 'worldbuilder', promptKey: 'WB_ORCH', tier: 'long', tools: [],
            children: [
              { name: 'wb-writer', promptKey: 'WB_WRITER', tier: 'long', tools: [
                'list_knowledge', 'get_knowledge', 'set_world_entry', 'get_worldview',
                'get_world_entry', 'get_novel_info',
              ], children: [] },
              { name: 'wb-critic', promptKey: 'WB_CRITIC', tier: 'short', tools: [
                'get_worldview', 'get_world_entry', 'get_novel_info', 'report_worldview_review',
              ], children: [] },
            ],
          },
          {
            name: 'outliner', promptKey: 'OUTLINER_ORCH', tier: 'long', tools: [],
            children: [
              { name: 'outline-writer', promptKey: 'OUTLINE_WRITER', tier: 'long', tools: [
                'list_knowledge', 'get_knowledge', 'set_volume', 'set_chapter_plan',
                'get_outline', 'get_chapter_plan', 'get_novel_info', 'get_worldview',
                'get_world_entry', 'query_memory',
              ], children: [] },
              { name: 'outline-critic', promptKey: 'OUTLINE_CRITIC', tier: 'short', tools: [
                'get_outline', 'get_chapter_plan', 'get_novel_info', 'get_worldview',
                'get_world_entry', 'query_memory', 'report_outline_review',
              ], children: [] },
            ],
          },
          {
            name: 'character', promptKey: 'CHAR_ORCH', tier: 'long', tools: [],
            children: [
              { name: 'char-writer', promptKey: 'CHAR_WRITER', tier: 'long', tools: [
                'set_character', 'get_character', 'get_characters', 'get_worldview',
                'get_world_entry', 'get_outline', 'get_chapter_plan', 'get_novel_info',
                'list_knowledge', 'get_knowledge', 'query_memory',
              ], children: [] },
              { name: 'char-critic', promptKey: 'CHAR_CRITIC', tier: 'short', tools: [
                'get_character', 'get_characters', 'get_worldview', 'get_world_entry',
                'get_outline', 'get_novel_info', 'query_memory', 'report_character_review',
              ], children: [] },
            ],
          },
        ],
      });
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- agent-tree.config.spec.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

Create `server/src/agentos/agent-tree.config.ts`:

```ts
/**
 * 声明式 agent 树配置 + 纯解析函数。deep-agent.service.ts 的 buildAgentGraph 读取
 * AGENT_TREE 递归建图。这是「加一个 agent = 加一段配置」的扩展点:工具走 TOOL_REGISTRY,
 * prompt 走 PROMPTS,model 档位/温度按角色可调(temperature 覆盖;model-per-role 留位未接)。
 *
 * 行为等价约束:现有 chapter/curator/worldbuilder/outliner 四分支的 prompt/tools/tier
 * 与重构前的 buildAgentGraph 字面量逐字一致;main 的 set_character(写)被移除、改为
 * 只读 get_character/get_characters(对齐 outline/worldview 只读策略);新增 character 分支。
 */
import type { ModelConfigRecord } from './model-factory';
import * as P from './agent-prompts';

export type ModelTier = 'long' | 'short';

export interface AgentSpec {
  name: string;
  description: string;
  promptKey: string;
  promptAugment?: 'writer'; // 动态切片钩子(只有 writer 需要 references slice)
  modelTier: ModelTier;
  temperature?: number; // 可选按角色覆盖;undefined → activeConfig.temperature
  tools: string[]; // TOOL_REGISTRY 的 key
  subagents?: AgentSpec[];
  // 未来扩展位(本期不读):modelOverride?: { configId: string }
}

export const MAX_TOKENS_BY_TIER: Record<ModelTier, number> = {
  long: 16_000,
  short: 6_000,
};

export const PROMPTS: Record<string, string> = {
  MAIN: P.MAIN_AGENT_PROMPT,
  CHAPTER_ORCH: P.CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER: P.WRITER_AGENT_PROMPT,
  SETTLER: P.SETTLER_AGENT_PROMPT,
  VALIDATOR: P.VALIDATOR_AGENT_PROMPT,
  CURATOR: P.CURATOR_AGENT_PROMPT,
  WB_ORCH: P.WORLDBUILDER_ORCHESTRATOR_PROMPT,
  WB_WRITER: P.WORLDBUILDER_WRITER_PROMPT,
  WB_CRITIC: P.WORLDBUILDER_CRITIC_PROMPT,
  OUTLINER_ORCH: P.OUTLINER_ORCHESTRATOR_PROMPT,
  OUTLINE_WRITER: P.OUTLINE_WRITER_PROMPT,
  OUTLINE_CRITIC: P.OUTLINE_CRITIC_PROMPT,
  CHAR_ORCH: P.CHARACTER_ORCHESTRATOR_PROMPT,
  CHAR_WRITER: P.CHARACTER_WRITER_PROMPT,
  CHAR_CRITIC: P.CHARACTER_CRITIC_PROMPT,
};

/**
 * 按 spec 解析出真正喂给 getModel/buildChatModel 的 ModelConfigRecord。
 * 有 temperature 覆盖且与 activeConfig 不同 → clone 改温度;否则原样返回(避免无谓 clone)。
 * 纯函数,可单测;getModel 据返回值的 temperature 进 cache key。
 */
export function resolveModelConfig(
  spec: AgentSpec,
  activeConfig: ModelConfigRecord,
): ModelConfigRecord {
  if (
    spec.temperature !== undefined &&
    spec.temperature !== activeConfig.temperature
  ) {
    return { ...activeConfig, temperature: spec.temperature };
  }
  return activeConfig;
}

export const AGENT_TREE: AgentSpec = {
  name: 'main',
  description: '小说生成流程的编排(主 agent)。',
  promptKey: 'MAIN',
  modelTier: 'long',
  tools: [
    'get_novel_info', 'update_novel', 'get_reading_chapter', 'get_outline',
    'get_chapter_plan', 'get_worldview', 'get_world_entry', 'get_character',
    'get_characters', 'get_reference',
  ],
  subagents: [
    {
      name: 'chapter',
      description:
        '写/改/续写/重写章节。作者要写/续写/重写第 N 章时委派;它会在聚焦上下文里跑完 writer → settler → validator(+修订) 全流程。',
      promptKey: 'CHAPTER_ORCH',
      modelTier: 'long',
      tools: ['snapshot_chapter', 'restore_chapter'],
      subagents: [
        {
          name: 'writer', description: '写/改/续写章节正文。', promptKey: 'WRITER',
          promptAugment: 'writer', modelTier: 'long',
          tools: [
            'append_section', 'replace_text', 'insert_text', 'delete_text',
            'clear_chapter', 'set_chapter_title', 'get_chapter', 'list_chapters',
            'query_memory', 'get_outline', 'get_chapter_plan', 'get_worldview',
            'get_world_entry', 'get_character', 'get_characters', 'get_reference',
          ],
        },
        {
          name: 'settler', description: '结算章节(提取摘要/角色/伏笔)。', promptKey: 'SETTLER',
          modelTier: 'short', tools: ['get_chapter', 'write_summary'],
        },
        {
          name: 'validator', description: '校验章节一致性/质量。', promptKey: 'VALIDATOR',
          modelTier: 'short', tools: ['get_chapter', 'query_memory', 'report_review'],
        },
      ],
    },
    {
      name: 'curator',
      description:
        '搜索/提炼写作参考资料并固化为本小说专属参考。立项信息齐、需要建参考资料时委派。',
      promptKey: 'CURATOR', modelTier: 'long',
      tools: ['list_knowledge', 'get_knowledge', 'set_references', 'get_reference'],
    },
    {
      name: 'worldbuilder',
      description:
        '构建/重建世界观。立项信息齐、需要建世界观时委派;它会在聚焦上下文里跑完 取KB设定文档→建条目→评审→(修订) 全流程。',
      promptKey: 'WB_ORCH', modelTier: 'long', tools: [],
      subagents: [
        {
          name: 'wb-writer', description: '从知识库取设定文档后建/改世界观条目。', promptKey: 'WB_WRITER',
          modelTier: 'long', tools: [
            'list_knowledge', 'get_knowledge', 'set_world_entry', 'get_worldview',
            'get_world_entry', 'get_novel_info',
          ],
        },
        {
          name: 'wb-critic', description: '评审世界观(6维结构化打分),调 report_worldview_review。', promptKey: 'WB_CRITIC',
          modelTier: 'short', tools: [
            'get_worldview', 'get_world_entry', 'get_novel_info', 'report_worldview_review',
          ],
        },
      ],
    },
    {
      name: 'outliner',
      description:
        '建/重建大纲,或补细纲(第 M-N 章)。世界观建好后、写正文前委派建大纲;写到边界或某章无细纲时委派补细纲;它会在聚焦上下文里跑完 取KB大纲方法论→建卷/细纲→评审→(修订) 全流程。',
      promptKey: 'OUTLINER_ORCH', modelTier: 'long', tools: [],
      subagents: [
        {
          name: 'outline-writer', description: '从知识库取大纲方法论后建/改卷与细纲。', promptKey: 'OUTLINE_WRITER',
          modelTier: 'long', tools: [
            'list_knowledge', 'get_knowledge', 'set_volume', 'set_chapter_plan',
            'get_outline', 'get_chapter_plan', 'get_novel_info', 'get_worldview',
            'get_world_entry', 'query_memory',
          ],
        },
        {
          name: 'outline-critic', description: '评审大纲(6维结构化打分),调 report_outline_review。', promptKey: 'OUTLINE_CRITIC',
          modelTier: 'short', tools: [
            'get_outline', 'get_chapter_plan', 'get_novel_info', 'get_worldview',
            'get_world_entry', 'query_memory', 'report_outline_review',
          ],
        },
      ],
    },
    {
      name: 'character',
      description:
        '建/丰富角色档案。大纲建好后、写正文前委派建主要角色档案;或作者要丰富人物时委派;它会在聚焦上下文里跑完 取KB人物方法论→建档案→评审→(修订) 全流程。',
      promptKey: 'CHAR_ORCH', modelTier: 'long', tools: [],
      subagents: [
        {
          name: 'char-writer', description: '从知识库取人物方法论后建/改角色档案。', promptKey: 'CHAR_WRITER',
          modelTier: 'long', tools: [
            'set_character', 'get_character', 'get_characters', 'get_worldview',
            'get_world_entry', 'get_outline', 'get_chapter_plan', 'get_novel_info',
            'list_knowledge', 'get_knowledge', 'query_memory',
          ],
        },
        {
          name: 'char-critic', description: '评审角色档案(6维结构化打分),调 report_character_review。', promptKey: 'CHAR_CRITIC',
          modelTier: 'short', tools: [
            'get_character', 'get_characters', 'get_worldview', 'get_world_entry',
            'get_outline', 'get_novel_info', 'query_memory', 'report_character_review',
          ],
        },
      ],
    },
  ],
};

/** 扁平收集一棵树里的所有 spec(测试/校验用)。 */
export function collectSpecs(spec: AgentSpec): AgentSpec[] {
  return [spec, ...(spec.subagents ?? []).flatMap(collectSpecs)];
}

/** 树结构摘要(测试快照用,不含 prompt 文本)。 */
export interface TreeNode {
  name: string;
  promptKey: string;
  tier: ModelTier;
  tools: string[];
  children: TreeNode[];
}
export function describeTree(spec: AgentSpec): TreeNode {
  return {
    name: spec.name,
    promptKey: spec.promptKey,
    tier: spec.modelTier,
    tools: spec.tools,
    children: (spec.subagents ?? []).map(describeTree),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- agent-tree.config.spec.ts`
Expected: PASS(4 个 describe 块全绿)。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(agentos): 声明式 AgentSpec 配置树 + 纯解析函数(含 character 分支)"
```

---

## Task 7: `buildAgentGraph` 改为走配置(核心重构)

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`

> 不单测 buildAgentGraph(动态 import langchain/deepagents)。正确性靠:Task 6 配置快照测试 + `pnpm --dir server typecheck` + 全量 `pnpm --dir server test`(确保现有 spec 仍绿)+ 手动 smoke。

- [ ] **Step 1: 调整 import**

在 `server/src/agentos/deep-agent.service.ts` 顶部:

**删除**从 `./agent-prompts` 的整段 import(12 个 prompt 常量)——改由配置内部引用。
**删除**所有 `./tools/*` 工具工厂 import(28 行)——改由 `TOOL_REGISTRY` 引用。
**删除** `buildChatModel` 之外不需要的;`ModelConfigRecord` 保留。

**新增** import:
```ts
import { AGENT_TREE, MAX_TOKENS_BY_TIER, PROMPTS, resolveModelConfig, type AgentSpec } from './agent-tree.config';
import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';
```
保留 `import { buildChatModel, type ModelConfigRecord } from './model-factory';`。删除 `createActivityEmitter`/`applyRewind`/`ActivityEvent` 等仍需要的 import(保留它们)。保留所有服务 import(NovelService 等——ToolDeps 要用)。

- [ ] **Step 2: 改 `getModel` cache key 含 temperature**

```ts
  private async getModel(config: ModelConfigRecord, maxTokens = 16_000) {
    const key = `${config.id}:${maxTokens}:${config.temperature}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const model = await buildChatModel(config, maxTokens);
    this.models.set(key, model);
    return model;
  }
```

- [ ] **Step 3: 新增 `resolveModel`,替换三处显式取模型**

```ts
  private async resolveModel(spec: AgentSpec, activeConfig: ModelConfigRecord) {
    return this.getModel(
      resolveModelConfig(spec, activeConfig),
      MAX_TOKENS_BY_TIER[spec.modelTier],
    );
  }
```

- [ ] **Step 4: 改 `runTurn` —— 传 activeConfig + writerSlice,不再传预解析模型/prompt**

把 runTurn 里 `// main / writer 复用 16k ... settlerModel / validatorModel` 那段(取三个 model)删掉;`writerPrompt` 变量改为只算 `writerSlice`(去掉与 `WRITER_AGENT_PROMPT` 的拼接):

```ts
    // writer 的参考资料 slice:每轮按 novel 现拼,createSubAgentMiddleware 配置同步故必须先 await。
    // 无条目则 writer 用原始 WRITER_AGENT_PROMPT(配置里 promptAugment:'writer',由 builder 拼接)。
    const refsAll = await this.references.listAll(userId, novelId);
    const writerRefs = refsAll.filter(
      (r) => r.injectTo === 'writer' || r.injectTo === 'both',
    );
    const refIndexLines = refsAll
      .map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category})`)
      .join('\n');
    const writerSlice = writerRefs.length
      ? '\n\n【写作参考】\n索引:\n' +
        refIndexLines +
        '\n\n精要:\n' +
        writerRefs
          .slice(0, 6)
          .map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`)
          .join('\n\n')
      : '';

    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig: config,
      writerSlice,
    });
```

(删掉原 `writerPrompt`、`model`、`settlerModel`、`validatorModel` 局部变量。)

- [ ] **Step 5: 改 `rewind` —— 传 activeConfig + writerSlice,不再传模型**

```ts
    const config: ModelConfigRecord = {
      id: activeConfig.id,
      provider: activeConfig.provider,
      model: activeConfig.model,
      baseUrl: activeConfig.baseUrl,
      apiKey: activeConfig.apiKey,
      temperature: activeConfig.temperature,
    };
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder: null,
      systemPrompt: '',
      activeConfig: config,
      writerSlice: '',
    });
```

(删掉原 `model`/`settlerModel`/`validatorModel`/`writerPrompt`。)

- [ ] **Step 6: 重写 `buildAgentGraph` 走配置**

把整个 `buildAgentGraph` 方法体替换为(签名改为接收 `activeConfig` + `writerSlice`,返回类型不变):

```ts
  private async buildAgentGraph(args: {
    userId: string;
    novelId: string;
    readingChapterOrder: number | null;
    systemPrompt: string;
    activeConfig: ModelConfigRecord;
    writerSlice: string;
  }): Promise<{
    stream: (
      input: { messages: Array<{ role: string; content: string; id?: string }> },
      options: {
        configurable: Record<string, unknown>;
        streamMode: string;
        signal?: AbortSignal;
      },
    ) => Promise<AsyncIterable<unknown>>;
    getState: (config: {
      configurable: Record<string, unknown>;
    }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
    updateState: (
      config: { configurable: Record<string, unknown> },
      values: Record<string, unknown>,
    ) => Promise<unknown>;
  }> {
    const {
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig,
      writerSlice,
    } = args;

    const { createAgent } = await import('langchain');
    const {
      createSubAgentMiddleware,
      createSummarizationMiddleware,
      createPatchToolCallsMiddleware,
      createSubagentTransformer,
      StateBackend,
    } = await import('deepagents');

    const backend = new StateBackend();
    const subagentStack = () => [createPatchToolCallsMiddleware()] as never;

    const deps: ToolDeps = {
      userId,
      novelId,
      readingChapterOrder,
      novels: this.novels,
      chapters: this.chapters,
      outlines: this.outlines,
      world: this.world,
      characters: this.characters,
      references: this.references,
      knowledge: this.knowledge,
      snapshots: this.snapshots,
      summaries: this.summaries,
      events: this.events,
      prisma: this.prisma,
    };
    const resolveTools = (keys: string[]) =>
      keys.map((k) => TOOL_REGISTRY[k](deps) as never);
    const resolvePrompt = (spec: AgentSpec) =>
      spec.promptAugment === 'writer'
        ? PROMPTS[spec.promptKey] + writerSlice
        : PROMPTS[spec.promptKey];

    const mainModel = await this.resolveModel(AGENT_TREE, activeConfig);

    // 把一个 spec 递归构造成 subagent 配置(含其下 nested createSubAgentMiddleware)。
    const buildNode = async (spec: AgentSpec) => {
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: resolvePrompt(spec),
        model: (await this.resolveModel(spec, activeConfig)) as never,
        tools: resolveTools(spec.tools),
      };
      if (spec.subagents && spec.subagents.length > 0) {
        node.middleware = [
          createSubAgentMiddleware({
            defaultModel: mainModel as never,
            generalPurposeAgent: false,
            defaultMiddleware: subagentStack(),
            subagents: await Promise.all(spec.subagents.map(buildNode)),
          }) as never,
        ];
      }
      return node;
    };

    const agent = createAgent({
      model: mainModel as never,
      systemPrompt: systemPrompt || PROMPTS[AGENT_TREE.promptKey],
      tools: resolveTools(AGENT_TREE.tools),
      middleware: [
        createSubAgentMiddleware({
          defaultModel: mainModel as never,
          generalPurposeAgent: false,
          defaultMiddleware: subagentStack(),
          subagents: await Promise.all((AGENT_TREE.subagents ?? []).map(buildNode)),
        }) as never,
        createSummarizationMiddleware({ backend }) as never,
        createPatchToolCallsMiddleware() as never,
      ],
      streamTransformers: [createSubagentTransformer([] as never)] as never,
      ...(this.checkpointer
        ? { checkpointer: this.checkpointer as never }
        : {}),
    }).withConfig({ recursionLimit: 10_000 }) as unknown as {
      stream: (
        input: { messages: Array<{ role: string; content: string; id?: string }> },
        options: {
          configurable: Record<string, unknown>;
          streamMode: string;
          signal?: AbortSignal;
        },
      ) => Promise<AsyncIterable<unknown>>;
      getState: (config: {
        configurable: Record<string, unknown>;
      }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
      updateState: (
        config: { configurable: Record<string, unknown> },
        values: Record<string, unknown>,
      ) => Promise<unknown>;
    };

    return agent;
  }
```

- [ ] **Step 7: 删掉三个旧 helper**

删除 `writerTools()`、`wbWriterTools()`、`outlineWriterTools()` 三个 private 方法(已被 `TOOL_REGISTRY` + 配置取代)。

- [ ] **Step 8: typecheck + 全量测试**

Run:
```bash
pnpm --dir server typecheck
pnpm --dir server test
```
Expected: typecheck PASS;全量 jest 绿(含新增 spec + 既有 novel/character/model-factory/agentos.controller/sessions 等)。

- [ ] **Step 9: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "refactor(agentos): buildAgentGraph 改为走声明式配置树(移除内联树与 *Tools helper)"
```

---

## Task 8: FE 纯函数 `lib/phase.ts`

**Files:**
- Create: `agent-ui/src/lib/phase.ts`

> agent-ui 无测试运行器;验证靠 typecheck + lint。纯函数,实现时仔细推理。

- [ ] **Step 1: 实现**

Create `agent-ui/src/lib/phase.ts`:

```ts
import type { Novel } from '@/types/novel'

/** 写作类工具(正文写/改/删)——显示「写作中·第 N 章」。 */
const WRITING_TOOLS = new Set([
  'append_section',
  'replace_text',
  'insert_text',
  'delete_text',
  'clear_chapter',
  'set_chapter_title',
])

/** 工具名 → 固定阶段文案。写作类工具不在此表,走 writingChapterOrder 分支。 */
const TOOL_TO_PHASE: Record<string, string> = {
  set_world_entry: '构建世界观中',
  set_volume: '构建大纲中',
  set_chapter_plan: '构建大纲中',
  set_character: '建角色档案中',
  write_summary: '结算中',
  set_references: '整理参考资料中',
  report_review: '评审中',
  report_worldview_review: '评审中',
  report_outline_review: '评审中',
  report_character_review: '评审中',
}

/**
 * 据 activity 的 tool label 推断当前阶段文案。返回 null 表示该 label 不映射(调用方应保留旧值)。
 * writingChapterOrder 用于写作类工具显示章节号(与 useAIStreamHandler 写入的 store 值一致)。
 */
export function phaseForTool(
  label: string | undefined,
  writingChapterOrder: number | null
): string | null {
  if (!label) return null
  if (WRITING_TOOLS.has(label)) {
    return writingChapterOrder != null
      ? `写作中·第 ${writingChapterOrder} 章`
      : '写作中'
  }
  return TOOL_TO_PHASE[label] ?? null
}

/**
 * 空闲(非流式)阶段:CONCEPT → 立项中;ACTIVE → 写作中 + 焦点章/总章数。
 * focus 取 currentChapterOrder(用户聚焦章),否则最新章;无章则只显示「写作中」。
 */
export function deriveIdlePhase(
  novel: Pick<Novel, 'status' | 'chapters'>,
  currentChapterOrder: number | null
): string {
  if (novel.status === 'CONCEPT') return '立项中(尚未开写)'
  const total = novel.chapters.length
  const focus =
    currentChapterOrder ??
    (total ? Math.max(...novel.chapters.map((c) => c.order)) : null)
  return focus != null ? `写作中 · 第 ${focus} 章 / 共 ${total} 章` : '写作中'
}
```

- [ ] **Step 2: typecheck + lint**

Run:
```bash
pnpm --dir agent-ui typecheck
pnpm --dir agent-ui lint
```
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/lib/phase.ts
git commit -m "feat(agent-ui): lib/phase 阶段映射纯函数(TOOL_TO_PHASE + deriveIdlePhase)"
```

---

## Task 9: FE store + handler + ChatPanel 顶栏接线

**Files:**
- Modify: `agent-ui/src/store.ts`
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx`
- Modify: `agent-ui/src/components/workspace/ChatPanel.tsx`

> agent-ui 无测试运行器;验证靠 typecheck + lint + 手动 smoke(起 dev 看 顶栏随工具变化)。

- [ ] **Step 1: store 加 `activePhase`**

在 `agent-ui/src/store.ts` 的 `Store` 接口加(`currentChapterOrder` 附近):

```ts
  activePhase: string | null
  setActivePhase: (phase: string | null) => void
```

实现里(初始值 + setter,放在 `setCurrentChapterOrder` 附近):

```ts
      activePhase: null,
      setActivePhase: (phase) => set(() => ({ activePhase: phase })),
```

并在 `logout` 和 `login` 两个 reset 对象里加 `activePhase: null`(与 `currentChapterOrder: null` 同处)。

- [ ] **Step 2: handler 设/清 `activePhase`**

在 `agent-ui/src/hooks/useAIStreamHandler.tsx`:

(a) 顶部 import:
```ts
import { phaseForTool } from '@/lib/phase'
```

(b) `handleStreamResponse` 开头(`setIsStreaming(true)` 之后,约 line 114)加:
```ts
        useStore.getState().setActivePhase('思考中…')
```

(c) 在 ActTool 分支,现有 label-based bump 块末尾(约 line 461,`write_summary` bump 之后)加:
```ts
                  const phase = phaseForTool(
                    activities[a.id].label,
                    useStore.getState().writingChapterOrder
                  )
                  if (phase) useStore.getState().setActivePhase(phase)
```

(d) `finally` 块(`useStore.getState().setWritingChapterOrder(null)` 之后,约 line 562)加:
```ts
        useStore.getState().setActivePhase(null)
```

(e) `stopStreaming`(`useStore.getState().setWritingChapterOrder(null)` 之后,约 line 601)加:
```ts
    useStore.getState().setActivePhase(null)
```

- [ ] **Step 3: ChatPanel 顶栏改读阶段**

在 `agent-ui/src/components/workspace/ChatPanel.tsx`:

(a) import 改:删 `currentChapterOrder` 的 `readingChapter` 推导;加 phase 工具:
```ts
import { deriveIdlePhase } from '@/lib/phase'
```

(b) 组件内(约 line 32-36)替换为:
```ts
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const activePhase = useStore((s) => s.activePhase)
  const phase = activePhase ?? deriveIdlePhase(novel, currentChapterOrder)
```

(c) 顶栏 JSX(约 line 106-116)替换为:
```tsx
      <div className="flex items-center justify-between px-5 py-2 text-xs text-muted">
        <span>💬 聊天 · 一本小说一份记忆</span>
        <span>📍 {phase}</span>
      </div>
```

(删掉 `readingChapter` 三元与「(agent 可见)」字样。)

- [ ] **Step 4: typecheck + lint + format**

Run:
```bash
pnpm --dir agent-ui typecheck
pnpm --dir agent-ui lint
pnpm --dir agent-ui format
```
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/store.ts agent-ui/src/hooks/useAIStreamHandler.tsx agent-ui/src/components/workspace/ChatPanel.tsx
git commit -m "feat(agent-ui): 顶栏静态「第N章」→ 实时阶段状态(按工具映射 + status 兜底)"
```

---

## Task 10: 全量验证 + 手动 smoke

**Files:** 无(验证)

- [ ] **Step 1: server 全量 gate**

Run:
```bash
pnpm --dir server typecheck
pnpm --dir server lint
pnpm --dir server test
```
Expected: 全 PASS。

- [ ] **Step 2: agent-ui 全量 gate**

Run:
```bash
pnpm --dir agent-ui validate
```
Expected: PASS(lint && format && typecheck)。

- [ ] **Step 3: 手动 smoke(顶栏 + agent)**

起 dev(`pnpm --dir server start:dev` 配 `PORT=3001`;`pnpm --dir agent-ui dev`),登录后:
1. 「新建小说」→ 进工作台。顶栏空闲应显示 `📍 立项中(尚未开写)`(CONCEPT)。
2. 发消息让 agent 走流程:建世界观时顶栏随 `set_world_entry` 显示 `📍 构建世界观中`;建大纲时 `📍 构建大纲中`;建角色时 `📍 建角色档案中`(验证 character agent 被委派);写章时 `📍 写作中·第 N 章`;之间显示 `📍 思考中…`。
3. 章节写完后(status→ACTIVE),空闲顶栏显示 `📍 写作中 · 第 N 章 / 共 M 章`。
4. 确认不再出现「正在读 第 1 章」「(agent 可见)」。

> 若 smoke 中 character agent 未被委派(顶栏无「建角色档案中」):检查 MAIN_AGENT_PROMPT 顺序(curator→worldbuilder→outliner→character)与 character description 是否清晰;必要时调 prompt。

- [ ] **Step 4: 更新 CLAUDE.md(Phase 记录 + agent 树描述)**

在 `CLAUDE.md` 的 `### server (NestJS)` → `Agentos` 段,把「one main agent + three subagents (writer/settler/validator)」更新为反映配置化 + 4 编排 agent + character;在 `### Phase status` 末尾追加 Phase 5 条目指向本 spec/plan。具体措辞按现有风格补。

- [ ] **Step 5: 最终 commit**

```bash
git add CLAUDE.md
git commit -m "docs: 更新 CLAUDE.md agent 树描述 + Phase 5 记录"
```

---

## Self-Review(plan 写完后已执行)

- **Spec 覆盖**:① 配置化 → Task 5/6/7;② character agent → Task 1/2/3/4(+ Task 6 配置分支 + Task 7 接线);③ 顶栏 → Task 8/9。迁移 → Task 2。MAIN_AGENT_PROMPT 改动 → Task 4。全覆盖。
- **占位符扫描**:无 TBD/TODO;每个代码步骤含完整代码。
- **类型一致性**:`AgentSpec`/`ModelTier`/`ToolDeps`/`resolveModelConfig`/`phaseForTool`/`deriveIdlePhase`/`setActivePhase` 在各 Task 间命名一致;`MAX_TOKENS_BY_TIER`、`PROMPTS`、`AGENT_TREE` 定义与使用一致。

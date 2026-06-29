# 人物小传 + changes 瘦身 — 实现计划

> spec: [2026-06-30-character-bio-and-changes-slim-design.md](../specs/2026-06-30-character-bio-and-changes-slim-design.md)

---

## Task 1: schema + migration

**Files:** [server/prisma/schema.prisma](../../../server/prisma/schema.prisma)

- [ ] **Step 1: Character + growth/flaw**(在 `voice` 后)

```prisma
  growth     String   @default("")    // 成长经历:塑造性格的重大事件(防 OOC 的根)
  flaw       String   @default("")    // 弱点/执念阴暗面:挣扎与蜕变之源
```

- [ ] **Step 2: CharacterChange + significance**(在 `reason` 后)+ 新 enum

```prisma
  significance CharacterChangeSignificance @default(MINOR) // MAJOR=实质蜕变 / MINOR=次要状态
```
文件末尾(EventSignificance 旁)加:
```prisma
enum CharacterChangeSignificance {
  MAJOR
  MINOR
}
```

- [ ] **Step 3: migrate + generate**

`pnpm --dir server prisma migrate dev --name add_character_bio_and_change_significance` → `pnpm --dir server prisma generate`

---

## Task 2: RoleChange 类型 + service

**Files:** [chapter-summary.service.ts](../../../server/src/memory/chapter-summary.service.ts) + [character.service.ts](../../../server/src/novel/character.service.ts)

- [ ] **Step 1: RoleChange + significance**

```ts
export interface RoleChange {
  name: string;
  field: string;
  value: string;
  reason: string;
  significance?: 'MAJOR' | 'MINOR'; // 默认 MINOR;MAJOR=实质蜕变
}
```

- [ ] **Step 2: CharacterChangeInput + significance**

```ts
export interface CharacterChangeInput {
  name: string;
  field: string;
  value: string;
  reason: string;
  significance?: 'MAJOR' | 'MINOR';
}
```

- [ ] **Step 3: upsertCharacter + growth/flaw**(在 fields 的展开里加)

```ts
      ...(data.growth !== undefined && { growth: data.growth }),
      ...(data.flaw !== undefined && { flaw: data.flaw }),
```
方法签名 data 参数 +growth/flaw?: string。

- [ ] **Step 4: recordChanges 写 significance**

```ts
await this.prisma.characterChange.create({
  data: {
    novelId, characterId: ch.id, chapterOrder,
    field: c.field, value: c.value, reason: c.reason,
    significance: (c.significance ?? 'MINOR') as never,
  },
});
```

- [ ] **Step 5: getCharacter MAJOR全量 + MINOR近30**

替换现在的 `changes: { orderBy desc, take: 50 }`:
```ts
const [major, minor] = await Promise.all([
  this.prisma.characterChange.findMany({
    where: { characterId: ch.id, significance: 'MAJOR' },
    orderBy: { chapterOrder: 'desc' },
  }),
  this.prisma.characterChange.findMany({
    where: { characterId: ch.id, significance: 'MINOR' },
    orderBy: { chapterOrder: 'desc' },
    take: 30,
  }),
]);
const changes = [...major, ...minor].sort((a, b) => b.chapterOrder - a.chapterOrder);
```
currentState 从 `changes` 派生(同现有 deriveCurrentState)。返回 `{ ...ch, changes, currentState }`(注意 ch 此处不带 include 的 changes,手动挂)。

- [ ] **Step 6: listCharacters changes take:50**

`include: { changes: { orderBy: { chapterOrder: 'desc' }, take: 50 } }`。

---

## Task 3: tools

**Files:** [set-character.tool.ts](../../../server/src/agentos/tools/set-character.tool.ts) + [write-summary.tool.ts](../../../server/src/agentos/tools/write-summary.tool.ts)

- [ ] **Step 1: set_character + growth/flaw**(zod + 工具 description)

```ts
growth: z.string().optional().describe('成长经历:塑造性格的重大事件(防 OOC 的根)'),
flaw: z.string().optional().describe('弱点/执念阴暗面(挣扎与蜕变之源)'),
```

- [ ] **Step 2: write_summary roleChanges 项 + significance**

roleChanges 的 z.object 每项加:
```ts
significance: z.enum(['MAJOR','MINOR']).optional().describe('MAJOR=性格/弧光/能力/地位的实质蜕变(写后续章必知);MINOR=次要状态。默认 MINOR'),
```

---

## Task 4: 提示词

**Files:** [settler.md](../../../server/src/agentos/prompts/settler.md) + [character-writer.md](../../../server/src/agentos/prompts/character-writer.md) + [character-critic.md](../../../server/src/agentos/prompts/character-critic.md)

- [ ] **Step 1: settler.md「角色变化」段重写**

替换为:
```md
【角色变化 — 只记实质蜕变(不记出场/瞬时情绪)】
- 【不要】记 appearance=appeared——出场记录归 plotEvents(involvedCharacters)。只有真实外貌变化(受伤留疤等)才记。
- 【瞬时情绪不记】——情绪是事件,归 plotEvents。changes 只记 personality/ability/status/relationship 的【实质、持久】转变。
- 每条判 significance:
  · MAJOR:性格/弧光/能力/地位的实质蜕变(写后续章必须知道的,如「恩师被杀→性格从天真转冷峻」)。
  · MINOR:次要状态调整(如「与某角色关系缓和」)。
- reason【必填】——什么故事事件导致。角色是会成长的,但只记大的转折,不记每个情绪波动。
- 没有实质转变的章节/角色 → roleChanges 留空(不是每个出场角色都要硬塞一条)。
```

- [ ] **Step 2: character-writer.md 加三支柱小传 + 按 role 分层**

开篇「建档案」段重写为:
```md
【人物小传 — 三支柱 + 按 role 分复杂度】
按「出身背景 / 社会情况 / 心理状态」三大支柱建小传,让角色有血有肉、逻辑自洽(防 OOC)。最终检验:能回答角色的【来路、执念、挣扎、归宿】。按 role 分层:
- 主角(PROTAGONIST)/反派(ANTAGONIST):小传全填深——background(出身)+ growth(成长经历:塑造性格的重大事件,防 OOC 最重要)+ 社会阶层/地位(写进 background/faction)+ appearance(外貌记忆点)+ personality(性格基调)+ motivation(执念/目标)+ flaw(弱点/挣扎之源)+ arcGoal(归宿)+ voice。
- 关键配角(SUPPORTING 重要):中等——background + personality + motivation + 功能定位。
- 路人配角:精简 essence——name/role + 一句话功能,其余留空。
set_character(by name upsert)填对应字段。
```

- [ ] **Step 3: character-critic.md 加小传深度 + growth↔personality**

维度(区分度/一致性)后补:
```md
- 小传深度匹配 role:主角/反派是否填全 background/growth/personality/motivation/flaw/arcGoal?配角是否过度(浪费)或不足(立不住)?growth(成长经历)能否解释现在的 personality(不一致 = OOC 种子 → blocking)?flaw 是否清晰(挣扎之源)?
```

---

## Task 5: FE

**Files:** [types/novel.ts](../../../agent-ui/src/types/novel.ts) + CharactersView

- [ ] **Step 1: Character type + growth/flaw;CharacterChangeEntry + significance**

```ts
growth: string
flaw: string
```
CharacterChangeEntry + `significance?: 'MAJOR' | 'MINOR'`

- [ ] **Step 2: CharactersView 渲染 growth/flaw + significance badge**(档案区加 growth/flaw;changes 时间线显 ★MAJOR/·minor)

---

## Task 6: 测试 + 验证 + 提交

- [ ] **Step 1: character.service.spec 加用例**

- upsert growth/flaw → get 回含。
- getCharacter significance 过滤:造 1 条 MAJOR(旧章)+ 35 条 MINOR → 返回含 MAJOR + 最近 30 MINOR;currentState 含 MAJOR 那条的 field。

- [ ] **Step 2: 全量验证**

`pnpm --dir server test && pnpm --dir server typecheck && pnpm --dir server build` + `pnpm --dir agent-ui typecheck`。锁子串(settler/character-writer/character-critic)不破。

- [ ] **Step 3: 提交 + CLAUDE.md(Phase 21)**

# 角色管理完善：上下文分层注入 + 面板档案渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 ContextAssembler 加角色分层注入（活跃全档案 + 沉默名册），让长篇写作不丢角色设定；前端角色面板渲染 5 个 stable-profile 字段；顺手对齐 `get_characters` 工具。

**Architecture:** 分类逻辑封装在 `CharacterService.listForContext`（可单测），`ContextAssembler.forSession` 只做格式化并注入 slice；前端纯 JSX 改动（数据已在手）。无 DB 迁移。

**Tech Stack:** NestJS 11 + Prisma 7（server，jest 单测）；Next.js 15 + React 18（agent-ui，`pnpm validate` 质量门）。

**Spec:** [docs/superpowers/specs/2026-06-27-character-context-and-panel-design.md](../specs/2026-06-27-character-context-and-panel-design.md)

---

## File Structure

- **Modify** `server/src/novel/character.service.ts` — 新增 `listForContext(userId, novelId, currentChapter, activeWindow=5)`：分类返回 `{ active, dormant }`。
- **Modify** `server/src/agentos/context-assembler.service.ts` — 构造器注入 `CharacterService`；`forSession` 调 `listForContext` 并拼【角色】slice；新增私有 `buildCharacterSlice`。
- **Modify** `server/src/agentos/tools/get-characters.tool.ts` — projection 补全 profile 字段。
- **Modify** `server/src/novel/character.service.spec.ts` — 新增 `listForContext` 用例。
- **Modify** `server/src/agentos/context-assembler.service.spec.ts` — 加 `stubCharacters`，8 处实例化补第 6 参，新增 slice 注入用例。
- **Modify** `agent-ui/src/components/workspace/ResourcePanel.tsx` — `CharactersView` 渲染档案字段 + 卡片三段重组。
- **Modify** `CLAUDE.md` — 更新 Phase 状态 / deferred 项。

---

## Task 1: `CharacterService.listForContext`（分类逻辑，TDD）

**Files:**
- Modify: `server/src/novel/character.service.ts`（在 `listCharacters` 之后新增方法）
- Test: `server/src/novel/character.service.spec.ts`（在 `listCharacters` describe 块之后新增 describe）

- [ ] **Step 1: 写失败测试**

在 `server/src/novel/character.service.spec.ts` 末尾的 `describe('listCharacters', ...)` 块之后、最外层 `describe('CharacterService')` 闭合 `})` 之前，插入：

```ts
  describe('listForContext', () => {
    const baseChar = {
      id: 'x', aliases: [], faction: '', background: '', appearance: '',
      personality: '', motivation: '', arcGoal: '', voice: '',
    };

    it('PROTAGONIST 永远活跃;沉默角色只带精简字段(name/role/aliases/personality/motivation)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findMany.mockResolvedValue([
        {
          ...baseChar, id: 'c1', name: '沈砚', role: 'PROTAGONIST', aliases: ['沈少'],
          personality: '外冷内热', motivation: '复仇',
          // 当前第 10 章,最近出场第 1 章——但主角永远活跃
          changes: [{ field: 'appearance', value: 'appeared', chapterOrder: 1, reason: '' }],
        },
        {
          ...baseChar, id: 'c2', name: '老陈', role: 'SUPPORTING',
          personality: '隐忍', motivation: '护主',
          changes: [{ field: 'appearance', value: 'appeared', chapterOrder: 1, reason: '' }],
        },
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const { active, dormant } = await svc.listForContext('u1', 'n1', 10);

      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ name: '沈砚', role: 'PROTAGONIST', motivation: '复仇' });
      expect(dormant).toHaveLength(1);
      expect(dormant[0]).toMatchObject({ name: '老陈', personality: '隐忍', motivation: '护主' });
      // 沉默不带完整档案字段
      expect(dormant[0]).not.toHaveProperty('appearance');
      expect(dormant[0]).not.toHaveProperty('arcGoal');
    });

    it('窗口内出场→活跃;超出窗口→沉默(默认窗口 5)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findMany.mockResolvedValue([
        { ...baseChar, id: 'c1', name: 'A', role: 'SUPPORTING',
          changes: [{ field: 'appearance', value: 'x', chapterOrder: 8, reason: '' }] }, // 10-8=2 ≤5
        { ...baseChar, id: 'c2', name: 'B', role: 'SUPPORTING',
          changes: [{ field: 'appearance', value: 'x', chapterOrder: 2, reason: '' }] }, // 10-2=8 >5
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const { active, dormant } = await svc.listForContext('u1', 'n1', 10);

      expect(active.map((c) => c.name)).toEqual(['A']);
      expect(dormant.map((c) => c.name)).toEqual(['B']);
    });

    it('从未出场(lastChapter=null)→活跃(种子卡司,不被误判沉默)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findMany.mockResolvedValue([
        { ...baseChar, id: 'c1', name: '新角', role: 'SUPPORTING', changes: [] },
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const { active, dormant } = await svc.listForContext('u1', 'n1', 10);

      expect(active.map((c) => c.name)).toEqual(['新角']);
      expect(dormant).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- character.service.spec.ts`
Expected: FAIL — `svc.listForContext is not a function`

- [ ] **Step 3: 实现 `listForContext`**

在 `server/src/novel/character.service.ts` 的 `listCharacters` 方法之后（文件闭合 `}` 之前）插入：

```ts
  /**
   * 供 ContextAssembler 分层注入:按"活跃/沉默"分类返回角色。
   *  - 活跃:PROTAGONIST/ANTAGONIST,或从未出场(种子卡司),或最近 activeWindow 章出场过。
   *  - 沉默:其余。沉默只带精简字段(name/role/aliases/personality/motivation)做名册。
   * currentChapter = 当前最新章序号(无章为 0)。activeWindow 默认 5。
   */
  async listForContext(
    userId: string,
    novelId: string,
    currentChapter: number,
    activeWindow = 5,
  ): Promise<{
    active: Array<{
      name: string;
      role: string;
      aliases: string[];
      faction: string;
      background: string;
      appearance: string;
      personality: string;
      motivation: string;
      arcGoal: string;
      voice: string;
      currentState: Record<
        string,
        { value: string; chapterOrder: number; reason: string }
      >;
    }>;
    dormant: Array<{
      name: string;
      role: string;
      aliases: string[];
      personality: string;
      motivation: string;
    }>;
  }> {
    await this.assertOwned(userId, novelId);
    const characters = await this.prisma.character.findMany({
      where: { novelId, novel: { userId } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      include: { changes: { orderBy: { chapterOrder: 'desc' }, take: 50 } },
    });
    const active: ReturnType<CharacterService['listForContext']> extends Promise<
      infer R
    >
      ? R extends { active: infer A }
        ? A
        : never
      : never = [];
    const dormant: ReturnType<CharacterService['listForContext']> extends Promise<
      infer R
    >
      ? R extends { dormant: infer D }
        ? D
        : never
      : never = [];
    for (const ch of characters) {
      const changes = ch.changes as Array<{
        field: string;
        value: string;
        chapterOrder: number;
        reason: string;
      }>;
      // changes 按 chapterOrder desc,首条即最新;无记录则 null。
      const lastChapter = changes.length ? changes[0].chapterOrder : null;
      const isActive =
        ch.role === 'PROTAGONIST' ||
        ch.role === 'ANTAGONIST' ||
        lastChapter === null ||
        currentChapter - lastChapter <= activeWindow;
      const currentState = this.deriveCurrentState(changes);
      if (isActive) {
        active.push({
          name: ch.name,
          role: ch.role,
          aliases: ch.aliases,
          faction: ch.faction,
          background: ch.background,
          appearance: ch.appearance,
          personality: ch.personality,
          motivation: ch.motivation,
          arcGoal: ch.arcGoal,
          voice: ch.voice,
          currentState,
        });
      } else {
        dormant.push({
          name: ch.name,
          role: ch.role,
          aliases: ch.aliases,
          personality: ch.personality,
          motivation: ch.motivation,
        });
      }
    }
    return { active, dormant };
  }
```

> 注：上面 `ReturnType` 嵌套类型推断只是为了让 `active`/`dormant` 元素类型与返回签名一致，避免 `any`。若觉得可读性差，可改成在方法上方定义两个独立 `interface` 再复用——行为一致。实现时二选一即可，推荐下面的等价写法（更清晰）：

等价、更清晰的写法（**推荐用这个**，替换上面的 `ReturnType` 那段声明）：在 `character.service.ts` 顶部（`CharacterChangeInput` interface 之后）新增：

```ts
export interface ContextCharacterActive {
  name: string;
  role: string;
  aliases: string[];
  faction: string;
  background: string;
  appearance: string;
  personality: string;
  motivation: string;
  arcGoal: string;
  voice: string;
  currentState: Record<
    string,
    { value: string; chapterOrder: number; reason: string }
  >;
}

export interface ContextCharacterDormant {
  name: string;
  role: string;
  aliases: string[];
  personality: string;
  motivation: string;
}
```

并把方法体内 `const active: ... = []` / `const dormant: ... = []` 改为：

```ts
    const active: ContextCharacterActive[] = [];
    const dormant: ContextCharacterDormant[] = [];
```

并把返回签名 `Promise<{ active: Array<{...}>; dormant: Array<{...}> }>` 改为 `Promise<{ active: ContextCharacterActive[]; dormant: ContextCharacterDormant[] }>`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- character.service.spec.ts`
Expected: PASS（含原有用例 + 3 个新用例）

- [ ] **Step 5: 提交**

```bash
git add server/src/novel/character.service.ts server/src/novel/character.service.spec.ts
git commit -m "feat(character): listForContext 活跃/沉默分层分类(供上下文注入)"
```

---

## Task 2: `ContextAssembler` 注入角色 slice

**Files:**
- Modify: `server/src/agentos/context-assembler.service.ts`
- Test: `server/src/agentos/context-assembler.service.spec.ts`

- [ ] **Step 1: 先改测试——加 `stubCharacters` + 8 处实例化补第 6 参**

在 `server/src/agentos/context-assembler.service.spec.ts`：

(a) 顶部 import 区加一行（与其它 `import type` 并列）：

```ts
import type { CharacterService } from '../novel/character.service';
```

(b) 在 `stubReferences` 定义之后加：

```ts
// 默认空卡司 → 不注入角色 slice(保留旧测试行为)。
const stubCharacters = {
  listForContext: jest.fn().mockResolvedValue({ active: [], dormant: [] }),
} as unknown as CharacterService;
```

(c) 文件里 **8 处** `new ContextAssembler(...)` 调用都要在末尾参 `stubReferences`（或 `references`）之后、闭合 `)` 之前补一个 `stubCharacters,` 参。其中 7 处以 `stubReferences,` 收尾，1 处（`injects 【写作参考】` 用例）以 `references,` 收尾。

对 7 处 `stubReferences,` 收尾的，把：

```ts
        stubReferences,
      );
```

改为：

```ts
        stubReferences,
        stubCharacters,
      );
```

对 1 处 `references,` 收尾的（`injects 【写作参考】 slice` 用例），把：

```ts
        stubWorld,
        references,
      );
```

改为：

```ts
        stubWorld,
        references,
        stubCharacters,
      );
```

- [ ] **Step 2: 跑测试确认现有用例仍通过（构造器还没加参时会编译失败——先确认这一步失败）**

Run: `pnpm --dir server test -- context-assembler.service.spec.ts`
Expected: FAIL（编译错误：`Expected 6 arguments, but got 5`）—— 因为 Task 2 还没改 service 构造器。这是预期的，下一步实现。

- [ ] **Step 3: 实现——构造器注入 + slice 拼装**

在 `server/src/agentos/context-assembler.service.ts`：

(a) 顶部 import 区加：

```ts
import { CharacterService } from '../novel/character.service';
```

(b) 构造器加第 6 个依赖（在 `references` 之后）：

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly world: WorldEntryService,
    private readonly references: NovelReferenceService,
    private readonly characters: CharacterService,
  ) {}
```

(c) 在 `forSession` 里，`const coreWorld = ...`（现有 ~line 121）之后加一行取卡司：

```ts
    const cast = await this.characters.listForContext(
      userId,
      novel.id,
      currentChapter,
    );
```

(d) 在 slices 区，紧接【世界观】block 之后（即 `if (coreWorld.length) { ... }` 闭合之后、`if (recent.length)` 之前）插入：

```ts
    if (cast.active.length || cast.dormant.length) {
      slices.push(this.buildCharacterSlice(cast));
    }
```

(e) 在 class 内（`forSession` 之后）新增私有方法：

```ts
  /** 拼角色分层 slice:活跃(全档案+当前态)+ 沉默(名册+essence)。 */
  private buildCharacterSlice(cast: {
    active: Array<{
      name: string;
      role: string;
      aliases: string[];
      faction: string;
      background: string;
      appearance: string;
      personality: string;
      motivation: string;
      arcGoal: string;
      voice: string;
      currentState: Record<
        string,
        { value: string; chapterOrder: number; reason: string }
      >;
    }>;
    dormant: Array<{
      name: string;
      role: string;
      aliases: string[];
      personality: string;
      motivation: string;
    }>;
  }): string {
    const ROLE_LABEL: Record<string, string> = {
      PROTAGONIST: '主角',
      ANTAGONIST: '反派',
      SUPPORTING: '配角',
    };
    const STATE_LABEL: Record<string, string> = {
      personality: '性格',
      emotion: '情绪',
      ability: '能力',
      status: '状态',
      knowledge: '认知',
      relationship: '关系',
      background: '背景',
      other: '其他',
    };
    const lines: string[] = [];
    if (cast.active.length) {
      lines.push('【角色档案 · 活跃】(写涉及他们时以这些设定为准)');
      for (const c of cast.active) {
        const head = `- ${c.name}(${ROLE_LABEL[c.role] ?? c.role})${
          c.aliases.length ? ` [别名:${c.aliases.join('/')}]` : ''
        }`;
        const profile = [
          c.faction && `阵营:${c.faction}`,
          c.background && `背景:${c.background}`,
          c.appearance && `外貌:${c.appearance}`,
          c.personality && `性格基调:${c.personality}`,
          c.motivation && `动机:${c.motivation}`,
          c.arcGoal && `弧光目标:${c.arcGoal}`,
          c.voice && `语言风格:${c.voice}`,
        ]
          .filter(Boolean)
          .join(' | ');
        const stateEntries = Object.entries(c.currentState)
          .filter(([f]) => f !== 'appearance')
          .map(([f, s]) => `${STATE_LABEL[f] ?? f}=${s.value}`);
        const state = stateEntries.length
          ? ` | 当前态:${stateEntries.join(' | ')}`
          : '';
        lines.push(`${head}${profile ? ` | ${profile}` : ''}${state}`);
      }
    }
    if (cast.dormant.length) {
      lines.push(
        '【角色名册 · 沉默】(近期未出场;若要写他们,先 get_character 取最新档案)',
      );
      for (const c of cast.dormant) {
        const essence = [
          c.personality && `性格:${c.personality}`,
          c.motivation && `动机:${c.motivation}`,
        ]
          .filter(Boolean)
          .join('; ');
        const head = `- ${c.name}(${ROLE_LABEL[c.role] ?? c.role})${
          c.aliases.length ? ` [${c.aliases.join('/')}]` : ''
        }`;
        lines.push(essence ? `${head} — ${essence}` : head);
      }
    }
    return lines.join('\n');
  }
```

- [ ] **Step 4: 加新测试——slice 注入用例**

在 `context-assembler.service.spec.ts` 的 `describe('forSession')` 内、最后一个用例之后加：

```ts
    it('injects 【角色档案 · 活跃】+【角色名册 · 沉默】 slices when characters exist', async () => {
      const characters = {
        listForContext: jest.fn().mockResolvedValue({
          active: [
            {
              name: '沈砚', role: 'PROTAGONIST', aliases: ['沈少'], faction: '棺材铺',
              background: '', appearance: '青衫', personality: '外冷内热',
              motivation: '复仇', arcGoal: '放下', voice: '寡言',
              currentState: {
                status: { value: '被通缉', chapterOrder: 5, reason: '' },
              },
            },
          ],
          dormant: [
            {
              name: '老陈', role: 'SUPPORTING', aliases: [],
              personality: '隐忍', motivation: '护主',
            },
          ],
        }),
      } as unknown as CharacterService;
      const svc = new ContextAssembler(
        {
          novel: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'nid-c', title: 'T', genre: null, synopsis: null,
              settings: {}, status: 'ACTIVE',
            }),
          },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: 5 } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        characters,
      );
      const { prompt } = await svc.forSession('u1', 's-c');
      expect(prompt).toContain('【角色档案 · 活跃】');
      expect(prompt).toContain('沈砚(主角)');
      expect(prompt).toContain('动机:复仇');
      expect(prompt).toContain('当前态:状态=被通缉');
      expect(prompt).toContain('【角色名册 · 沉默】');
      expect(prompt).toContain('老陈(配角)');
    });

    it('does not inject character slice when there are no characters', async () => {
      // 默认 stubCharacters 返回 {active:[],dormant:[]}
      const svc = new ContextAssembler(
        {
          novel: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'nid-e', title: 'T', genre: null, synopsis: null,
              settings: {}, status: 'ACTIVE',
            }),
          },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
      );
      const { prompt } = await svc.forSession('u1', 's-e');
      expect(prompt).not.toContain('【角色档案 · 活跃】');
      expect(prompt).not.toContain('【角色名册 · 沉默】');
    });
```

- [ ] **Step 5: 跑测试确认全通过**

Run: `pnpm --dir server test -- context-assembler.service.spec.ts`
Expected: PASS（含原有 8 用例改造后 + 2 个新用例）

- [ ] **Step 6: 提交**

```bash
git add server/src/agentos/context-assembler.service.ts server/src/agentos/context-assembler.service.spec.ts
git commit -m "feat(assembler): 注入角色分层 slice(活跃全档案+沉默名册)——长篇不丢设定"
```

---

## Task 3: `get_characters` 工具字段对齐

**Files:**
- Modify: `server/src/agentos/tools/get-characters.tool.ts`

- [ ] **Step 1: 补全 projection**

把 `get-characters.tool.ts` 里 `list.map((c) => ({ ... }))` 改为包含全部 profile 字段：

```ts
      return {
        characters: list.map((c) => ({
          name: c.name,
          role: c.role,
          aliases: c.aliases,
          faction: c.faction,
          background: c.background,
          appearance: c.appearance,
          personality: c.personality,
          motivation: c.motivation,
          arcGoal: c.arcGoal,
          voice: c.voice,
          currentState: c.currentState,
        })),
      };
```

- [ ] **Step 2: typecheck 确认**

Run: `pnpm --dir server typecheck`
Expected: PASS（无报错）

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/tools/get-characters.tool.ts
git commit -m "feat(tools): get_characters 返回全 profile 字段(对齐 get_character)"
```

---

## Task 4: 前端角色面板渲染档案字段

**Files:**
- Modify: `agent-ui/src/components/workspace/ResourcePanel.tsx`（`FIELD_LABEL` 之后加 `PROFILE_FIELDS`；重写 `CharactersView` 角色卡渲染）

- [ ] **Step 1: 加 `PROFILE_FIELDS` 常量**

在 `ResourcePanel.tsx` 的 `FIELD_LABEL`（约 line 670-679）之后新增：

```ts
const PROFILE_FIELDS: Array<{
  key: 'appearance' | 'personality' | 'motivation' | 'arcGoal' | 'voice' | 'faction' | 'background'
  label: string
  long?: boolean
}> = [
  { key: 'appearance', label: '外貌', long: true },
  { key: 'personality', label: '性格基调' },
  { key: 'motivation', label: '动机' },
  { key: 'arcGoal', label: '弧光目标', long: true },
  { key: 'voice', label: '语言风格' },
  { key: 'faction', label: '阵营' },
  { key: 'background', label: '背景', long: true }
]
```

- [ ] **Step 2: 重写角色卡渲染（折叠态 essence + 展开态三段）**

在 `CharactersView` 内，把当前角色卡里 `{items.map((c) => { const isOpen = ... return ( <div ...> ... </div> ) })}` 这一段（从 `const isOpen = openName === c.name` 到对应 `</div>` 闭合）替换为下面这段。关键变化：折叠态改显示 essence 行（替换原 currentState 预览）；展开态三段「档案 / 当前态 / 变化时间线」。

```tsx
                {items.map((c) => {
                  const isOpen = openName === c.name
                  const stateEntries = Object.entries(c.currentState).filter(
                    ([f]) => f !== 'appearance'
                  )
                  const essence = [
                    c.personality && `性格基调:${c.personality}`,
                    c.motivation && `动机:${c.motivation}`
                  ].filter(Boolean)
                  return (
                    <div
                      key={c.id}
                      className="rounded border border-primary/10 bg-background px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenName((cur) => (cur === c.name ? null : c.name))
                        }
                        className="flex w-full items-center justify-between text-left"
                      >
                        <span className="text-sm text-primary">{c.name}</span>
                        <span className="text-xs text-muted">
                          {c.aliases.length > 0 && `${c.aliases.join('/')} · `}
                          {isOpen ? '▼' : '▶'}
                        </span>
                      </button>
                      {/* 折叠态:essence 一行(身份速览) */}
                      {!isOpen && essence.length > 0 && (
                        <p className="mt-1 text-xs text-muted">{essence.join(' · ')}</p>
                      )}
                      {isOpen && (
                        <div className="mt-2 space-y-2 border-t border-primary/10 pt-2">
                          {/* 完整档案(char-writer 建的稳定身份) */}
                          {PROFILE_FIELDS.some((f) => c[f.key]) ? (
                            <div className="space-y-1">
                              <p className="text-xs uppercase text-muted/70">档案</p>
                              {PROFILE_FIELDS.map((f) => {
                                const val = c[f.key]
                                if (!val) return null
                                return f.long ? (
                                  <div key={f.key} className="text-xs">
                                    <span className="text-primary/70">{f.label}</span>
                                    <div className="prose prose-invert max-w-none pt-0.5 text-primary">
                                      <MarkdownRenderer>{val}</MarkdownRenderer>
                                    </div>
                                  </div>
                                ) : (
                                  <p key={f.key} className="text-xs">
                                    <span className="text-primary/70">{f.label}:</span>{' '}
                                    <span className="text-primary">{val}</span>
                                  </p>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted/50">
                              档案尚未建立(char-writer 建档后显示)
                            </p>
                          )}
                          {/* 当前态(派生) */}
                          {stateEntries.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-xs uppercase text-muted/70">当前态</p>
                              {stateEntries.map(([field, s]) => (
                                <p key={field} className="text-xs text-muted">
                                  <span className="text-primary/70">
                                    {FIELD_LABEL[field] ?? field}
                                  </span>
                                  :{s.value}
                                  <span className="text-muted/50">
                                    {' '}
                                    (第{s.chapterOrder}章)
                                  </span>
                                </p>
                              ))}
                            </div>
                          )}
                          {/* 变化时间线 */}
                          <div className="space-y-0.5">
                            <p className="text-xs uppercase text-muted/70">
                              变化时间线
                            </p>
                            {c.changes.length === 0 ? (
                              <p className="text-xs text-muted">暂无变化记录</p>
                            ) : (
                              c.changes
                                .slice()
                                .reverse()
                                .map((ch, i) => (
                                  <div key={i} className="text-xs">
                                    <span className="text-muted/50">
                                      第{ch.chapterOrder}章
                                    </span>{' '}
                                    <span className="text-primary/70">
                                      {FIELD_LABEL[ch.field] ??
                                        ch.field.split(':')[0]}
                                    </span>
                                    :
                                    <span className="text-primary">{ch.value}</span>
                                    {ch.reason && (
                                      <span className="text-muted/50">
                                        {' '}
                                        ({ch.reason})
                                      </span>
                                    )}
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
```

- [ ] **Step 3: 质量门**

Run: `pnpm --dir agent-ui validate`
Expected: PASS（lint + format + typecheck 全过；若 format 报风格差异，先 `pnpm --dir agent-ui format:fix` 再 validate）

- [ ] **Step 4: 提交**

```bash
git add agent-ui/src/components/workspace/ResourcePanel.tsx
git commit -m "feat(agent-ui): 角色面板渲染档案字段(外貌/性格/动机/弧光/语言风格/阵营/背景)"
```

---

## Task 5: 全量验证 + 文档更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: server 全量测试**

Run: `pnpm --dir server test`
Expected: 全部 PASS

- [ ] **Step 2: agent-ui 全量验证**

Run: `pnpm --dir agent-ui validate`
Expected: PASS

- [ ] **Step 3: 更新 CLAUDE.md**

在 `CLAUDE.md` 的 `ContextAssembler` 描述段（"returns `{ prompt, novelId }`..."那句）里，把注入 slice 列表从 `【前情】... + 【未回收伏笔】...` 更新为含【角色】：提到现在注入【世界观】【角色(活跃全档案+沉默名册)】【前情】【未回收伏笔】【写作参考】。

在 `### Phase status` 末尾「Deferred」列表里，删除「FE character panel display of the new profile fields」这一项（已完成），并新增一条 Phase 记录（Phase 6 / character-context）：角色分层上下文注入 + 面板档案渲染 + `get_characters` 对齐；手编/删除明确不做（agent 单一作者）。指向本 spec 与 plan。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 更新角色 slice 注入 + 面板档案渲染(Phase 6)"
```

---

## Self-Review（写完后自查，已通过）

- **Spec 覆盖**：核心注入（Task 1+2）✅；前端渲染（Task 4）✅；get_characters 对齐（Task 3）✅；非目标（手编/删除/锁定/critic）明确不做 ✅；无 DB 迁移 ✅。
- **类型一致**：`listForContext` 返回签名 = `buildCharacterSlice` 入参签名 = 测试 mock 形状，三者字段一致（role/aliases/faction/background/appearance/personality/motivation/arcGoal/voice/currentState；dormant 子集）。`PROFILE_FIELDS.key` 限定为 7 个 string 字段，与 `Character` 类型吻合。
- **无占位符**：每个 step 都有完整代码/命令/预期。

# 工具返回瘦身 实施计划

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** get_characters → lean(name/role/aliases/currentState,封顶 30);get_outline → 未写计划 + writtenCount;参考资料 slice 加「按需、勿盲查」脚注。

**Spec:** [2026-06-29-tool-return-slim-design.md](../specs/2026-06-29-tool-return-slim-design.md)

---

## Task 1:get_characters lean + spec

**Files:**
- Modify: `server/src/agentos/tools/get-characters.tool.ts`
- Create: `server/src/agentos/tools/get-characters.tool.spec.ts`

- [ ] **Step 1: 写测试**

Create `server/src/agentos/tools/get-characters.tool.spec.ts`:
```ts
import { makeGetCharactersTool } from './get-characters.tool';
import type { CharacterService } from '../../novel/character.service';

describe('get_characters tool', () => {
  it('返回 lean(name/role/aliases/currentState),不带稳定档案', async () => {
    const listCharacters = jest.fn().mockResolvedValue([
      {
        name: '沈砚', role: 'PROTAGONIST', aliases: ['沈少'],
        faction: '棺材铺', background: '少掌柜', appearance: '青衫',
        personality: '外冷内热', motivation: '复仇', arcGoal: '放下', voice: '寡言',
        currentState: { status: { value: '被通缉', chapterOrder: 5, reason: '' } },
      },
    ]);
    const characters = { listCharacters } as unknown as CharacterService;
    const t = makeGetCharactersTool({ userId: 'u1', novelId: 'n1', characters });

    const out = await t.invoke({});

    expect(listCharacters).toHaveBeenCalledWith('u1', 'n1', undefined);
    expect(out.characters).toHaveLength(1);
    const c = out.characters[0];
    expect(c).toMatchObject({ name: '沈砚', role: 'PROTAGONIST', aliases: ['沈少'] });
    expect(c.currentState).toEqual({
      status: { value: '被通缉', chapterOrder: 5, reason: '' },
    });
    // lean:不带稳定档案字段
    expect(c).not.toHaveProperty('personality');
    expect(c).not.toHaveProperty('motivation');
    expect(c).not.toHaveProperty('appearance');
  });

  it('超 30 截断 + 提示', async () => {
    const all = Array.from({ length: 40 }, (_, i) => ({
      name: `角色${i}`, role: 'SUPPORTING', aliases: [], currentState: {},
    }));
    const listCharacters = jest.fn().mockResolvedValue(all);
    const characters = { listCharacters } as unknown as CharacterService;
    const t = makeGetCharactersTool({ userId: 'u1', novelId: 'n1', characters });

    const out = await t.invoke({});

    expect(out.characters).toHaveLength(30);
    expect(out.note).toContain('40');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- get-characters.tool.spec.ts`
Expected: FAIL(返回了全档案、未截断)。

- [ ] **Step 3: 实现 lean**

`get-characters.tool.ts` 把 tool 回调 + map 改为:
```ts
  return tool(
    async ({ role }) => {
      const list = await characters.listCharacters(userId, novelId, role);
      const CAP = 30;
      const head = list.slice(0, CAP).map((c) => ({
        name: c.name,
        role: c.role,
        aliases: c.aliases,
        currentState: c.currentState,
      }));
      return {
        characters: head,
        ...(list.length > CAP
          ? { note: `共 ${list.length} 个,仅显示前 ${CAP};用 role 过滤或 get_character(name) 读稳定档案` }
          : {}),
      };
    },
    {
      name: 'get_characters',
      description:
        '列出角色 lean(名字+定位+别名+当前态,封顶30)。稳定档案(外貌/性格/动机/弧光/语言风格)用 get_character(name) 单查。场景规划/一致性核对时调用。',
      schema: z.object({
        role: z
          .enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'])
          .optional()
          .describe('只列某定位;省略列全部(超30截断)'),
      }),
    },
  );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- get-characters.tool.spec.ts`
Expected: PASS(2)。

- [ ] **Step 5: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/tools/get-characters.tool.ts server/src/agentos/tools/get-characters.tool.spec.ts
git -C /Users/taowen/project/narratox commit -m "feat(tool): get_characters 返回 lean(名字+当前态,封顶30),稳定档案走 get_character"
```

---

## Task 2:get_outline 未写计划 + spec

**Files:**
- Modify: `server/src/agentos/tools/get-outline.tool.ts`、`server/src/agentos/tools/get-outline.tool.spec.ts`

- [ ] **Step 1: 改测试断言**

`get-outline.tool.spec.ts`:把 `expect(out.chapters)...` 段改为断言「未写过滤 + writtenCount」。原数据 ch1=WRITTEN、ch2=DRAFT,期望 chapters 只含 ch2、writtenCount=1:
```ts
    // chapters 只含未写计划(DRAFT/APPROVED);已写算进 writtenCount
    expect(out.chapters).toEqual([
      { chapterOrder: 2, title: '夜雨', status: 'DRAFT' },
    ]);
    expect(out.writtenCount).toBe(1);
    expect(out.nextChapterOrder).toBe(2);
```
(删掉原来断言 ch1 在 chapters 的那行。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- get-outline.tool.spec.ts`
Expected: FAIL(chapters 仍含 WRITTEN 的 ch1;无 writtenCount)。

- [ ] **Step 3: 实现**

`get-outline.tool.ts` 把 `chapters` 段改为:
```ts
        chapters: chapterOutlines
          .filter((c) => c.status !== 'WRITTEN')
          .map((c) => ({ chapterOrder: c.chapterOrder, title: c.title, status: c.status })),
        writtenCount: chapterOutlines.filter((c) => c.status === 'WRITTEN').length,
```
description 补「chapters 仅未写计划(DRAFT/APPROVED);已写见 writtenCount,单章 get_chapter/get_chapter_plan」。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- get-outline.tool.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/tools/get-outline.tool.ts server/src/agentos/tools/get-outline.tool.spec.ts
git -C /Users/taowen/project/narratox commit -m "feat(tool): get_outline chapters 改未写计划(to-do)+ writtenCount,已写不重复列"
```

---

## Task 3:参考资料 slice 按需脚注 + spec

**Files:**
- Modify: `server/src/agentos/reference-slice.ts`、`server/src/agentos/reference-slice.spec.ts`

- [ ] **Step 1: 改测试断言含脚注**

`reference-slice.spec.ts` 在「命中本角色精要」用例里加:
```ts
    expect(s).toContain('get_reference');
    expect(s).toContain('勿查'); // 按需、勿盲查提示
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- reference-slice.spec.ts`
Expected: FAIL(无脚注)。

- [ ] **Step 3: 实现脚注**

`reference-slice.ts` 的 `buildReferenceSlice` 返回值末尾改为:
```ts
  return `【写作参考】\n索引:\n${index}\n\n精要:\n${body}\n（仅当写到上述索引明确指向的场景,才 get_reference(title) 拉那条;否则勿查）`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- reference-slice.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/reference-slice.ts server/src/agentos/reference-slice.spec.ts
git -C /Users/taowen/project/narratox commit -m "feat(reference): 精要 slice 加按需脚注(写到索引指向场景才 get_reference)"
```

---

## Task 4:全量回归 + CLAUDE.md

- [ ] **Step 1: 全量回归**
Run: `pnpm --dir server test && pnpm --dir server typecheck`
Expected: 全绿。

- [ ] **Step 2: CLAUDE.md** —— Phase 19 末尾补一句工具层瘦身(同条追加,不新开 phase,因属同一上下文治理倡议):
在 Phase 19 条末尾(`Spec/Plan` 链接前)补:
```
后续工具层瘦身:get_characters 返回 lean(name/role/aliases/currentState,封顶 30,稳定档案走 get_character);get_outline 的 chapters 改未写计划(DRAFT/APPROVED)+ writtenCount(已写不重复列,FE 走 REST 全量不受影响);参考资料 slice 加「按需、勿盲查」脚注。Spec: [2026-06-29-tool-return-slim-design.md](docs/superpowers/specs/2026-06-29-tool-return-slim-design.md). Plan: [2026-06-29-tool-return-slim.md](docs/superpowers/plans/2026-06-29-tool-return-slim.md).
```

- [ ] **Step 3: 提交 CLAUDE.md**

```bash
git -C /Users/taowen/project/narratox add CLAUDE.md
git -C /Users/taowen/project/narratox commit -m "docs: CLAUDE.md Phase19 补工具层瘦身(get_characters/get_outline/参考按需)"
```

---

## Self-Review
- get_characters lean → Task 1;get_outline 未写 → Task 2;参考脚注 → Task 3;不动 listCharacters/listOutline(FE 全量)、DB、FE、prompt → 显式。✅
- 一致性:lean 字段 Task1 定义/Task1 spec 消费;chapters 过滤 Task2 定义/Task2 spec 消费;脚注 Task3 定义/Task3 spec 消费。✅

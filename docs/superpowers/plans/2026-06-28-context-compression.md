# 上下文压缩 实施计划

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** main 的角色/世界观/伏笔 slice 压成索引+简述(按需 tool 拉详情),直击线性膨胀。

**Spec:** [2026-06-28-context-compression-design.md](../specs/2026-06-28-context-compression-design.md)

**Architecture:** `CharacterService.listIndex`(lean name+role)+ `getCharacter` 别名感知;ContextAssembler 三 slice 重写(角色索引/世界观 80 字简述/伏笔核心+近期+计数);删旧 `listForContext`/`buildCharacterSlice`/`ContextCharacter*`。

---

## Task 1:CharacterService — listIndex + 别名感知 + 删 listForContext

**Files:** `server/src/novel/character.service.ts`

- [ ] **Step 1: 删 `ContextCharacterActive`/`ContextCharacterDormant` 接口 + `listForContext` 方法**(整段,约 `:11-36` 与 `:195-258`),替换为:

```ts
/** 角色索引(main 常驻用):只 name+role,lean 查询,不拉 profile/changes。 */
export interface CharacterIndexEntry {
  name: string;
  role: string;
}

  /** 列角色索引(name+role),按 role→name 排序。供 ContextAssembler 注入【角色】索引。 */
  async listIndex(
    userId: string,
    novelId: string,
  ): Promise<CharacterIndexEntry[]> {
    await this.assertOwned(userId, novelId);
    return this.prisma.character.findMany({
      where: { novelId, novel: { userId } },
      select: { name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }
```

- [ ] **Step 2: `getCharacter` 别名感知**

把 `getCharacter`(约 `:153`)的 `findFirst` where 改为:
```ts
    const ch = await this.prisma.character.findFirst({
      where: {
        novelId,
        novel: { userId },
        OR: [{ name }, { aliases: { has: name } }],
      },
      include: {
        changes: { orderBy: { chapterOrder: 'desc' }, take: 50 },
      },
    });
```
(注释:正文常用别名;别名命中也返回,canonical 名优先因 `OR` 顺序 + findFirst。)

- [ ] **Step 3: typecheck**

Run: `pnpm --dir server typecheck`
Expected:ContextAssembler 引用 `listForContext`/`ContextCharacter*` 报错(下一 Task 修)。

- [ ] **Step 4: 暂不提交**(随 Task 3 一起,避免中间态编译不过)。

---

## Task 2:character.service.spec — 换用例

**Files:** `server/src/novel/character.service.spec.ts`

- [ ] **Step 1: 删 `describe('listForContext')` 整块,替换为:**

```ts
  describe('listIndex', () => {
    it('返回 name+role 索引(lean,不带 changes)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findMany.mockResolvedValue([
        { name: '沈砚', role: 'PROTAGONIST' },
        { name: '陆青棠', role: 'SUPPORTING' },
      ]);
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const idx = await svc.listIndex('u1', 'n1');
      expect(idx).toEqual([
        { name: '沈砚', role: 'PROTAGONIST' },
        { name: '陆青棠', role: 'SUPPORTING' },
      ]);
      // lean:select 只取 name+role
      expect(prisma.character.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { name: true, role: true } }),
      );
    });
  });

  describe('getCharacter (别名解析)', () => {
    it('canonical 名直传命中', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({
        id: 'c1', name: '沈砚', role: 'PROTAGONIST', aliases: ['沈少'],
        changes: [],
      });
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const ch = await svc.getCharacter('u1', 'n1', '沈砚');
      expect(ch).not.toBeNull();
      expect(ch!.name).toBe('沈砚');
    });

    it('传别名也能命中(OR aliases has)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({
        id: 'c1', name: '沈砚', role: 'PROTAGONIST', aliases: ['沈少'],
        changes: [],
      });
      const svc = new CharacterService(prisma as unknown as PrismaService);
      const ch = await svc.getCharacter('u1', 'n1', '沈少');
      expect(prisma.character.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ name: '沈少' }, { aliases: { has: '沈少' } }],
          }),
        }),
      );
      expect(ch).not.toBeNull();
      expect(ch!.name).toBe('沈砚');
    });
  });
```
> 注:`getCharacter` 原用例(getCharacter 返回 currentState)保留——它 mock 的 findFirst 不依赖 where 形状,仍通过。

- [ ] **Step 2: 跑测试**

Run: `pnpm --dir server test -- character.service.spec.ts`
Expected:PASS(listIndex + getCharacter 别名 + 原有 upsert/findOrCreate/recordChanges/getCharacter/listCharacters)。

- [ ] **Step 3: 暂不提交**。

---

## Task 3:ContextAssembler — 三 slice 重写 + 删 buildCharacterSlice

**Files:** `server/src/agentos/context-assembler.service.ts`

- [ ] **Step 1: import 改**(约 `:14-21`):把
```ts
import {
  CharacterService,
  ContextCharacterActive,
  ContextCharacterDormant,
} from '../novel/character.service';
```
改为:
```ts
import { CharacterService } from '../novel/character.service';
```

- [ ] **Step 2: 角色取数据改**(约 `:133-138`):把 `listForContext(...)` 调用改为
```ts
    const charIndex = await this.characters.listIndex(userId, novel.id);
```

- [ ] **Step 3: 世界观 slice 改简述**(约 `:193-198`):把
```ts
    if (coreWorld.length) {
      slices.push(
        `【世界观】${coreWorld.map((e) => `${e.name}:${e.content}`).join(' / ')}`,
      );
    }
```
改为:
```ts
    if (coreWorld.length) {
      // 每条简述(80 字),全文 get_world_entry(name) 拉。main 是编排者,不需全文。
      const briefs = coreWorld
        .map((e) => `${e.name}:${(e.content ?? '').slice(0, 80)}`)
        .join(' / ');
      slices.push(
        `【世界观】${briefs}(get_world_entry(name) 查全文)`,
      );
    }
```

- [ ] **Step 4: 角色 slice 改索引**(约 `:199-202`):把
```ts
    if (cast.active.length || cast.dormant.length) {
      slices.push(this.buildCharacterSlice(cast));
    }
```
改为:
```ts
    if (charIndex.length) {
      slices.push(this.buildCharacterIndexSlice(charIndex));
    }
```

- [ ] **Step 5: 伏笔 slice 封顶**(约 `:221-241`):把整段 `if (openHooks.length) {...}` 改为:
```ts
    if (openHooks.length) {
      // 封顶:核心★全留 + 非核心 active top5 + 其余计数 stub(详情 get_events)。
      const core = openHooks.filter((h) => h.coreHook);
      const stale = openHooks.filter((h) => h.stale);
      const active = openHooks.filter((h) => !h.coreHook && !h.stale);
      const parts: string[] = [];
      if (core.length)
        parts.push(`核心★:${core.map((h) => h.description).join('、')}`);
      if (active.length)
        parts.push(
          `进行中(近):${active
            .slice(0, 5)
            .map((h) => h.description)
            .join('、')}`,
        );
      const restCount =
        openHooks.length - core.length - Math.min(active.length, 5);
      if (restCount > 0 || stale.length)
        parts.push(
          `另有${restCount + stale.length}个开放${stale.length ? `(⚠️${stale.length}陈久)` : ''},get_events 查询`,
        );
      slices.push(`【未回收伏笔】${parts.join(' · ')}`);
    }
```

- [ ] **Step 6: 删 `buildCharacterSlice` 方法,加 `buildCharacterIndexSlice`**(替换原 `:259-...` 整个 buildCharacterSlice):
```ts
  /** 拼角色索引 slice:name(role) 逗号分隔 + tool 指引;超 N 截断计数。 */
  private buildCharacterIndexSlice(
    chars: { name: string; role: string }[],
  ): string {
    const ROLE_LABEL: Record<string, string> = {
      PROTAGONIST: '主角',
      ANTAGONIST: '反派',
      SUPPORTING: '配角',
    };
    const CAP = 40;
    const head = chars
      .slice(0, CAP)
      .map((c) => `${c.name}(${ROLE_LABEL[c.role] ?? c.role})`)
      .join('、');
    const tail =
      chars.length > CAP ? `…(共${chars.length}个,` : '(';
    return `【角色】${head}${tail}写涉及某角色前 get_character(name) 读档案+当前态,get_characters 列查询)`;
  }
```

- [ ] **Step 7: typecheck + test**(此时 Task1+2+3 一起验)
Run: `pnpm --dir server typecheck && pnpm --dir server test -- character.service context-assembler`
Expected:typecheck 过;character 用例过;context-assembler 用例**角色 slice 断言失败**(下一 Task 修)。

---

## Task 4:context-assembler specs — 更新 mock + 断言

**Files:** `server/src/agentos/context-assembler.service.spec.ts`、`context-assembler.memory.spec.ts`

- [ ] **Step 1: `context-assembler.service.spec.ts` 的 stubCharacters**(约 `:25-27`):
```ts
const stubCharacters = {
  listForContext: jest.fn().mockResolvedValue({ active: [], dormant: [] }),
} as unknown as CharacterService;
```
改为:
```ts
const stubCharacters = {
  listIndex: jest.fn().mockResolvedValue([]),
} as unknown as CharacterService;
```

- [ ] **Step 2: 角色注入用例**(约 `:277-337`,`injects 【角色档案 · 活跃】...`):把 mock 从 `listForContext: {active:[...], dormant:[...]}` 改为 `listIndex: [{name,role}]`,断言改为索引:
```ts
    it('injects 【角色】 names+role 索引 when characters exist', async () => {
      const characters = {
        listIndex: jest.fn().mockResolvedValue([
          { name: '沈砚', role: 'PROTAGONIST' },
          { name: '老陈', role: 'SUPPORTING' },
        ]),
      } as unknown as CharacterService;
      // ... new ContextAssembler(..., characters) (第 10 参)
      const { prompt } = await svc.forSession('u1', 's-c');
      expect(prompt).toContain('【角色】');
      expect(prompt).toContain('沈砚(主角)');
      expect(prompt).toContain('老陈(配角)');
      expect(prompt).toContain('get_character(name)');
      // 不再注入全档案
      expect(prompt).not.toContain('【角色档案 · 活跃】');
    });

    it('does not inject character slice when there are no characters', async () => {
      // 默认 stubCharacters.listIndex → []
      const svc = new ContextAssembler(/* ...10 参, 最后 stubCharacters */);
      const { prompt } = await svc.forSession('u1', 's-e');
      expect(prompt).not.toContain('【角色】');
    });
```
> 原「does not inject character slice」用例:listIndex 返 [] → `charIndex.length` 假 → 不注。断言 `not.toContain('【角色】')`。

- [ ] **Step 3: `context-assembler.memory.spec.ts` 的 stubCharacters**(约 `:18-20`)同样改 `listIndex`。

- [ ] **Step 4: typecheck + 全量 test**
Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected:全绿。

---

## Task 5:提交 + CLAUDE.md

- [ ] **Step 1: 提交**(一个 commit,含 Task1-4)
```bash
git -C /Users/taowen/project/narratox add server/src/novel/character.service.ts server/src/novel/character.service.spec.ts server/src/agentos/context-assembler.service.ts server/src/agentos/context-assembler.service.spec.ts server/src/agentos/context-assembler.memory.spec.ts
git -C /Users/taowen/project/narratox commit -m "feat(context): 压缩角色/世界观/伏笔 slice 为索引+按需加载(防 token 爆炸)"
```

- [ ] **Step 2: CLAUDE.md** Phase 19 条(在 Phase 18 后;Phase 18 去 current):
```markdown
- **Phase 19 (上下文压缩, current):** main 的三个线性膨胀 slice 改为索引/简述 + 按需 tool 拉详情——**【角色】**从「活跃全档案+沉默名册」(`listForContext`,无界)压成 `name(role)` 逗号索引(`CharacterService.listIndex`,lean name+role,超 40 截断计数);**【世界观】**每条 `content` 截 80 字简述(全文 `get_world_entry` 拉);**【未回收伏笔】**核心★全留+非核心 top5+其余计数(详情 `get_events`)。**`getCharacter` 改别名感知**(`OR aliases has`),正文叫别名也能解析到 canonical——压缩后 writer 更依赖拉取,解析缺口必须补。删 `listForContext`/`buildCharacterSlice`/`ContextCharacter*`(全档案注入反模式)。**效果保证**:writer 本就 tool 拉,validator dim1 拿全量 bible 复检兜底(Phase 7),故激进压缩不损一致性。**零 DB/FE/subagent 改动**;不动已封顶 slice(总纲/态势/弧线/前情/近期事件)。Spec: [2026-06-28-context-compression-design.md](docs/superpowers/specs/2026-06-28-context-compression-design.md). Plan: [2026-06-28-context-compression.md](docs/superpowers/plans/2026-06-28-context-compression.md).
```

- [ ] **Step 3: 全量回归** `pnpm --dir server test && pnpm --dir server typecheck` → 提交 CLAUDE.md。

---

## Self-Review
- 角色索引 + 别名解析 → Task 1;三 slice 压缩 → Task 3;测试同步 → Task 2/4;删旧反模式 → Task 1/3;不动 writer/validator/DB/FE → 显式。✅
- 一致性:`listIndex` Task1 定义 / Task3 消费;`buildCharacterIndexSlice` Task3 定义+消费;stubCharacters `listIndex` Task4 三处(spec×2+memory×1)。✅

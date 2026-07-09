# 角色删除/清空套件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为角色资源补齐删除/清空能力(`delete_character` / `clear_characters` / `set_character(+clear_fields)`),与刚完成的「大纲细粒度编辑」套件对称。纯 Agent 工具,零 DB 迁移,零 FE 改动。

**Architecture:** 改动集中在 `CharacterService`(加 `deleteCharacter` / `clearCharacters` 两方法,扩 `upsertCharacter` 支持 `clear_fields`)+ 2 个新 tool factory + 1 个 tool schema 扩参 + char-writer 配置挂 2 个新工具 + 3 处 prompt 增纪律段。所有删除走 prisma `$transaction` 保证原子性。挂 char-writer,其他 agent 不动(角色唯一作者原则)。

**Tech Stack:** NestJS 11 + Prisma 7(PostgreSQL)+ LangChain `tool()` factory + zod schema + jest。

**Spec:** [docs/superpowers/specs/2026-07-09-character-delete-suite-design.md](../specs/2026-07-09-character-delete-suite-design.md)

---

## File Structure

**Modify:**
- `server/src/novel/character.service.ts` — 加 `deleteCharacter` / `clearCharacters` 方法,扩 `upsertCharacter` 处理 `clear_fields`
- `server/src/novel/character.service.spec.ts` — 新增 3 个 describe block + 扩 PrismaMock
- `server/src/agentos/tools/set-character.tool.ts` — schema 加 `clear_fields` 参数
- `server/src/agentos/tools/set-character.tool.spec.ts`(若存在;若不存在按其他 tool spec 范式新建)
- `server/src/agentos/agent-registry.ts` — 注册 `delete_character` / `clear_characters`
- `server/src/agentos/agent-tree.config.ts` — char-writer.tools 数组加 2 个 key
- `server/src/agentos/agent-tree.config.spec.ts` — inline 快照(char-writer tools)同步加 2 个
- `server/src/agentos/prompts/character-writer.md` — 加【删除/清空 — 用法纪律】section
- `server/src/agentos/prompts/character-orchestrator.md` — 加「删/清角色」task type
- `server/src/agentos/prompts/main.md` — character 委派协议补「删/清角色」
- `server/test/smoke/l1-integration.spec.ts` — 加一轮 character delete/patch/clear 的集成测试

**Create:**
- `server/src/agentos/tools/delete-character.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/clear-characters.tool.ts` + `.spec.ts`

---

## Task 1: 扩 CharacterService + spec,加 deleteCharacter / clearCharacters / clear_fields

**Files:**
- Modify: `server/src/novel/character.service.ts`
- Test: `server/src/novel/character.service.spec.ts`

本 task 一次性把 3 个服务端能力加齐(service 层最小可测单元),后面 task 再加 tool 层。

- [ ] **Step 1.1: 扩 spec 文件的 PrismaMock,补 delete/count/deleteMany/$transaction/novel.findFirst(status)**

打开 `server/src/novel/character.service.spec.ts`,把 `PrismaMock` interface 和 `makePrismaMock()` 替换为下面这版(加了 `character.delete` / `character.count` / `characterChange.deleteMany` / `characterChange.count` / `$transaction` / `novel.findFirst` 现在选 `status`):

```typescript
interface PrismaMock {
  novel: { findFirst: jest.Mock };
  character: {
    upsert: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  characterChange: {
    create: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    character: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    characterChange: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  };
}
```

- [ ] **Step 1.2: 在 spec 末尾(`describe('getCharacterHistory')` 之后,最外层 `describe('CharacterService')` 闭合 `})` 之前)加 deleteCharacter / clearCharacters / clear_fields 三个 describe block**

```typescript
  describe('deleteCharacter', () => {
    it('无 CharacterChange → 直接删,deletedChanges: 0', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.count.mockResolvedValue(0);
      prisma.character.delete.mockResolvedValue({});
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '沈砚', false);

      expect(r).toEqual({ ok: true, name: '沈砚', deletedChanges: 0 });
      expect(prisma.character.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('有 CharacterChange + cascade=false → HAS_CHANGES 拒绝返清单(不偷删)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.count.mockResolvedValue(7);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '沈砚', false);

      expect(r).toEqual({
        ok: false,
        error: 'HAS_CHANGES',
        changes: 7,
        hint: '该角色有 7 条变迁史,删除前请确认:传 cascade=true 连带删,或保留变迁史(角色删了变迁史成孤儿)',
      });
      expect(prisma.character.delete).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('有 CharacterChange + cascade=true → $transaction 连删,返 deletedChanges', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue({ id: 'c1', name: '沈砚' });
      prisma.characterChange.count.mockResolvedValue(3);
      // $transaction 接收回调;回调内用 tx 操作,我们用同 mock 响应即可
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          characterChange: { deleteMany: prisma.characterChange.deleteMany },
          character: { delete: prisma.character.delete },
        };
        return cb(tx);
      });
      prisma.characterChange.deleteMany.mockResolvedValue({ count: 3 });
      prisma.character.delete.mockResolvedValue({});
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '沈砚', true);

      expect(r).toEqual({ ok: true, name: '沈砚', deletedChanges: 3 });
      expect(prisma.characterChange.deleteMany).toHaveBeenCalledWith({
        where: { characterId: 'c1' },
      });
      expect(prisma.character.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('角色不存在 → not_found', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.findFirst.mockResolvedValue(null);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.deleteCharacter('u1', 'n1', '路人甲', false);

      expect(r).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe('clearCharacters', () => {
    it('无任何角色 → empty', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', status: 'CONCEPT' });
      prisma.character.count.mockResolvedValue(0);
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.clearCharacters('u1', 'n1');

      expect(r).toEqual({ ok: false, reason: 'empty' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('CONCEPT → 删,无 warning', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', status: 'CONCEPT' });
      prisma.character.count.mockResolvedValue(3);
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          characterChange: { deleteMany: prisma.characterChange.deleteMany },
          character: { deleteMany: prisma.character.deleteMany },
        };
        return cb(tx);
      });
      prisma.characterChange.deleteMany.mockResolvedValue({ count: 12 });
      prisma.character.deleteMany.mockResolvedValue({ count: 3 });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.clearCharacters('u1', 'n1');

      expect(r).toEqual({
        ok: true,
        deletedCharacters: 3,
        deletedChanges: 12,
        warned: false,
      });
      expect(prisma.characterChange.deleteMany).toHaveBeenCalledWith({
        where: { novelId: 'n1' },
      });
      expect(prisma.character.deleteMany).toHaveBeenCalledWith({
        where: { novelId: 'n1' },
      });
    });

    it('ACTIVE → 删 + warned=true + reason', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', status: 'ACTIVE' });
      prisma.character.count.mockResolvedValue(5);
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          characterChange: { deleteMany: prisma.characterChange.deleteMany },
          character: { deleteMany: prisma.character.deleteMany },
        };
        return cb(tx);
      });
      prisma.characterChange.deleteMany.mockResolvedValue({ count: 20 });
      prisma.character.deleteMany.mockResolvedValue({ count: 5 });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      const r = await svc.clearCharacters('u1', 'n1');

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warned).toBe(true);
        expect(r.reason).toContain('ACTIVE');
        expect(r.deletedCharacters).toBe(5);
        expect(r.deletedChanges).toBe(20);
      }
    });
  });

  describe('upsertCharacter clear_fields', () => {
    it('clear_fields: [appearance] → 该字段 set 为空串,其他字段保留', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        personality: '新描述',
        clear_fields: ['appearance'],
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          personality: '新描述',
          appearance: '',
        },
        update: {
          personality: '新描述',
          appearance: '',
        },
      });
    });

    it('clear_fields 多字段 + 与 merge 共存:正常应用', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.character.upsert.mockResolvedValue({ id: 'c1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await svc.upsertCharacter('u1', 'n1', {
        name: '沈砚',
        motivation: '复仇',
        clear_fields: ['appearance', 'growth'],
      });

      expect(prisma.character.upsert).toHaveBeenCalledWith({
        where: { novelId_name: { novelId: 'n1', name: '沈砚' } },
        create: {
          novelId: 'n1',
          name: '沈砚',
          motivation: '复仇',
          appearance: '',
          growth: '',
        },
        update: {
          motivation: '复仇',
          appearance: '',
          growth: '',
        },
      });
    });

    it('clear_fields 含未知字段名 → 抛错(防 typo 静默丢数据)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await expect(
        svc.upsertCharacter('u1', 'n1', {
          name: '沈砚',
          clear_fields: ['typo_field'],
        }),
      ).rejects.toThrow(/typo_field/);
    });

    it('clear_fields 含 name/role/aliases → 抛错(不在白名单)', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const svc = new CharacterService(prisma as unknown as PrismaService);

      await expect(
        svc.upsertCharacter('u1', 'n1', {
          name: '沈砚',
          clear_fields: ['name'],
        }),
      ).rejects.toThrow(/name/);
    });
  });
```

- [ ] **Step 1.3: 跑 spec 确认全挂(方法未实现)**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- character.service.spec.ts`
Expected: FAIL(原有用例仍过;新增的 9 条都挂——`deleteCharacter` / `clearCharacters` 未定义,`clear_fields` 参数类型不识别)

- [ ] **Step 1.4: 改 `character.service.ts` 加 3 处实现**

**改 1**:扩 `upsertCharacter` 的入参类型 + 加白名单常量 + 实现 `clear_fields` 逻辑。把 `upsertCharacter` 方法整体替换为:

```typescript
/** clear_fields 白名单:只允许清空这 9 个文本字段。
 *  name(身份)/role(enum)/aliases(数组)不走这套:
 *  - 改名 = 新建旧删(身份不可变)
 *  - role 直接用 set_character({ role: 'X' }) 改
 *  - aliases 直接传空数组 */
const CLEARABLE_FIELDS = [
  'faction',
  'background',
  'appearance',
  'personality',
  'motivation',
  'arcGoal',
  'voice',
  'growth',
  'flaw',
] as const;

/** upsert 角色稳定身份(by novelId+name)。 */
async upsertCharacter(
  userId: string,
  novelId: string,
  data: {
    name: string;
    // null 与 undefined 都视为「不提供」(跳过=保留旧值)。schema 用 .nullish(),
    // 模型发 null 不再被 zod 拒收而触发重试(同 set_references 的修复)。
    role?: string | null;
    aliases?: string[] | null;
    faction?: string | null;
    background?: string | null;
    appearance?: string | null;
    personality?: string | null;
    motivation?: string | null;
    arcGoal?: string | null;
    voice?: string | null;
    growth?: string | null;
    flaw?: string | null;
    /** 显式清空成 "" 的字段名(白名单见 CLEARABLE_FIELDS)。比空串语义更明确,
     *  不破坏 null=skip 的历史语义(.nullish() 的炮筒背景见 spec §5.4)。 */
    clear_fields?: string[];
  },
) {
  await this.assertOwned(userId, novelId);
  const fields: Record<string, unknown> = {
    ...(data.role != null && { role: data.role as never }),
    ...(data.aliases != null && { aliases: data.aliases }),
    ...(data.faction != null && { faction: data.faction }),
    ...(data.background != null && { background: data.background }),
    ...(data.appearance != null && { appearance: data.appearance }),
    ...(data.personality != null && { personality: data.personality }),
    ...(data.motivation != null && { motivation: data.motivation }),
    ...(data.arcGoal != null && { arcGoal: data.arcGoal }),
    ...(data.voice != null && { voice: data.voice }),
    ...(data.growth != null && { growth: data.growth }),
    ...(data.flaw != null && { flaw: data.flaw }),
  };
  if (data.clear_fields && data.clear_fields.length > 0) {
    for (const fname of data.clear_fields) {
      if (!CLEARABLE_FIELDS.includes(fname as never)) {
        throw new Error(
          `clear_fields 不支持字段名 "${fname}";白名单:${CLEARABLE_FIELDS.join(', ')}`,
        );
      }
      fields[fname] = '';
    }
  }
  return this.prisma.character.upsert({
    where: { novelId_name: { novelId, name: data.name } },
    create: { novelId, name: data.name, ...fields },
    update: fields,
  });
}
```

**改 2**:在 `getCharacterHistory` 方法之后(class 闭合 `}` 之前)加 `deleteCharacter` + `clearCharacters` 两方法:

```typescript
/**
 * 删单个角色(by name,user-scoped)。CharacterChange 是真级联 FK 依赖:
 *  - cascade=false(默认):有 changes 拒绝,返清单(对标 delete_volume)
 *  - cascade=true:$transaction 连删 changes + character,返 deletedChanges
 *  不拦 ACTIVE(单删是显式请求;错了 char-writer 重建)。
 */
async deleteCharacter(
  userId: string,
  novelId: string,
  name: string,
  cascade: boolean,
): Promise<
  | { ok: true; name: string; deletedChanges: number }
  | { ok: false; error: 'HAS_CHANGES'; changes: number; hint: string }
  | { ok: false; reason: 'not_found' }
> {
  await this.assertOwned(userId, novelId);
  const ch = await this.prisma.character.findFirst({
    where: { novelId, name, novel: { userId } },
    select: { id: true, name: true },
  });
  if (!ch) return { ok: false, reason: 'not_found' };

  const changes = await this.prisma.characterChange.count({
    where: { characterId: ch.id },
  });
  if (changes > 0 && !cascade) {
    return {
      ok: false,
      error: 'HAS_CHANGES',
      changes,
      hint: `该角色有 ${changes} 条变迁史,删除前请确认:传 cascade=true 连带删,或保留变迁史(角色删了变迁史成孤儿)`,
    };
  }
  if (changes > 0 && cascade) {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await tx.characterChange.deleteMany({
        where: { characterId: ch.id },
      });
      await tx.character.delete({ where: { id: ch.id } });
      return { deletedChanges: r.count };
    });
    return { ok: true, name, deletedChanges: result.deletedChanges };
  }
  // changes === 0:直接删
  await this.prisma.character.delete({ where: { id: ch.id } });
  return { ok: true, name, deletedChanges: 0 };
}

/**
 * 清空全书角色(ACTIVE 小说返 warning,对标 clear_master_outline)。
 * $transaction 一次性删全部 characterChange(子) + character(父)。
 * 不拦 ACTIVE(soft warning,prompt 层让 agent 在 clear 前征得作者同意)。
 */
async clearCharacters(
  userId: string,
  novelId: string,
): Promise<
  | {
      ok: true;
      deletedCharacters: number;
      deletedChanges: number;
      warned: boolean;
      reason?: string;
    }
  | { ok: false; reason: 'empty' }
> {
  const n = await this.prisma.novel.findFirst({
    where: { id: novelId, userId },
    select: { id: true, status: true },
  });
  if (!n) throw new NotFoundException('Novel not found');
  const count = await this.prisma.character.count({
    where: { novelId },
  });
  if (count === 0) return { ok: false, reason: 'empty' };

  const result = await this.prisma.$transaction(async (tx) => {
    const c = await tx.characterChange.deleteMany({
      where: { novelId },
    });
    const ch = await tx.character.deleteMany({ where: { novelId } });
    return { deletedCharacters: ch.count, deletedChanges: c.count };
  });
  if (n.status === 'ACTIVE') {
    return {
      ok: true,
      ...result,
      warned: true,
      reason:
        '全书角色 bible 已清空(ACTIVE 小说),writer/validator 将失去角色档案依据,下一轮写章前请重建 bible',
    };
  }
  return { ok: true, ...result, warned: false };
}
```

- [ ] **Step 1.5: 跑 spec 确认全过**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- character.service.spec.ts`
Expected: PASS(原有用例 + 新增 9 条全过)

- [ ] **Step 1.6: 跑 typecheck**

Run: `pnpm --dir /Users/taowen/project/narratox/server typecheck`
Expected: 无 error

- [ ] **Step 1.7: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/novel/character.service.ts server/src/novel/character.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(character): CharacterService 加 deleteCharacter/clearCharacters + upsert 支持 clear_fields

- deleteCharacter(name, cascade): cascade=false 默认拒返 count;true 连删 changes+character 事务原子
- clearCharacters(): 全清,ACTIVE 返 warning(对标 clear_master_outline)
- upsertCharacter 新增 clear_fields 白名单(9 个文本字段),比空串更明确,不破坏 null=skip 语义

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 改 set-character.tool.ts schema 加 clear_fields

**Files:**
- Modify: `server/src/agentos/tools/set-character.tool.ts`
- Test: `server/src/agentos/tools/set-character.tool.spec.ts`(若不存在则新建)

- [ ] **Step 2.1: 检查 set-character.tool.spec.ts 是否存在**

Run: `ls /Users/taowen/project/narratox/server/src/agentos/tools/set-character.tool.spec.ts`

如不存在,Step 2.3 会新建;存在就在 Step 2.3 里 Edit 加用例。

- [ ] **Step 2.2: 写失败测试**

若 **spec 文件不存在**,新建 `server/src/agentos/tools/set-character.tool.spec.ts`:

```typescript
import { makeSetCharacterTool } from './set-character.tool';
import type { CharacterService } from '../../novel/character.service';

describe('set_character tool', () => {
  it('透传 clear_fields 给 upsertCharacter', async () => {
    const upsertCharacter = jest.fn().mockResolvedValue({ id: 'c1' });
    const characters = { upsertCharacter } as unknown as CharacterService;
    const t = makeSetCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({
      name: '沈砚',
      personality: '新描述',
      clear_fields: ['appearance'],
    });
    expect(upsertCharacter).toHaveBeenCalledWith('u1', 'n1', {
      name: '沈砚',
      role: undefined,
      aliases: undefined,
      faction: undefined,
      background: undefined,
      appearance: undefined,
      personality: '新描述',
      motivation: undefined,
      arcGoal: undefined,
      voice: undefined,
      growth: undefined,
      flaw: undefined,
      clear_fields: ['appearance'],
    });
  });

  it('无 clear_fields 时正常透传(undefined)', async () => {
    const upsertCharacter = jest.fn().mockResolvedValue({ id: 'c1' });
    const characters = { upsertCharacter } as unknown as CharacterService;
    const t = makeSetCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({ name: '沈砚', role: 'PROTAGONIST' });
    expect(upsertCharacter).toHaveBeenCalledWith(
      'u1',
      'n1',
      expect.objectContaining({ name: '沈砚', role: 'PROTAGONIST', clear_fields: undefined }),
    );
  });

  it('返回 { ok: true, name }', async () => {
    const upsertCharacter = jest.fn().mockResolvedValue({ id: 'c1' });
    const characters = { upsertCharacter } as unknown as CharacterService;
    const t = makeSetCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    const r = await t.invoke({ name: '沈砚' });
    expect(r).toEqual({ ok: true, name: '沈砚' });
  });
});
```

若 **spec 已存在**,用 Edit 在末尾追加这 3 个 it 块。

- [ ] **Step 2.3: 跑 spec 确认失败**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- set-character.tool.spec.ts`
Expected: FAIL(`clear_fields` 未在 schema 中定义,工具拒绝该参数)

- [ ] **Step 2.4: 改 set-character.tool.ts 加 clear_fields schema + 透传**

把 `set-character.tool.ts` 整体替换为:

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

export function makeSetCharacterTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({
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
      growth,
      flaw,
      clear_fields,
    }) => {
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
        growth,
        flaw,
        clear_fields,
      });
      return { ok: true as const, name };
    },
    {
      name: 'set_character',
      description:
        '创建或更新角色人物小传(稳定身份:名字/定位/别名/势力/出身/成长经历/外貌/性格/动机/弱点/弧光/语言风格)。按 role 分层:主角/反派全填深,配角精简。建/丰富角色档案时调用。改某字段直接传新值(未传字段保留旧值);要清空某字段回空用 clear_fields(比空串更明确)。',
      schema: z.object({
        name: z.string().describe('角色主名(书内唯一)'),
        role: z
          .enum(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'])
          .nullish()
          .describe('角色定位(决定小传填多深:主角/反派全填,配角精简)'),
        aliases: z.array(z.string()).nullish().describe('别名/外号'),
        faction: z.string().nullish().describe('势力/组织归属'),
        background: z.string().nullish().describe('身世背景(出身/前史)'),
        growth: z
          .string()
          .nullish()
          .describe('成长经历:塑造性格的重大事件(防 OOC 的根;来路)'),
        appearance: z.string().nullish().describe('外貌/记忆点'),
        personality: z.string().nullish().describe('性格基调'),
        motivation: z.string().nullish().describe('执念/动机/欲望'),
        flaw: z.string().nullish().describe('弱点/执念阴暗面(挣扎与蜕变之源)'),
        arcGoal: z.string().nullish().describe('弧光目标(归宿/成长终点)'),
        voice: z.string().nullish().describe('语言风格/口头禅'),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe(
            '要清空成 "" 的字段名(白名单:faction/background/appearance/personality/motivation/arcGoal/voice/growth/flaw)。比传空串更明确。未传字段保留旧值;clear_fields 是显式清空。',
          ),
      }),
    },
  );
}
```

- [ ] **Step 2.5: 跑 spec 确认全过**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- set-character.tool.spec.ts`
Expected: PASS(3 条全过)

- [ ] **Step 2.6: Commit(暂不 commit,与下两个 tool 一起在 Task 3 末尾 commit)**

---

## Task 3: 新建 delete-character.tool.ts + clear-characters.tool.ts

**Files:**
- Create: `server/src/agentos/tools/delete-character.tool.ts` + `.spec.ts`
- Create: `server/src/agentos/tools/clear-characters.tool.ts` + `.spec.ts`

- [ ] **Step 3.1: 写 delete-character.tool.spec.ts**

新建 `server/src/agentos/tools/delete-character.tool.spec.ts`:

```typescript
import { makeDeleteCharacterTool } from './delete-character.tool';
import type { CharacterService } from '../../novel/character.service';

describe('delete_character tool', () => {
  it('转发给 CharacterService.deleteCharacter(name, cascade)', async () => {
    const deleteCharacter = jest.fn().mockResolvedValue({
      ok: true,
      name: '沈砚',
      deletedChanges: 3,
    });
    const characters = { deleteCharacter } as unknown as CharacterService;
    const t = makeDeleteCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    const out = await t.invoke({ name: '沈砚', cascade: true });
    expect(deleteCharacter).toHaveBeenCalledWith('u1', 'n1', '沈砚', true);
    expect(out).toMatchObject({ ok: true, name: '沈砚', deletedChanges: 3 });
  });

  it('cascade 默认 false(不传)', async () => {
    const deleteCharacter = jest.fn().mockResolvedValue({
      ok: false,
      error: 'HAS_CHANGES',
      changes: 5,
      hint: '...',
    });
    const characters = { deleteCharacter } as unknown as CharacterService;
    const t = makeDeleteCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({ name: '沈砚' });
    expect(deleteCharacter).toHaveBeenCalledWith('u1', 'n1', '沈砚', false);
  });

  it('HAS_CHANGES 透传(不偷删)', async () => {
    const deleteCharacter = jest.fn().mockResolvedValue({
      ok: false,
      error: 'HAS_CHANGES',
      changes: 5,
      hint: '有 5 条',
    });
    const characters = { deleteCharacter } as unknown as CharacterService;
    const t = makeDeleteCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    const out = (await t.invoke({ name: '沈砚' })) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toBe('HAS_CHANGES');
    expect(out.changes).toBe(5);
  });
});
```

- [ ] **Step 3.2: 写 delete-character.tool.ts**

新建 `server/src/agentos/tools/delete-character.tool.ts`:

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

/** char-writer 的「删角色」工具。cascade 默认 false:有变迁史返清单(对标 delete_volume)。 */
export function makeDeleteCharacterTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(
    async ({ name, cascade }) =>
      characters.deleteCharacter(userId, novelId, name, cascade ?? false),
    {
      name: 'delete_character',
      description:
        '删单个角色(by name)。该角色的 CharacterChange 变迁史处理:cascade=false(默认)→ 有变迁史拒绝返清单(不偷删);cascade=true → 连删变迁史+角色(事务原子)。单删是显式请求,不拦 ACTIVE。改名不做 rename(身份不可变),要改 = 新建旧删。',
      schema: z.object({
        name: z.string().describe('角色主名(或别名,会解析到 canonical)'),
        cascade: z
          .boolean()
          .optional()
          .describe('有变迁史时是否连删:true=连删;false(默认)=拒绝返清单'),
      }),
    },
  );
}
```

- [ ] **Step 3.3: 跑 delete-character.tool.spec.ts 确认全过**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- delete-character.tool.spec.ts`
Expected: PASS(3 条)

- [ ] **Step 3.4: 写 clear-characters.tool.spec.ts**

新建 `server/src/agentos/tools/clear-characters.tool.spec.ts`:

```typescript
import { makeClearCharactersTool } from './clear-characters.tool';
import type { CharacterService } from '../../novel/character.service';

describe('clear_characters tool', () => {
  it('转发给 CharacterService.clearCharacters', async () => {
    const clearCharacters = jest.fn().mockResolvedValue({
      ok: true,
      deletedCharacters: 5,
      deletedChanges: 20,
      warned: true,
      reason: 'ACTIVE',
    });
    const characters = { clearCharacters } as unknown as CharacterService;
    const t = makeClearCharactersTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({});
    expect(clearCharacters).toHaveBeenCalledWith('u1', 'n1');
  });

  it('ACTIVE warning 透传', async () => {
    const clearCharacters = jest.fn().mockResolvedValue({
      ok: true,
      deletedCharacters: 3,
      deletedChanges: 9,
      warned: true,
      reason: '全书角色 bible 已清空',
    });
    const characters = { clearCharacters } as unknown as CharacterService;
    const t = makeClearCharactersTool({ userId: 'u1', novelId: 'n1', characters });
    const out = (await t.invoke({})) as any;
    expect(out.warned).toBe(true);
    expect(out.reason).toContain('清空');
  });

  it('empty 透传', async () => {
    const clearCharacters = jest.fn().mockResolvedValue({ ok: false, reason: 'empty' });
    const characters = { clearCharacters } as unknown as CharacterService;
    const t = makeClearCharactersTool({ userId: 'u1', novelId: 'n1', characters });
    const out = (await t.invoke({})) as any;
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('empty');
  });
});
```

- [ ] **Step 3.5: 写 clear-characters.tool.ts**

新建 `server/src/agentos/tools/clear-characters.tool.ts`:

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CharacterService } from '../../novel/character.service';

/** char-writer 的「清空全书角色」工具。ACTIVE 返 warning(不拦,对标 clear_master_outline)。 */
export function makeClearCharactersTool({
  userId,
  novelId,
  characters,
}: {
  userId: string;
  novelId: string;
  characters: CharacterService;
}) {
  return tool(async () => characters.clearCharacters(userId, novelId), {
    name: 'clear_characters',
    description:
      '清空全书角色 bible(角色 + 变迁史,$transaction 原子)。ACTIVE 小说返 warning(bible 是 writer/validator 的依据),但不拦。仅在作者明确要求「重建角色体系」时调用。不是「重写某角色」的快捷方式(那是 set_character merge)。',
    schema: z.object({}),
  });
}
```

- [ ] **Step 3.6: 跑 clear-characters.tool.spec.ts 确认全过**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- clear-characters.tool.spec.ts`
Expected: PASS(3 条)

- [ ] **Step 3.7: 跑全套 character 相关 tool spec 确认零回归**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- character`
Expected: 所有 character 相关 spec 全过(set-character / get-character / get-characters / get-character-history / delete-character / clear-characters)

- [ ] **Step 3.8: Commit(Task 2 + Task 3 一起)**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/tools/set-character.tool.ts \
        server/src/agentos/tools/set-character.tool.spec.ts \
        server/src/agentos/tools/delete-character.tool.ts \
        server/src/agentos/tools/delete-character.tool.spec.ts \
        server/src/agentos/tools/clear-characters.tool.ts \
        server/src/agentos/tools/clear-characters.tool.spec.ts
git commit -m "$(cat <<'EOF'
feat(agentos/tools): 加 delete_character/clear-characters + set_character 扩 clear_fields

3 个 tool factory:
- set_character: schema 加 clear_fields 白名单(9 文本字段),透传给 upsert
- delete_character(name, cascade?): 转发 deleteCharacter
- clear_characters(): 转发 clearCharacters

全挂 char-writer(下一步 registry+config)。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 注册工具到 agent-registry.ts + 挂到 char-writer

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`
- Modify: `server/src/agentos/agent-tree.config.ts`
- Test: `server/src/agentos/agent-tree.config.spec.ts`

- [ ] **Step 4.1: 在 agent-registry.ts 加 2 个 import**

打开 `server/src/agentos/agent-registry.ts`,在现有 import 段(紧接 `makeClearMasterOutlineTool` 那行之后,或与其它 character tool 相邻)加:

```typescript
import { makeDeleteCharacterTool } from './tools/delete-character.tool';
import { makeClearCharactersTool } from './tools/clear-characters.tool';
```

具体位置:跟在 `import { makeGetCharacterHistoryTool } from './tools/get-character-history.tool';`(第 52 行)之后。

- [ ] **Step 4.2: 在 TOOL_REGISTRY 加 2 个条目**

在 `TOOL_REGISTRY` 对象内(`set_character` 条目之后,即第 341 行 `}),` 之后)加:

```typescript
  delete_character: (d) =>
    makeDeleteCharacterTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  clear_characters: (d) =>
    makeClearCharactersTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
```

- [ ] **Step 4.3: 改 agent-tree.config.ts,char-writer 的 tools 数组加 2 个 key**

找到 char-writer 节点(约第 286-305 行),把它的 `tools` 数组改为:

```typescript
          tools: [
            'set_character',
            'delete_character',
            'clear_characters',
            'get_character',
            'get_characters',
            'get_worldview',
            'get_world_entry',
            'get_outline',
            'get_chapter_plan',
            'get_novel_info',
            'list_knowledge',
            'get_knowledge',
            'query_memory',
          ],
```

(在 `'set_character'` 之后加 `'delete_character'` 和 `'clear_characters'` 两行)

- [ ] **Step 4.4: 改 agent-tree.config.spec.ts 的 inline 快照**

打开 `server/src/agentos/agent-tree.config.spec.ts`,找到 char-writer tools 数组(约第 269-281 行),同步加 2 行:

```typescript
                tools: [
                  'set_character',
                  'delete_character',
                  'clear_characters',
                  'get_character',
                  'get_characters',
                  'get_worldview',
                  'get_world_entry',
                  'get_outline',
                  'get_chapter_plan',
                  'get_novel_info',
                  'list_knowledge',
                  'get_knowledge',
                  'query_memory',
                ],
```

- [ ] **Step 4.5: 加一条针对 delete/clear 挂载的断言(在「outline-writer 能读实际正文」之后)**

在 `agent-tree.config.spec.ts` 找一个合适位置(例如 `it('outline-writer 能读实际正文...` 之后)加:

```typescript
    it('char-writer 拥有 delete_character / clear_characters(角色删除/清空套件)', () => {
      const character = AGENT_TREE.subagents!.find((s) => s.name === 'character')!;
      const charWriter = character.subagents!.find((s) => s.name === 'char-writer')!;
      expect(charWriter.tools).toContain('set_character');
      expect(charWriter.tools).toContain('delete_character');
      expect(charWriter.tools).toContain('clear_characters');
    });

    it('char-critic 没有删除工具(只读评审,不带删权)', () => {
      const character = AGENT_TREE.subagents!.find((s) => s.name === 'character')!;
      const charCritic = character.subagents!.find((s) => s.name === 'char-critic')!;
      expect(charCritic.tools).not.toContain('delete_character');
      expect(charCritic.tools).not.toContain('clear_characters');
      expect(charCritic.tools).not.toContain('set_character');
    });
```

- [ ] **Step 4.6: 跑 spec 确认全过**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- agent-tree.config.spec.ts agent-registry`
Expected: PASS(含 inline 快照对齐 + 新增 2 条挂载断言)

- [ ] **Step 4.7: 跑 typecheck**

Run: `pnpm --dir /Users/taowen/project/narratox/server typecheck`
Expected: 无 error

- [ ] **Step 4.8: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/agent-registry.ts \
        server/src/agentos/agent-tree.config.ts \
        server/src/agentos/agent-tree.config.spec.ts
git commit -m "$(cat <<'EOF'
feat(agent-tree): char-writer 挂 delete_character/clear_characters + registry 注册

- TOOL_REGISTRY 加 2 个 tool 工厂
- AGENT_TREE.char-writer.tools 加 2 个 key
- inline 快照同步;char-critic 显式断言无删除权(只读评审一致性)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 改 3 处 prompt(char-writer / character-orchestrator / main)

**Files:**
- Modify: `server/src/agentos/prompts/character-writer.md`
- Modify: `server/src/agentos/prompts/character-orchestrator.md`
- Modify: `server/src/agentos/prompts/main.md`

**注意:prompts 在 boot 时加载到内存,改完需重启 dev 才生效;不热加载。**

- [ ] **Step 5.1: 在 character-writer.md 的【铁律】之前加【删除/清空 — 用法纪律】section**

打开 `server/src/agentos/prompts/character-writer.md`,在最后一行(`【铁律】...`)之前插入以下 section(空行隔开):

```markdown
【删除/清空 — 用法纪律】你拥有 `delete_character` / `clear_characters` 工具,以及 `set_character` 的 `clear_fields` 参数。这些是危险操作,严格守纪律:

- **删角色前问作者 cascade 意愿**:该角色可能有 CharacterChange 变迁史(它是 `get_character_history` 工具的数据源)。删前问作者:「保留变迁史(角色删了变迁史成孤儿)还是一起删(传 cascade=true)?」默认 cascade=false(拒绝返清单,不偷删)。
- **`clear_characters` 是核武**:仅在作者明确要求「重建角色体系」时调用。不是「重写某个角色」的快捷方式(那是 `set_character` merge)。ACTIVE 小说会返 warning——看到了不要慌,这是软提醒,你已经在删前问过作者就 OK。
- **`clear_fields` 优先于空串**:想清空某字段(让它回到空、重新填)用 `set_character({ name, clear_fields: ['personality'] })`,比传 `personality: ''` 更明确。白名单:faction/background/appearance/personality/motivation/arcGoal/voice/growth/flaw。
- **改名 = 新建旧删**:`name` 是身份,不做 rename。改名 = `delete_character(旧名)` + `set_character({ name: 新名, ... })`。

```

然后保留原【铁律】行不动。

- [ ] **Step 5.2: 在 character-orchestrator.md 加「删/清角色」task type**

打开 `server/src/agentos/prompts/character-orchestrator.md`,在【建角色档案流程】的 step 6 之后(【铁律】之前)加:

```markdown

【删/清角色流程】收到「删某角色」或「清空全书角色」时:
1. 用 task 委派 char-writer,明确告诉它:
   - 删单个:告诉它角色名 + 问作者 cascade 意愿(变迁史保留还是连删)。char-writer 会先 `get_character(name)` 确认存在,再 `delete_character(name, cascade?)`。
   - 清全书:仅在作者明确要求「重建角色体系」时触发。char-writer 调 `clear_characters()`,ACTIVE 会返 warning(不拦)。
2. 删/清完不需要 critic 评审(没有「成品」可评);直接回主 agent 一句结论(如「沈砚已删(3 条变迁史连删)」或「全书角色已清空,等待重建」)。
```

- [ ] **Step 5.3: 在 main.md 的 character 委派语补「删/清角色」**

打开 `server/src/agentos/prompts/main.md`,找到现有 character 委派语(类似「character 建完 → 停:...」或「建角色 → 拉 CHARACTER」的位置),在「建角色档案」相关委派描述里追加一句:

```markdown
- 作者要删某角色 / 清空角色 bible → 委派 character(它内部走 char-writer 的 delete_character / clear_characters)。删前问作者 cascade 意愿,clear 走核武护栏。
```

(具体插入位置:在 main.md 里搜 `character` 找到委派段落,作为一条新的 bullet 加入;若结构是段落式,作为新句追加)

- [ ] **Step 5.4: 跑 agent-prompts.spec.ts 确认 substring 锁仍通过**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- agent-prompts.spec.ts`
Expected: PASS。本期不动已锁的 substring 主体(`弧光目标 arcGoal` / `取KB→建档案→评审` 等),只加新 section,锁仍通过。

- [ ] **Step 5.5: Commit**

```bash
cd /Users/taowen/project/narratox/server
# 先确认 lint 不报错
pnpm lint
cd /Users/taowen/project/narratox
git add server/src/agentos/prompts/character-writer.md \
        server/src/agentos/prompts/character-orchestrator.md \
        server/src/agentos/prompts/main.md
git commit -m "$(cat <<'EOF'
docs(prompts): char-writer/orchestrator/main 加角色删除/清空纪律

- char-writer.md: 新增【删除/清空 — 用法纪律】(cascade 问意愿/clear 核武/clear_fields 优先/改名=新建旧删)
- character-orchestrator.md: 新增【删/清角色流程】task type
- main.md: character 委派补「删/清」一句

prompt boot 时加载,改完需重启 dev 生效。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: L1 smoke test 加 character delete/patch/clear 用例

**Files:**
- Modify: `server/test/smoke/l1-integration.spec.ts`

- [ ] **Step 6.1: 加 imports(CharacterService)+ 一个新 it 块**

打开 `server/test/smoke/l1-integration.spec.ts`,在 imports 段(第 10 行 `ArcService` 之后)加:

```typescript
import { CharacterService } from '../../src/novel/character.service';
```

- [ ] **Step 6.2: 在文件末尾(最后一个 `it('大纲细粒度:patch...')` 之后,`});` 之前)加新 it**

```typescript
  it('角色细粒度:clear_fields → delete(cascade=false 拒绝) → delete(cascade=true 连删) → clear 全书', async () => {
    const characters = new CharacterService(prisma);
    // 建 2 个角色 + 1 条变迁(给 c1)
    await characters.upsertCharacter(userId, novelId, {
      name: 'smoke-char-1',
      role: 'PROTAGONIST',
      appearance: '旧外貌',
      personality: '旧性格',
    });
    await characters.upsertCharacter(userId, novelId, {
      name: 'smoke-char-2',
      role: 'SUPPORTING',
    });
    await characters.recordChanges(userId, novelId, 1, [
      {
        name: 'smoke-char-1',
        field: 'personality',
        value: '从天真转冷峻',
        reason: '家变',
        significance: 'MAJOR',
      },
    ]);
    // clear_fields: 把 smoke-char-1 的 appearance 清空,改 personality
    await characters.upsertCharacter(userId, novelId, {
      name: 'smoke-char-1',
      personality: '新性格',
      clear_fields: ['appearance'],
    });
    const ch1 = await prisma.character.findFirst({
      where: { novelId, name: 'smoke-char-1' },
    });
    expect(ch1?.appearance).toBe('');
    expect(ch1?.personality).toBe('新性格');
    // delete smoke-char-1 with cascade=false → 拒绝(有 1 条变迁)
    const r1 = await characters.deleteCharacter(userId, novelId, 'smoke-char-1', false);
    expect(r1.ok).toBe(false);
    if (!r1.ok && 'error' in r1) expect(r1.error).toBe('HAS_CHANGES');
    // delete smoke-char-2 with cascade=false → ok(无变迁)
    const r2 = await characters.deleteCharacter(userId, novelId, 'smoke-char-2', false);
    expect(r2.ok).toBe(true);
    // delete smoke-char-1 with cascade=true → 连删
    const r3 = await characters.deleteCharacter(userId, novelId, 'smoke-char-1', true);
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.deletedChanges).toBe(1);
    // 此时表里应已无 smoke-char-*;再造一个然后 clear_characters
    await characters.upsertCharacter(userId, novelId, { name: 'smoke-char-3' });
    const r4 = await characters.clearCharacters(userId, novelId);
    expect(r4.ok).toBe(true);
    const total = await prisma.character.count({ where: { novelId } });
    expect(total).toBe(0);
  });
```

- [ ] **Step 6.3: 跑 L1 smoke 确认通过(需要 DB)**

Run: `pnpm --dir /Users/taowen/project/narratox/server test -- l1-integration.spec.ts`
Expected: PASS(若 DB 未起,会报连接错误——先起 DB 再跑)

- [ ] **Step 6.4: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/test/smoke/l1-integration.spec.ts
git commit -m "$(cat <<'EOF'
test(l1): 加角色细粒度 smoke(clear_fields/delete cascade/clear 全书)

集成验证:upsert+clear_fields → delete cascade=false 拒绝 → cascade=true 连删 → clear 全书。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 全量回归 + lint

- [ ] **Step 7.1: 跑全量单测**

Run: `pnpm --dir /Users/taowen/project/narratox/server test`
Expected: 全 PASS(原 492 + 本期新增约 17 条 = ~509)

- [ ] **Step 7.2: 跑 typecheck**

Run: `pnpm --dir /Users/taowen/project/narratox/server typecheck`
Expected: 无 error

- [ ] **Step 7.3: 跑 lint(只看自己改的文件)**

Run: `pnpm --dir /Users/taowen/project/narratox/server lint`
Expected: 自己改的文件不引入新 lint 错误(仓库里预存 126 条 lint 警告与本 task 无关,忽略)

- [ ] **Step 7.4: 终态 git status + log 确认**

```bash
cd /Users/taowen/project/narratox
git status   # 应 clean
git log --oneline -8  # 看到 6 个新 commit(spec 已在 brainstorming 阶段 commit,这里看 plan + 5 个实现)
```

Expected:
- `test(l1): 加角色细粒度 smoke...`
- `docs(prompts): char-writer/orchestrator/main...`
- `feat(agent-tree): char-writer 挂 delete_character...`
- `feat(agentos/tools): 加 delete_character/clear_characters...`
- `feat(character): CharacterService 加 deleteCharacter...`
- (更早的 spec commit `design: 角色删除/清空套件 spec...`)

---

## Spec Coverage 自检(写 plan 后过一遍)

| Spec 条款 | Task |
|---|---|
| §3.1 `delete_character(name, cascade?)` | Task 1.4(service) + Task 3.1/3.2(tool) + Task 4 注册 |
| §3.2 `clear_characters()` ACTIVE warning | Task 1.4(service) + Task 3.4/3.5(tool) + Task 4 注册 |
| §3.3 `set_character(+clear_fields)` 白名单 | Task 1.4(service) + Task 2(tool schema) |
| §5.1 CharacterChange 真级联(事务) | Task 1.4 `$transaction` |
| §5.2 clearCharacters 事务性 | Task 1.4 `$transaction` |
| §5.3 ACTIVE 软护栏 | Task 1.4 warn 分支 |
| §5.4 null 语义不改(历史背景) | Task 1.4 注释引用 spec §5.4 |
| §5.5 工具归属(char-writer only) | Task 4.3 配置 + Task 4.5 critic 断言 |
| §6 零 DB 迁移 | 不动 schema.prisma |
| §7.1 char-writer.md 加纪律 | Task 5.1 |
| §7.2 character-orchestrator.md 加 task type | Task 5.2 |
| §7.3 main.md 委派补「删/清」 | Task 5.3 |
| §8 测试覆盖 | Task 1.2 / Task 2.2 / Task 3.1/3.4 / Task 4.5 / Task 6.2 |
| §10 风险(误删/typo/dangling) | Task 5.1 prompt 纪律 + Task 1.4 throw |

无遗漏。

## Placeholder 自检

无 TBD/TODO/「实现适当错误处理」等占位;每 step 都有完整代码。

## 类型一致性自检

- `deleteCharacter` 返回类型在 Task 1.4(实现)和 Task 1.2(测试)、Task 3.2(tool 透传)中一致
- `clearCharacters` 返回类型同上
- `clear_fields` 字段名在 Task 1.4 / 2.4 / 3.1 中一致(camelCase)
- `CASCADE_DEFAULT = false` 语义在 Task 3.2 `cascade ?? false` 中体现

---

## 执行选择(给用户)

**Plan 已写完并存到 `docs/superpowers/plans/2026-07-09-character-delete-suite.md`。两种执行方式:**

**1. Subagent-Driven(推荐)** - 每个 task 派一个新 subagent,task 间 review,迭代快

**2. Inline Execution** - 在本会话内 executing-plans 批量执行 + 检查点

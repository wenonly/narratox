# per-agent modelId 可空 + 删温度中间级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AgentModelOverride.modelId 改可空(模型默认=空,温度独立),删掉没用上的 AgentSpec.temperature 中间级,温度优先级简化为两级(per-agent > Model)。

**Architecture:** schema modelId DROP NOT NULL;resolveModelConfig 去 spec 参数改两级;AgentOverrideEntry.config 可 null(modelId null → listMap 返 null);resolveModel 用 `config ?? activeConfig`;upsert「两者空 → remove」;前端去掉 fallback active model。

**Tech Stack:** NestJS 11 + Prisma 7(server,Jest TDD) / Next.js 15(agent-ui,typecheck+lint)。

**关联 spec:** [docs/superpowers/specs/2026-06-30-per-agent-modelid-nullable-design.md](../specs/2026-06-30-per-agent-modelid-nullable-design.md)

---

## File Structure

- Modify: `server/prisma/schema.prisma` — AgentModelOverride.modelId 可空 + model 可选关系
- Create: migration SQL(modelId DROP NOT NULL)
- Modify: `server/src/agentos/agent-tree.config.ts` — 删 AgentSpec.temperature;resolveModelConfig 两级
- Modify: `server/src/agentos/agent-tree.config.spec.ts` — resolveModelConfig 用例改两级
- Modify: `server/src/agentos/deep-agent.service.ts` — AgentOverrideEntry.config 可 null;resolveModel `?? activeConfig`
- Modify: `server/src/agentos/deep-agent.override.spec.ts` — pickAgentConfig config 可 null
- Modify: `server/src/settings/agent-model-override.service.ts` — listMap(modelId null→config null);upsert(两者空 remove);listForApi modelId 类型
- Modify: `server/src/settings/agent-model-override.service.spec.ts` — 适配
- Modify: `agent-ui/src/components/settings/AgentModelSettings.tsx` — 去 fallback active model

---

## Task 1: schema migration — modelId 可空

**Files:**
- Modify: `server/prisma/schema.prisma`(`model AgentModelOverride`)
- Create: migration SQL

- [ ] **Step 1: 改 schema**

`server/prisma/schema.prisma` 的 `model AgentModelOverride`,把:
```prisma
  modelId     String
  model       Model    @relation(fields: [modelId], references: [id], onDelete: Cascade)
```
改为:
```prisma
  modelId     String?
  model       Model?   @relation(fields: [modelId], references: [id], onDelete: Cascade)
```
(只改这两个字段:required → 可空。`temperature Float?` 不变。)

- [ ] **Step 2: 生成迁移**

Run:
```bash
cd server && pnpm prisma migrate dev --name agent_override_modelid_nullable --create-only
```
打开生成的 `migration.sql`,确认含 `ALTER TABLE "AgentModelOverride" ALTER COLUMN "modelId" DROP NOT NULL;`(Prisma 自动生成)。若 Prisma 还生成了 FK 约束重建(可选 → 必需的 ON DELETE 保持 Cascade),确认无误。

- [ ] **Step 3: 执行迁移 + regenerate**

Run:
```bash
cd server && pnpm prisma migrate dev && pnpm prisma generate
```
(Prisma 7 gotcha:migrate 不自动 regenerate,手动 generate)
Expected: `✔ Generated Prisma Client`,`modelId` 在 delegate 上变可选。

- [ ] **Step 4: 冒烟**

Run: `cd server && pnpm typecheck 2>&1 | head -20`
Expected: **会红** —— `agent-model-override.service.ts` 的 `listMap` 用 `r.model.vendor`(model 现在 null) + `assembleModelConfig(r.model, ...)`(modelId null 时 model null)。**记录报错**,这是 Task 4 要修的。确认无 schema 语法错误。

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(settings): AgentModelOverride.modelId 可空(模型默认=空)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 删 AgentSpec.temperature + resolveModelConfig 两级(纯函数 TDD)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`
- Test: `server/src/agentos/agent-tree.config.spec.ts`

- [ ] **Step 1: 改测试(现有 resolveModelConfig 用例改两级)**

`agent-tree.config.spec.ts` 现有 `describe('resolveModelConfig 三级温度')` 块,把 4 个用例改两级(去掉 spec 参数 + spec.temperature 相关用例)。新块:

```ts
import { resolveModelConfig } from './agent-tree.config';
import type { ModelConfigRecord } from './model-factory';

const base: ModelConfigRecord = {
  id: 'm1', provider: 'p', model: 'm', baseUrl: null,
  apiKey: 'k', temperature: 0.5, updatedAt: new Date(0),
};

describe('resolveModelConfig 两级温度', () => {
  it('无 override → 用 Model 温度', () => {
    expect(resolveModelConfig(base).temperature).toBe(0.5);
  });
  it('temperatureOverride 覆盖 Model 温度', () => {
    expect(resolveModelConfig(base, 0.8).temperature).toBe(0.8);
  });
  it('temperatureOverride 为 null 不覆盖(走 Model)', () => {
    expect(resolveModelConfig(base, null).temperature).toBe(0.5);
  });
  it('最终温度与 Model 相同 → 原样返回(不 clone,cache key 不变)', () => {
    expect(resolveModelConfig(base, 0.5)).toBe(base);
  });
});
```

(删掉旧的「三级温度」describe 块,包括引用 `AGENT_TREE`/`spec.temperature` 的用例。若文件顶部 import `AGENT_TREE` 仅此处用,保留——buildAgentGroups 等其他用例可能也用。)

- [ ] **Step 2: 跑确认失败**

Run: `cd server && pnpm test -- agent-tree.config.spec.ts`
Expected: FAIL(resolveModelConfig 当前签名是 3 参 `(spec, activeConfig, temperatureOverride)`,新测试传 1-2 参)。

- [ ] **Step 3: 改 agent-tree.config.ts**

(a) `AgentSpec` interface 删掉 `temperature?: number;` 字段(line 25 附近)。

(b) `resolveModelConfig` 改两级(去掉 spec 参数):

```ts
/**
 * 解析真正喂给 getModel/buildChatModel 的 ModelConfigRecord。
 *
 * 温度两级优先级(高 → 低):
 *   1. temperatureOverride —— per-agent 用户配的温度(AgentModelOverride)
 *   2. activeConfig.temperature —— Model 自带温度
 * 用 `??` 链:null/undefined 跳过。最终温度与 activeConfig 相同 → 原样返回(避免无谓 clone)。
 */
export function resolveModelConfig(
  activeConfig: ModelConfigRecord,
  temperatureOverride?: number | null,
): ModelConfigRecord {
  const finalTemp = temperatureOverride ?? activeConfig.temperature;
  return finalTemp === activeConfig.temperature
    ? activeConfig
    : { ...activeConfig, temperature: finalTemp };
}
```

(顶部 JSDoc 第 54-65 行的三级说明也同步改两级。)

- [ ] **Step 4: 跑确认通过**

Run: `cd server && pnpm test -- agent-tree.config.spec.ts` → PASS。

- [ ] **Step 5: typecheck 看 deep-agent.service 的调用(预期红)**

Run: `cd server && pnpm typecheck 2>&1 | grep "deep-agent.service"`
Expected: `deep-agent.service.ts` 报错——`resolveModelConfig(spec, config, temperatureOverride)` 调用还在传 spec(Task 3 修)。

- [ ] **Step 6: Commit**

```bash
git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "refactor(agentos): 删 AgentSpec.temperature 死代码;resolveModelConfig 改两级(per-agent > Model)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: AgentOverrideEntry.config 可 null + resolveModel 适配

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`
- Test: `server/src/agentos/deep-agent.override.spec.ts`

- [ ] **Step 1: 改测试(pickAgentConfig 返回 {config: null|Record, temperatureOverride})**

`deep-agent.override.spec.ts` 加一个用例(config null,modelId 空的 override):

```ts
import { pickAgentConfig } from './deep-agent.service';
import type { ModelConfigRecord } from './model-factory';

const active: ModelConfigRecord = {
  id: 'active', provider: 'p', model: 'm', baseUrl: null,
  apiKey: 'k', temperature: 0.5, updatedAt: new Date(0),
};
const override: ModelConfigRecord = { ...active, id: 'override' };

describe('pickAgentConfig (override 优先,config 可 null)', () => {
  it('有 override 用 override.config', () => {
    const map = new Map([['writer', { config: override, temperatureOverride: 0.8 }]]);
    expect(pickAgentConfig('writer', map, active).config!.id).toBe('override');
    expect(pickAgentConfig('writer', map, active).temperatureOverride).toBe(0.8);
  });
  it('无 override 回退 active,temperatureOverride=null', () => {
    const r = pickAgentConfig('writer', new Map(), active);
    expect(r.config!.id).toBe('active');
    expect(r.temperatureOverride).toBeNull();
  });
  it('modelId 空(只设温度)的 override:config=null', () => {
    const map = new Map([['writer', { config: null, temperatureOverride: 0.7 }]]);
    expect(pickAgentConfig('writer', map, active).config).toBeNull();
    expect(pickAgentConfig('writer', map, active).temperatureOverride).toBe(0.7);
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `cd server && pnpm test -- deep-agent.override.spec.ts`
Expected: FAIL(第 3 个用例:AgentOverrideEntry.config 当前是 `ModelConfigRecord`(非 null),传 null 类型报错)。

- [ ] **Step 3: 改 deep-agent.service.ts**

(a) `AgentOverrideEntry` 的 config 改可空:
```ts
export interface AgentOverrideEntry {
  config: ModelConfigRecord | null;   // null = modelId 空(只设温度),运行时用 active
  temperatureOverride: number | null;
}
```

(b) `resolveModel` 改:config null → 用 active + resolveModelConfig 两级(去 spec 参数):
```ts
  private async resolveModel(
    spec: AgentSpec,
    activeConfig: ModelConfigRecord,
    overrideMap: Map<string, AgentOverrideEntry>,
  ) {
    const { config: overrideConfig, temperatureOverride } = pickAgentConfig(
      spec.name,
      overrideMap,
      activeConfig,
    );
    const config = overrideConfig ?? activeConfig;   // null(modelId 空) → 用 active
    return this.getModel(
      resolveModelConfig(config, temperatureOverride),
      MAX_TOKENS_BY_TIER[spec.modelTier],
    );
  }
```

- [ ] **Step 4: 跑确认通过**

Run: `cd server && pnpm test -- deep-agent.override.spec.ts` → PASS(3 用例)。

- [ ] **Step 5: typecheck(仍红 listMap,Task 4 修)**

Run: `cd server && pnpm typecheck 2>&1 | grep -E "deep-agent|agent-model-override" | head`
Expected: `deep-agent.service.ts` 自身无新错误(Task 2 的调用已修);`agent-model-override.service.ts` 的 listMap 用 `r.model.vendor`(model null)仍红(Task 4)。

- [ ] **Step 6: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.override.spec.ts
git commit -m "feat(agentos): AgentOverrideEntry.config 可 null(modelId 空→用 active);resolveModel 两级温度

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: listMap(modelId null) + upsert(清除逻辑) + service 测试

**Files:**
- Modify: `server/src/settings/agent-model-override.service.ts`
- Test: `server/src/settings/agent-model-override.service.spec.ts`

- [ ] **Step 1: 改测试**

`agent-model-override.service.spec.ts`:
- listMap 用例:`r.model` 改为可选(mock 一条 modelId null 的行 `{ agentKey: 'writer', temperature: 0.3, model: null }`),断言 `map.get('writer')?.config`).toBeNull() + `.temperatureOverride` 为 0.3。另一条 modelId 非空的正常拼装。
- upsert 用例:加两个:
  - `upsert modelId 空 + temperature 有值 → 建 override(modelId null,不校验 vendor)`:`await svc.upsert('u1','writer',{ temperature: 0.7 })`,断言 `prisma.agentModelOverride.upsert` 被调,create/update 含 `modelId: null, temperature: 0.7`,且 `vendor.findFirst` **未**被调。
  - `upsert modelId 空 + temperature null → remove`:`await svc.upsert('u1','writer',{})`,断言 `prisma.agentModelOverride.deleteMany` 被调(走 remove),`upsert` 未被调。
- 删掉旧的「upsert modelId 空 → remove」用例(Task 11 版本,modelId 空一律 remove)——现在 modelId 空 + temperature 有值是建 override。

- [ ] **Step 2: 跑确认失败**

Run: `cd server && pnpm test -- agent-model-override.service.spec.ts` → FAIL。

- [ ] **Step 3: 改 service**

`agent-model-override.service.ts`:

(a) `listMap`:model 可能为 null:
```ts
    for (const r of rows) {
      map.set(r.agentKey, {
        config: r.model ? assembleModelConfig(r.model, r.model.vendor) : null,
        temperatureOverride: r.temperature,
      });
    }
```

(b) `listForApi`:modelId 类型改可空(返回类型 + select):
```ts
  async listForApi(
    userId: string,
  ): Promise<Record<string, { modelId: string | null; temperature: number | null }>> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      select: { agentKey: true, modelId: true, temperature: true },
    });
    const out: Record<string, { modelId: string | null; temperature: number | null }> = {};
    for (const r of rows)
      out[r.agentKey] = { modelId: r.modelId, temperature: r.temperature };
    return out;
  }
```

(c) `upsert`:清除逻辑改(两者空 → remove;否则 upsert modelId 可空,仅 modelId 非空才校验归属):
```ts
  /**
   * 写一条 override。
   *  - modelId 空 + temperature 空 → remove(两者都空 = 无 override)。
   *  - 否则 upsert:modelId 可空(空=用 active model 只覆盖温度);仅 modelId 非空时校验 Model 归属。
   */
  async upsert(
    userId: string,
    agentKey: string,
    dto: { modelId?: string; temperature?: number | null },
  ): Promise<void> {
    const modelId = dto.modelId ?? null;
    const temperature = dto.temperature ?? null;
    if (!modelId && temperature == null) {
      await this.remove(userId, agentKey);
      return;
    }
    if (modelId) {
      const owned = await this.prisma.vendor.findFirst({
        where: { models: { some: { id: modelId } }, userId },
        select: { id: true },
      });
      if (!owned) throw new NotFoundException('Model not found');
    }
    await this.prisma.agentModelOverride.upsert({
      where: { userId_agentKey: { userId, agentKey } },
      create: { userId, agentKey, modelId, temperature },
      update: { modelId, temperature },
    });
  }
```

(顶部 JSDoc 第 6-11 行 + upsert JSDoc 同步更新新语义。)

- [ ] **Step 4: 跑确认通过**

Run: `cd server && pnpm test -- agent-model-override.service.spec.ts` → PASS。

- [ ] **Step 5: typecheck 应全绿**

Run: `cd server && pnpm typecheck`
Expected: **零错误**(Task 1 的 listMap 红 + Task 2 的 resolveModelConfig 调用红 + Task 3 全已修)。

- [ ] **Step 6: 全量回归**

Run: `cd server && pnpm test`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add server/src/settings/agent-model-override.service.ts server/src/settings/agent-model-override.service.spec.ts
git commit -m "feat(settings): listMap modelId null→config null;upsert 两者空→remove + modelId 可空

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 前端 AgentModelSettings 去 fallback

**Files:**
- Modify: `agent-ui/src/components/settings/AgentModelSettings.tsx`

- [ ] **Step 1: 改 onChange(去掉 fallback active model)**

`AgentModelSettings.tsx` 的 `onChange`,删掉 fallback active model 那段(`if (!effectiveModelId) { ... activeModel ... }`),modelId 空合法直接传。新 onChange:

```ts
  const onChange = async (
    agentKey: string,
    modelId: string,
    temperature: number | null
  ) => {
    const prevEntry = overrides[agentKey]
    try {
      setOverrides((prev) => ({
        ...prev,
        // 两者空 → 本地删除(后端 remove);否则保留条目(modelId 可空)
        ...((!modelId && temperature == null)
          ? {} : { [agentKey]: { modelId, temperature } }),
      }))
      await putAgentModel(endpoint, token, agentKey, {
        modelId: modelId || undefined,
        temperature,
      })
      // 两者空 → 后端 remove → 本地同步删条目
      if (!modelId && temperature == null) {
        setOverrides((prev) => {
          const next = { ...prev }
          delete next[agentKey]
          return next
        })
      }
      toast.success('已保存')
    } catch (err) {
      setOverrides((prev) => {
        const next = { ...prev }
        if (prevEntry) next[agentKey] = prevEntry
        else delete next[agentKey]
        return next
      })
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }
```

(删掉 `vendors.flatMap((v) => v.models).find((m) => m.active)` 那段 fallback + 「请先激活默认模型」toast。)

- [ ] **Step 2: typecheck + lint + format**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix && pnpm format:fix`
Expected: 全绿。

- [ ] **Step 3: 手动验证(启服务)**

启 `pnpm dev`,设置页「按 Agent 分配模型」弹窗:
- 选默认模型 + 设温度 0.8 → 保存成功(温度独立,不绑模型)
- 选默认模型 + 温度留空 → override 清除
- 选某模型 + 设温度 → override {modelId, temperature}

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/settings/AgentModelSettings.tsx
git commit -m "feat(agent-ui): per-agent onChange 去 fallback;模型默认+温度独立

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 回归

- [ ] **Step 1: server 全量**

Run: `cd server && pnpm test && pnpm typecheck`
Expected: 全绿。

- [ ] **Step 2: agent-ui validate**

Run: `cd agent-ui && pnpm validate`
Expected: 全绿。

- [ ] **Step 3: 收尾 commit(若有 lint 修复)**

---

## Definition of Done

- [ ] AgentModelOverride.modelId 可空(schema + migration + prisma generate)
- [ ] AgentSpec.temperature 删除;resolveModelConfig 两级(per-agent > Model)
- [ ] AgentOverrideEntry.config 可 null;resolveModel `config ?? activeConfig`
- [ ] listMap modelId null → config null;upsert 两者空 → remove + modelId 可空
- [ ] 前端 onChange 去 fallback(模型默认 + 温度独立)
- [ ] server test/typecheck + agent-ui validate 全绿
- [ ] model-factory / getActive / assembleModelConfig / Vendor/Model CRUD 零改动

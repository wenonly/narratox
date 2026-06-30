# 模型配置厂商重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扁平 `ModelConfig` 拆成 `Vendor`(厂商凭证) + `Model`(模型) 两层,设置页改厂商单列分组,`AgentModelOverride` 升级为「选模型 + 配温度」,温度三级优先级。

**Architecture:** model-factory / buildChatModel / getModel cache 全不变(仍吃 ModelConfigRecord)。改动封闭在:① ModelConfigRecord 从 Model+Vendor 运行时拼装;② resolveModelConfig 加 per-agent temperatureOverride(三级温度);③ Vendor/Model CRUD;④ 前端厂商分组 + per-agent 弹窗(optgroup 模型 + 温度)。

**Tech Stack:** NestJS 11 + Prisma 7(server,Jest TDD) / Next.js 15 + React 18(agent-ui,无 test,用 typecheck+lint)。

**关联 spec:** [docs/superpowers/specs/2026-06-30-model-config-vendor-restructure-design.md](../specs/2026-06-30-model-config-vendor-restructure-design.md)

---

## File Structure

**server(创建/修改):**
- Modify: `server/prisma/schema.prisma` — 加 Vendor/Model,改 User/AgentModelOverride,删 ModelConfig
- Create: `server/prisma/migrations/<ts>_vendor_model_restructure/migration.sql` — 建表 + 数据迁移 + 删旧表
- Modify: `server/src/agentos/agent-tree.config.ts` — resolveModelConfig 加 temperatureOverride 参数
- Create: `server/src/agentos/vendor-model-assembler.ts` — 纯函数:Model+Vendor 行 → ModelConfigRecord
- Modify: `server/src/agentos/deep-agent.service.ts` — pickAgentConfig 返回 {config, temperatureOverride};resolveModel 适配
- Modify: `server/src/settings/model-config.service.ts` — getActive 改读 activeModelId + JOIN Vendor
- Modify: `server/src/settings/agent-model-override.service.ts` — listMap 返回 {config, temperatureOverride};upsert 加 temperature
- Create: `server/src/settings/vendor.service.ts` + `vendor.controller.ts` + `dto/vendor.dto.ts`
- Create: `server/src/settings/model.service.ts` + `model.controller.ts` + `dto/model.dto.ts`
- Modify: `server/src/settings/agent-model.controller.ts` — 返回 {modelId, temperature} 结构;upsert body 加 temperature
- Modify: `server/src/settings/settings.module.ts` — 注册新 controller/service

**agent-ui(创建/修改):**
- Modify: `agent-ui/src/api/routes.ts` + `api/settings.ts` + `types/settings.ts` — vendor/model API + 类型
- Rewrite: `agent-ui/src/components/settings/ModelSettings.tsx` — 厂商单列分组 + 厂商/模型表单
- Modify: `agent-ui/src/components/settings/AgentModelSettings.tsx` — optgroup 模型下拉 + 温度输入

---

## Task 1: DB 迁移 — Vendor/Model 两层 + 数据迁移

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: migration SQL(由 `prisma migrate dev` 生成骨架,数据迁移 SQL 手写补进)

- [ ] **Step 1: 改 schema.prisma**

删 `model ModelConfig {...}` 整段。加两个新 model:

```prisma
/// 厂商(凭证级):同厂商多模型共用 provider/baseUrl/apiKey。
model Vendor {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  provider  String
  baseUrl   String?
  apiKey    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  models    Model[]

  @@index([userId])
}

/// 模型(挂厂商下):model ID + 温度,凭证继承厂商。
model Model {
  id          String   @id @default(cuid())
  vendorId    String
  vendor      Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  model       String
  temperature Float?
  name        String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([vendorId])
}
```

改 `model User`:把 `activeModelConfigId String? @unique` + `activeModelConfig ModelConfig? @relation("ActiveModel", ...)` 两行替换为:

```prisma
  activeModelId String? @unique
  activeModel   Model?  @relation("ActiveModel", fields: [activeModelId], references: [id], onDelete: SetNull)
```

并在 `model User` 里把原 `modelConfigs ModelConfig[]` 改为 `vendors Vendor[]`。

改 `model AgentModelOverride`:把 `modelConfigId String` + `modelConfig ModelConfig @relation(...)` 两行替换为:

```prisma
  modelId     String
  model       Model    @relation(fields: [modelId], references: [id], onDelete: Cascade)
  temperature Float?
```

- [ ] **Step 2: 生成空迁移骨架(不立即执行,先要 SQL 文件)**

Run:
```bash
cd server && pnpm prisma migrate dev --name vendor_model_restructure --create-only
```
Expected: 生成 `prisma/migrations/<ts>_vendor_model_restructure/migration.sql`(只含建表/删表 DDL,无数据迁移)。

- [ ] **Step 3: 在生成的 migration.sql 末尾追加数据迁移 SQL**

在 SQL 文件末尾(所有 DDL 之后)追加(PostgreSQL):

```sql
-- 数据迁移:ModelConfig → Vendor(去重) + Model(映射)
WITH vendor_map AS (
  INSERT INTO "Vendor" ("id", "userId", "name", "provider", "baseUrl", "apiKey", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid(),
    "userId",
    COALESCE(NULLIF("name", ''), "provider" || '/' || "model"),
    "provider",
    "baseUrl",
    "apiKey",
    NOW(),
    NOW()
  FROM (SELECT DISTINCT "userId", "provider", "baseUrl", "apiKey", MIN("name") AS "name" FROM "ModelConfig" GROUP BY "userId", "provider", "baseUrl", "apiKey") d
  RETURNING "id", "userId", "provider", "baseUrl", "apiKey"
),
model_map AS (
  INSERT INTO "Model" ("id", "vendorId", "model", "temperature", "name", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid(),
    vm."id",
    mc."model",
    mc."temperature",
    mc."name",
    NOW(),
    NOW()
  FROM "ModelConfig" mc
  JOIN "Vendor" vm
    ON vm."userId" = mc."userId"
    AND vm."provider" = mc."provider"
    AND COALESCE(vm."baseUrl", '') = COALESCE(mc."baseUrl", '')
    AND vm."apiKey" = mc."apiKey"
  RETURNING "id", "model", "createdAt"
)
-- 重映射 User.activeModelConfigId → activeModelId
UPDATE "User" u SET "activeModelId" = (
  SELECT mm."id" FROM "ModelConfig" mc
  JOIN "Model" mm ON mm."model" = mc."model"
  WHERE mc."id" = u."activeModelConfigId"
  LIMIT 1
)
WHERE u."activeModelConfigId" IS NOT NULL;
```

注意:Prisma migrate 生成的 DDL 会先把 `ModelConfig` 相关外键约束建/删处理好;数据迁移 SQL 必须在「新表已建、旧表未删」的窗口执行。`prisma migrate dev --create-only` 生成的 SQL 通常先建新表后删旧表——把数据迁移 SQL 插在「删 ModelConfig」语句**之前**。打开生成的 SQL,定位 `DROP TABLE "ModelConfig"`,把上面数据迁移 SQL 粘到它前面。

- [ ] **Step 4: 执行迁移 + 手动 regenerate client**

Run:
```bash
cd server && pnpm prisma migrate dev
```
(已 create-only,这次直接执行)
**Prisma 7 gotcha**:migrate 不自动 regenerate client,手动:
```bash
cd server && pnpm prisma generate
```
Expected: `✔ Generated Prisma Client`,`vendor`/`model` delegate 出现。

- [ ] **Step 5: 冒烟**

Run: `cd server && pnpm typecheck`
Expected: PASS(若有现有代码引用 `modelConfig` delegate 报错——预期,model-config.service 等待后续 task 改。**记录报错文件清单,这些是后续 task 要改的**)。

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(settings): Vendor/Model 两层 schema + ModelConfig 数据迁移

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> 说明:此 task 后 `pnpm typecheck` 会红(model-config.service 等仍引用旧 modelConfig delegate)。这是预期,Task 2-7 会逐个修复。每个后续 task 让 typecheck 逐步转绿,Task 11 全绿。

---

## Task 2: resolveModelConfig 三级温度优先级(纯函数)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`
- Test: `server/src/agentos/agent-tree.config.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `agent-tree.config.spec.ts` 的 `resolveModelConfig` describe 块里加用例(覆盖三级优先级):

```ts
import { resolveModelConfig, AGENT_TREE } from './agent-tree.config';
import type { ModelConfigRecord } from './model-factory';

const base: ModelConfigRecord = {
  id: 'm1', provider: 'p', model: 'm', baseUrl: null,
  apiKey: 'k', temperature: 0.5, updatedAt: new Date(0),
};

describe('resolveModelConfig 三级温度', () => {
  it('无 override 无 spec.temperature → 用 Model 温度', () => {
    const spec = { ...AGENT_TREE, temperature: undefined };
    expect(resolveModelConfig(spec, base).temperature).toBe(0.5);
  });
  it('spec.temperature 覆盖 Model 温度', () => {
    const spec = { ...AGENT_TREE, temperature: 0.3 };
    expect(resolveModelConfig(spec, base).temperature).toBe(0.3);
  });
  it('temperatureOverride(per-agent) 覆盖 spec.temperature', () => {
    const spec = { ...AGENT_TREE, temperature: 0.3 };
    expect(resolveModelConfig(spec, base, 0.8).temperature).toBe(0.8);
  });
  it('temperatureOverride 为 null 不覆盖(走 spec)', () => {
    const spec = { ...AGENT_TREE, temperature: 0.3 };
    expect(resolveModelConfig(spec, base, null).temperature).toBe(0.3);
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `cd server && pnpm test -- agent-tree.config.spec.ts`
Expected: FAIL(第 3 个用例:resolveModelConfig 不接受第三参)。

- [ ] **Step 3: 改 resolveModelConfig 签名**

在 `agent-tree.config.ts` 把 `resolveModelConfig` 改为:

```ts
export function resolveModelConfig(
  spec: AgentSpec,
  activeConfig: ModelConfigRecord,
  temperatureOverride?: number | null,
): ModelConfigRecord {
  const finalTemp =
    temperatureOverride ?? spec.temperature ?? activeConfig.temperature;
  return finalTemp === activeConfig.temperature
    ? activeConfig
    : { ...activeConfig, temperature: finalTemp };
}
```

- [ ] **Step 4: 跑确认通过**

Run: `cd server && pnpm test -- agent-tree.config.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(agentos): resolveModelConfig 三级温度优先级(per-agent > spec > model)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: VendorModelAssembler 纯函数(Model+Vendor → ModelConfigRecord)

**Files:**
- Create: `server/src/agentos/vendor-model-assembler.ts`
- Test: `server/src/agentos/vendor-model-assembler.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/agentos/vendor-model-assembler.spec.ts`:

```ts
import { assembleModelConfig } from './vendor-model-assembler';

const model = {
  id: 'm1', model: 'glm-4-air', temperature: 0.7, updatedAt: new Date(0),
};
const vendor = {
  provider: 'anthropic', baseUrl: 'https://x/api/anthropic', apiKey: 'sk-x',
};

describe('assembleModelConfig', () => {
  it('Model + Vendor → ModelConfigRecord', () => {
    const r = assembleModelConfig(model as never, vendor as never);
    expect(r).toMatchObject({
      id: 'm1',
      model: 'glm-4-air',
      temperature: 0.7,
      provider: 'anthropic',
      baseUrl: 'https://x/api/anthropic',
      apiKey: 'sk-x',
    });
  });
  it('temperature null → 透传 null(由 resolveModelConfig 兜底)', () => {
    const r = assembleModelConfig({ ...model, temperature: null } as never, vendor as never);
    expect(r.temperature).toBeNull();
  });
  it('baseUrl null → 透传 null', () => {
    const r = assembleModelConfig(model as never, { ...vendor, baseUrl: null } as never);
    expect(r.baseUrl).toBeNull();
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `cd server && pnpm test -- vendor-model-assembler.spec.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

创建 `server/src/agentos/vendor-model-assembler.ts`:

```ts
import type { ModelConfigRecord } from './model-factory';

/** Model + Vendor 行 → ModelConfigRecord(运行时拼装,替代旧的 ModelConfig 直读)。 */
export function assembleModelConfig(
  model: { id: string; model: string; temperature: number | null; updatedAt: Date },
  vendor: { provider: string; baseUrl: string | null; apiKey: string },
): ModelConfigRecord {
  return {
    id: model.id,
    provider: vendor.provider,
    model: model.model,
    baseUrl: vendor.baseUrl,
    apiKey: vendor.apiKey,
    temperature: model.temperature,
    updatedAt: model.updatedAt,
  };
}
```

- [ ] **Step 4: 跑确认通过**

Run: `cd server && pnpm test -- vendor-model-assembler.spec.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/vendor-model-assembler.ts server/src/agentos/vendor-model-assembler.spec.ts
git commit -m "feat(agentos): assembleModelConfig 纯函数(Model+Vendor→ModelConfigRecord)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: pickAgentConfig 升级 + DeepAgentService 适配

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`
- Test: `server/src/agentos/deep-agent.override.spec.ts`

- [ ] **Step 1: 改测试(deep-agent.override.spec.ts)**

`pickAgentConfig` 返回值从 `ModelConfigRecord` 变为 `{ config, temperatureOverride }`。改测试:

```ts
import { pickAgentConfig } from './deep-agent.service';
import type { ModelConfigRecord } from './model-factory';

const active: ModelConfigRecord = {
  id: 'active', provider: 'p', model: 'm', baseUrl: null,
  apiKey: 'k', temperature: 0.5, updatedAt: new Date(0),
};
const override: ModelConfigRecord = { ...active, id: 'override' };

describe('pickAgentConfig (override 优先,返回 config+temperatureOverride)', () => {
  it('有 override 用 override.config', () => {
    const map = new Map([['writer', { config: override, temperatureOverride: 0.8 }]]);
    expect(pickAgentConfig('writer', map, active).config.id).toBe('override');
    expect(pickAgentConfig('writer', map, active).temperatureOverride).toBe(0.8);
  });
  it('无 override 回退 active,temperatureOverride=null', () => {
    const r = pickAgentConfig('writer', new Map(), active);
    expect(r.config.id).toBe('active');
    expect(r.temperatureOverride).toBeNull();
  });
  it('main agent key 也能 override', () => {
    const map = new Map([['main', { config: override, temperatureOverride: null }]]);
    expect(pickAgentConfig('main', map, active).config.id).toBe('override');
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `cd server && pnpm test -- deep-agent.override.spec.ts` → FAIL。

- [ ] **Step 3: 改 pickAgentConfig + resolveModel + buildNode**

在 `deep-agent.service.ts`:

(a) 定义新类型 + 改 pickAgentConfig(替换原函数):

```ts
/** override map 的 value:模型 + per-agent 温度覆盖。 */
export interface AgentOverrideEntry {
  config: ModelConfigRecord;
  temperatureOverride: number | null;
}

/** override 优先,无则 active(temperatureOverride=null)。纯函数好测。 */
export function pickAgentConfig(
  agentKey: string,
  overrideMap: Map<string, AgentOverrideEntry>,
  activeConfig: ModelConfigRecord,
): AgentOverrideEntry {
  return (
    overrideMap.get(agentKey) ?? {
      config: activeConfig,
      temperatureOverride: null,
    }
  );
}
```

(b) 改 `resolveModel`(私有方法,接收 overrideMap):

```ts
  private async resolveModel(
    spec: AgentSpec,
    activeConfig: ModelConfigRecord,
    overrideMap: Map<string, AgentOverrideEntry>,
  ) {
    const { config, temperatureOverride } = pickAgentConfig(
      spec.name,
      overrideMap,
      activeConfig,
    );
    return this.getModel(
      resolveModelConfig(spec, config, temperatureOverride),
      MAX_TOKENS_BY_TIER[spec.modelTier],
    );
  }
```

(c) `buildNode` 的 `model:` 行和 `mainModel` 行**不变**(它们调 `this.resolveModel(spec, activeConfig, overrideMap)`,签名没变)。确认这两处仍是 `await this.resolveModel(spec, activeConfig, overrideMap)` 和 `await this.resolveModel(AGENT_TREE, activeConfig, overrideMap)`——无需改。

- [ ] **Step 4: 跑确认通过**

Run: `cd server && pnpm test -- deep-agent.override.spec.ts` → PASS。

- [ ] **Step 5: typecheck 确认 DeepAgentService 仍引用 OverrideMap 类型一致**

Run: `cd server && pnpm typecheck 2>&1 | grep -v "model-config\|agent-model-override" | head`
Expected: deep-agent.service.ts 自身无新报错(其他 modelConfig 相关报错留给 Task 5-7)。

- [ ] **Step 6: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.override.spec.ts
git commit -m "feat(agentos): pickAgentConfig 返回 {config, temperatureOverride}

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: ModelConfigService.getActive 改读 activeModelId + JOIN Vendor

**Files:**
- Modify: `server/src/settings/model-config.service.ts`

> 说明:重构后 `ModelConfigService` 职责缩为「读 activeModelId 拼装 ModelConfigRecord 给 DeepAgentService」。厂商/模型 CRUD 由 Task 6/7 的新 service 负责。保留 service 名 `ModelConfigService`(被 AgentosModule 注入),内部改实现。

- [ ] **Step 1: 改 getActive 实现**

把 `model-config.service.ts` 的 `getActive` 改为(读 activeModelId → Model + Vendor → assembleModelConfig):

```ts
import { assembleModelConfig } from '../agentos/vendor-model-assembler';

// ...在 class 内:
  /** 服务端用:返回活动模型【含 apiKey】,Model+Vendor 拼装成 ModelConfigRecord。 */
  async getActive(userId: string): Promise<ModelConfigRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { activeModel: { include: { vendor: true } } },
    });
    const m = user?.activeModel;
    if (!m) return null;
    return assembleModelConfig(m, m.vendor);
  }
```

删掉旧的 `list / create / update / delete / activate / assertOwned / getActiveId / mask` 方法(它们迁移到 Vendor/Model service)。保留 `getActive` 一个方法。同时删掉 `MaskedModelConfig` type export(前端类型另改)。

- [ ] **Step 2: 删 model-config.controller.ts(路由由 vendor/model controller 替代)**

`rm server/src/settings/model-config.controller.ts` 和 `dto/create-model-config.dto.ts`、`dto/update-model-config.dto.ts`(MODEL_PROVIDERS 常量迁到 vendor.dto.ts,Task 6)。

- [ ] **Step 3: 暂不跑 typecheck(仍红,Task 6/7 补齐 CRUD 后转绿)**

- [ ] **Step 4: 暂不 commit(和 Task 6/7 一起,避免中间不可编译)**

---

## Task 6: Vendor service + controller + dto

**Files:**
- Create: `server/src/settings/vendor.service.ts` + `vendor.controller.ts` + `dto/vendor.dto.ts`
- Test: `server/src/settings/vendor.service.spec.ts`

- [ ] **Step 1: 写 dto(含 MODEL_PROVIDERS)**

创建 `server/src/settings/dto/vendor.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const MODEL_PROVIDERS = [
  'deepseek',
  'openai-compatible',
  'anthropic',
  'gemini',
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export class CreateVendorDto {
  @IsString() @MaxLength(80) name!: string;
  @IsIn(MODEL_PROVIDERS) provider!: ModelProvider;
  @IsOptional() @IsString() baseUrl?: string;
  @IsString() @IsNotEmpty() apiKey!: string;
}

export class UpdateVendorDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsIn(MODEL_PROVIDERS) provider?: ModelProvider;
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiKey?: string; // 空串=不改
}
```

- [ ] **Step 2: 写失败测试**

创建 `server/src/settings/vendor.service.spec.ts`:

```ts
import { VendorService } from './vendor.service';

const prisma = { vendor: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() } };
const svc = new VendorService(prisma as never);
beforeEach(() => jest.clearAllMocks());

describe('VendorService', () => {
  it('list 返回脱敏(无 apiKey,带 hasApiKey)', async () => {
    (prisma.vendor.findMany as jest.Mock).mockResolvedValue([{ id: 'v1', apiKey: 'sk' }]);
    const out = await svc.list('u1');
    expect(out[0].apiKey).toBeUndefined();
    expect(out[0].hasApiKey).toBe(true);
  });
  it('create 写库', async () => {
    await svc.create('u1', { name: 'GLM', provider: 'anthropic', apiKey: 'sk' });
    expect(prisma.vendor.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', name: 'GLM', apiKey: 'sk' }),
    }));
  });
  it('update apiKey 空串不改', async () => {
    (prisma.vendor.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', userId: 'u1' });
    await svc.update('u1', 'v1', { name: 'GLM2', apiKey: '' });
    expect(prisma.vendor.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ apiKey: expect.anything() }),
    }));
  });
});
```

- [ ] **Step 3: 跑确认失败** → Run: `cd server && pnpm test -- vendor.service.spec.ts` → FAIL。

- [ ] **Step 4: 实现 service**

创建 `server/src/settings/vendor.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Injectable()
export class VendorService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.vendor.findMany({
      where: { userId },
      include: { models: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: Boolean(apiKey) }));
  }

  async create(userId: string, dto: CreateVendorDto) {
    const row = await this.prisma.vendor.create({
      data: { ...dto, userId },
      include: { models: true },
    });
    const { apiKey, ...rest } = row;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }

  async update(userId: string, id: string, dto: UpdateVendorDto) {
    await this.assertOwned(userId, id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.apiKey === undefined || dto.apiKey === '') delete data.apiKey;
    const row = await this.prisma.vendor.update({ where: { id }, data, include: { models: true } });
    const { apiKey, ...rest } = row;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }

  async delete(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.vendor.delete({ where: { id } });
  }

  private async assertOwned(userId: string, id: string) {
    const owned = await this.prisma.vendor.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new NotFoundException('Vendor not found');
  }
}
```

- [ ] **Step 5: 跑确认通过** → Run: `cd server && pnpm test -- vendor.service.spec.ts` → PASS。

- [ ] **Step 6: 实现 controller**

创建 `server/src/settings/vendor.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VendorService } from './vendor.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Controller('settings/vendors')
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @Get() list(@CurrentUser() user: RequestUser) { return this.vendors.list(user.id); }
  @Post() create(@CurrentUser() user: RequestUser, @Body() dto: CreateVendorDto) { return this.vendors.create(user.id, dto); }
  @Patch(':id') update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateVendorDto) { return this.vendors.update(user.id, id, dto); }
  @Delete(':id') delete(@CurrentUser() user: RequestUser, @Param('id') id: string) { return this.vendors.delete(user.id, id); }
}
```

- [ ] **Step 7: Commit**

```bash
git add server/src/settings/vendor.service.ts server/src/settings/vendor.service.spec.ts server/src/settings/vendor.controller.ts server/src/settings/dto/vendor.dto.ts
git commit -m "feat(settings): Vendor CRUD service/controller/dto

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Model service + controller + activate

**Files:**
- Create: `server/src/settings/model.service.ts` + `model.controller.ts` + `dto/model.dto.ts`
- Test: `server/src/settings/model.service.spec.ts`
- Modify: `server/src/settings/settings.module.ts`

- [ ] **Step 1: dto**

创建 `server/src/settings/dto/model.dto.ts`:

```ts
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateModelDto {
  @IsString() @MaxLength(120) model!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}
export class UpdateModelDto {
  @IsOptional() @IsString() @MaxLength(120) model?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}
```

- [ ] **Step 2: 写失败测试**

创建 `server/src/settings/model.service.spec.ts`:

```ts
import { ModelService } from './model.service';

const prisma = {
  model: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  vendor: { findFirst: jest.fn() },
  user: { update: jest.fn() },
};
const svc = new ModelService(prisma as never);
beforeEach(() => jest.clearAllMocks());

describe('ModelService', () => {
  it('create 校验 vendor 归属', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.create('u1', 'vX', { model: 'glm' })).rejects.toThrow();
    expect(prisma.model.create).not.toHaveBeenCalled();
  });
  it('create 归属通过写库', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue({ id: 'v1' });
    await svc.create('u1', 'v1', { model: 'glm-4-air', temperature: 0.7 });
    expect(prisma.model.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: 'v1', model: 'glm-4-air', temperature: 0.7 }),
    }));
  });
  it('activate 设 User.activeModelId', async () => {
    (prisma.vendor.findFirst as jest.Mock).mockResolvedValue({ id: 'v1' });
    (prisma.model.update as jest.Mock).mockResolvedValue({ id: 'm1' });
    await svc.activate('u1', 'm1');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { activeModelId: 'm1' } });
  });
});
```

- [ ] **Step 3: 跑确认失败** → FAIL。

- [ ] **Step 4: 实现 service**

创建 `server/src/settings/model.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModelDto, UpdateModelDto } from './dto/model.dto';

@Injectable()
export class ModelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, vendorId: string, dto: CreateModelDto) {
    await this.assertVendorOwned(userId, vendorId);
    return this.prisma.model.create({ data: { ...dto, vendorId } });
  }

  async update(userId: string, id: string, dto: UpdateModelDto) {
    await this.assertModelOwned(userId, id);
    return this.prisma.model.update({ where: { id }, data: dto });
  }

  async delete(userId: string, id: string) {
    await this.assertModelOwned(userId, id);
    await this.prisma.model.delete({ where: { id } });
  }

  /** 设为默认模型:校验归属后更新 User.activeModelId。 */
  async activate(userId: string, id: string) {
    await this.assertModelOwned(userId, id);
    await this.prisma.user.update({ where: { id: userId }, data: { activeModelId: id } });
  }

  private async assertVendorOwned(userId: string, vendorId: string) {
    const owned = await this.prisma.vendor.findFirst({ where: { id: vendorId, userId }, select: { id: true } });
    if (!owned) throw new NotFoundException('Vendor not found');
  }
  private async assertModelOwned(userId: string, modelId: string) {
    const owned = await this.prisma.vendor.findFirst({
      where: { models: { some: { id: modelId } }, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model not found');
  }
}
```

- [ ] **Step 5: 跑确认通过** → PASS。

- [ ] **Step 6: controller**

创建 `server/src/settings/model.controller.ts`:

```ts
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ModelService } from './model.service';
import { CreateModelDto, UpdateModelDto } from './dto/model.dto';

@Controller('settings')
export class ModelController {
  constructor(private readonly models: ModelService) {}

  @Post('vendors/:vid/models')
  create(@CurrentUser() user: RequestUser, @Param('vid') vid: string, @Body() dto: CreateModelDto) {
    return this.models.create(user.id, vid, dto);
  }

  @Patch('models/:id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.models.update(user.id, id, dto);
  }

  @Delete('models/:id')
  delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.models.delete(user.id, id);
  }

  @Post('models/:id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.models.activate(user.id, id);
  }
}
```

- [ ] **Step 7: 注册到 settings.module**

改 `settings.module.ts`:

```ts
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { ModelController } from './model.controller';
import { ModelService } from './model.service';

@Module({
  controllers: [VendorController, ModelController, VoiceProfileController, AgentModelController],
  providers: [VendorService, ModelService, ModelConfigService, VoiceProfileService, AgentModelOverrideService],
  exports: [ModelConfigService, VoiceProfileService, AgentModelOverrideService],
})
```

(删掉 `ModelConfigController` import + 注册,它已被删/替代。)

- [ ] **Step 8: typecheck 应转绿(后端部分)**

Run: `cd server && pnpm typecheck`
Expected: PASS(若 agent-model.controller/override 还引用旧结构,Task 8 修)。

- [ ] **Step 9: Commit**

```bash
git add server/src/settings/model.service.ts server/src/settings/model.service.spec.ts server/src/settings/model.controller.ts server/src/settings/dto/model.dto.ts server/src/settings/settings.module.ts server/src/settings/model-config.service.ts
git rm server/src/settings/model-config.controller.ts server/src/settings/dto/create-model-config.dto.ts server/src/settings/dto/update-model-config.dto.ts
git commit -m "feat(settings): Model CRUD + activate;ModelConfigService 缩为 getActive;删旧 model config controller/dto

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: AgentModelOverride 升级(modelId + temperature)

**Files:**
- Modify: `server/src/settings/agent-model-override.service.ts` + `dto/agent-model-override.dto.ts` + `agent-model.controller.ts`
- Test: `server/src/settings/agent-model-override.service.spec.ts` + `agent-model.controller.spec.ts`

- [ ] **Step 1: 改 dto(加 temperature,modelId 可空=清除)**

`server/src/settings/dto/agent-model-override.dto.ts`:

```ts
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertAgentOverrideDto {
  @IsOptional() @IsString() modelId?: string;       // 空=清除 override
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number | null;
}
```

- [ ] **Step 2: 改 listMap(用 assembleModelConfig 拼装 + temperatureOverride) + listForApi(返回 {modelId, temperature}) + upsert(加 temperature)**

`agent-model-override.service.ts` 关键改动:

```ts
import { assembleModelConfig } from '../agentos/vendor-model-assembler';
import type { ModelConfigRecord } from '../agentos/model-factory';
import type { AgentOverrideEntry } from '../agentos/deep-agent.service';

// listMap 返回 Map<agentKey, AgentOverrideEntry>
async listMap(userId: string): Promise<Map<string, AgentOverrideEntry>> {
  const rows = await this.prisma.agentModelOverride.findMany({
    where: { userId },
    include: { model: { include: { vendor: true } } },
  });
  const map = new Map<string, AgentOverrideEntry>();
  for (const r of rows) {
    map.set(r.agentKey, {
      config: assembleModelConfig(r.model, r.model.vendor),
      temperatureOverride: r.temperature,
    });
  }
  return map;
}

// listForApi 返回 Record<agentKey, {modelId, temperature}>
async listForApi(userId: string): Promise<Record<string, { modelId: string; temperature: number | null }>> {
  const rows = await this.prisma.agentModelOverride.findMany({
    where: { userId },
    select: { agentKey: true, modelId: true, temperature: true },
  });
  const out: Record<string, { modelId: string; temperature: number | null }> = {};
  for (const r of rows) out[r.agentKey] = { modelId: r.modelId, temperature: r.temperature };
  return out;
}

// upsert:若 modelId 为空 → 删 override(remove);否则校验 model 归属 + 写 temperature
async upsert(userId: string, agentKey: string, dto: { modelId?: string; temperature?: number | null }) {
  if (!dto.modelId) {
    await this.remove(userId, agentKey);
    return;
  }
  const owned = await this.prisma.vendor.findFirst({
    where: { models: { some: { id: dto.modelId } }, userId },
    select: { id: true },
  });
  if (!owned) throw new NotFoundException('Model not found');
  await this.prisma.agentModelOverride.upsert({
    where: { userId_agentKey: { userId, agentKey } },
    create: { userId, agentKey, modelId: dto.modelId, temperature: dto.temperature ?? null },
    update: { modelId: dto.modelId, temperature: dto.temperature ?? null },
  });
}
```

(去掉旧的 listMap 返回 OverrideMap 类型别名,改为 import AgentOverrideEntry。)

- [ ] **Step 3: 更新 service spec**

`agent-model-override.service.spec.ts`:listMap mock 改为返回 `{ agentKey, model: { id, model, temperature, updatedAt, vendor: { provider, baseUrl, apiKey } } }`,断言 `map.get('writer')?.config.id` 和 `.temperatureOverride`;listForApi 断言 `{ writer: { modelId, temperature } }`;upsert 用 `{ modelId, temperature }`。重写整个 spec 适配新签名。

- [ ] **Step 4: 改 controller.upsert 透传 dto(含 temperature)**

`agent-model.controller.ts` 的 `upsert` 改为接收 `UpsertAgentOverrideDto`(含 modelId + temperature),透传 `overrides.upsert(user.id, agentKey, dto)`。controller spec 相应更新(upsert 传 `{ modelId, temperature }`)。

- [ ] **Step 5: 跑测试 + typecheck**

Run: `cd server && pnpm test && pnpm typecheck`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add server/src/settings/agent-model-override.service.ts server/src/settings/agent-model-override.service.spec.ts server/src/settings/agent-model.controller.ts server/src/settings/agent-model.controller.spec.ts server/src/settings/dto/agent-model-override.dto.ts
git commit -m "feat(settings): AgentModelOverride 升级(modelId+temperature;listMap 拼 ModelConfigRecord)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: 前端 API 层

**Files:**
- Modify: `agent-ui/src/api/routes.ts` + `api/settings.ts` + `types/settings.ts`

- [ ] **Step 1: 类型(types/settings.ts)**

替换 `ModelConfig` 为 `Vendor`/`Model` 类型,加 override 升级结构:

```ts
export type ModelProvider = 'deepseek' | 'openai-compatible' | 'anthropic' | 'gemini'

export interface Model {
  id: string
  model: string
  temperature: number | null
  name: string | null
}
export interface Vendor {
  id: string
  name: string
  provider: ModelProvider
  baseUrl: string | null
  hasApiKey: boolean
  models: Model[]
}
export interface AgentOverride {
  modelId: string
  temperature: number | null
}
```

删旧 `ModelConfig` interface。

- [ ] **Step 2: 路由(routes.ts)**

把 `SettingsModels/SettingsModel/SettingsModelActivate` 三行替换为:

```ts
  SettingsVendors: (base: string) => `${base}/settings/vendors`,
  SettingsVendor: (base: string, id: string) => `${base}/settings/vendors/${id}`,
  SettingsModels: (base: string, vid: string) => `${base}/settings/vendors/${vid}/models`,
  SettingsModel: (base: string, id: string) => `${base}/settings/models/${id}`,
  SettingsModelActivate: (base: string, id: string) => `${base}/settings/models/${id}/activate`,
```

- [ ] **Step 3: API 函数(api/settings.ts)**

替换旧的 listModelConfigs/createModelConfig/updateModelConfig/deleteModelConfig/activateModelConfig 为 vendor/model 版本(保持文件现有 `headers(token)`/`asJson`/`asEmpty` 封装风格):

```ts
import type { Vendor, AgentOverride } from '@/types/settings'

export const listVendors = (b: string, t: string) => asJson<Vendor[]>(fetch(APIRoutes.SettingsVendors(b), { headers: headers(t) }))
export const createVendor = (b: string, t: string, body: { name: string; provider: ModelProvider; baseUrl?: string; apiKey: string }) =>
  asJson<Vendor>(fetch(APIRoutes.SettingsVendors(b), { method: 'POST', headers: headers(t), body: JSON.stringify(body) }))
export const updateVendor = (b: string, t: string, id: string, body: Partial<{ name: string; provider: ModelProvider; baseUrl?: string; apiKey?: string }>) =>
  asJson<Vendor>(fetch(APIRoutes.SettingsVendor(b, id), { method: 'PATCH', headers: headers(t), body: JSON.stringify(body) }))
export const deleteVendor = (b: string, t: string, id: string) => asEmpty(fetch(APIRoutes.SettingsVendor(b, id), { method: 'DELETE', headers: headers(t) }))

export const createModel = (b: string, t: string, vid: string, body: { model: string; temperature?: number; name?: string }) =>
  asJson<Model>(fetch(APIRoutes.SettingsModels(b, vid), { method: 'POST', headers: headers(t), body: JSON.stringify(body) }))
export const updateModel = (b: string, t: string, id: string, body: Partial<{ model: string; temperature?: number; name?: string }>) =>
  asJson<Model>(fetch(APIRoutes.SettingsModel(b, id), { method: 'PATCH', headers: headers(t), body: JSON.stringify(body) }))
export const deleteModel = (b: string, t: string, id: string) => asEmpty(fetch(APIRoutes.SettingsModel(b, id), { method: 'DELETE', headers: headers(t) }))
export const activateModel = (b: string, t: string, id: string) => asEmpty(fetch(APIRoutes.SettingsModelActivate(b, id), { method: 'POST', headers: headers(t) }))
```

`listAgentModels` 返回类型改 `Promise<Record<string, AgentOverride>>`;`putAgentModel` body 改 `{ modelId?: string; temperature?: number | null }`。

- [ ] **Step 4: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck`(此时 ModelSettings/AgentModelSettings 还引用旧类型,**预期红**,Task 10/11 修)。记录报错文件。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/api/routes.ts agent-ui/src/api/settings.ts agent-ui/src/types/settings.ts
git commit -m "feat(agent-ui): vendor/model API + 类型(替换 ModelConfig)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 前端模型设置区(厂商单列分组,重写 ModelSettings)

**Files:**
- Rewrite: `agent-ui/src/components/settings/ModelSettings.tsx`
- Modify: `agent-ui/src/components/settings/model-presets.ts`(provider 预设的 baseUrl,供新建厂商表单预填)

- [ ] **Step 1: 改 model-presets.ts(去掉 model 字段,只留 provider+baseUrl 预设)**

```ts
import type { ModelProvider } from '@/types/settings'

export interface ProviderPreset {
  provider: ModelProvider
  label: string
  baseUrl: string  // 空串=走默认端点
}
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { provider: 'anthropic', label: 'Anthropic 兼容', baseUrl: '' },
  { provider: 'openai-compatible', label: 'OpenAI 兼容', baseUrl: '' },
  { provider: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { provider: 'gemini', label: 'Google Gemini', baseUrl: '' },
]
```

- [ ] **Step 2: 重写 ModelSettings.tsx(厂商单列分组 + 厂商/模型表单弹窗)**

重写为(骨架 + 关键逻辑;表单用现有 Dialog 组件 `@/components/ui/dialog`,样式参照旧 ModelSettings 的 `input-base`/暗色卡片):

```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { listVendors, createVendor, updateVendor, deleteVendor, createModel, updateModel, deleteModel, activateModel } from '@/api/settings'
import type { Vendor, Model, ModelProvider } from '@/types/settings'
import { PROVIDER_PRESETS } from './model-presets'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// 厂商表单弹窗(新建/编辑):name/provider/baseUrl/apiKey
// 模型表单弹窗(加模型/编辑):model/temperature/name
// (实现两个小组件 VendorFormDialog / ModelFormDialog,props: open/onClose/初始值/保存回调)

const ModelSettings = () => {
  const endpoint = useStore(s => s.selectedEndpoint)
  const token = useStore(s => s.authToken)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setVendors(await listVendors(endpoint, token)) }
    catch (e) { toast.error(e instanceof Error ? e.message : '加载失败') }
    finally { setLoading(false) }
  }, [endpoint, token])
  useEffect(() => { refresh() }, [refresh])

  // 厂商 CRUD 包装(createVendor/updateVendor/deleteVendor + refresh + toast)
  // 模型 CRUD 包装(createModel/updateModel/deleteModel + activateModel + refresh)
  // activeModelId 从... 后端 list vendors 不含 activeModelId → 加一个 GET /settings/active-model 或在 vendor list 附带。
  //   【简化方案】:listVendors 返回里给每个 Model 加 `active` 标记(User.activeModelId 匹配)。
  //   → Task 7 的 VendorService.list 改:include user 的 activeModelId,标记 model.active。

  return (
    <div className="space-y-3">
      {/* 「+ 新建厂商」触发 VendorFormDialog */}
      {/* vendors.map(v => 厂商区块):
            头部:▾ {v.name} · {v.provider} · {v.baseUrl} [编辑厂商][删]
            模型行:v.models.map(m => {m.model} · temp {m.temperature} {m.active&&⭐默认} [设默认][删])
            + 加模型(触发 ModelFormDialog,vendorId=v.id) */}
    </div>
  )
}
export default ModelSettings
```

> 实现要点(给 implementer):
> - `VendorFormDialog`:`name`(input)/`provider`(select PROVIDER_PRESETS,选中预填 baseUrl)/`baseUrl`(input)/`apiKey`(input,编辑时空=不改)。保存调 createVendor/updateVendor。
> - `ModelFormDialog`:`model`(input)/`temperature`(input number,可空)/`name`(input 可空)。保存调 createModel/updateModel。
> - 设默认:`activateModel`。删除模型/厂商前 `confirm`。
> - 「active 标记」依赖 Task 7 改 VendorService.list 附带(见下面 Step 3)。

- [ ] **Step 3: 后端 VendorService.list 附带 activeModelId 标记**

回 `server/src/settings/vendor.service.ts` 的 `list`:`include: { models: true }` 改为先查 `user.activeModelId`,再 map 每个 model 加 `active: m.id === activeModelId`。FE `Vendor.models[i].active` 即可用。同步更新 `types/settings.ts` 的 `Model` 加 `active: boolean`。

- [ ] **Step 4: typecheck + lint + format + 手动验证**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix && pnpm format:fix`
启服务手动验证:设置页模型区 = 厂商分组;新建厂商/加模型/设默认/删除均工作。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/components/settings/ModelSettings.tsx agent-ui/src/components/settings/model-presets.ts agent-ui/src/types/settings.ts server/src/settings/vendor.service.ts
git commit -m "feat(agent-ui): 模型设置区重写为厂商单列分组 + 厂商/模型表单

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: 前端 per-agent 弹窗升级(optgroup 模型 + 温度)

**Files:**
- Modify: `agent-ui/src/components/settings/AgentModelSettings.tsx`

- [ ] **Step 1: 升级 AgentModelSettings**

关键改动(基于现有弹窗结构):
- `overrides` state 从 `Record<string, string>` 改为 `Record<string, AgentOverride>`(modelId + temperature)。
- 模型下拉改 `<optgroup>` 按厂商分组:`vendors.map(v => <optgroup label={v.name}>{v.models.map(m => <option value={m.id}>{m.model}</option>)}</optgroup>)`。需要 `listVendors` 拿厂商+模型列表(替代旧的 listModelConfigs)。
- 加温度 input(每个 agent 行,value = overrides[agentKey]?.temperature ?? '',onChange 调 putAgentModel({ modelId, temperature }))。
- 「清除」按钮:putAgentModel({ modelId: '', temperature: null }) → 删 override。
- 保存逻辑:模型或温度任一变化 → putAgentModel({ modelId: 当前|空, temperature: 当前|null })。

```tsx
// 关键渲染(每 agent 行):
<select value={overrides[a.key]?.modelId ?? ''} onChange={e => onChange(a.key, e.target.value, overrides[a.key]?.temperature ?? null)}>
  <option value="">默认</option>
  {vendors.map(v => (
    <optgroup key={v.id} label={v.name}>
      {v.models.map(m => <option key={m.id} value={m.id}>{m.model}</option>)}
    </optgroup>
  ))}
</select>
<input type="number" step="0.1" min="0" max="2"
  value={overrides[a.key]?.temperature ?? ''}
  onChange={e => onChange(a.key, overrides[a.key]?.modelId ?? '', e.target.value === '' ? null : Number(e.target.value))}
  placeholder="—" />
```

- [ ] **Step 2: typecheck + lint + format + 手动验证**

Run: `cd agent-ui && pnpm validate`
手动:per-agent 弹窗模型下拉按厂商分组、选模型+温度能保存、清除工作、刷新持久。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/settings/AgentModelSettings.tsx
git commit -m "feat(agent-ui): per-agent 弹窗升级(optgroup 模型 + 温度输入)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: 回归 + validate

- [ ] **Step 1: server 全量**

Run: `cd server && pnpm test && pnpm typecheck && pnpm lint`
Expected: 全绿。

- [ ] **Step 2: agent-ui validate**

Run: `cd agent-ui && pnpm validate`
Expected: 全绿。

- [ ] **Step 3: 手动端到端(启服务)**

- 设置页:新建厂商(GLM,provider=anthropic,baseUrl+key)→ 加模型(glm-4-air temp 0.7)→ 设默认。
- 再加一个模型(glm-4-flash)→ 复用同厂商凭证(不用重填 baseUrl/key)。
- per-agent 弹窗:给 writer 选 glm-4-flash + 温度 0.8 → 保存 → 刷新持久。
- 工作区发消息触发 runTurn → 后端日志确认用 override 模型 + 温度。

- [ ] **Step 4: 收尾 commit(若有 lint 修复)**

---

## Definition of Done

- [ ] Vendor/Model 两层 schema + 数据迁移(ModelConfig 数据保留) + prisma generate
- [ ] resolveModelConfig 三级温度(per-agent > spec > model)
- [ ] ModelConfigRecord 运行时从 Model+Vendor 拼装(assembleModelConfig)
- [ ] Vendor/Model CRUD + activate endpoint
- [ ] AgentModelOverride 升级(modelId + temperature),listMap 拼 ModelConfigRecord
- [ ] 设置页模型区 = 厂商单列分组 + 厂商/模型表单
- [ ] per-agent 弹窗 = optgroup 模型 + 温度
- [ ] `cd server && pnpm test/typecheck/lint` 全绿;`cd agent-ui && pnpm validate` 全绿
- [ ] model-factory / buildChatModel / getModel cache 零改动(核心稳定)

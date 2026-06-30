# per-agent 模型配置 Implementation Plan（Phase 22 · Plan 1/2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在设置页为每个 agent（main/writer/validator…）单独指定模型，未配置的回退默认模型；配置项从 `AGENT_TREE` 自动派生，新增子 agent 零额外代码自动出现。

**Architecture:** 新建 `AgentModelOverride(userId, agentKey, modelConfigId)` 表。`DeepAgentService.runTurn` 开头一次读 override map，`buildNode` 里 `overrideMap.get(spec.name) ?? activeConfig`。设置页遍历 `AGENT_TREE`（新 `buildAgentGroups`）渲染分组 + 推荐 badge。`recommendedTier` 是纯 UI 标注，运行时不读。

**Tech Stack:** NestJS 11 + Prisma 7（server）/ Next.js 15 + React 18（agent-ui）/ Jest（server 测试，agent-ui 无 test runner，用 `pnpm validate` 把关）

**关联 spec:** [docs/superpowers/specs/2026-06-30-novel-dissection-design.md](../specs/2026-06-30-novel-dissection-design.md) §5/§6.2/§7.2/§8

**范围:** 仅 per-agent 模型配置（写作树）。拆解模块 + 对标库 + 写作引用是 Plan 2/2，本 plan 不涉及。

---

## File Structure

**server（创建/修改）:**
- Modify: `server/prisma/schema.prisma` — 加 `AgentModelOverride` model + User/ModelConfig 反向关系
- Modify: `server/src/agentos/agent-tree.config.ts` — 加 `RecommendedTier` 类型 + `AgentSpec.recommendedTier` + 现有 spec 标注 + `buildAgentGroups()`
- Create: `server/src/settings/agent-model-override.service.ts` — override CRUD + `listMap`
- Create: `server/src/settings/agent-model-override.service.spec.ts` — 单测
- Create: `server/src/settings/agent-model.controller.ts` — 3 个 endpoint
- Create: `server/src/settings/agent-model.controller.spec.ts` — 单测
- Create: `server/src/settings/dto/agent-model-override.dto.ts` — PUT 入参校验
- Modify: `server/src/settings/settings.module.ts` — 注册新 controller/service
- Modify: `server/src/agentos/deep-agent.service.ts` — `runTurn` 读 override map，`buildAgentGraph`/`buildNode` 用 override

**agent-ui（创建/修改）:**
- Modify: `agent-ui/src/api/routes.ts` — 加 3 个 agent-model 路由
- Modify: `agent-ui/src/api/settings.ts` — 加 4 个 API 函数
- Modify: `agent-ui/src/types/settings.ts` — 加 AgentGroup / AgentOverride 类型
- Create: `agent-ui/src/components/settings/AgentModelSettings.tsx` — 分组配置 UI
- Modify: `agent-ui/src/app/settings/page.tsx` — 接入新组件

---

## Task 1: Prisma schema — AgentModelOverride 表

**Files:**
- Modify: `server/prisma/schema.prisma`（`User` model 约 L9-24，`ModelConfig` model 约 L395-410）

- [ ] **Step 1: 加 AgentModelOverride model**

在 `server/prisma/schema.prisma` 末尾（`VoiceProfile` model 之后）追加：

```prisma

/// per-agent 模型覆盖:用户为某 agent 指定用哪个 ModelConfig。
/// (userId, agentKey) 唯一。agentKey = AgentSpec.name(写作树+拆解树全局唯一)。
model AgentModelOverride {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  agentKey      String
  modelConfigId String
  modelConfig   ModelConfig @relation(fields: [modelConfigId], references: [id], onDelete: Cascade)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([userId, agentKey])
  @@index([userId])
}
```

- [ ] **Step 2: 给 User 加反向关系字段**

在 `model User` 里（`activeModelConfig` 那行之后）加：

```prisma
  agentOverrides     AgentModelOverride[]
```

- [ ] **Step 3: 给 ModelConfig 加反向关系字段**

在 `model ModelConfig` 里（`activeForUser` 那行之后）加：

```prisma
  agentOverrides     AgentModelOverride[]
```

- [ ] **Step 4: 建迁移并 regenerate client**

Run:
```bash
cd server && pnpm prisma migrate dev --name add_agent_model_override
```
Expected: 迁移 SQL 生成 + `prisma migrate dev` 自动跑。**但 Prisma 7 不会自动 regenerate client**（已知 gotcha），需手动：

```bash
cd server && pnpm prisma generate
```
Expected: `✔ Generated Prisma Client`，`agentModelOverride` delegate 出现在 client。

- [ ] **Step 5: 冒烟验证 client 可用**

Run:
```bash
cd server && pnpm typecheck
```
Expected: PASS（无类型错误）。

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(settings): AgentModelOverride 表 + 反向关系

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: agent-tree.config.ts — recommendedTier + buildAgentGroups

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`
- Test: `server/src/agentos/agent-tree.spec.ts`（新建；若已存在则追加）

- [ ] **Step 1: 写失败测试（recommendedTier + buildAgentGroups）**

创建 `server/src/agentos/agent-tree.spec.ts`：

```ts
import {
  AGENT_TREE,
  buildAgentGroups,
  collectSpecs,
  type RecommendedTier,
} from './agent-tree.config';

describe('agent-tree per-agent config', () => {
  it('每个 spec 都标了 recommendedTier', () => {
    const missing = collectSpecs(AGENT_TREE).filter((s) => !s.recommendedTier);
    expect(missing.map((s) => s.name)).toEqual([]);
  });

  it('recommendedTier 只取 strong/mid/cheap', () => {
    const tiers = collectSpecs(AGENT_TREE).map((s) => s.recommendedTier);
    const valid: RecommendedTier[] = ['strong', 'mid', 'cheap'];
    tiers.forEach((t) => expect(valid).toContain(t));
  });

  it('buildAgentGroups 把 main 单列,每个 orchestrator 自成一组(含子孙)', () => {
    const groups = buildAgentGroups();
    const names = groups.map((g) => g.group);
    expect(names).toContain('main');
    expect(names).toContain('chapter');
    const chapterGroup = groups.find((g) => g.group === 'chapter')!;
    expect(chapterGroup.agents.map((a) => a.key)).toEqual(
      expect.arrayContaining(['chapter', 'writer', 'settler', 'validator']),
    );
  });

  it('每个 agent 条目带 key/description/recommendedTier', () => {
    const groups = buildAgentGroups();
    const mainAgent = groups
      .find((g) => g.group === 'main')!
      .agents.find((a) => a.key === 'main')!;
    expect(mainAgent.description).toBeTruthy();
    expect(mainAgent.recommendedTier).toBe('strong');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- agent-tree.spec.ts`
Expected: FAIL（`recommendedTier` 不存在 / `buildAgentGroups` 未导出）。

- [ ] **Step 3: 加 RecommendedTier 类型 + AgentSpec 字段**

在 `server/src/agentos/agent-tree.config.ts` 顶部（`ModelTier` type 之后）加：

```ts
/** 纯 UI 标注(设置页推荐模型 badge),运行时不读。与 modelTier(maxTokens 档位)正交。 */
export type RecommendedTier = 'strong' | 'mid' | 'cheap';
```

在 `AgentSpec` interface 里加字段（`modelTier` 之后、`temperature` 之前）：

```ts
  recommendedTier: RecommendedTier;
```

- [ ] **Step 4: 给 AGENT_TREE 所有 spec 标 recommendedTier**

按下表给每个 spec 加 `recommendedTier:` 字段（与现有字段并列）：

| spec 路径 | recommendedTier |
|---|---|
| `main` | `strong` |
| `chapter` | `strong` |
| `chapter.writer` | `mid` |
| `chapter.settler` | `cheap` |
| `chapter.validator` | `strong` |
| `curator` | `mid` |
| `worldbuilder` | `strong` |
| `worldbuilder.wb-writer` | `mid` |
| `worldbuilder.wb-critic` | `strong` |
| `outliner` | `strong` |
| `outliner.outline-writer` | `mid` |
| `outliner.outline-critic` | `strong` |
| `character` | `strong` |
| `character.char-writer` | `mid` |
| `character.char-critic` | `strong` |

例如根节点改为：

```ts
export const AGENT_TREE: AgentSpec = {
  name: 'main',
  description: '小说生成流程的编排(主 agent)。',
  promptKey: 'MAIN',
  modelTier: 'long',
  recommendedTier: 'strong',
  tools: [/* 不变 */],
  subagents: [/* 不变 */],
};
```

- [ ] **Step 5: 加 buildAgentGroups 派生函数**

在 `agent-tree.config.ts` 末尾（`describeTree` 之后）加：

```ts
/** per-agent 模型配置 UI 用的 agent 分组:main 单列,每个 orchestrator 自成一组(含其子孙)。 */
export interface AgentGroupEntry {
  key: string;
  description: string;
  recommendedTier: RecommendedTier;
}
export interface AgentGroup {
  group: string; // orchestrator 的 name
  agents: AgentGroupEntry[];
}
export function buildAgentGroups(): AgentGroup[] {
  const entry = (s: AgentSpec): AgentGroupEntry => ({
    key: s.name,
    description: s.description,
    recommendedTier: s.recommendedTier,
  });
  const groups: AgentGroup[] = [
    { group: AGENT_TREE.name, agents: [entry(AGENT_TREE)] },
  ];
  for (const orch of AGENT_TREE.subagents ?? []) {
    groups.push({
      group: orch.name,
      agents: collectSpecs(orch).map(entry),
    });
  }
  return groups;
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd server && pnpm test -- agent-tree.spec.ts`
Expected: PASS（4 个 it 全过）。

- [ ] **Step 7: 全量回归 + typecheck**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: 全绿（给 spec 加 required 字段不应破坏现有测试；若 `describeTree`/快照测试因新增字段失败，更新快照）。

- [ ] **Step 8: Commit**

```bash
git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.spec.ts
git commit -m "feat(agentos): AgentSpec.recommendedTier + buildAgentGroups(设置页派生)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: AgentModelOverrideService

**Files:**
- Create: `server/src/settings/agent-model-override.service.ts`
- Test: `server/src/settings/agent-model-override.service.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/settings/agent-model-override.service.spec.ts`：

```ts
import { AgentModelOverrideService } from './agent-model-override.service';

const prisma = {
  agentModelOverride: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  modelConfig: {
    findFirst: jest.fn(),
  },
};

const svc = new AgentModelOverrideService(prisma as never);

beforeEach(() => jest.clearAllMocks());

describe('AgentModelOverrideService', () => {
  it('listMap 返回 agentKey→modelConfig 行 map(含 apiKey)', async () => {
    (prisma.agentModelOverride.findMany as jest.Mock).mockResolvedValue([
      {
        agentKey: 'writer',
        modelConfig: { id: 'mc1', apiKey: 'sk-x', updatedAt: new Date(0) },
      },
    ]);
    const map = await svc.listMap('u1');
    expect(map.get('writer')?.id).toBe('mc1');
    expect(map.get('writer')?.apiKey).toBe('sk-x');
  });

  it('upsert 校验 modelConfig 归属当前用户', async () => {
    (prisma.modelConfig.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.upsert('u1', 'writer', 'mcX')).rejects.toThrow();
    expect(prisma.agentModelOverride.upsert).not.toHaveBeenCalled();
  });

  it('upsert 归属校验通过后写库', async () => {
    (prisma.modelConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'mc1' });
    await svc.upsert('u1', 'writer', 'mc1');
    expect(prisma.agentModelOverride.upsert).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
      create: { userId: 'u1', agentKey: 'writer', modelConfigId: 'mc1' },
      update: { modelConfigId: 'mc1' },
    });
  });

  it('listForApi 返回 agentKey→modelConfigId(脱敏)', async () => {
    (prisma.agentModelOverride.findMany as jest.Mock).mockResolvedValue([
      { agentKey: 'writer', modelConfigId: 'mc1' },
    ]);
    const out = await svc.listForApi('u1');
    expect(out).toEqual({ writer: 'mc1' });
  });

  it('remove 删指定 agentKey', async () => {
    await svc.remove('u1', 'writer');
    expect(prisma.agentModelOverride.delete).toHaveBeenCalledWith({
      where: { userId_agentKey: { userId: 'u1', agentKey: 'writer' } },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- agent-model-override.service.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 service**

创建 `server/src/settings/agent-model-override.service.ts`：

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ModelConfigRecord } from '../agentos/model-factory';

/** agentKey → 完整 ModelConfig(含 apiKey,喂 buildChatModel)。 */
export type OverrideMap = Map<string, ModelConfigRecord>;

@Injectable()
export class AgentModelOverrideService {
  constructor(private readonly prisma: PrismaService) {}

  /** runTurn 开头一次读全量 override(含 apiKey),buildNode 据此 override 优先。 */
  async listMap(userId: string): Promise<OverrideMap> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      include: { modelConfig: true },
    });
    const map: OverrideMap = new Map();
    for (const r of rows) {
      const c = r.modelConfig;
      map.set(r.agentKey, {
        id: c.id,
        provider: c.provider,
        model: c.model,
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        temperature: c.temperature,
        updatedAt: c.updatedAt,
      });
    }
    return map;
  }

  /** 设置页用:agentKey → modelConfigId(脱敏,不含 key)。 */
  async listForApi(
    userId: string,
  ): Promise<Record<string, string>> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      select: { agentKey: true, modelConfigId: true },
    });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.agentKey] = r.modelConfigId;
    return out;
  }

  async upsert(
    userId: string,
    agentKey: string,
    modelConfigId: string,
  ): Promise<void> {
    const owned = await this.prisma.modelConfig.findFirst({
      where: { id: modelConfigId, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model config not found');
    await this.prisma.agentModelOverride.upsert({
      where: { userId_agentKey: { userId, agentKey } },
      create: { userId, agentKey, modelConfigId },
      update: { modelConfigId },
    });
  }

  async remove(userId: string, agentKey: string): Promise<void> {
    await this.prisma.agentModelOverride.delete({
      where: { userId_agentKey: { userId, agentKey } },
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- agent-model-override.service.spec.ts`
Expected: PASS（5 个 it 全过）。

- [ ] **Step 5: Commit**

```bash
git add server/src/settings/agent-model-override.service.ts server/src/settings/agent-model-override.service.spec.ts
git commit -m "feat(settings): AgentModelOverrideService(listMap/upsert/remove)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: DeepAgentService resolveModel 链改造

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`
- Modify: `server/src/agentos/agent-tree.config.ts`（`resolveModelConfig` 不变，仅复用）
- Test: 新增 `server/src/agentos/deep-agent.override.spec.ts`（纯函数级，避免拉起 langgraph）

- [ ] **Step 1: 写失败测试（override 选择逻辑）**

`resolveModel` 链的「override 优先」逻辑用一个纯函数 `pickConfig` 表达，便于单测。创建 `server/src/agentos/deep-agent.override.spec.ts`：

```ts
import { pickAgentConfig } from './deep-agent.service';

const active = { id: 'active', provider: 'p', model: 'm', baseUrl: null, apiKey: 'k', temperature: 0.5, updatedAt: new Date(0) };
const override = { ...active, id: 'override' };

describe('pickAgentConfig (override 优先)', () => {
  it('有 override 用 override', () => {
    const map = new Map([['writer', override]]);
    expect(pickAgentConfig('writer', map, active).id).toBe('override');
  });
  it('无 override 回退 active', () => {
    expect(pickAgentConfig('writer', new Map(), active).id).toBe('active');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- deep-agent.override.spec.ts`
Expected: FAIL（`pickAgentConfig` 未导出）。

- [ ] **Step 3: 导出纯函数 pickAgentConfig**

在 `server/src/agentos/deep-agent.service.ts` 顶部（`buildTurnMessages` 之后、class 之前）加：

```ts
/** override 优先,无则 active。纯函数好测;buildNode 用它解析每个 spec 的 config。 */
export function pickAgentConfig(
  agentKey: string,
  overrideMap: Map<string, ModelConfigRecord>,
  activeConfig: ModelConfigRecord,
): ModelConfigRecord {
  return overrideMap.get(agentKey) ?? activeConfig;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- deep-agent.override.spec.ts`
Expected: PASS。

- [ ] **Step 5: 注入 AgentModelOverrideService**

在 `DeepAgentService.constructor` 参数列表（`modelConfigs` 之后）加：

```ts
    private readonly agentOverrides: AgentModelOverrideService,
```

并在文件顶部 import：

```ts
import { AgentModelOverrideService } from '../settings/agent-model-override.service';
```

- [ ] **Step 6: runTurn 读 overrideMap 并传入 buildAgentGraph**

在 `runTurn` 里，紧接 `const config: ModelConfigRecord = {...}` 之后加：

```ts
    const overrideMap = await this.agentOverrides.listMap(userId);
```

并把 `overrideMap` 加入 `this.buildAgentGraph({...})` 的实参（在 `activeConfig: config,` 之后）：

```ts
      activeConfig: config,
      overrideMap,
```

- [ ] **Step 7: buildAgentGraph 接收 overrideMap，buildNode 用 pickAgentConfig**

在 `buildAgentGraph` 的 `args` 类型里加字段：

```ts
    activeConfig: ModelConfigRecord;
    overrideMap: Map<string, ModelConfigRecord>;
```

解构里加 `overrideMap`：

```ts
    activeConfig,
    overrideMap,
```

把 `resolveModel` 改造为读 override：

```ts
  private async resolveModel(
    spec: AgentSpec,
    activeConfig: ModelConfigRecord,
    overrideMap: Map<string, ModelConfigRecord>,
  ) {
    return this.getModel(
      resolveModelConfig(spec, pickAgentConfig(spec.name, overrideMap, activeConfig)),
      MAX_TOKENS_BY_TIER[spec.modelTier],
    );
  }
```

更新 `buildNode` 内的调用（`model:` 那行）：

```ts
        model: await this.resolveModel(spec, activeConfig, overrideMap),
```

更新 `mainModel` 那行（root 用 AGENT_TREE，也走 override，使 main 可单独配）：

```ts
    const mainModel = await this.resolveModel(AGENT_TREE, activeConfig, overrideMap);
```

更新 `rewind` 方法里的 `this.buildAgentGraph({...})` 调用，加 `overrideMap: new Map(),`（rewind 不调 LLM，模型不重要，传空 map）。

- [ ] **Step 8: 全量回归**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: 全绿。若现有 `deep-agent.service` 相关 spec 因 constructor 新增依赖失败，在测试里补 `agentOverrides: { listMap: jest.fn().mockResolvedValue(new Map()) }` 注入。

- [ ] **Step 9: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.override.spec.ts
git commit -m "feat(agentos): runTurn 读 AgentModelOverride,buildNode override 优先

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: AgentModelController + 模块注册

**Files:**
- Create: `server/src/settings/dto/agent-model-override.dto.ts`
- Create: `server/src/settings/agent-model.controller.ts`
- Create: `server/src/settings/agent-model.controller.spec.ts`
- Modify: `server/src/settings/settings.module.ts`

- [ ] **Step 1: 写 DTO**

创建 `server/src/settings/dto/agent-model-override.dto.ts`：

```ts
import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertAgentOverrideDto {
  @IsString()
  @IsNotEmpty()
  modelConfigId!: string;
}
```

- [ ] **Step 2: 写失败测试（controller）**

创建 `server/src/settings/agent-model.controller.spec.ts`（controller 直接 import `buildAgentGroups`，故 constructor 只注入 `overrides`）：

```ts
import { AgentModelController } from './agent-model.controller';
import { buildAgentGroups } from '../agentos/agent-tree.config';

const overrides = {
  listForApi: jest.fn(),
  upsert: jest.fn(),
  remove: jest.fn(),
};

const ctrl = new AgentModelController(overrides as never);
const user = { id: 'u1' };

beforeEach(() => jest.clearAllMocks());

describe('AgentModelController', () => {
  it('GET /agent-tree 返回派生分组', () => {
    expect(ctrl.getTree()).toEqual(buildAgentGroups());
  });
  it('GET /agent-models 返回 override map', async () => {
    overrides.listForApi.mockResolvedValue({ writer: 'mc1' });
    await expect(ctrl.list(user as never)).resolves.toEqual({ writer: 'mc1' });
  });
  it('PUT /agent-models/:agentKey 调 upsert', async () => {
    await ctrl.upsert(user as never, 'writer', { modelConfigId: 'mc1' });
    expect(overrides.upsert).toHaveBeenCalledWith('u1', 'writer', 'mc1');
  });
  it('DELETE /agent-models/:agentKey 调 remove', async () => {
    await ctrl.remove(user as never, 'writer');
    expect(overrides.remove).toHaveBeenCalledWith('u1', 'writer');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd server && pnpm test -- agent-model.controller.spec.ts`
Expected: FAIL（controller 不存在）。

- [ ] **Step 4: 实现 controller**

创建 `server/src/settings/agent-model.controller.ts`：

```ts
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { AgentModelOverrideService } from './agent-model-override.service';
import { buildAgentGroups, type AgentGroup } from '../agentos/agent-tree.config';
import { UpsertAgentOverrideDto } from './dto/agent-model-override.dto';

@Controller('settings')
export class AgentModelController {
  constructor(
    private readonly overrides: AgentModelOverrideService,
  ) {}

  /** 派生的 agent 分组(设置页渲染用)。无用户态,但仍走鉴权。 */
  @Get('agent-tree')
  getTree(): AgentGroup[] {
    return buildAgentGroups();
  }

  @Get('agent-models')
  list(@CurrentUser() user: RequestUser): Promise<Record<string, string>> {
    return this.overrides.listForApi(user.id);
  }

  @Put('agent-models/:agentKey')
  upsert(
    @CurrentUser() user: RequestUser,
    @Param('agentKey') agentKey: string,
    @Body() dto: UpsertAgentOverrideDto,
  ): Promise<void> {
    return this.overrides.upsert(user.id, agentKey, dto.modelConfigId);
  }

  @Delete('agent-models/:agentKey')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('agentKey') agentKey: string,
  ): Promise<void> {
    return this.overrides.remove(user.id, agentKey);
  }
}
```

- [ ] **Step 5: 注册到 settings.module**

修改 `server/src/settings/settings.module.ts`：

```ts
import { AgentModelController } from './agent-model.controller';
import { AgentModelOverrideService } from './agent-model-override.service';
// ...
@Module({
  controllers: [ModelConfigController, VoiceProfileController, AgentModelController],
  providers: [ModelConfigService, VoiceProfileService, AgentModelOverrideService],
  exports: [ModelConfigService, VoiceProfileService, AgentModelOverrideService],
})
```

`AgentosModule` 已 import `SettingsModule`（拿 `ModelConfigService`），故 `AgentModelOverrideService` 自动可注入 `DeepAgentService`。

- [ ] **Step 6: 跑测试确认通过 + 全量回归**

Run: `cd server && pnpm test -- agent-model.controller.spec.ts && pnpm typecheck && pnpm test`
Expected: PASS + 全绿。

- [ ] **Step 7: Commit**

```bash
git add server/src/settings/agent-model.controller.ts server/src/settings/agent-model.controller.spec.ts server/src/settings/dto/agent-model-override.dto.ts server/src/settings/settings.module.ts
git commit -m "feat(settings): agent-tree/agent-models endpoint(per-agent 配置)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 前端 API 层（routes + settings 封装 + 类型）

**Files:**
- Modify: `agent-ui/src/api/routes.ts`
- Modify: `agent-ui/src/api/settings.ts`
- Modify: `agent-ui/src/types/settings.ts`

> agent-ui 无 test runner（CLAUDE.md），前端任务用 `pnpm typecheck` + `pnpm lint` 把关，最后 `pnpm validate`。

- [ ] **Step 1: 加路由**

在 `agent-ui/src/api/routes.ts` 的 `SettingsModelActivate` 之后加：

```ts
  SettingsAgentTree: (base: string) => `${base}/settings/agent-tree`,
  SettingsAgentModels: (base: string) => `${base}/settings/agent-models`,
  SettingsAgentModel: (base: string, agentKey: string) =>
    `${base}/settings/agent-models/${agentKey}`,
```

- [ ] **Step 2: 加类型**

在 `agent-ui/src/types/settings.ts` 末尾加：

```ts
export type RecommendedTier = 'strong' | 'mid' | 'cheap'

export interface AgentGroupEntry {
  key: string
  description: string
  recommendedTier: RecommendedTier
}
export interface AgentGroup {
  group: string
  agents: AgentGroupEntry[]
}
```

- [ ] **Step 3: 加 API 函数**

先读 `agent-ui/src/api/settings.ts` 确认现有 `listModelConfigs` 的 fetch 封装签名（带 `Authorization: Bearer ${token}`）。在文件末尾追加（保持同一封装风格）：

```ts
import type { AgentGroup } from '@/types/settings'

export const listAgentTree = async (
  base: string,
  token: string
): Promise<AgentGroup[]> => {
  const res = await fetch(APIRoutes.SettingsAgentTree(base), {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`agent-tree failed (${res.status})`)
  return res.json()
}

export const listAgentModels = async (
  base: string,
  token: string
): Promise<Record<string, string>> => {
  const res = await fetch(APIRoutes.SettingsAgentModels(base), {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`agent-models failed (${res.status})`)
  return res.json()
}

export const putAgentModel = async (
  base: string,
  token: string,
  agentKey: string,
  modelConfigId: string
): Promise<void> => {
  const res = await fetch(APIRoutes.SettingsAgentModel(base, agentKey), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ modelConfigId })
  })
  if (!res.ok) throw new Error(`agent-model put failed (${res.status})`)
}

export const deleteAgentModel = async (
  base: string,
  token: string,
  agentKey: string
): Promise<void> => {
  const res = await fetch(APIRoutes.SettingsAgentModel(base, agentKey), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`agent-model delete failed (${res.status})`)
}
```

- [ ] **Step 4: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/api/routes.ts agent-ui/src/api/settings.ts agent-ui/src/types/settings.ts
git commit -m "feat(agent-ui): agent-tree/agent-models API 封装 + 类型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 前端 AgentModelSettings 组件 + 设置页接入

**Files:**
- Create: `agent-ui/src/components/settings/AgentModelSettings.tsx`
- Modify: `agent-ui/src/app/settings/page.tsx`

- [ ] **Step 1: 实现组件**

创建 `agent-ui/src/components/settings/AgentModelSettings.tsx`（参考现有 `ModelSettings.tsx` 的 `useStore(endpoint/token)` + `toast` + `input-base` 模式）：

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  deleteAgentModel,
  listAgentModels,
  listAgentTree,
  putAgentModel
} from '@/api/settings'
import type { AgentGroup, ModelConfig, RecommendedTier } from '@/types/settings'

const TIER_LABEL: Record<RecommendedTier, string> = {
  strong: '🔴 推荐强',
  mid: '🟡 推荐中',
  cheap: '💚 推荐便宜'
}
const TIER_COLOR: Record<RecommendedTier, string> = {
  strong: 'text-red-400',
  mid: 'text-yellow-400',
  cheap: 'text-green-400'
}

interface Props {
  configs: ModelConfig[] // 复用父级已加载的模型列表(含 name/id)
}

const AgentModelSettings = ({ configs }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [g, o] = await Promise.all([
        listAgentTree(endpoint, token),
        listAgentModels(endpoint, token)
      ])
      setGroups(g)
      setOverrides(o)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onChange = async (agentKey: string, modelConfigId: string) => {
    const prev = overrides[agentKey]
    try {
      if (modelConfigId === '') {
        const { [agentKey]: _drop, ...rest } = overrides
        setOverrides(rest)
        await deleteAgentModel(endpoint, token, agentKey)
      } else {
        setOverrides({ ...overrides, [agentKey]: modelConfigId })
        await putAgentModel(endpoint, token, agentKey, modelConfigId)
      }
      toast.success('已保存')
    } catch (err) {
      setOverrides({ ...overrides, [agentKey]: prev }) // 回滚
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  if (loading) return <p className="text-xs text-muted">加载中…</p>

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.group}>
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
            {g.group}
          </h3>
          <div className="space-y-1.5">
            {g.agents.map((a) => (
              <div
                key={a.key}
                className="flex items-center gap-3 rounded-lg border border-primary/10 bg-background-secondary px-3 py-2"
              >
                <div className="w-44 shrink-0">
                  <div className="text-sm text-primary">{a.key}</div>
                  <div className="truncate text-xs text-muted">
                    {a.description}
                  </div>
                </div>
                <span className={`text-[10px] ${TIER_COLOR[a.recommendedTier]}`}>
                  {TIER_LABEL[a.recommendedTier]}
                </span>
                <select
                  value={overrides[a.key] ?? ''}
                  onChange={(e) => onChange(a.key, e.target.value)}
                  className="input-base ml-auto w-48"
                >
                  <option value="">默认</option>
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default AgentModelSettings
```

- [ ] **Step 2: 设置页接入**

修改 `agent-ui/src/app/settings/page.tsx`。`Settings` 组件现在需要把模型列表传给新组件，所以把 `ModelSettings` 和 `AgentModelSettings` 一起放在「模型设置」下。在「模型设置」`<ModelSettings />` 之后加新区块：

```tsx
import AgentModelSettings from '@/components/settings/AgentModelSettings'
// ...
        <h2 className="mb-2 text-sm font-semibold text-primary">模型设置</h2>
        <div className="mb-10">
          <ModelSettings />
        </div>

        <h2 className="mb-2 text-sm font-semibold text-primary">
          per-agent 模型
        </h2>
        <p className="mb-3 text-xs text-muted">
          为单个 agent 单独指定模型(未指定=用上面的默认模型)。推荐级别仅作参考。
        </p>
        <div className="mb-10">
          <AgentModelSettingsWrapper />
        </div>
```

`AgentModelSettings` 需要 `configs`，而 `ModelSettings` 内部自己加载 configs。为避免重复加载，把模型列表加载提到 `Settings` 层：在 `Settings` 组件加 `const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([])` + 加载逻辑（调 `listModelConfigs`），传给 `AgentModelSettings`。`ModelSettings` 保持不变（它内部也加载一份，轻微重复但改动最小；若要消除重复可后续重构 `ModelSettings` 接受 props）。

在 `settings/page.tsx` 末尾加包装组件：

```tsx
import { listModelConfigs } from '@/api/settings'
import type { ModelConfig } from '@/types/settings'

const AgentModelSettingsWrapper = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  useEffect(() => {
    listModelConfigs(endpoint, token).then(setConfigs).catch(() => {})
  }, [endpoint, token])
  return <AgentModelSettings configs={configs} />
}
```

- [ ] **Step 3: typecheck + lint + format**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix && pnpm format:fix`
Expected: PASS。

- [ ] **Step 4: 手动验证（启服务）**

Run（两个终端）:
```bash
pnpm dev:server   # :3001
pnpm dev:agent-ui # :3000
```
打开 http://localhost:3000/settings：
- 看到「per-agent 模型」区，列出 main/chapter/curator… 分组，每个 agent 有描述 + 推荐 badge + 下拉。
- 给 `writer` 选一个模型 → toast「已保存」→ 刷新页面仍记住。
- 把 `writer` 改回「默认」→ override 删除。
Expected: 全部符合。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/components/settings/AgentModelSettings.tsx agent-ui/src/app/settings/page.tsx
git commit -m "feat(agent-ui): per-agent 模型配置区(分组/推荐badge/下拉)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: 端到端回归 + validate

**Files:** 无（验证任务）

- [ ] **Step 1: server 全量测试 + lint**

Run: `cd server && pnpm test && pnpm lint && pnpm typecheck`
Expected: 全绿。

- [ ] **Step 2: agent-ui validate**

Run: `cd agent-ui && pnpm validate`
Expected: lint + format + typecheck 全过。

- [ ] **Step 3: 真实 agent 运行验证（手动）**

启服务后，在工作台对一本小说发一条消息触发 `runTurn`：
- 给 `validator` 配一个不同模型 → 看后端日志 `runTurn:` 是否对该 agent 用了 override 模型（在 `getModel` cache key 体现为 override 的 config.id）。
- 把所有 override 清空 → 确认回退到 active 模型，行为与改造前一致。
Expected: override 生效；清空后回退正常。

- [ ] **Step 4: 收尾 commit（若有 lint 修复）**

```bash
git add -A
git commit -m "chore: per-agent 模型配置 lint 收尾

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Definition of Done

- [ ] `AgentModelOverride` 表已迁移，client 已 regenerate
- [ ] 每个 AGENT_TREE spec 标了 `recommendedTier`；`buildAgentGroups()` 可用
- [ ] `DeepAgentService.runTurn` 读 override，`buildNode` override 优先，清空后回退正常
- [ ] `GET /settings/agent-tree` / `GET|PUT|DELETE /settings/agent-models[/:key]` 可用
- [ ] 设置页「per-agent 模型」区分组渲染、可保存、刷新持久
- [ ] `cd server && pnpm test` 全绿；`cd agent-ui && pnpm validate` 全绿
- [ ] Plan 2（拆解 + 对标库 + 写作引用）可在此机制上扩展（DISSECT_TREE 的 agent 自动进设置页）

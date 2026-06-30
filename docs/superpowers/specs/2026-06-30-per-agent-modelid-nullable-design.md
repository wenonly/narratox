# per-agent modelId 可空 + 删温度中间级

- **日期**：2026-06-30
- **状态**：设计已确认（待 plan）
- **关联**：修正 [model-vendor 重构](./2026-06-30-model-config-vendor-restructure-design.md) 的 per-agent 语义。

---

## 1. 背景与目标

model-vendor 重构后，`AgentModelOverride.modelId` 是 **required** FK。导致两个问题：

1. **温度与模型挂钩**：「模型选默认 + 改温度」时，为规避后端 P2025（C1 fix），温度变化会自动 fallback 绑定 active model——但用户要的是**两者独立**：模型默认就是空（用全局默认），温度单独设。
2. **温度中间级是死代码**：`AgentSpec.temperature`（代码级角色温度）从未被任何 agent 使用（grep 确认全 undefined），是多馀的优先级层。

**目标**：
- `AgentModelOverride.modelId` 改**可空**：null = 用全局 active model，只覆盖温度。
- 删 `AgentSpec.temperature` 中间级：温度优先级简化为**两级**（per-agent > Model）。

---

## 2. 需求决策

| # | 决策 | 选择 |
|---|---|---|
| 1 | modelId 语义 | **可空**：null = 用 active model + per-agent 温度；非空 = 指定 model + 温度 |
| 2 | override 清除 | **自动清除**：modelId null + temperature null → 后端 remove（两者都空 = 无 override） |
| 3 | 温度中间级 | **删除** AgentSpec.temperature（死代码）；resolveModelConfig 改两级 |
| 4 | 运行时 fallback | override config null（modelId null）→ resolveModel 用 activeConfig |

---

## 3. 数据模型（schema 变更）

```prisma
model AgentModelOverride {
  id            String @id @default(cuid())
  userId        String
  user          User   @relation(...)
  agentKey      String
  modelId       String?   // ← 改可空(原 required)
  model         Model?    // ← 可选关系(原 required)
  temperature   Float?
  ...
}
```

migration：`ALTER TABLE "AgentModelOverride" ALTER COLUMN "modelId" DROP NOT NULL`（外键约束改可选）。手动 `prisma generate`。

---

## 4. 后端设计

### 4.1 删 AgentSpec.temperature（agent-tree.config.ts）

- `AgentSpec` interface 去掉 `temperature?: number` 字段
- `resolveModelConfig` 改两级签名（去掉 spec 参数）：

```ts
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

温度两级优先级：**per-agent temperatureOverride > Model.temperature**。

### 4.2 AgentOverrideEntry.config 可 null（deep-agent.service.ts）

```ts
export interface AgentOverrideEntry {
  config: ModelConfigRecord | null;   // ← null = modelId 空,用 active
  temperatureOverride: number | null;
}
```

`pickAgentConfig` 不变（返回 override entry 或回退 `{config: activeConfig, temperatureOverride: null}`）——但 override 的 config 可能是 null。

`resolveModel` 改一行：null → 用 active：

```ts
private async resolveModel(spec, activeConfig, overrideMap) {
  const { config: overrideConfig, temperatureOverride } = pickAgentConfig(spec.name, overrideMap, activeConfig);
  const config = overrideConfig ?? activeConfig;   // ← null → active
  return this.getModel(
    resolveModelConfig(config, temperatureOverride),
    MAX_TOKENS_BY_TIER[spec.modelTier],
  );
}
```

### 4.3 listMap / upsert（agent-model-override.service.ts）

`listMap`：modelId null → config null：
```ts
config: r.model ? assembleModelConfig(r.model, r.model.vendor) : null,
```

`upsert`：清除逻辑——两者都空 → remove：
```ts
async upsert(userId, agentKey, dto: { modelId?, temperature? }) {
  if (!dto.modelId && dto.temperature == null) {
    await this.remove(userId, agentKey);   // 两者空 = 无 override
    return;
  }
  // 否则 upsert(modelId 可空)
  if (dto.modelId) {
    // 校验 model 归属(经 vendor)
  }
  await this.prisma.agentModelOverride.upsert({
    where: { userId_agentKey: { userId, agentKey } },
    create: { userId, agentKey, modelId: dto.modelId ?? null, temperature: dto.temperature ?? null },
    update: { modelId: dto.modelId ?? null, temperature: dto.temperature ?? null },
  });
}
```

`listForApi` 不变（返回 `{modelId, temperature}`，modelId 可能 null）。

---

## 5. 前端（AgentModelSettings.tsx）

- `onChange` **去掉 fallback active model**（modelId 空合法，直接传空）
- select「默认」+ 温度留空 → `putAgentModel({modelId: undefined, temperature: null})` → 后端 remove
- 选默认模型 + 设温度 → override `{modelId: null, temperature}`（温度独立）

```ts
const onChange = async (agentKey, modelId: string, temperature: number | null) => {
  // 不再 fallback active model;modelId 空合法
  ...
  await putAgentModel(endpoint, token, agentKey, { modelId: modelId || undefined, temperature });
};
```

select onChange 传当前 modelId（可能空）；温度 onChange 传当前 modelId（可能空）+ 新温度。

---

## 6. 影响范围 + 测试

**改动文件**：
- `server/prisma/schema.prisma` + migration（modelId 可空）
- `server/src/agentos/agent-tree.config.ts`（删 AgentSpec.temperature + resolveModelConfig 两级）
- `server/src/agentos/deep-agent.service.ts`（AgentOverrideEntry.config 可 null + resolveModel 一行）
- `server/src/settings/agent-model-override.service.ts`（listMap modelId null + upsert 清除逻辑）
- `agent-ui/src/components/settings/AgentModelSettings.tsx`（去 fallback）

**不变**：model-factory / getActive / assembleModelConfig / Vendor/Model CRUD / 前端模型设置区。

**测试更新**：
- `agent-tree.config.spec.ts`：resolveModelConfig 两级（删 spec 参数的用例 + per-agent > Model）
- `deep-agent.override.spec.ts`：pickAgentConfig 返回 {config: null|Record, temperatureOverride}
- `agent-model-override.service.spec.ts`：listMap modelId null → config null；upsert 两者空 → remove；upsert modelId null + temperature → 建 override
- `model-factory.spec.ts`：不变

---

## 7. 实施顺序（供 plan 参考）

1. schema migration（modelId 可空）+ prisma generate
2. 删 AgentSpec.temperature + resolveModelConfig 两级（纯函数 TDD）
3. AgentOverrideEntry.config 可 null + resolveModel 适配 + pickAgentConfig 测试
4. listMap（modelId null）+ upsert（清除逻辑）+ service 测试
5. 前端 AgentModelSettings 去 fallback
6. 回归（server test/typecheck + agent-ui validate）

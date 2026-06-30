# 模型配置厂商重构（Vendor/Model 两层 + per-agent 升级）

- **日期**：2026-06-30
- **状态**：设计已确认（待 plan）
- **关联**：承接 Plan 1（per-agent 模型配置）+ 拆解小说 spec（Phase 22）。本重构把扁平的 `ModelConfig` 拆成厂商-模型两层，并升级 per-agent 配置（加温度）。

---

## 1. 背景与目标

当前 `ModelConfig` 是扁平单层：每条含 `provider/model/baseUrl/apiKey/temperature`。三个痛点：

1. **重复配置**：同厂商加新模型要把 baseUrl/apiKey 重填一遍（同一套凭证重复）。
2. **排版不对称**：设置页 `ModelSettings` 是左右布局（左 `w-64` 列表 + 右 `flex-1` 编辑器），配置少时左短右长，视觉不平衡。
3. **per-agent 不可调温度**：`AgentModelOverride` 只能选模型，不能配温度；温度链靠代码 `AgentSpec.temperature`（agent-tree.config 静态写死），用户在 UI 改不了。

**目标**：
- `ModelConfig` 拆 `Vendor`（厂商级 provider/baseUrl/apiKey）+ `Model`（模型级 model/temperature），同厂商多模型共用凭证。
- 设置页模型区改**厂商单列分组**（解决不对称）。
- `AgentModelOverride` 升级：`modelId` + `temperature`（per-agent 配温度）；温度三级优先级（per-agent > 代码角色 > 模型）。

---

## 2. 需求决策汇总（均已确认）

| # | 决策 | 选择 |
|---|---|---|
| 1 | 厂商来源 | **B 自由创建**：新建厂商 = 现有「新建模型」表单（选 provider + baseUrl + apiKey + 名）。provider 仍从四类选（openai-compatible/anthropic/gemini/deepseek，model-factory 按它路由）。不预置厂商种子。 |
| 2 | 设置页排版 | **方案 2 单列分组**：每个厂商一个可展开区块（头部 + 模型行），抛弃左右布局 |
| 3 | per-agent 配置范围 | **modelId + temperature**（YAGNI，不加 maxTokens/top_p） |
| 4 | 迁移 | **一次性迁移**（不做新旧并存双写） |
| 5 | 温度优先级 | **per-agent > AgentSpec（代码角色）> Model（模型默认）** |
| 6 | per-agent 模型下拉 | **optgroup 按厂商分组**（一个下拉跨厂商选，省一次点击） |
| 7 | per-agent 温度留空 | = 不覆盖（走代码角色默认） |

---

## 3. 数据模型（Prisma）

新增 `Vendor` / `Model`，改 `User` / `AgentModelOverride`，删 `ModelConfig`。

```prisma
/// 厂商(凭证级):同厂商多模型共用 provider/baseUrl/apiKey。
model Vendor {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String   // 用户起的名,如「智谱 GLM」
  provider  String   // openai-compatible | anthropic | gemini | deepseek
  baseUrl   String?  // 留空走 provider 默认端点
  apiKey    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  models    Model[]

  @@index([userId])
}

/// 模型(挂在厂商下):只填 model ID + 温度,凭证继承厂商。
model Model {
  id          String   @id @default(cuid())
  vendorId    String
  vendor      Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  model       String   // 模型 ID,如 glm-4-air
  temperature Float?   // 模型默认温度(可空)
  name        String?  // 可选别名,空则展示 model
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([vendorId])
}
```

`User` 改：`activeModelConfigId` → `activeModelId`（指 `Model`，onDelete SetNull）。

`AgentModelOverride` 改：`modelConfigId` → `modelId`（指 `Model`，onDelete Cascade）+ 加 `temperature Float?`。

删 `ModelConfig`。

---

## 4. 迁移策略（一次性）

prisma migrate + 数据迁移脚本（SQL，放在 migration 里一次性跑）：

1. 建 `Vendor` / `Model` 表；`User` 加 `activeModelId`；`AgentModelOverride` 加 `modelId`/`temperature`（先可空，迁移后填）。
2. **去重建 Vendor**：`INSERT INTO Vendor SELECT DISTINCT (userId, provider, baseUrl, apiKey)` FROM `ModelConfig`，每组一个 Vendor（同用户、同 provider、同 baseUrl、同 key 合并）。
3. **建 Model**：每条 `ModelConfig` → `Model(vendorId=匹配 Vendor, model, temperature, name=name)`。
4. **重映射外键**：`User.activeModelConfigId` → `activeModelId`（按 ModelConfig→Model 映射）；`AgentModelOverride.modelConfigId` → `modelId`。
5. `AgentModelOverride.temperature` 全部置 `null`（保持现有行为，见 §6）。
6. 删 `ModelConfig` 及其关系。

**去重边界**：同 provider 不同 baseUrl（自部署端点）→ 不同 Vendor（正确）；同 provider+baseUrl 不同 apiKey（测试/正式 key）→ 不同 Vendor（符合"厂商 = 一套凭证"）。

**手动 `prisma generate`**（Prisma 7 gotcha：migrate dev 不自动 regenerate client）。

---

## 5. 后端设计

### 5.1 model-factory 不变

`model-factory.ts`（按 provider 路由的纯函数）/ `buildChatModel` / `getModel` cache **全不变**——它们仍吃 `ModelConfigRecord`。`ModelConfigRecord` 类型不变（id/provider/model/baseUrl/apiKey/temperature/updatedAt）。

### 5.2 ModelConfigRecord 的拼装层（改）

`ModelConfigRecord` 不再直接读表，运行时从 `Model` + `Vendor` 拼：

- `ModelConfigService.getActive(userId)`：读 `User.activeModelId` → `Model` + JOIN `Vendor` → 拼 `ModelConfigRecord`（id=Model.id, provider/baseUrl/apiKey 来自 Vendor, model/temperature 来自 Model, updatedAt 取 Model.updatedAt）。
- `AgentModelOverrideService.listMap(userId)`：list overrides（agentKey/modelId/**temperature**）→ 每个 JOIN Model+Vendor → `Map<agentKey, { config: ModelConfigRecord, temperatureOverride: number|null }>`。`temperatureOverride` = `AgentModelOverride.temperature`（per-agent 覆盖）。

### 5.3 温度三级优先级（resolveModelConfig 升级）

`resolveModelConfig` 签名加 `temperatureOverride`：

```ts
export function resolveModelConfig(
  spec: AgentSpec,
  config: ModelConfigRecord,
  temperatureOverride?: number | null,  // 新增:per-agent 用户配的温度
): ModelConfigRecord {
  const finalTemp =
    temperatureOverride ??            // ① per-agent(用户配,最优先)
    spec.temperature ??               // ② AgentSpec(代码角色默认)
    config.temperature;               // ③ Model(模型默认)
  return finalTemp === config.temperature
    ? config
    : { ...config, temperature: finalTemp };
}
```

`pickAgentConfig` 返回值升级：`{ config: ModelConfigRecord, temperatureOverride: number|null }`（不再只返回 ModelConfigRecord）。`DeepAgentService.resolveModel` 拆开：先 `pickAgentConfig` 拿 {config, temperatureOverride}，再 `resolveModelConfig(spec, config, temperatureOverride)`，再 `getModel`。

### 5.4 cache key 不变

`getModel` cache key 仍 `${config.id}:${config.updatedAt.getTime()}:${maxTokens}:${temperature}`。`config.id` = `Model.id`，`temperature` = finalTemp（含 per-agent 覆盖）→ 同 Model 不同 per-agent 温度天然不同 cache。✅

### 5.5 Vendor/Model CRUD

新 `VendorService` + `ModelService`（settings 模块下）。路由：
- `GET/POST/PUT/DELETE /settings/vendors[/:id]`（厂商 CRUD）
- `GET/POST /settings/vendors/:vid/models` + `PUT/DELETE /settings/models/:id`（模型 CRUD）
- `PUT /settings/models/:id/activate`（设为默认 → 更新 `User.activeModelId`）
- `GET /settings/agent-tree`（不变，派生分组）
- `GET /settings/agent-models`（返回升级结构：`{ agentKey: { modelId, temperature } }`）
- `PUT /settings/agent-models/:agentKey`（body 含 `modelId` + `temperature`，均可空 = 清除）

---

## 6. 前端设计

### 6.1 模型设置区（厂商单列分组，重写 ModelSettings）

每个厂商一个可展开区块：
- **头部**：厂商名 · provider · baseUrl + 「编辑厂商」「删」
- **展开后**：模型行（model · temp · ⭐默认 · 删）+ 「+ 加模型」

弹窗：
- **厂商表单**（新建/编辑厂商）：name / provider（四类选）/ baseUrl / apiKey。= 现有新建模型表单去掉 model 字段。
- **模型表单**（加模型）：model / temperature。

### 6.2 per-agent 弹窗（升级 AgentModelSettings）

每个 agent 行：name · description · 推荐 badge · **模型下拉**（`optgroup` 按厂商分组，跨厂商选）· **温度输入**（留空 = 不覆盖）+ 「清除」（删 override）。

---

## 7. 兼容性 + 测试影响

**对 agent 编排层零影响**：`AGENT_TREE` / 子 agent / deepagents middleware / `createSubAgentMiddleware` 全不变——它们看到的仍是"一个 ModelConfigRecord"。改动封闭在 settings + resolveModel 链。

**测试**：
- `model-factory.spec.ts`（纯路由）→ **不变**
- `deep-agent.override.spec.ts`（pickAgentConfig）→ 返回值加 `temperatureOverride`，更新断言
- `agent-model-override.service.spec.ts`（listMap）→ 返回结构变（`{ config, temperatureOverride }`），更新
- `agent-tree.config.spec.ts`（resolveModelConfig）→ 加三级温度优先级用例（per-agent > spec > model）
- `model-config.service.spec.ts` → 改为测新的 getActive（读 activeModelId + JOIN Vendor）

---

## 8. 范围界定（YAGNI / Deferred）

**不做**：
- 预置厂商种子（B 自由创建，用户自己建厂商）
- maxTokens / top_p 等暴露给 per-agent
- 模型「测试连接」按钮
- 新旧并存的双写过渡（一次性迁移）
- 模型别名 name 的 UI 编辑（先支持字段，UI 可后补）

---

## 9. 实施顺序（供 plan 参考）

1. **DB 迁移**：Vendor/Model 表 + 改 User/AgentModelOverride + 数据迁移 SQL + 删 ModelConfig + 手动 prisma generate。
2. **后端拼装层**：getActive（读 activeModelId+JOIN）/ listMap（升级结构）/ resolveModelConfig（三级温度）/ pickAgentConfig（返回值升级）/ Vendor/Model service + controller。
3. **前端模型设置区**：厂商单列分组 + 厂商表单 + 模型表单（重写 ModelSettings）。
4. **前端 per-agent 弹窗**：optgroup 模型下拉 + 温度输入（升级 AgentModelSettings）。
5. **测试更新 + 回归**：上述 spec 更新 + 全量 pnpm test + agent-ui validate。

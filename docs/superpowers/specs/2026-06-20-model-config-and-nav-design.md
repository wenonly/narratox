# narratox 模型配置化 + 导航重构 — 设计文档

- 日期:2026-06-20
- 状态:已与用户确认,待 review
- 范围:四件事 —— (1) 把全局「设置」入口从工作台左栏移到主页侧边栏;(2) 主页侧边栏加 tab(「小说库」默认高亮 +「设置」),方便切换;(3) 设置页做成 cline 风格的模型 Provider 管理界面(自定义新增/编辑/删除模型配置,一键切换活动模型,不再写死 GLM);(4) 拆掉为 GLM 加的 `coerce` 中间件,改用一个职责单一的文件系统工具过滤中间件。
- 前置:当前线上是单 `DeepAgentService`(deepagents `createDeepAgent`,主 + 写手/收束/校验三子 agent),模型在 `DeepAgentService.getModel()` 里写死 `ChatOpenAI` + GLM 常量 + `process.env.ZHIPUAI_API_KEY`。

> ⚠️ 现状勘误:`CLAUDE.md` 的 Architecture / Phase-status 章节描述的 `createSwarm` / `workspace-swarm.service.ts` / `transfer_to_writer` / `WritingChapter` / `extractDelta` / `makeTrimHook` 已**不存在于代码**。真实形态见上文「前置」。本次会顺带修正 `CLAUDE.md`。

---

## 1. 背景与目标

用户反馈四个问题:

1. **设置入口位置不对**:工作台(`IconRail.tsx`)左栏有 ⚙️「设置」按钮,但设置是全局入口,应放主页侧边栏,不该出现在单本小说的编辑页里。
2. **主页缺切换入口**:主页(`/`)进来直接是小说列表,左侧没有可高亮的 tab。希望左侧有一个默认高亮的入口 tab,方便在「小说库 / 设置」之间切换。
3. **模型写死 GLM**:设置页([settings/page.tsx](agent-ui/src/app/settings/page.tsx))是只读的,`CURRENT_MODEL = 'GLM-5.2'` 硬编码;服务端 `DeepAgentService.getModel()` 也写死 GLM。希望像 cline 那样:界面里选厂商、填配置、新增多个模型、随时切换活动模型,不再固定 GLM。需要支持多厂商(OpenAI 兼容 + Anthropic + Gemini)。
4. **去掉为模型加的中间件**:目前 `deep-agent.service.ts` 里有个 `coerce` 中间件(commit `17548b7`),同时干两件事 —— 过滤 deepagents 注入的文件系统工具、重分类 GLM-5.2 无 `role` 的 chunk。模型配置化、能换别的模型后,这个 GLM 专用补丁该去掉,换模型时看是否还有问题。但**文件系统工具仍要过滤掉**(单独用一个中间件做,不跟 GLM 补丁绑一起)。

**核心原则**:模型配置 = 服务端每用户存储(Key 不进浏览器);设置入口 = 主页侧边栏;中间件 = 职责单一,不为单一厂商打补丁。

---

## 2. 架构总览

### 2.1 决策(已与用户确认)

| 议题 | 决策 |
|---|---|
| 模型配置存储 | **服务端每用户**(Prisma 表 + `/settings/models` API),API Key 不离开服务器 |
| 活动模型表示 | `User.activeModelConfigId` 外键(唯一活动,可空) |
| 中间件 | 整体删掉 `coerce`(GLM 重分类 + FS 过滤一起走);**新做一个职责单一的 FS 过滤中间件** |
| 厂商范围 | OpenAI 兼容(通用,带预设)+ Anthropic 原生 + Gemini 原生 |
| 厂商预设模板 | 放前端常量文件,选厂商自动带出 baseURL/model,不走额外请求 |
| API Key 落库 | DB 明文(服务端存储已满足「Key 不进浏览器」;加密落盘是后续可分离加固项,本次不做) |

### 2.2 数据流

```
设置页 UI ──(POST/PATCH/DELETE/activate)──► /settings/models ──► Prisma ModelConfig + User.activeModelConfigId
                                                                        │
工作台聊天 ──(POST /agents/:id/runs)──► AgentosController ──► DeepAgentService.runTurn
                                                                        │
                                          getModel(userId) ◄── ModelConfigService.getActive(userId)
                                                                        │
                                          buildChatModel(config) ──► ChatOpenAI / ChatAnthropic / ChatGoogleGenerativeAI
                                                                        │
                                          createDeepAgent({ model, middleware:[excludeFilesystemTools], ... })
```

---

## 3. 数据模型(Prisma)

新增 `ModelConfig` 表,`User` 加活动模型外键。

```prisma
model ModelConfig {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String              // 用户起的名字,如 "我的 GLM"、"Claude Sonnet"
  provider    String              // 'openai-compatible' | 'anthropic' | 'gemini'
  model       String              // 模型 id:glm-5.2 / claude-sonnet-4-6 / gemini-2.5-pro
  baseUrl     String?             // 仅 openai-compatible 用
  apiKey      String              // 明文落库(见 §2.1)
  temperature Float?              // 可选,覆盖默认 0.5
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId])
}
```

`User` 加:
```prisma
  activeModelConfigId String?
  activeModelConfig   ModelConfig? @relation("ActiveModel", fields: [activeModelConfigId], references: [id], onDelete: SetNull)
```

- 删活动模型时:若是活动项 → `User.activeModelConfigId` 置空(`onDelete: SetNull`),不再额外拒绝(UX 更顺;删完提醒用户重新选一个)。
- 历史用户:`activeModelConfigId` 为空 → 首次聊天时报「尚未配置模型,请在设置页添加一个」。

Prisma 7 是 config-driven(`server/prisma.config.ts`),`prisma migrate dev` 不带 `--schema`。

---

## 4. Server 改动

### 4.1 模型工厂 —— 替换写死 GLM 的唯一入口

`DeepAgentService.getModel(userId, maxTokens)` 改为读用户活动配置 + 工厂分支:

```ts
private async getModel(userId: string, maxTokens = 16_000) {
  const config = await this.modelConfigService.getActive(userId);
  if (!config) throw new Error('尚未配置模型,请在设置页添加一个');
  const key = `${userId}:${config.id}:${maxTokens}`;   // configId 进 key,切换活动天然 cache miss
  const cached = this.models.get(key);
  if (cached) return cached;
  const model = await buildChatModel(config, maxTokens);
  this.models.set(key, model);
  return model;
}
```

`buildChatModel(config, maxTokens)`(新文件 `agentos/model-factory.ts` 或入 `agentos.constants.ts` 旁):
- `openai-compatible` → `new ChatOpenAI({ apiKey, model, configuration:{ baseURL: config.baseUrl }, temperature: config.temperature ?? 0.5, maxTokens, timeout: 120_000, maxRetries: 0 })`
- `anthropic` → `new ChatAnthropic({ apiKey, model, maxTokens, temperature: config.temperature ?? 0.5, ... })` —— **新依赖 `@langchain/anthropic`**
- `gemini` → `new ChatGoogleGenerativeAI({ apiKey, model, maxTokens, temperature: config.temperature ?? 0.5, ... })` —— **新依赖 `@langchain/google-genai`**

三个 chat 类一律**动态 import**(`await import(...)`,沿用现有写法,保持 Jest collection 干净)。

**保持不变**:按角色的 maxTokens 切分(主/写手 16k,收束/校验 6k);`temperature` 默认 0.5,可被配置覆盖。

**避免重复 DB 查询**:`getModel` 每次都要读 `config.id` 组 cache key,而 `runTurn` 会调它 3 次(主/收束/校验)。实现时由 `runTurn` 先 `getActive(userId)` 读一次活动配置,把它(或 `config.id`)作为参数传给 `getModel`,避免每轮 3 次 DB 命中。`getActive` 本身也可加进程内短缓存(activate/delete 时失效)。

**删除**:`GLM_MODEL` / `GLM_BASE_URL` 常量、`process.env.ZHIPUAI_API_KEY` 读取。`.env.example` 去掉 `ZHIPUAI_API_KEY`。

> Anthropic 附带好处:deepagents 检测到 Anthropic 模型会自动启用 prompt-caching 中间件(`isAnthropicModel` 分支),无需额外配置。

### 4.2 中间件 —— 删 `coerce`,新做 FS 过滤中间件

`deep-agent.service.ts`:
- **删** `coerce` 对象(原 `wrapModelCall` 里两件事一起做的那段)。
- **删** `reclassGenericMessage` 辅助函数 + 随之失效的 `@langchain/core/messages` 动态 import。
- **删** 四处 `middleware: [coerce as never]` 用法(主 / 写手 / 收束 / 校验)。
- **保留** `FILESYSTEM_TOOL_NAMES` 集合(`ls`/`read_file`/`write_file`/`edit_file`/`glob`/`grep`/`execute`)。
- **新增** 职责单一的中间件 `excludeFilesystemTools`,只做一件事 —— `wrapModelCall` 里从 `request.tools` 过滤掉 `FILESYSTEM_TOOL_NAMES`;挂到四个 agent 的 `middleware: [excludeFilesystemTools]`。

```ts
const excludeFilesystemTools = {
  name: 'excludeFilesystemTools',
  async wrapModelCall(request: unknown, handler: (req: unknown) => Promise<unknown>) {
    const req = request as { tools?: Array<{ name: string }> };
    const filtered = { ...req, tools: req.tools?.filter((t) => !FILESYSTEM_TOOL_NAMES.has(t.name)) };
    return handler(filtered);
  },
};
```

**已知后果(可接受)**:
- GLM-5.2 无 `role` chunk 崩溃可能复发(仅在切回 GLM 时);非 GLM 模型干净基线,不受影响。若真撞到,再单独加一个 GLM 专用 shim(不并进这个通用中间件)。
- 文件系统工具仍被过滤,不会回来。

> 关于 deepagents 自带中间件:`createDeepAgent` 内部强制装配 `todoListMiddleware` / `FilesystemMiddleware` / `SubAgentMiddleware` / `SummarizationMiddleware` / `PatchToolCallsMiddleware`,这些**不在本次「移除」范围内** —— 用户要移除的是**我们自己加的** `coerce`。`FilesystemMiddleware` 在 `REQUIRED_MIDDLEWARE_NAMES` 里、无法通过常规 API 排除,所以工具级过滤(本中间件)是当前可行做法。

### 4.3 新接口 —— `SettingsModule` + `ModelConfigController/Service`

全部 `@CurrentUser` 作用域 + 全局 `JwtAuthGuard`(无需 `@Public`):

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/settings/models` | 列出该用户所有配置,当前活动的打 `active: true` |
| POST | `/settings/models` | 新建(校验 provider 合法、openai-compatible 必填 baseUrl) |
| PATCH | `/settings/models/:id` | 更新(只能改自己的;apiKey 可选不更新) |
| DELETE | `/settings/models/:id` | 删除(若是活动项 → `User.activeModelConfigId` 置空) |
| POST | `/settings/models/:id/activate` | 设 `User.activeModelConfigId = id` |

- `ModelConfigService`:CRUD 全部按 `userId` 过滤(多租户隔离,与现有 Novel/Chapter 一致)。
- DTO 用 `class-validator`,`ValidationPipe({ whitelist, forbidNonWhitelisted })` 全局生效。
- `provider` 枚举校验:`openai-compatible` | `anthropic` | `gemini`;`openai-compatible` 时 `baseUrl` 必填。
- `SettingsModule` 注册进 `app.module.ts`。

`AgentosModule` 需能拿到 `ModelConfigService`(给 `DeepAgentService` 用)—— 在 `app.module.ts` 调整 import 顺序/依赖,或把 `ModelConfigService` 放进一个被两者共享的 module(如 `SettingsModule` exports `ModelConfigService`,`AgentosModule` imports `SettingsModule`)。

---

## 5. 前端改动

### 5.1 共享侧边栏 `AppSidebar`(问题 1 + 2)

新组件 `components/layout/AppSidebar.tsx`,被 `/` 和 `/settings` 共用:
- 品牌行(narratox)
- Tab 列表:**「小说库」**(在 `/` 高亮)· **「设置」**(在 `/settings` 高亮)—— 当前 tab 加 brand 色左边框/背景,点 tab `router.push`
- 登出 固定底部

`NovelLibrary.tsx` / `settings/page.tsx` 删掉各自手写的 `w-60` aside,改 `<AppSidebar active="library" />` / `<AppSidebar active="settings" />`。「+ 新建小说」按钮**从侧边栏移到小说库主区头部**(紧挨「我的小说」标题),只在用得到的地方出现。

`IconRail.tsx`(工作台):**删掉 ⚙️ 设置按钮**。工作台保留 ← / 资源 toggles / ℹ️ / ⏻。设置只从主页侧边栏进。

### 5.2 设置页改成 cline 风格模型管理(问题 3)

主区改成**列表 + 编辑器**两栏:
- **左列表**:已保存的模型配置,活动的打 brand 标记(点/高亮);顶部「+ 新建模型」。
- **右编辑器**(选中或新建时):`名称` · `厂商`(下拉,带预设)· `模型 ID` · `Base URL`(仅 `openai-compatible` 显示)· `API Key`(密码框,编辑时默认掩码、可清空重填)· `温度`(可选)。按钮:`保存` · `设为当前` · `删除`。
- **页面顶部**:保留现有的「后端地址 / 后端状态」两行,「当前模型」改为读活动配置名(无则显示「未配置」)。

厂商预设(`types/settings.ts` 旁的常量,或 `lib/model-presets.ts`):每个预设含 `provider` + 默认 `baseUrl` + 建议 `model`,选厂商时自动带出(用户可改)。覆盖:GLM、DeepSeek、Moonshot、Qwen、OpenAI(Claude/Gemini 走原生 provider,无 baseUrl)。

### 5.3 store / api / types

- **store**:服务端是唯一真相源,删掉没用到的 `selectedModel` / `setSelectedModel`([store.ts](agent-ui/src/store.ts))。
- **routes.ts**:加 `SettingsModels(base)`、`SettingsModel(base, id)`、`SettingsModelActivate(base, id)`。
- **api/settings.ts**(新):`listModelConfigs` / `createModelConfig` / `updateModelConfig` / `deleteModelConfig` / `activateModelConfig`,签名与 `api/novels.ts` 一致(`(base, token, ...)`)。
- **types/settings.ts**(新):
  ```ts
  export type ModelProvider = 'openai-compatible' | 'anthropic' | 'gemini';
  export interface ModelConfig {
    id: string; name: string; provider: ModelProvider;
    model: string; baseUrl: string | null; apiKey: string; temperature: number | null;
    active: boolean; createdAt: string; updatedAt: string;
  }
  export interface ModelConfigInput { name; provider; model; baseUrl?; apiKey; temperature?; }
  ```

---

## 6. 范围与非目标

**做**:
- `AppSidebar` 共享组件 + 主页 tab 高亮 + 设置入口移到主页 + 工作台 IconRail 去 ⚙️。
- `ModelConfig` 表 + `User.activeModelConfigId` + `/settings/models` 五个接口。
- `DeepAgentService.getModel` 配置化 + `buildChatModel` 三 provider 工厂 + 新依赖(`@langchain/anthropic`、`@langchain/google-genai`)。
- 删 `coerce` 中间件 + 新做 `excludeFilesystemTools` 中间件。
- 设置页 cline 风格 UI + 厂商预设 + `api/settings.ts` + `types/settings.ts` + `routes.ts`。
- 修正 `CLAUDE.md`(过时的 swarm/Phase 描述 → 现状)。

**不做(非目标)**:
- 每小说/每会话独立模型(本次是全局唯一活动模型 + 配置库)。
- API Key 加密落盘(后续加固)。
- 模型连通性测试按钮(可在后续加一个「测试连接」接口)。
- 主题切换、其他设置项。
- 把 deepagents 自带中间件(SummarizationMiddleware 等)纳入「移除」范围。

---

## 7. 测试与门禁

- **Server**:
  - `model-config.service.spec.ts`:CRUD、用户隔离(用户 A 读不到/改不到 B 的配置)、activate 切换、删除活动项后 `activeModelConfigId` 置空、provider/baseURL 校验。
  - 模型工厂测试:用既有 `jest.unstable_mockModule` + 动态 `import()` 模式 mock `@langchain/openai` / `@langchain/anthropic` / `@langchain/google-genai`(参考 `agentos/deep-agent.service.spec.ts`)。
  - `pnpm typecheck` + `pnpm lint` + `pnpm format`。
- **前端**:无测试运行器,门禁 `pnpm validate`(lint + format + typecheck)。

---

## 8. 风险

- **`ModelConfigService` 跨 module 依赖**:`DeepAgentService`(在 `AgentosModule`)要用 `ModelConfigService`(在 `SettingsModule`)。需在 `app.module.ts` 正确接线(让 `AgentosModule` import `SettingsModule` 或共享 module),避免循环依赖。
- **模型缓存 key**:`configId` 进 key 后,频繁换模型会累积多个缓存条目(个人用规模小,可接受;必要时加 LRU/上限)。
- **GLM 回退崩溃**:切回 GLM-5.2 可能复现无 `role` chunk 崩溃 —— 可接受(用户明确要干净基线去验证);真撞到再补针对性 shim。
- **Anthropic/Gemini 与 deepagents 兼容**:均为标准 `BaseChatModel`,理论兼容;Anthropic 会自动启用 prompt-caching。需在接入后实测一轮。
- **API Key 明文落库**:可接受(服务端存储已满足核心诉求);记录为已知限制,后续可加 app-key 加密。

---

## 9. 参考

- cline 的 API Provider 管理(厂商下拉 + baseURL/apiKey/model + 切换活动配置)。
- 现状代码:`server/src/agentos/deep-agent.service.ts`(`getModel` + `coerce` 中间件)、`agent-ui/src/components/workspace/IconRail.tsx`(⚙️ 入口)、`agent-ui/src/components/library/NovelLibrary.tsx`(主页)、`agent-ui/src/app/settings/page.tsx`(只读设置页)、`agent-ui/src/store.ts`(未用的 `selectedModel`)。
- 相关 spec:`2026-06-19-deepagents-migration-design.md`(deepagents 迁移)、`2026-06-18-icon-rail-layout-design.md`(IconRail 布局)。

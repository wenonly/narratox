# 模型配置化 + 导航重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把写死的 GLM 模型改成服务端每用户可配置的多 Provider(OpenAI 兼容 / Anthropic / Gemini)模型库 + cline 风格切换 UI;同时把全局「设置」入口移到主页侧边栏并加 tab,拆掉 GLM 专用 coerce 中间件改用职责单一的 FS 过滤中间件。

**Architecture:** 新增 Prisma `ModelConfig` 表 + `User.activeModelConfigId`;新增 `SettingsModule`(`/settings/models` CRUD,服务端持有 API Key,响应中不回传 Key 只给 `hasApiKey`);`DeepAgentService.getModel` 改为读用户活动配置 + `buildChatModel` 工厂按 provider 分支;`coerce` 中间件整体删除,新做 `excludeFilesystemTools` 只过滤文件系统工具;前端新增共享 `AppSidebar`(小说库/设置 tab),设置页改成列表+编辑器模型管理 UI。

**Tech Stack:** NestJS 11 + Prisma 7 + PostgreSQL(server);Next.js 15 App Router + React 18 + Zustand + shadcn/ui + Tailwind(agent-ui)。包管理器 pnpm。Server 测试 jest(`NODE_OPTIONS=--experimental-vm-modules`);前端无测试运行器,门禁 `pnpm validate`。

**Spec:** [docs/superpowers/specs/2026-06-20-model-config-and-nav-design.md](../specs/2026-06-20-model-config-and-nav-design.md)

---

## File Structure

### Server (`server/src/`)

| 文件 | 职责 | 动作 |
|---|---|---|
| `prisma/schema.prisma` | 加 `ModelConfig` 表 + `User.activeModelConfigId` | 改 |
| `settings/dto/create-model-config.dto.ts` | 新建校验 | 新建 |
| `settings/dto/update-model-config.dto.ts` | 更新校验(全可选) | 新建 |
| `settings/model-config.service.ts` | CRUD + getActive,用户隔离,响应脱敏 | 新建 |
| `settings/model-config.service.spec.ts` | 服务单测 | 新建 |
| `settings/model-config.controller.ts` | `/settings/models` 5 个路由 | 新建 |
| `settings/settings.module.ts` | 装配 + 导出 `ModelConfigService` | 新建 |
| `app.module.ts` | 注册 `SettingsModule` | 改 |
| `agentos/model-factory.ts` | `resolveModelSpec`(纯路由)+ `buildChatModel`(动态 import) | 新建 |
| `agentos/model-factory.spec.ts` | 纯路由单测 | 新建 |
| `agentos/deep-agent.service.ts` | getModel 读活动配置;删 coerce/reclass;加 excludeFilesystemTools;注入 ModelConfigService | 改 |
| `agentos/agentos.module.ts` | import `SettingsModule` | 改 |
| `agentos/agentos.constants.ts` | 删 `GLM_BASE_URL`/`GLM_MODEL` | 改 |
| `.env.example` | 删 `ZHIPUAI_API_KEY` | 改 |

### Frontend (`agent-ui/src/`)

| 文件 | 职责 | 动作 |
|---|---|---|
| `api/routes.ts` | 加 `SettingsModels` / `SettingsModel` / `SettingsModelActivate` | 改 |
| `api/settings.ts` | 5 个 model config 客户端 | 新建 |
| `types/settings.ts` | `ModelProvider`/`ModelConfig`/`ModelConfigInput` | 新建 |
| `components/layout/AppSidebar.tsx` | 共享侧边栏(小说库/设置 tab + 登出) | 新建 |
| `components/library/NovelLibrary.tsx` | 用 AppSidebar;「新建小说」移到主区头部 | 改 |
| `components/workspace/IconRail.tsx` | 删 ⚙️ 设置按钮 | 改 |
| `components/settings/model-presets.ts` | 厂商预设模板 | 新建 |
| `components/settings/ModelSettings.tsx` | 列表 + 编辑器 UI | 新建 |
| `app/settings/page.tsx` | AppSidebar + ModelSettings,重写 | 改 |
| `store.ts` | 删未用的 `selectedModel`/`setSelectedModel` | 改 |

---

## Task 1: Prisma schema — ModelConfig + User.activeModelConfigId

**Files:**
- Modify: `server/prisma/schema.prisma` (User model + new ModelConfig model)

- [ ] **Step 1: 加 User 关联字段**

在 `server/prisma/schema.prisma` 的 `User` model 内(`novels Novel[]` 之后)加:

```prisma
  novels       Novel[]
  modelConfigs ModelConfig[]
  activeModelConfigId String?
  activeModelConfig   ModelConfig? @relation("ActiveModel", fields: [activeModelConfigId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: 加 ModelConfig model**

在 `User` model 之后(文件末尾的 `StoryEvent` 之后也可)新增:

```prisma
model ModelConfig {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  provider    String
  model       String
  baseUrl     String?
  apiKey      String
  temperature Float?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId])
}
```

- [ ] **Step 3: 生成迁移**

Run:
```bash
cd server && pnpm exec prisma migrate dev --name add_model_config
```
Expected: 生成 `server/prisma/migrations/<ts>_add_model_config/migration.sql`(含 `CREATE TABLE "ModelConfig"` + `ALTER TABLE "User" ADD COLUMN "activeModelConfigId"`),并 `Applied ... Changes to database`。

> Prisma 7 是 config-driven(`prisma.config.ts`),不带 `--schema`。

- [ ] **Step 4: 验证 Prisma Client 生成了类型**

Run:
```bash
cd server && node -e "const {PrismaClient}=require('@prisma/client');console.log(typeof new PrismaClient().modelConfig.findMany)"
```
Expected: 打印 `function`。

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(server): add ModelConfig schema + migration"
```

---

## Task 2: ModelConfig CRUD module(SETTINGS)

TDD。`ModelConfigService` 响应中**不回传 apiKey**,改给 `hasApiKey: boolean`(Key 永不离开服务器);更新时 apiKey 留空则保持原值。

**Files:**
- Create: `server/src/settings/dto/create-model-config.dto.ts`
- Create: `server/src/settings/dto/update-model-config.dto.ts`
- Create: `server/src/settings/model-config.service.ts`
- Create: `server/src/settings/model-config.service.spec.ts`
- Create: `server/src/settings/model-config.controller.ts`
- Create: `server/src/settings/settings.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: 写 CreateModelConfigDto**

`server/src/settings/dto/create-model-config.dto.ts`:

```ts
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** 与 ModelProvider (FE) 保持一致;DB 以字符串存。 */
export const MODEL_PROVIDERS = ['openai-compatible', 'anthropic', 'gemini'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export class CreateModelConfigDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsIn(MODEL_PROVIDERS)
  provider!: ModelProvider;

  @IsString()
  @MaxLength(120)
  model!: string;

  /** 仅 openai-compatible 需要(校验);其余 provider 忽略。 */
  @ValidateIf((o) => o.provider === 'openai-compatible')
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  @IsNotEmpty()
  apiKey!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
```

- [ ] **Step 2: 写 UpdateModelConfigDto(全可选,apiKey 留空=不改)**

`server/src/settings/dto/update-model-config.dto.ts`:

```ts
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MODEL_PROVIDERS, type ModelProvider } from './create-model-config.dto';

export class UpdateModelConfigDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;

  @IsOptional() @IsIn(MODEL_PROVIDERS) provider?: ModelProvider;

  @IsOptional() @IsString() @MaxLength(120) model?: string;

  @ValidateIf((o) => o.provider === 'openai-compatible')
  @IsOptional() @IsString() @IsNotEmpty()
  baseUrl?: string;

  /** 留空/缺省 = 不改 apiKey(见 service.update)。 */
  @IsOptional() @IsString() @IsNotEmpty()
  apiKey?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(2)
  temperature?: number;
}
```

- [ ] **Step 3: 写失败的测试**

`server/src/settings/model-config.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { ModelConfigService } from './model-config.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  modelConfig: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    modelConfig: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn(), update: jest.fn() },
  };
}

const baseConfig = {
  id: 'c1',
  userId: 'u1',
  name: '我的 GLM',
  provider: 'openai-compatible',
  model: 'GLM-5.2',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  apiKey: 'secret',
  temperature: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ModelConfigService', () => {
  describe('list', () => {
    it('returns configs with active flag and NO raw apiKey', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findMany.mockResolvedValue([baseConfig]);
      prisma.user.findUnique.mockResolvedValue({ activeModelConfigId: 'c1' });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      const out = await svc.list('u1');

      expect(prisma.modelConfig.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ id: 'c1', active: true, hasApiKey: true });
      expect(out[0]).not.toHaveProperty('apiKey');
    });
  });

  describe('create', () => {
    it('persists with userId and masks the key', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.create.mockResolvedValue(baseConfig);
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      const out = await svc.create('u1', {
        name: '我的 GLM',
        provider: 'openai-compatible',
        model: 'GLM-5.2',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        apiKey: 'secret',
      });

      expect(prisma.modelConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', apiKey: 'secret' }),
      });
      expect(out).not.toHaveProperty('apiKey');
      expect(out.hasApiKey).toBe(true);
    });
  });

  describe('update', () => {
    it('throws NotFound when config belongs to another user', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue(null);
      const svc = new ModelConfigService(prisma as unknown as PrismaService);
      await expect(svc.update('u1', 'cX', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('keeps old apiKey when dto leaves it blank', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.modelConfig.update.mockResolvedValue(baseConfig);
      prisma.user.findUnique.mockResolvedValue({ activeModelConfigId: null });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      await svc.update('u1', 'c1', { name: '改名' });

      expect(prisma.modelConfig.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: '改名' }, // 不含 apiKey
      });
    });
  });

  describe('delete', () => {
    it('clears activeModelConfigId when deleting the active one', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.user.findUnique.mockResolvedValue({ activeModelConfigId: 'c1' });
      prisma.modelConfig.delete.mockResolvedValue(baseConfig);
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      await svc.delete('u1', 'c1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { activeModelConfigId: null },
      });
      expect(prisma.modelConfig.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });

  describe('activate', () => {
    it('sets activeModelConfigId after ownership check', async () => {
      const prisma = makePrismaMock();
      prisma.modelConfig.findFirst.mockResolvedValue({ id: 'c1' });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      await svc.activate('u1', 'c1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { activeModelConfigId: 'c1' },
      });
    });
  });

  describe('getActive', () => {
    it('returns the active config WITH its apiKey (server-side use)', async () => {
      const prisma = makePrismaMock();
      prisma.user.findUnique.mockResolvedValue({ activeModelConfig: baseConfig });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);

      const out = await svc.getActive('u1');

      expect(out?.apiKey).toBe('secret'); // 工厂要用,不脱敏
    });

    it('returns null when none active', async () => {
      const prisma = makePrismaMock();
      prisma.user.findUnique.mockResolvedValue({ activeModelConfig: null });
      const svc = new ModelConfigService(prisma as unknown as PrismaService);
      expect(await svc.getActive('u1')).toBeNull();
    });
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run:
```bash
cd server && pnpm test -- model-config.service.spec.ts
```
Expected: FAIL(`Cannot find module './model-config.service'`)。

- [ ] **Step 5: 写 ModelConfigService**

`server/src/settings/model-config.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';

/** 脱敏后的响应类型(不含 apiKey)。 */
export type MaskedModelConfig = Omit<
  Awaited<ReturnType<PrismaService['modelConfig']['findUnique']>>,
  'apiKey'
> & { hasApiKey: boolean; active: boolean };

@Injectable()
export class ModelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<MaskedModelConfig[]> {
    const [configs, activeId] = await Promise.all([
      this.prisma.modelConfig.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.getActiveId(userId),
    ]);
    return configs.map((c) => this.mask(c, c.id === activeId));
  }

  /** 服务端用:返回活动配置【含 apiKey】(供 DeepAgentService 工厂)。 */
  async getActive(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { activeModelConfig: true },
    });
    return user?.activeModelConfig ?? null;
  }

  async create(userId: string, dto: CreateModelConfigDto): Promise<MaskedModelConfig> {
    const created = await this.prisma.modelConfig.create({
      data: { ...dto, userId },
    });
    return this.mask(created, false);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateModelConfigDto,
  ): Promise<MaskedModelConfig> {
    await this.assertOwned(userId, id);
    const { apiKey, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (apiKey !== undefined && apiKey !== '') data.apiKey = apiKey;
    const updated = await this.prisma.modelConfig.update({ where: { id }, data });
    const activeId = await this.getActiveId(userId);
    return this.mask(updated, updated.id === activeId);
  }

  async delete(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwned(userId, id);
    if ((await this.getActiveId(userId)) === id) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeModelConfigId: null },
      });
    }
    await this.prisma.modelConfig.delete({ where: { id } });
    return { ok: true };
  }

  async activate(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwned(userId, id);
    await this.prisma.user.update({
      where: { id: userId },
      data: { activeModelConfigId: id },
    });
    return { ok: true };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.modelConfig.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model config not found');
  }

  private async getActiveId(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeModelConfigId: true },
    });
    return u?.activeModelConfigId ?? null;
  }

  private mask(
    c: Awaited<ReturnType<PrismaService['modelConfig']['findUnique']>> & object,
    active: boolean,
  ): MaskedModelConfig {
    const { apiKey, ...rest } = c;
    void apiKey;
    return { ...rest, hasApiKey: Boolean(apiKey), active } as MaskedModelConfig;
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run:
```bash
cd server && pnpm test -- model-config.service.spec.ts
```
Expected: PASS(6 个测试全过)。

- [ ] **Step 7: 写 Controller**

`server/src/settings/model-config.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ModelConfigService } from './model-config.service';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';

@Controller('settings/models')
export class ModelConfigController {
  constructor(private readonly configs: ModelConfigService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.configs.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateModelConfigDto) {
    return this.configs.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateModelConfigDto,
  ) {
    return this.configs.update(user.id, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.configs.delete(user.id, id);
  }

  @Post(':id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.configs.activate(user.id, id);
  }
}
```

- [ ] **Step 8: 写 SettingsModule**

`server/src/settings/settings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';

/** 导出 ModelConfigService 供 AgentosModule(DeepAgentService 工厂)注入。 */
@Module({
  controllers: [ModelConfigController],
  providers: [ModelConfigService],
  exports: [ModelConfigService],
})
export class SettingsModule {}
```

- [ ] **Step 9: 注册到 app.module**

Modify `server/src/app.module.ts`:`imports` 数组加 `SettingsModule`(在 `NovelModule` 后)。导入语句加 `import { SettingsModule } from './settings/settings.module';`。

- [ ] **Step 10: typecheck + lint + 全量测试**

Run:
```bash
cd server && pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck 通过;lint 通过;全量测试通过。

- [ ] **Step 11: Commit**

```bash
git add server/src/settings server/src/app.module.ts
git commit -m "feat(server): add settings model-config CRUD module"
```

---

## Task 3: 中间件改造 — 删 coerce,新做 excludeFilesystemTools

把 `coerce`(GLM 重分类 + FS 过滤两件事)整体删掉,换成职责单一的 FS 过滤中间件。GLM 无 role 重分类补丁不再保留(换非 GLM 模型是干净基线)。

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts` (lines 33–88 删 reclass+改注释;155–177 删 import+coerce 换 excludeFilesystemTools;183/196/204/225 换挂载)

- [ ] **Step 1: 删 reclassGenericMessage 函数 + 改 FILESYSTEM_TOOL_NAMES 注释**

在 `server/src/agentos/deep-agent.service.ts`:

删掉整个 `reclassGenericMessage` 函数(第 33–68 行,含其上方的 JSDoc 注释块)。

把 `FILESYSTEM_TOOL_NAMES` 上方的注释块(第 70–79 行)替换为:

```ts
/** deepagents 的 createDeepAgent 无条件注入 7 个文件系统工具(ls / read_file / write_file /
 * edit_file / glob / grep / execute)。它们操作的是内存 StateBackend,与本服务的 PostgreSQL
 * 存储无关 —— agent 调它们只会得到空结果或无意义副作用。createDeepAgent 不允许移除
 * FilesystemMiddleware(它在 REQUIRED_MIDDLEWARE_NAMES 里),所以单独用一个中间件在每次
 * model-call 时按名 filter 掉这些工具(provider 无关,主 agent + 全部 subagent 统一生效)。 */
const FILESYSTEM_TOOL_NAMES = new Set([
  'ls',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'execute',
]);

/** 职责单一:只过滤文件系统工具,不再兜任何厂商特定消息(原 GLM generic 重分类已移除)。 */
const excludeFilesystemTools = {
  name: 'excludeFilesystemTools',
  async wrapModelCall(
    request: unknown,
    handler: (req: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const req = request as { tools?: Array<{ name: string }> };
    const filtered = {
      ...req,
      tools: req.tools?.filter((t) => !FILESYSTEM_TOOL_NAMES.has(t.name)),
    };
    return handler(filtered);
  },
};
```

`FILESYSTEM_TOOL_NAMES` 的 `Set([...])` 定义本体保持不变(在上面代码块里已含)。

- [ ] **Step 2: 删动态 import + coerce,改 runTurn 里的中间件挂载**

在 `runTurn` 内,删掉这两段:

```ts
    // 与 deepagents 同源的 ESM core:构造 coerce 中间件,兜住 GLM-5.2 间歇吐出的无 role generic 消息。
    const { AIMessage, AIMessageChunk } =
      await import('@langchain/core/messages');
    const coerce = {
      name: 'coerceChatMessage',
      async wrapModelCall(
        request: unknown,
        handler: (req: unknown) => Promise<unknown>,
      ): Promise<unknown> {
        // 1) 过滤掉 deepagents 注入的文件系统工具(见 FILESYSTEM_TOOL_NAMES)。
        const req = request as { tools?: Array<{ name: string }> };
        const filtered = {
          ...req,
          tools: req.tools?.filter((t) => !FILESYSTEM_TOOL_NAMES.has(t.name)),
        };
        // 2) 兜 GLM-5.2 无 role generic 消息 → 重类化为 AIMessage(Chunk)。
        return reclassGenericMessage(
          await handler(filtered),
          AIMessage,
          AIMessageChunk,
        );
      },
    };
```

把四处 `middleware: [coerce as never], // 兜 GLM-5.2 无 role generic 消息`(主 agent 第 183 行、writer 第 196 行、settler 第 204 行、validator 第 225 行)全部替换为:

```ts
      middleware: [excludeFilesystemTools as never],
```

- [ ] **Step 3: typecheck + lint + 测试**

Run:
```bash
cd server && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全过(确认没有遗留的 `coerce`/`reclassGenericMessage`/`AIMessage` 引用)。

- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "refactor(server): replace GLM coerce middleware with FS tool filter"
```

---

## Task 4: 模型工厂 + getModel 配置化 + 接线 + 删 GLM 常量

路由逻辑拆成纯函数 `resolveModelSpec`(好测,不碰 ESM),`buildChatModel` 负责动态 import + 构造。`getModel` 改为接收活动配置对象(runTurn 先读一次,避免 3 次 DB 命中)。

**Files:**
- Create: `server/src/agentos/model-factory.ts`
- Create: `server/src/agentos/model-factory.spec.ts`
- Modify: `server/src/agentos/deep-agent.service.ts`
- Modify: `server/src/agentos/agentos.module.ts`
- Modify: `server/src/agentos/agentos.constants.ts`
- Modify: `server/.env.example`

- [ ] **Step 1: 装新依赖**

Run:
```bash
cd server && pnpm add @langchain/anthropic @langchain/google-genai
```
Expected: 两个包写入 `server/package.json` dependencies 并安装成功。

- [ ] **Step 2: 写失败的纯路由测试**

`server/src/agentos/model-factory.spec.ts`:

```ts
import { resolveModelSpec } from './model-factory';

const cfg = (over: Partial<Parameters<typeof resolveModelSpec>[0]>) => ({
  id: 'c1',
  provider: 'openai-compatible',
  model: 'm',
  baseUrl: 'https://x',
  apiKey: 'k',
  temperature: null,
  ...over,
});

describe('resolveModelSpec', () => {
  it('openai-compatible → openai 构造参数(含 baseURL,默认 temp 0.5)', () => {
    const spec = resolveModelSpec(cfg({}), 16_000);
    expect(spec.kind).toBe('openai');
    expect(spec.args).toMatchObject({
      apiKey: 'k',
      model: 'm',
      configuration: { baseURL: 'https://x' },
      temperature: 0.5,
      maxTokens: 16_000,
      maxRetries: 0,
    });
  });

  it('anthropic → anthropic 构造参数(无 configuration)', () => {
    const spec = resolveModelSpec(cfg({ provider: 'anthropic', baseUrl: null }), 6_000);
    expect(spec.kind).toBe('anthropic');
    expect(spec.args).toMatchObject({ apiKey: 'k', model: 'm', maxTokens: 6_000 });
    expect(spec.args).not.toHaveProperty('configuration');
  });

  it('gemini → gemini 构造参数', () => {
    const spec = resolveModelSpec(cfg({ provider: 'gemini', baseUrl: null }), 6_000);
    expect(spec.kind).toBe('gemini');
    expect(spec.args).toMatchObject({ apiKey: 'k', model: 'm' });
  });

  it('temperature 覆盖默认', () => {
    const spec = resolveModelSpec(cfg({ temperature: 0.1 }), 16_000);
    expect(spec.args).toMatchObject({ temperature: 0.1 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run:
```bash
cd server && pnpm test -- model-factory.spec.ts
```
Expected: FAIL(`Cannot find module './model-factory'`)。

- [ ] **Step 4: 写 model-factory.ts**

`server/src/agentos/model-factory.ts`:

```ts
export interface ModelConfigRecord {
  id: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKey: string;
  temperature: number | null;
}

type ChatModelSpec =
  | { kind: 'openai'; args: Record<string, unknown> }
  | { kind: 'anthropic'; args: Record<string, unknown> }
  | { kind: 'gemini'; args: Record<string, unknown> };

/** 纯路由:按 provider 选构造器 + 组参数(不含任何 import,好测)。 */
export function resolveModelSpec(
  config: ModelConfigRecord,
  maxTokens: number,
): ChatModelSpec {
  const temperature = config.temperature ?? 0.5;
  if (config.provider === 'anthropic') {
    return {
      kind: 'anthropic',
      args: { apiKey: config.apiKey, model: config.model, maxTokens, temperature },
    };
  }
  if (config.provider === 'gemini') {
    return {
      kind: 'gemini',
      args: { apiKey: config.apiKey, model: config.model, maxTokens, temperature },
    };
  }
  // 默认 openai-compatible(GLM / DeepSeek / Moonshot / Qwen / OpenAI …)
  return {
    kind: 'openai',
    args: {
      apiKey: config.apiKey,
      model: config.model,
      configuration: { baseURL: config.baseUrl ?? undefined },
      temperature,
      timeout: 120_000,
      maxRetries: 0,
      maxTokens,
    },
  };
}

/** 实例化:动态 import 三套 chat 类(保持 Jest collection 干净)。 */
export async function buildChatModel(config: ModelConfigRecord, maxTokens: number) {
  const spec = resolveModelSpec(config, maxTokens);
  if (spec.kind === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic(spec.args as never);
  }
  if (spec.kind === 'gemini') {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    return new ChatGoogleGenerativeAI(spec.args as never);
  }
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI(spec.args as never);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run:
```bash
cd server && pnpm test -- model-factory.spec.ts
```
Expected: PASS(4 个测试)。

- [ ] **Step 6: 改 getModel + runTurn + 构造器注入**

Modify `server/src/agentos/deep-agent.service.ts`:

(a) 顶部 import:删掉
```ts
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
```
加:
```ts
import { ModelConfigService } from '../settings/model-config.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
```

(b) 构造器加注入(在 `private readonly prisma: PrismaService,` 之后):
```ts
    private readonly prisma: PrismaService,
    private readonly modelConfigs: ModelConfigService,
```

(c) 把 `getModel` 方法整体替换为(改为接收已读好的配置对象):
```ts
  /**
   * 取(并缓存)一个 chat 实例。config 由 runTurn 先读一次(getActive)传入,避免每轮 3 次 DB 命中。
   * 按 `${config.id}:${maxTokens}` 缓存 —— 切换活动配置天然 cache miss。maxTokens 角色切分:
   *  - main / writer = 16_000(默认):写正文要输出空间。
   *  - settler / validator = 6_000:短输出,紧上限压住长思考。
   */
  private async getModel(config: ModelConfigRecord, maxTokens = 16_000) {
    const key = `${config.id}:${maxTokens}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const model = await buildChatModel(config, maxTokens);
    this.models.set(key, model);
    return model;
  }
```

(d) 在 `runTurn` 内,把:
```ts
    // main / writer 复用 16k 默认实例;settler / validator 各取 6k 紧上限实例。
    const model = await this.getModel(userId);
    const settlerModel = await this.getModel(userId, 6_000);
    const validatorModel = await this.getModel(userId, 6_000);
    const { createDeepAgent } = await import('deepagents');
```
替换为:
```ts
    // 读一次活动模型配置(getActive 含 apiKey,供工厂;runTurn 里复用,避免 3 次 DB 命中)。
    const activeConfig = await this.modelConfigs.getActive(userId);
    if (!activeConfig) {
      throw new Error('尚未配置模型,请在设置页「设置」中添加并激活一个模型');
    }
    const config: ModelConfigRecord = {
      id: activeConfig.id,
      provider: activeConfig.provider,
      model: activeConfig.model,
      baseUrl: activeConfig.baseUrl,
      apiKey: activeConfig.apiKey,
      temperature: activeConfig.temperature,
    };
    // main / writer 复用 16k 默认实例;settler / validator 各取 6k 紧上限实例。
    const model = await this.getModel(config);
    const settlerModel = await this.getModel(config, 6_000);
    const validatorModel = await this.getModel(config, 6_000);
    const { createDeepAgent } = await import('deepagents');
```

- [ ] **Step 7: AgentosModule import SettingsModule**

Modify `server/src/agentos/agentos.module.ts`:`imports: [NovelModule, MemoryModule]` → `imports: [NovelModule, MemoryModule, SettingsModule]`,并加 `import { SettingsModule } from '../settings/settings.module';`。同时把模块顶部那段过时 JSDoc(`DeepAgents:... 带 SummarizationMiddleware ...`)替换为:

```ts
/**
 * 会话 agent 由 DeepAgentService(createDeepAgent,主 + writer/settler/validator)提供。
 * 模型由 SettingsModule(ModelConfigService)按用户活动配置注入。ContextAssembler(状态感知
 * prompt)+ SessionsService 仍由本模块提供。
 */
```

- [ ] **Step 8: 删 GLM 常量**

Modify `server/src/agentos/agentos.constants.ts`:删掉最后两行 `export const GLM_BASE_URL ...` 与 `export const GLM_MODEL ...`(及其上方 `// GLM Coding Plan...` 注释)。保留 `AGENT_ID`/`AGENT_NAME`/`AGENT_DB_ID`/`SYSTEM_PROMPT`。

- [ ] **Step 9: 更新 .env.example**

Modify `server/.env.example`:删掉 `ZHIPUAI_API_KEY=...` 行及其上方注释。结果只剩 `PORT` / `DATABASE_URL` / `JWT_SECRET`。

- [ ] **Step 10: typecheck + lint + 全量测试**

Run:
```bash
cd server && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全过。typecheck 失败则检查是否有遗留 `GLM_MODEL`/`GLM_BASE_URL`/`process.env.ZHIPUAI_API_KEY` 引用:`grep -rn "GLM_MODEL\|GLM_BASE_URL\|ZHIPUAI" server/src`(应只剩历史 spec 里可能的引用,若有也一并清理)。

- [ ] **Step 11: Commit**

```bash
git add server/src/agentos server/src/app.module.ts server/package.json server/pnpm-lock.yaml server/.env.example
git commit -m "feat(server): configurable multi-provider model factory"
```

---

## Task 5: 前端 types + api + routes

**Files:**
- Create: `agent-ui/src/types/settings.ts`
- Create: `agent-ui/src/api/settings.ts`
- Modify: `agent-ui/src/api/routes.ts`

- [ ] **Step 1: 写 types/settings.ts**

`agent-ui/src/types/settings.ts`:

```ts
export type ModelProvider = 'openai-compatible' | 'anthropic' | 'gemini';

/** 服务端响应:不含 apiKey,只给 hasApiKey。 */
export interface ModelConfig {
  id: string;
  userId: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string | null;
  temperature: number | null;
  hasApiKey: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 新建/更新入参;更新时 apiKey 留空=不改。 */
export interface ModelConfigInput {
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}
```

- [ ] **Step 2: 加 routes.ts 条目**

Modify `agent-ui/src/api/routes.ts`:在 `NovelAccept` 之后加:

```ts
  NovelAccept: (base: string, id: string) => `${base}/novels/${id}/accept`,

  SettingsModels: (base: string) => `${base}/settings/models`,
  SettingsModel: (base: string, id: string) => `${base}/settings/models/${id}`,
  SettingsModelActivate: (base: string, id: string) =>
    `${base}/settings/models/${id}/activate`
```

- [ ] **Step 3: 写 api/settings.ts**

`agent-ui/src/api/settings.ts`(沿用 `api/novels.ts` 的 `headers`/`asJson` 模式):

```ts
import { APIRoutes } from './routes';
import type { ModelConfig, ModelConfigInput } from '@/types/settings';

const headers = (token: string): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`
});

async function asJson<T>(res: Promise<Response>): Promise<T> {
  const r = await res;
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export const listModelConfigs = (base: string, token: string) =>
  asJson<ModelConfig[]>(
    fetch(APIRoutes.SettingsModels(base), { headers: headers(token) })
  );

export const createModelConfig = (
  base: string,
  token: string,
  input: ModelConfigInput
) =>
  asJson<ModelConfig>(
    fetch(APIRoutes.SettingsModels(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  );

export const updateModelConfig = (
  base: string,
  token: string,
  id: string,
  input: ModelConfigInput
) =>
  asJson<ModelConfig>(
    fetch(APIRoutes.SettingsModel(base, id), {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  );

export const deleteModelConfig = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.SettingsModel(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  );

export const activateModelConfig = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.SettingsModelActivate(base, id), {
      method: 'POST',
      headers: headers(token)
    })
  );
```

- [ ] **Step 4: typecheck + lint + format**

Run:
```bash
cd agent-ui && pnpm typecheck && pnpm lint && pnpm format:fix
```
Expected: 全过。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/types/settings.ts agent-ui/src/api/settings.ts agent-ui/src/api/routes.ts
git commit -m "feat(agent-ui): add settings model-config api + types"
```

---

## Task 6: 共享 AppSidebar + 主页/工作台导航改造(问题 1+2)

**Files:**
- Create: `agent-ui/src/components/layout/AppSidebar.tsx`
- Modify: `agent-ui/src/components/library/NovelLibrary.tsx`
- Modify: `agent-ui/src/components/workspace/IconRail.tsx`

- [ ] **Step 1: 写 AppSidebar**

`agent-ui/src/components/layout/AppSidebar.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface Props {
  active: 'library' | 'settings'
}

const TABS = [
  { key: 'library', label: '小说库', href: '/' },
  { key: 'settings', label: '设置', href: '/settings' }
] as const

const AppSidebar = ({ active }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
      <div className="mb-2 flex items-center gap-2">
        <Icon type="agno" size="xs" />
        <span className="text-xs font-medium uppercase text-white">narratox</span>
      </div>
      <nav className="flex flex-col gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.push(t.href)}
            className={cn(
              'rounded-lg px-3 py-2 text-left text-sm transition-colors',
              active === t.key
                ? 'bg-brand/15 font-medium text-primary'
                : 'text-muted hover:bg-accent hover:text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          className="text-muted"
        >
          登出
        </Button>
      </div>
    </aside>
  )
}

export default AppSidebar
```

- [ ] **Step 2: NovelLibrary 用 AppSidebar,「新建小说」移到主区头部**

Modify `agent-ui/src/components/library/NovelLibrary.tsx`:

(a) 加 import:`import AppSidebar from '@/components/layout/AppSidebar'`。
(b) 删掉原 `<aside>...</aside>` 整块(第 57–83 行),换成 `<AppSidebar active="library" />`。
(c) 把主区头部:
```tsx
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-6 text-lg font-semibold text-primary">我的小说</h1>
```
替换为(新建按钮挪到这里):
```tsx
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-primary">我的小说</h1>
          <Button
            onClick={onNewNovel}
            className="h-9 rounded-xl bg-primary text-xs font-medium text-background hover:bg-primary/80"
          >
            + 新建小说
          </Button>
        </div>
```

- [ ] **Step 3: IconRail 删 ⚙️ 设置按钮**

Modify `agent-ui/src/components/workspace/IconRail.tsx`:删掉第 77–84 行整个 ⚙️ `<button ... router.push('/settings') ...>⚙️</button>` 块。其余(← / 资源 / ℹ️ / ⏻)保持。

- [ ] **Step 4: typecheck + lint + format**

Run:
```bash
cd agent-ui && pnpm typecheck && pnpm lint && pnpm format:fix
```
Expected: 全过。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/components/layout/AppSidebar.tsx agent-ui/src/components/library/NovelLibrary.tsx agent-ui/src/components/workspace/IconRail.tsx
git commit -m "feat(agent-ui): shared AppSidebar + library/settings nav, drop workspace settings btn"
```

---

## Task 7: 设置页模型管理 UI(问题 3)+ store 清理

cline 风格:左侧配置列表(活动的打标记)+「+ 新建模型」;右侧编辑器(名称/厂商/模型/Base URL/API Key/温度)+ 保存/设为当前/删除。选厂商从预设带出 baseURL/model。

**Files:**
- Create: `agent-ui/src/components/settings/model-presets.ts`
- Create: `agent-ui/src/components/settings/ModelSettings.tsx`
- Modify: `agent-ui/src/app/settings/page.tsx`
- Modify: `agent-ui/src/store.ts`

- [ ] **Step 1: 写厂商预设**

`agent-ui/src/components/settings/model-presets.ts`:

```ts
import type { ModelProvider } from '@/types/settings';

export interface ModelPreset {
  id: string;
  label: string;
  provider: ModelProvider;
  baseUrl: string | null;
  model: string;
  needsBaseUrl: boolean;
}

/** 选厂商时自动带出 baseUrl + 默认 model(用户可改)。 */
export const MODEL_PROVIDER_PRESETS: ModelPreset[] = [
  { id: 'glm', label: '智谱 GLM', provider: 'openai-compatible', baseUrl: 'https://api.z.ai/api/coding/paas/v4', model: 'GLM-5.2', needsBaseUrl: true },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', needsBaseUrl: true },
  { id: 'moonshot', label: 'Moonshot (Kimi)', provider: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', needsBaseUrl: true },
  { id: 'qwen', label: '通义千问', provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', needsBaseUrl: true },
  { id: 'openai', label: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', needsBaseUrl: true },
  { id: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic', baseUrl: null, model: 'claude-sonnet-4-6', needsBaseUrl: false },
  { id: 'gemini', label: 'Google Gemini', provider: 'gemini', baseUrl: null, model: 'gemini-2.5-pro', needsBaseUrl: false }
];
```

- [ ] **Step 2: 写 ModelSettings 组件**

`agent-ui/src/components/settings/ModelSettings.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  activateModelConfig,
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  updateModelConfig
} from '@/api/settings'
import type { ModelConfig, ModelProvider } from '@/types/settings'
import { MODEL_PROVIDER_PRESETS } from './model-presets'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FormState {
  name: string
  provider: ModelProvider
  model: string
  baseUrl: string
  apiKey: string
  temperature: string
}

const EMPTY: FormState = {
  name: '',
  provider: 'openai-compatible',
  model: '',
  baseUrl: '',
  apiKey: '',
  temperature: ''
}

const presetFor = (provider: ModelProvider) =>
  MODEL_PROVIDER_PRESETS.find((p) => p.provider === provider) ??
  MODEL_PROVIDER_PRESETS[0]

const ModelSettings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null) // null = 新建
  const [form, setForm] = useState<FormState>(EMPTY)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setConfigs(await listModelConfigs(endpoint, token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const startNew = () => {
    setEditingId('new')
    setForm(EMPTY)
  }

  const selectConfig = (c: ModelConfig) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl ?? '',
      apiKey: '', // 不回填;留空=不改
      temperature: c.temperature == null ? '' : String(c.temperature)
    })
  }

  const onProviderChange = (provider: ModelProvider) => {
    const preset = presetFor(provider)
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: preset.needsBaseUrl ? preset.baseUrl ?? '' : '',
      model: f.model || preset.model
    }))
  }

  const save = async () => {
    const temperature = form.temperature === '' ? undefined : Number(form.temperature)
    const payload = {
      name: form.name,
      provider: form.provider,
      model: form.model,
      baseUrl: form.provider === 'openai-compatible' ? form.baseUrl : undefined,
      apiKey: form.apiKey === '' ? undefined : form.apiKey,
      temperature
    }
    try {
      if (editingId === 'new') {
        if (!payload.apiKey) {
          toast.error('新建模型需要填写 API Key')
          return
        }
        await createModelConfig(endpoint, token, payload)
        toast.success('已新增')
      } else if (editingId) {
        await updateModelConfig(endpoint, token, editingId, payload)
        toast.success('已保存')
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const activate = async (id: string) => {
    try {
      await activateModelConfig(endpoint, token, id)
      toast.success('已设为当前模型')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('删除这个模型配置?')) return
    try {
      await deleteModelConfig(endpoint, token, id)
      if (editingId === id) setEditingId(null)
      toast.success('已删除')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const activeConfig = configs.find((c) => c.active)
  const preset = presetFor(form.provider)

  return (
    <div className="flex gap-6">
      {/* 左:配置列表 */}
      <div className="w-64 shrink-0 space-y-2">
        <Button onClick={startNew} className="h-9 w-full rounded-xl bg-primary text-xs text-background hover:bg-primary/80">
          + 新建模型
        </Button>
        {loading ? (
          <p className="px-2 text-xs text-muted">加载中…</p>
        ) : (
          configs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectConfig(c)}
              className={cn(
                'w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                editingId === c.id
                  ? 'border-brand bg-brand/10'
                  : 'border-primary/10 bg-background-secondary hover:bg-accent'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="truncate font-medium text-primary">{c.name}</span>
                {c.active && <span className="text-[10px] text-brand">当前</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {c.provider} · {c.model}
              </div>
            </button>
          ))
        )}
      </div>

      {/* 右:编辑器 */}
      <div className="flex-1">
        {editingId === null ? (
          <div className="rounded-xl border border-dashed border-primary/15 p-8 text-center text-sm text-muted">
            当前模型:{activeConfig ? `${activeConfig.name} (${activeConfig.model})` : '未配置'}
            <br />
            选择左侧一个模型编辑,或点「+ 新建模型」。
          </div>
        ) : (
          <div className="max-w-md space-y-4 text-sm">
            <Field label="名称">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如:我的 GLM"
                className="input-base"
              />
            </Field>
            <Field label="厂商">
              <select
                value={form.provider}
                onChange={(e) => onProviderChange(e.target.value as ModelProvider)}
                className="input-base"
              >
                {MODEL_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.provider}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="模型 ID">
              <input
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder={preset.model}
                className="input-base"
              />
            </Field>
            {form.provider === 'openai-compatible' && (
              <Field label="Base URL">
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder={preset.baseUrl ?? ''}
                  className="input-base"
                />
              </Field>
            )}
            <Field label={editingId === 'new' ? 'API Key' : 'API Key(留空不修改)'}>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={editingId === 'new' ? 'sk-...' : '••••••••'}
                className="input-base"
              />
            </Field>
            <Field label="温度(可选,0–2)">
              <input
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                placeholder="0.5"
                className="input-base"
              />
            </Field>
            <div className="flex gap-2 pt-2">
              <Button onClick={save} className="rounded-xl bg-primary text-background hover:bg-primary/80">
                {editingId === 'new' ? '创建' : '保存'}
              </Button>
              {editingId !== 'new' && editingId && (
                <>
                  <Button variant="ghost" onClick={() => activate(editingId)}>
                    设为当前
                  </Button>
                  <Button variant="ghost" className="text-muted" onClick={() => remove(editingId)}>
                    删除
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-xs uppercase text-muted">{label}</span>
    {children}
  </label>
)

export default ModelSettings
```

- [ ] **Step 3: 加 `.input-base` 样式类**

CLAUDE.md 指出无 shadcn `input` token。在 `agent-ui/src/app/globals.css` 末尾追加一个原生 input/select 的共用类:

```css
.input-base {
  width: 100%;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: var(--background-secondary, #27272a);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #fafafa;
  outline: none;
}
.input-base:focus {
  border-color: #ff4017;
}
```

> 先 Read `agent-ui/src/app/globals.css` 确认变量名(`--background-secondary` / brand 色)与文件实际一致再追加;若变量名不同,改用对应值。

- [ ] **Step 4: 重写 settings/page.tsx**

`agent-ui/src/app/settings/page.tsx`(整体替换):

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import AppSidebar from '@/components/layout/AppSidebar'
import ModelSettings from '@/components/settings/ModelSettings'

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  )
}

const Settings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    getStatusAPI(endpoint, token)
      .then(setStatus)
      .catch(() => setStatus(503))
  }, [endpoint, token])

  return (
    <div className="flex h-screen bg-background/80">
      <AppSidebar active="settings" />
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-2 text-lg font-semibold text-primary">模型设置</h1>
        <p className="mb-6 text-xs text-muted">
          后端 {endpoint} · {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </p>
        <ModelSettings />
      </main>
    </div>
  )
}
```

- [ ] **Step 5: store 清理 — 删未用的 selectedModel**

Modify `agent-ui/src/store.ts`:删 interface 里两行(第 40–41 行):
```ts
  selectedModel: string
  setSelectedModel: (model: string) => void
```
删实现里两行(第 114–115 行):
```ts
      selectedModel: '',
      setSelectedModel: (selectedModel) => set(() => ({ selectedModel })),
```
`partialize` 不变(本就没存它)。

- [ ] **Step 6: typecheck + lint + format**

Run:
```bash
cd agent-ui && pnpm typecheck && pnpm lint && pnpm format:fix
```
Expected: 全过。若提示 `selectedModel` 在别处被引用,一并清理(预期没有)。

- [ ] **Step 7: Commit**

```bash
git add agent-ui/src/components/settings agent-ui/src/app/settings/page.tsx agent-ui/src/app/globals.css agent-ui/src/store.ts
git commit -m "feat(agent-ui): cline-style model provider management UI"
```

---

## Task 8: 修正过时的 CLAUDE.md

`CLAUDE.md` 的 Architecture / Phase-status 仍描述已不存在的 swarm。改成现状(DeepAgentService + createDeepAgent)+ 本次新加的模型配置体系。

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 修正 Agentos 段**

把 `CLAUDE.md` 里 `### server (NestJS)` 下 **Agentos** 子段中描述 `createSwarm`/`workspace-swarm.service.ts`/`transfer_to_writer`/`WritingChapter`/`extractDelta`/`makeTrimHook` 的内容,替换为现状要点:

- 会话 agent = `DeepAgentService`(`deepagents` 的 `createDeepAgent`),主 agent + 三个 subagent(writer / settler / validator)。
- **模型配置化**:`DeepAgentService.getModel` 通过 `ModelConfigService.getActive(userId)` 读用户活动 `ModelConfig`,经 `agentos/model-factory.ts`(`resolveModelSpec` + `buildChatModel`)按 provider 实例化 `ChatOpenAI`(openai-compatible)/ `ChatAnthropic` / `ChatGoogleGenerativeAI`。配置存 `ModelConfig` 表 + `User.activeModelConfigId`,管理走 `SettingsModule`(`/settings/models`)。API Key 服务端持有,响应不回传。
- 中间件:仅 `excludeFilesystemTools`(过滤 deepagents 强制注入的 7 个 FS 工具)。原 GLM 专用 `coerce`(含 generic 消息重分类)已移除。
- 轮次流式:`createActivityEmitter` 把 langgraph message-stream chunk 翻译为 `ActivityEvent`(`think`/`content`/`tool`/`ActResult`);控制器 `aggregateActivities` 汇总,帧格式 `RunStarted` / 活动 / `RunCompleted`。
- 数据模型补 `ModelConfig` + `User.activeModelConfigId` 说明;`Novel.status: CONCEPT|ACTIVE` 保留。

- [ ] **Step 2: 修正 Phase status 段**

把 Phase 3 描述里引用 swarm/`WritingChapter` 的部分,改为「v0.4.0+:createSwarm 已替换为 deepagents `createDeepAgent`(主+writer/settler/validator)」;新增一条「模型配置化(server-side 每用户 ModelConfig + 多 provider 工厂 + cline 风格 UI + FS 过滤中间件)」。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite stale agentos architecture in CLAUDE.md"
```

---

## Task 9: 全量验证 + 手测清单

- [ ] **Step 1: server 全量门禁**

Run:
```bash
cd server && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全过。

- [ ] **Step 2: agent-ui 全量门禁**

Run:
```bash
cd agent-ui && pnpm validate
```
Expected: lint + format + typecheck 全过。

- [ ] **Step 3: 起服务手测(两端口)**

Run(后台):
```bash
pnpm dev   # 根目录:agent-ui :3000 + server :3001
```

手测清单:
1. 登录后进 `/`(小说库),左侧 `AppSidebar` 的「小说库」高亮;点「设置」跳 `/settings`,「设置」高亮。
2. 设置页:点「+ 新建模型」→ 选「智谱 GLM」→ baseURL/model 自动带出 → 填 API Key → 创建;列表出现该项。
3. 点「设为当前」→ 该项标「当前」。
4. 回工作台(`/novels/[id]`):左栏 IconRail **无 ⚙️**;发一条消息,服务端用刚激活的模型跑通(检查 server 日志无 `尚未配置模型`、无 langgraph 报错)。
5. 设置页再建一个 Anthropic/Gemini 配置,切换激活,回工作台发消息验证该 provider 跑通(Anthropic 会自动启用 prompt-caching,正常)。
6. 切回 GLM-5.2 测试:若无 role 崩溃复现 → 记录,后续按需补针对性 shim(本次不补)。
7. 删除活动配置 → `User.activeModelConfigId` 置空;工作台发消息应报「尚未配置模型」(预期)。

---

## 自检(Coverage / 类型一致性)

- **Spec 覆盖**:问题1→Task 6(IconRail 删⚙️ + AppSidebar);问题2→Task 6(tab 高亮);问题3→Task 2+4+5+7(数据层+工厂+API+UI);问题4→Task 3(coerce 删 + excludeFilesystemTools)。模型存储/活动表示/厂商范围/中间件 = 全部落到任务。
- **类型一致**:`ModelProvider` 三处定义一致(server DTO `MODEL_PROVIDERS` / FE `types/settings.ts` / 预设)。`MaskedModelConfig.hasApiKey` ↔ FE `ModelConfig.hasApiKey`。`getActive` 返回带 apiKey 的原配置 ↔ `ModelConfigRecord` 字段(provider/model/baseUrl/apiKey/temperature)。
- **无占位符**:每个代码步含完整代码;`.input-base` 步骤先 Read globals.css 确认变量名再追加。

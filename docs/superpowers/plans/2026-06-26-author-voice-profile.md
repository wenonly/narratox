# 作者画像(Author Voice Profile)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者把个人写作声音录成一份 Markdown「作者画像」(全局 per-user),由专用 agent 从样本归纳生成,注入 writer 指导腔调、注入 validator 做比对,真正去 AI 指纹 + 全书声音一致。

**Architecture:** `User.voiceProfile`(Markdown 字符串)+ `/settings/voice` GET/PUT + `/settings/voice/generate` POST(跑轻量画像 agent)。`DeepAgentService.runTurn` 每轮把画像拼进 writer 的 augment slice;`resolvePrompt` 新增 `'validator'` 分支把画像拼进 validator prompt(第 11 维)。FE `/settings` 加三状态「作者画像」区。

**Tech Stack:** NestJS 11 + Prisma 7(PostgreSQL)+ deepagents/LangGraph(画像 agent);Next.js 15 + React 18 + Zustand(FE)。包管理 pnpm。Prisma 7 配置驱动(`prisma migrate dev` 不带 `--schema`;**改 schema 后必须手动 `prisma generate`**,见记忆 gotcha)。

**Spec:** [docs/superpowers/specs/2026-06-26-author-voice-profile-design.md](../specs/2026-06-26-author-voice-profile-design.md)

**Branch:** `feat/p1.5-author-voice-profile`(已建,spec 已在其上)。全程在此分支提交。

**参考代码(patterns to mirror):**
- 服务/控制器/DTO:[settings/model-config.service.ts](../../../server/src/settings/model-config.service.ts)、[model-config.controller.ts](../../../server/src/settings/model-config.controller.ts)、`settings/dto/*.dto.ts`
- writer slice 注入:[deep-agent.service.ts:134-158](../../../server/src/agentos/deep-agent.service.ts#L134)(`writerSlice` → `buildAgentGraph` → `resolvePrompt` 的 `promptAugment==='writer'` 分支,line 325-328)
- FE settings 客户端:[api/settings.ts](../../../agent-ui/src/api/settings.ts)、[types/settings.ts](../../../agent-ui/src/types/settings.ts)、[components/settings/ModelSettings.tsx](../../../agent-ui/src/components/settings/ModelSettings.tsx)

**约定:** 每个 Task 末尾 `pnpm --dir server test`(后端)或 `pnpm --dir agent-ui typecheck`(前端)验证;每个 Task 一个 commit。所有 server 命令在 `server/`、FE 在 `agent-ui/` 下跑。

---

## Task 1: Schema —— `User.voiceProfile`

**Files:**
- Modify: `server/prisma/schema.prisma`(`model User` 加列)

- [ ] **Step 1: 加列**

在 `server/prisma/schema.prisma` 的 `model User { ... }` 里(在 `email`/`password` 等列之后、`activeModelConfigId` 附近)加:

```prisma
  voiceProfile String?   // Markdown 作者画像;null=未设置,writer/validator 走默认
```

- [ ] **Step 2: 生成迁移**

```bash
cd server && pnpm exec prisma migrate dev --name add_user_voice_profile
```
预期:生成 `server/prisma/migrations/<ts>_add_user_voice_profile/migration.sql`,含 `ALTER TABLE "User" ADD COLUMN "voiceProfile" TEXT;`。

- [ ] **Step 3: 手动 regenerate client(记忆 gotcha:migrate dev 不自动 generate)**

```bash
cd server && pnpm exec prisma generate
```

- [ ] **Step 4: 验证 typecheck**

```bash
cd server && pnpm exec tsc --noEmit
```
预期:通过(`prisma.user.update({data:{voiceProfile}})` 等类型可用)。

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(server): add User.voiceProfile column"
```

---

## Task 2: `VoiceProfileService`(get/upsert)+ 纯函数 `buildProfilePrompt` + 单测

**Files:**
- Create: `server/src/settings/voice-profile.service.ts`
- Create: `server/src/settings/voice-profile.service.spec.ts`

先做 get/upsert 与纯函数(prompt 构造),generate 在 Task 4(依赖模型)。

- [ ] **Step 1: 写失败测试**

`server/src/settings/voice-profile.service.spec.ts`:

```ts
import { VoiceProfileService, buildProfilePrompt } from './voice-profile.service';
import type { PrismaService } from '../prisma/prisma.service';

const mockPrisma = (user: { findUnique: jest.Mock; update: jest.Mock }) =>
  ({ user } as unknown as PrismaService);

describe('VoiceProfileService', () => {
  describe('get', () => {
    it('returns the stored voiceProfile', async () => {
      const prisma = mockPrisma({
        findUnique: jest.fn().mockResolvedValue({ voiceProfile: '# 画像\n雷厉风行' }),
        update: jest.fn(),
      });
      const svc = new VoiceProfileService(prisma, {} as never);
      expect(await svc.get('u1')).toBe('# 画像\n雷厉风行');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { voiceProfile: true },
      });
    });

    it('returns null when not set', async () => {
      const prisma = mockPrisma({
        findUnique: jest.fn().mockResolvedValue({ voiceProfile: null }),
        update: jest.fn(),
      });
      const svc = new VoiceProfileService(prisma, {} as never);
      expect(await svc.get('u1')).toBeNull();
    });
  });

  describe('upsert', () => {
    it('stores profile (empty string → null)', async () => {
      const update = jest.fn().mockResolvedValue({});
      const prisma = mockPrisma({ findUnique: jest.fn(), update });
      const svc = new VoiceProfileService(prisma, {} as never);
      const out = await svc.upsert('u1', '');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { voiceProfile: null },
      });
      expect(out).toEqual({ profile: null });
    });
  });

  describe('buildProfilePrompt (pure)', () => {
    it('embeds samples into the builder instruction', () => {
      const p = buildProfilePrompt(['第一段样本', '第二段']);
      expect(p).toContain('第一段样本');
      expect(p).toContain('第二段');
      expect(p).toContain('作者画像');
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && pnpm test -- voice-profile.service.spec.ts
```
预期:FAIL(`Cannot find module './voice-profile.service'`)。

- [ ] **Step 3: 写实现**

`server/src/settings/voice-profile.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModelConfigService } from './model-config.service';
import { PROFILE_BUILDER_PROMPT } from './profile-builder.prompt';

/**
 * 把作者粘贴的样本拼成喂给画像 agent 的 user 消息(纯函数,好单测)。
 */
export function buildProfilePrompt(samples: string[]): string {
  const body = samples.map((s, i) => `【样本 ${i + 1}】\n${s}`).join('\n\n---\n\n');
  return `下面是这位作者的若干段代表性文字。请据此归纳出一份「作者画像」Markdown。\n\n${body}`;
}

@Injectable()
export class VoiceProfileService {
  constructor(
    private readonly prisma: PrismaService,
    // generate() 用;Task 4 接入。这里先占位注入(构造期不调用)。
    private readonly modelConfigs: ModelConfigService,
  ) {}

  /** 取当前用户的画像 Markdown;未设置返回 null。 */
  async get(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { voiceProfile: true },
    });
    return u?.voiceProfile ?? null;
  }

  /** 整体覆盖画像;空串视为清空(存 null)。 */
  async upsert(userId: string, profile: string): Promise<{ profile: string | null }> {
    const value = profile && profile.trim() ? profile : null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { voiceProfile: value },
    });
    return { profile: value };
  }

  // generate() 在 Task 4 实现。
  void PROFILE_BUILDER_PROMPT; // 占位引用,防 import 未用报错(Task 4 用)
}
```

注:`profile-builder.prompt.ts` 在 Task 4 创建;本 Task 为让 `buildProfilePrompt` 测试通过,先建一个最小版:

`server/src/settings/profile-builder.prompt.ts`:

```ts
/** 画像 agent 的系统指令(Task 4 会补全正文)。 */
export const PROFILE_BUILDER_PROMPT = '你是作者声音分析师。(Task 4 补全)';
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && pnpm test -- voice-profile.service.spec.ts
```
预期:PASS(3 个用例)。

- [ ] **Step 5: Commit**

```bash
git add server/src/settings/voice-profile.service.ts server/src/settings/voice-profile.service.spec.ts server/src/settings/profile-builder.prompt.ts
git commit -m "feat(settings): VoiceProfileService get/upsert + buildProfilePrompt"
```

---

## Task 3: DTOs + Controller(GET/PUT `/settings/voice`)+ 接线 + 测试

**Files:**
- Create: `server/src/settings/dto/put-voice-profile.dto.ts`
- Create: `server/src/settings/voice-profile.controller.ts`
- Create: `server/src/settings/voice-profile.controller.spec.ts`
- Modify: `server/src/settings/settings.module.ts`

- [ ] **Step 1: 写 DTO**

`server/src/settings/dto/put-voice-profile.dto.ts`:

```ts
import { IsString, MaxLength } from 'class-validator';

export class PutVoiceProfileDto {
  @IsString()
  @MaxLength(8000)
  profile!: string;
}
```

- [ ] **Step 2: 写 controller**

`server/src/settings/voice-profile.controller.ts`:

```ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VoiceProfileService } from './voice-profile.service';
import { PutVoiceProfileDto } from './dto/put-voice-profile.dto';

@Controller('settings/voice')
export class VoiceProfileController {
  constructor(private readonly voice: VoiceProfileService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.voice.get(user.id);
  }

  @Put()
  upsert(@CurrentUser() user: RequestUser, @Body() dto: PutVoiceProfileDto) {
    return this.voice.upsert(user.id, dto.profile);
  }
}
```

- [ ] **Step 3: 写 controller 测试**

`server/src/settings/voice-profile.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';

const USER = { id: 'u1', email: 'a@b.com' } as never;

describe('VoiceProfileController', () => {
  let controller: VoiceProfileController;
  let voice: { get: jest.Mock; upsert: jest.Mock };

  beforeEach(async () => {
    voice = { get: jest.fn().mockResolvedValue('# 画像'), upsert: jest.fn().mockResolvedValue({ profile: '# 画像' }) };
    const module = await Test.createTestingModule({
      controllers: [VoiceProfileController],
      providers: [{ provide: VoiceProfileService, useValue: voice }],
    }).compile();
    controller = module.get(VoiceProfileController);
  });

  it('GET forwards to voice.get', async () => {
    await controller.get(USER);
    expect(voice.get).toHaveBeenCalledWith('u1');
  });

  it('PUT forwards profile to voice.upsert', async () => {
    await controller.upsert(USER, { profile: '# 新' } as never);
    expect(voice.upsert).toHaveBeenCalledWith('u1', '# 新');
  });
});
```

- [ ] **Step 4: 接线 module**

`server/src/settings/settings.module.ts` —— 加 controller/provider/export:

```ts
import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';

/** 导出 ModelConfigService / VoiceProfileService 供 AgentosModule 注入。 */
@Module({
  controllers: [ModelConfigController, VoiceProfileController],
  providers: [ModelConfigService, VoiceProfileService],
  exports: [ModelConfigService, VoiceProfileService],
})
export class SettingsModule {}
```

- [ ] **Step 5: 跑测试 + 全量 typecheck/lint**

```bash
cd server && pnpm test -- voice-profile && pnpm exec tsc --noEmit && pnpm run lint
```
预期:controller 测试 PASS;typecheck/lint 通过。

- [ ] **Step 6: Commit**

```bash
git add server/src/settings
git commit -m "feat(settings): /settings/voice GET/PUT + VoiceProfileController"
```

---

## Task 4: 画像 agent —— `PROFILE_BUILDER_PROMPT` 正文 + `generate()` + POST `/settings/voice/generate`

**Files:**
- Modify: `server/src/settings/profile-builder.prompt.ts`(补正文)
- Modify: `server/src/settings/voice-profile.service.ts`(加 `generate`)
- Create: `server/src/settings/dto/generate-voice-profile.dto.ts`
- Modify: `server/src/settings/voice-profile.controller.ts`(加 generate 路由)
- Modify: `server/src/settings/voice-profile.service.spec.ts`(加 generate 守卫测试)

- [ ] **Step 1: 补 PROFILE_BUILDER_PROMPT 正文**

`server/src/settings/profile-builder.prompt.ts` 整体替换为:

```ts
/** 画像 agent 系统指令:从作者样本归纳一份 Markdown 作者画像。 */
export const PROFILE_BUILDER_PROMPT = `你是「作者声音分析师」。用户会给你若干段【他自己写的】代表性文字。
你的任务:严谨地从中归纳这位作者的写作声音,输出一份 Markdown「作者画像」,供 AI 写小说时照此腔调写作、并当尺子校验。

只归纳样本里【真实存在】的特征,不要编造、不要套用通用建议。样本不足以下结论的点,宁可不写。

严格用以下 Markdown 结构输出(每节都要,没观察到就写「样本不足,待补充」):

# 作者画像
## 语调与节奏
(整体气质:雷厉风行/缠绵/冷峻…;句子长短与节奏习惯;紧张/平静处怎么写)
## 标志句式
- (反复出现的句式、口头禅、段落收尾习惯;逐条列)
## 专属意象
- (反复使用的具体意象/物件/感官词;逐条列)
## 用词偏好
- (爱用/回避的词类、动词风格、是否口语化/书面化)
## 要避免(AI 套路 / 与作者相悖的写法)
- (作者样本里【没有】、但 AI 容易写的套路,如特定连接词/比喻/身体反应;逐条列)
## 代表性片段
> (从样本里摘 1-2 段最能体现声音的原文,作校验尺子)

直接输出 Markdown,不要寒暄、不要解释你做了什么。`;
```

- [ ] **Step 2: 写 generate DTO**

`server/src/settings/dto/generate-voice-profile.dto.ts`:

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

export class GenerateVoiceProfileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(4000, { each: true })
  samples!: string[];
}
```

- [ ] **Step 3: 写失败测试(generate 无模型配置时抛错)**

在 `voice-profile.service.spec.ts` 顶部 `mockPrisma` 旁加一个带 modelConfigs mock 的构造辅助,并加用例:

```ts
// 在文件顶部 import 区下补:
const mockModelConfigs = (active: unknown) =>
  ({ getActive: jest.fn().mockResolvedValue(active) } as never);

// 在 describe('VoiceProfileService', ...) 内加:
describe('generate', () => {
  it('throws when no active model config', async () => {
    const svc = new VoiceProfileService(
      mockPrisma({ findUnique: jest.fn(), update: jest.fn() }),
      mockModelConfigs(null),
    );
    await expect(svc.generate('u1', ['一段样本'])).rejects.toThrow(/尚未配置模型/);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

```bash
cd server && pnpm test -- voice-profile.service.spec.ts
```
预期:FAIL(`svc.generate is not a function`)。

- [ ] **Step 5: 实现 generate()**

在 `voice-profile.service.ts` 顶部 import 区加:

```ts
import { buildChatModel, type ModelConfigRecord } from '../agentos/model-factory';
import { MAX_TOKENS_BY_TIER } from '../agentos/agent-tree.config';
```

把 `voice-profile.service.ts` 的占位行 `void PROFILE_BUILDER_PROMPT;` 删掉,并在类里加 `generate`:

```ts
  /**
   * 跑画像 agent:从作者样本归纳 Markdown 画像。不落库(回前端供审,保存走 upsert)。
   * 复用用户活动模型配置;无配置时与 runTurn 一致抛错。
   */
  async generate(userId: string, samples: string[]): Promise<{ profile: string }> {
    const active = await this.modelConfigs.getActive(userId);
    if (!active) {
      throw new Error('尚未配置模型,请在设置页「设置」中添加并激活一个模型');
    }
    const config: ModelConfigRecord = {
      id: active.id,
      provider: active.provider,
      model: active.model,
      baseUrl: active.baseUrl,
      apiKey: active.apiKey,
      temperature: active.temperature,
      updatedAt: active.updatedAt,
    };
    const model = await buildChatModel(config, MAX_TOKENS_BY_TIER.long);
    const { createAgent } = await import('deepagents');
    const agent = createAgent({
      model: model as never,
      systemPrompt: PROFILE_BUILDER_PROMPT,
    } as never);
    const result = (await agent.invoke({
      messages: [{ role: 'user', content: buildProfilePrompt(samples) }],
    } as never)) as { messages: Array<{ content?: unknown }> };
    const profile = extractLastText(result.messages);
    return { profile };
  }
```

在文件底部(类外)加辅助:

```ts
/** 取 langgraph 结果最后一条消息的文本内容。 */
function extractLastText(messages: Array<{ content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i]?.content;
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}
```

- [ ] **Step 6: 加 generate 路由**

在 `voice-profile.controller.ts` 顶部 import 加 `Post`,并 import DTO/service 类型;类内加:

```ts
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VoiceProfileService } from './voice-profile.service';
import { PutVoiceProfileDto } from './dto/put-voice-profile.dto';
import { GenerateVoiceProfileDto } from './dto/generate-voice-profile.dto';

@Controller('settings/voice')
export class VoiceProfileController {
  constructor(private readonly voice: VoiceProfileService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.voice.get(user.id);
  }

  @Put()
  upsert(@CurrentUser() user: RequestUser, @Body() dto: PutVoiceProfileDto) {
    return this.voice.upsert(user.id, dto.profile);
  }

  @Post('generate')
  generate(
    @CurrentUser() user: RequestUser,
    @Body() dto: GenerateVoiceProfileDto,
  ) {
    return this.voice.generate(user.id, dto.samples);
  }
}
```

- [ ] **Step 7: 跑测试 + typecheck + lint**

```bash
cd server && pnpm test -- voice-profile && pnpm exec tsc --noEmit && pnpm run lint
```
预期:PASS(generate 守卫用例 + 其余);typecheck/lint 通过。

- [ ] **Step 8: Commit**

```bash
git add server/src/settings
git commit -m "feat(settings): profile-builder agent + POST /settings/voice/generate"
```

---

## Task 5: Writer 注入 —— 画像拼进 writer slice

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`(注入 `VoiceProfileService`、runTurn 读画像、拼进 `writerSlice`)

- [ ] **Step 1: 注入 VoiceProfileService**

在 `deep-agent.service.ts` 的构造函数参数里(已有 `modelConfigs: ModelConfigService` 旁)加:

```ts
import { VoiceProfileService } from '../settings/voice-profile.service';
// ...
    private readonly voiceProfile: VoiceProfileService,
```

- [ ] **Step 2: runTurn 读画像并拼进 writerSlice**

在 `runTurn` 内、构造 `writerSlice` 之后(line ~149 `: '';` 之后)、`const agent = await this.buildAgentGraph({` 之前,插入:

```ts
    // 作者画像(per-user):拼进 writer 的 augment slice。空画像 → 不加(走 P1 默认规则)。
    const voiceProfileMd = await this.voiceProfile.get(userId);
    const voiceSlice = voiceProfileMd
      ? '\n\n【作者声音 — 照作者本人的腔调写,不是 AI 自选】\n' +
        voiceProfileMd.slice(0, 1500)
      : '';
```

然后把 `writerSlice` 的使用点(line ~157 `writerSlice,`)改成拼接(在传给 buildAgentGraph 前):

```ts
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig: config,
      writerSlice: writerSlice + voiceSlice,
    });
```

- [ ] **Step 3: typecheck + lint**

```bash
cd server && pnpm exec tsc --noEmit && pnpm run lint
```
预期:通过(`VoiceProfileService` 已被 SettingsModule export、AgentosModule 已 import SettingsModule)。

- [ ] **Step 4: 跑全量 jest(确认没破坏现有 agentos 测试)**

```bash
cd server && pnpm test
```
预期:全绿(画像注入是新读取,不改变现有行为;空画像时 voiceSlice='')。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "feat(agent): inject author voiceProfile into writer slice"
```

---

## Task 6: Validator 注入 —— `resolvePrompt` 加 `'validator'` 分支 + 第 11 维

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`(validator spec 加 `promptAugment: 'validator'`)
- Modify: `server/src/agentos/deep-agent.service.ts`(`resolvePrompt` 加分支;runTurn 造 `validatorSlice` 并传 buildAgentGraph)
- Modify: `server/src/agentos/agent-prompts.ts`(VALIDATOR 加第 11 维文案)
- Modify: `server/src/agentos/agent-tree.config.spec.ts`(若 snapshot 校验 promptAugment,更新)

- [ ] **Step 1: VALIDATOR prompt 加第 11 维**

在 `agent-prompts.ts` 的 `VALIDATOR_AGENT_PROMPT` 里,dim 10 之后加(并在开头把"10 维"若出现过改成"11 维"——注:Task P1 已是"10 维",这里改成"11 维"):

```
11. 作者声音匹配(仅当你的上下文里给出了【作者画像】时审计;没有就跳过本维)——把本章与【作者画像】对照:语调/节奏/句式/用词偏好是否一致(像不像同一个作者写的);画像「要避免」项是否命中;标志句式/专属意象是否在合适处复现(不强制每章,但全书要有)。严重偏离作者声音(像换了个 AI 写的)= issue;命中「要避免」项 = issue。
```

同时把 VALIDATOR 开头 `按以下 10 维逐项审计` 改成 `按以下 11 维逐项审计(第 11 维仅当上下文含【作者画像】时审计)`。

- [ ] **Step 2: validator spec 标记 augment**

在 `agent-tree.config.ts` 的 validator `AgentSpec` 里加 `promptAugment: 'validator'`(与 writer 的 `promptAugment: 'writer'` 同字段)。先确认 `AgentSpec.promptAugment` 的类型联合含 `'validator'`——在该类型定义处(通常 `type PromptAugment = 'writer' | ...` 或内联)加上 `'validator'`。

- [ ] **Step 3: resolvePrompt 加分支 + runTurn 造 validatorSlice**

在 `deep-agent.service.ts` 的 `buildAgentGraph` 内,`resolvePrompt`(line ~325)改成:

```ts
    const resolvePrompt = (spec: AgentSpec) => {
      if (spec.promptAugment === 'writer') return PROMPTS[spec.promptKey] + writerSlice;
      if (spec.promptAugment === 'validator') return PROMPTS[spec.promptKey] + validatorSlice;
      return PROMPTS[spec.promptKey];
    };
```

`validatorSlice` 需在 `buildAgentGraph` 作用域内可见。在 `buildAgentGraph` 的参数解构里加 `validatorSlice`(默认 ''):

```ts
  private async buildAgentGraph(args: {
    userId: string;
    novelId: string;
    readingChapterOrder: number | null;
    systemPrompt: string;
    activeConfig: ModelConfigRecord;
    writerSlice: string;
    validatorSlice?: string;
  }) {
    const {
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig,
      writerSlice,
      validatorSlice = '',
    } = args;
```

(若 `buildAgentGraph` 现签名不同,按现有解构风格补 `validatorSlice`。)

在 `runTurn` 里(Task 5 已读 `voiceProfileMd`),造 validatorSlice 并传:

```ts
    const validatorSlice = voiceProfileMd
      ? '\n\n【作者画像 — 校验本章是否像这个作者写的】\n' + voiceProfileMd.slice(0, 1500)
      : '';
```

并把 buildAgentGraph 调用的参数加 `validatorSlice`(在 `writerSlice: writerSlice + voiceSlice,` 旁):

```ts
      writerSlice: writerSlice + voiceSlice,
      validatorSlice,
```

注:writer 侧用 `writerSlice + voiceSlice`(Task 5),validator 侧用独立 `validatorSlice`。两者都来自同一 `voiceProfileMd`,文案不同(writer 是"照此写",validator 是"对照校验")。

- [ ] **Step 4: typecheck + lint + 全量 jest**

```bash
cd server && pnpm exec tsc --noEmit && pnpm run lint && pnpm test
```
预期:通过。若 `agent-tree.config.spec.ts` 的 `collectSpecs`/`describeTree` snapshot 因 validator 加 `promptAugment` 失败,更新该 snapshot 的期望值(把 validator 的 expected spec 加上 `promptAugment: 'validator'`)。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos
git commit -m "feat(agent): inject author voiceProfile into validator (dim 11, centaur)"
```

---

## Task 7: FE 类型 + API 客户端 + 路由

**Files:**
- Modify: `agent-ui/src/types/settings.ts`
- Modify: `agent-ui/src/api/settings.ts`
- Modify: `agent-ui/src/api/routes.ts`

- [ ] **Step 1: 加类型**

`agent-ui/src/types/settings.ts` 末尾加:

```ts
/** GET /settings/voice 返回(画像 Markdown 或 null)。 */
export type VoiceProfile = string | null

/** POST /settings/voice/generate 入参。 */
export interface GenerateVoiceProfileInput {
  samples: string[]
}
```

- [ ] **Step 2: 加路由**

`agent-ui/src/api/routes.ts` 的 `APIRoutes` 里(在 `SettingsModelActivate` 附近)加:

```ts
  SettingsVoice: (base: string) => `${base}/settings/voice`,
  SettingsVoiceGenerate: (base: string) => `${base}/settings/voice/generate`,
```

- [ ] **Step 3: 加 API 客户端**

`agent-ui/src/api/settings.ts` 末尾加(顶部 import 补 `VoiceProfile, GenerateVoiceProfileInput`):

```ts
import type {
  ModelConfig,
  ModelConfigInput,
  VoiceProfile,
  GenerateVoiceProfileInput
} from '@/types/settings'

// ...(现有函数不动)...

export const getVoiceProfile = (base: string, token: string) =>
  asJson<VoiceProfile>(fetch(APIRoutes.SettingsVoice(base), { headers: headers(token) }))

export const putVoiceProfile = (base: string, token: string, profile: string) =>
  asJson<{ profile: string | null }>(
    fetch(APIRoutes.SettingsVoice(base), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({ profile })
    })
  )

export const generateVoiceProfile = (
  base: string,
  token: string,
  input: GenerateVoiceProfileInput
) =>
  asJson<{ profile: string }>(
    fetch(APIRoutes.SettingsVoiceGenerate(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )
```

- [ ] **Step 4: typecheck + lint + format**

```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:fix
```
预期:通过。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/types/settings.ts agent-ui/src/api/settings.ts agent-ui/src/api/routes.ts
git commit -m "feat(agent-ui): voice profile types + api client + routes"
```

---

## Task 8: FE `VoiceProfile.tsx`(三状态)+ 挂到 settings page

**Files:**
- Create: `agent-ui/src/components/settings/VoiceProfile.tsx`
- Modify: `agent-ui/src/app/settings/page.tsx`

- [ ] **Step 1: 写组件**

`agent-ui/src/components/settings/VoiceProfile.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  generateVoiceProfile,
  getVoiceProfile,
  putVoiceProfile
} from '@/api/settings'

const TEMPLATE = `# 作者画像
## 语调与节奏
(整体气质、句长节奏……)
## 标志句式
- (口头禅、句式、段尾习惯)
## 专属意象
- (反复用的意象/物件/感官词)
## 用词偏好
- (动词风格、口语化/书面化)
## 要避免(AI 套路)
- (此外 / 仿佛…一般 / 胸口发紧……)
## 代表性片段
> (摘 1-2 段你最有代表性的原文)`

type Phase = 'loading' | 'empty' | 'ready'

const VoiceProfile = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [phase, setPhase] = useState<Phase>('loading')
  const [profile, setProfile] = useState('')
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [samples, setSamples] = useState<string[]>([''])
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const p = await getVoiceProfile(endpoint, token)
      if (p) {
        setProfile(p)
        setPhase('ready')
      } else {
        setPhase('empty')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
      setPhase('empty')
    }
  }, [endpoint, token])

  useEffect(() => {
    load()
  }, [load])

  const startManual = () => {
    setProfile(TEMPLATE)
    setDirty(true)
    setPhase('ready')
  }

  const doGenerate = async () => {
    const filled = samples.map((s) => s.trim()).filter(Boolean)
    if (!filled.length) {
      toast.error('请至少粘贴一段你的文字')
      return
    }
    setGenerating(true)
    try {
      const { profile: out } = await generateVoiceProfile(endpoint, token, { samples: filled })
      setProfile(out)
      setDirty(true)
      setView('edit')
      toast.success('已生成,请审阅后点「保存」')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const save = async () => {
    try {
      await putVoiceProfile(endpoint, token, profile)
      setDirty(false)
      toast.success('已保存 · 下次写章生效')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  if (phase === 'loading') return <p className="text-xs text-muted">加载中…</p>

  if (phase === 'empty') {
    return (
      <div className="rounded-xl border border-white/20 bg-background.secondary p-5">
        <p className="mb-4 text-sm text-muted">
          还没有作者画像。AI 会照它写的腔调写作、并用它当尺子校验。留空则用默认写作风格。
        </p>
        <div className="mb-6 space-y-2">
          <p className="text-xs text-muted">粘贴 1-5 段你最像自己风格的文字,AI 据此归纳:</p>
          {samples.map((s, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                className="min-h-[80px] flex-1 resize-y rounded-md border border-white/20 bg-background px-3 py-2 font-mono text-xs text-primary"
                placeholder={`第 ${i + 1} 段样本…`}
                value={s}
                onChange={(e) =>
                  setSamples((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))
                }
              />
              {samples.length > 1 && (
                <button
                  className="text-muted hover:text-primary"
                  onClick={() => setSamples((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  删
                </button>
              )}
            </div>
          ))}
          <button
            className="text-xs text-brand"
            onClick={() => setSamples((prev) => [...prev, ''])}
          >
            + 添加一段
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md bg-brand px-4 py-2 text-sm text-primary disabled:opacity-50"
            disabled={generating}
            onClick={doGenerate}
          >
            {generating ? '正在归纳你的声音…' : '从我的写作生成'}
          </button>
          <button
            className="rounded-md border border-white/20 px-4 py-2 text-sm text-primary"
            onClick={startManual}
          >
            手动编辑模板
          </button>
        </div>
      </div>
    )
  }

  // ready
  return (
    <div className="rounded-xl border border-white/20 bg-background.secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`cursor-pointer rounded-md px-3 py-1 text-xs ${view === 'edit' ? 'bg-accent text-primary' : 'text-muted'}`}
          onClick={() => setView('edit')}
        >
          ✎ 编辑
        </span>
        <span
          className={`cursor-pointer rounded-md px-3 py-1 text-xs ${view === 'preview' ? 'bg-accent text-primary' : 'text-muted'}`}
          onClick={() => setView('preview')}
        >
          👁 预览
        </span>
        <span className="flex-1" />
        <button
          className="rounded-md border border-white/20 px-3 py-1 text-xs text-muted"
          onClick={() => {
            setProfile('')
            setSamples([''])
            setPhase('empty')
          }}
        >
          ↻ 重新生成
        </button>
        <button
          className="rounded-md bg-brand px-4 py-1 text-xs text-primary disabled:opacity-50"
          disabled={!dirty}
          onClick={save}
        >
          保存
        </button>
      </div>
      {view === 'edit' ? (
        <textarea
          className="min-h-[320px] w-full resize-y rounded-md border border-white/20 bg-background p-3 font-mono text-xs leading-relaxed text-primary"
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value)
            setDirty(true)
          }}
        />
      ) : (
        <pre className="min-h-[320px] w-full whitespace-pre-wrap rounded-md border border-white/20 bg-background p-3 text-xs leading-relaxed text-primary">
          {profile}
        </pre>
      )}
      <p className="mt-2 text-xs text-muted">保存后即时生效 · 下次写章即注入</p>
    </div>
  )
}

export default VoiceProfile
```

- [ ] **Step 2: 挂到 settings page**

`agent-ui/src/app/settings/page.tsx` —— 标题改「设置」,ModelSettings 下方加 VoiceProfile 区块。把 `<main>...</main>` 内部改为:

```tsx
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-2 text-lg font-semibold text-primary">设置</h1>
        <p className="mb-6 text-xs text-muted">
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </p>

        <h2 className="mb-2 text-sm font-semibold text-primary">模型设置</h2>
        <div className="mb-10">
          <ModelSettings />
        </div>

        <h2 className="mb-2 text-sm font-semibold text-primary">作者画像</h2>
        <p className="mb-3 text-xs text-muted">
          你的写作声音 · 全局(所有小说共用)
        </p>
        <VoiceProfile />
      </main>
```

并在文件顶部 import:`import VoiceProfile from '@/components/settings/VoiceProfile'`。

- [ ] **Step 3: typecheck + lint + format**

```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:fix
```
预期:通过。

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/settings/VoiceProfile.tsx agent-ui/src/app/settings/page.tsx
git commit -m "feat(agent-ui): VoiceProfile editor (3-state) in /settings"
```

---

## Task 9: Final 验证 + 合并准备

- [ ] **Step 1: server 全 gate**

```bash
cd server && pnpm exec tsc --noEmit && pnpm run lint && pnpm test
```
预期:typecheck 通过 / eslint 0 / jest 全绿(用例数应比 P0 后的 272 多:新增 voice-profile service/controller 用例)。

- [ ] **Step 2: agent-ui 全 gate**

```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format
```
预期:typecheck / next lint / prettier 全过。

- [ ] **Step 3: 手测(可选,需 server + agent-ui 跑起来)**

- `/settings` 看到「作者画像」区;空状态贴样本 → 生成 → 审 → 保存。
- 写一章,确认 writer 注入了【作者声音】(看活动流/产出腔调);validator 第 11 维生效。
- 空画像时写作正常(回落 P1 默认)。

- [ ] **Step 4: Commit(若有 format 微调)+ 报告**

```bash
git status --short   # 应干净;不干净则 add/commit format 修复
```

---

## Self-Review(plan 自检)

**Spec 覆盖**:§3.1 schema → Task 1;§3.2 API(GET/PUT/generate)→ Task 3+4;§3.3 画像 agent → Task 4;§3.4 注入(writer/validator)→ Task 5+6;§3.5 UI → Task 7+8;§3.6 validator 第 11 维 → Task 6。§2 非目标(per-novel/统计层/自动读章节)均不在计划内 ✓。

**类型一致性**:`VoiceProfileService.get→string|null`、`upsert(userId,profile)→{profile:string|null}`、`generate(userId,samples)→{profile:string}`;controller 调用一致;FE `VoiceProfile=string|null`、`getVoiceProfile→VoiceProfile`、`putVoiceProfile(profile)`、`generateVoiceProfile({samples})` 一致 ✓。`promptAugment:'validator'` 在 config/resolvePrompt 一致 ✓。

**已知执行注意**:Task 6 的 `buildAgentGraph` 签名需执行者按现有解构补 `validatorSlice`(plan 已给模式);若 `AgentSpec.promptAugment` 是内联联合而非命名类型,直接扩内联联合。Task 4 的 `createAgent.invoke` 走 dynamic import + `as never`(与 deep-agent 一致,dual-package .d.ts 摩擦)。

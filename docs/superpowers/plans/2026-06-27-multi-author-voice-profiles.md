# 多作者画像 + 每小说选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 把 P1.5 的单全局画像升级为 per-user 画像库 + 每本小说选一个;工作台可查看/切换。

**Architecture:** `VoiceProfile` 表(per-user 库,CRUD 在 /settings)+ `Novel.voiceProfileId` FK + `PUT /novels/:id/voice-profile` 选画像 + 工作台 IconRail 抽屉面板(查看/切换)。注入读小说选中画像。迁移 User.voiceProfile → VoiceProfile。

**Tech Stack:** NestJS 11 + Prisma 7(Postgres);Next.js 15 + React 18。pnpm。Prisma 7 配置驱动(`prisma migrate dev` 不带 `--schema`;改 schema 后手动 `prisma generate`)。

**Spec:** [2026-06-27-multi-author-voice-profiles-design.md](../specs/2026-06-27-multi-author-voice-profiles-design.md)

**Branch:** `feat/p1.5-author-voice-profile`(演进,不另开)。

---

## Task 1: Schema —— VoiceProfile 表 + Novel.voiceProfileId + 迁移(搬数据 + 删旧列)

**Files:** Modify `server/prisma/schema.prisma`

- [ ] **Step 1: 改 schema**

在 `schema.prisma`:
- `model User` 加反向关系 `voiceProfiles VoiceProfile[]`,**删除** `voiceProfile String?` 列。
- `model Novel` 加 `voiceProfileId String?` + `voiceProfile VoiceProfile? @relation(fields: [voiceProfileId], references: [id], onDelete: SetNull)`。
- 新增模型:
```prisma
model VoiceProfile {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  profile   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  novels    Novel[]
  @@index([userId])
}
```

- [ ] **Step 2: 生成迁移**
```bash
cd server && pnpm exec prisma migrate dev --name voice_profile_table --create-only
```
(`--create-only` 先不执行,要手动加数据搬迁。)

- [ ] **Step 3: 编辑生成的 migration.sql,在 DROP COLUMN 前加数据搬迁**

打开 `server/prisma/migrations/<ts>_voice_profile_table/migration.sql`,在 `ALTER TABLE "User" DROP COLUMN "voiceProfile";` **之前**插入:
```sql
-- 数据搬迁:把每用户非空的 voiceProfile 搬进 VoiceProfile 表
INSERT INTO "VoiceProfile" ("id", "userId", "name", "profile", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", '默认画像', "voiceProfile", NOW(), NOW()
FROM "User"
WHERE "voiceProfile" IS NOT NULL AND "voiceProfile" <> '';
```
(若 `gen_random_uuid` 不可用,用 `cuid`-style:用 `md5("id" || 'voice')` 临时。先在 DB 试 `SELECT gen_random_uuid();` 确认可用——Postgres 13+ 默认有。)

- [ ] **Step 4: 执行迁移 + 手动 generate**
```bash
cd server && pnpm exec prisma migrate dev && pnpm exec prisma generate
```
预期:迁移应用,VoiceProfile 表建好,数据搬完,User.voiceProfile 列删除。

- [ ] **Step 5: typecheck + commit**
```bash
cd server && pnpm exec tsc --noEmit
cd /Users/taowen/project/narratox && git add server/prisma && git commit -m "feat(server): VoiceProfile table + Novel.voiceProfileId (migrate User.voiceProfile)"
```

---

## Task 2: 后端 —— VoiceProfileService CRUD + generate + 路由 + NovelService.setVoiceProfile

**Files:**
- Modify: `server/src/settings/voice-profile.service.ts`(get/upsert → list/create/update/delete + getForNovel;generate 不变)
- Modify/Create DTOs: `server/src/settings/dto/voice-profile.dto.ts`(Create/Update 合一)
- Modify: `server/src/settings/voice-profile.controller.ts`(GET 列表 / POST / PATCH:id / DELETE:id / POST generate)
- Modify: `server/src/novel/novel.service.ts`(加 setVoiceProfile)
- Modify: `server/src/novel/novel.controller.ts`(加 PUT :id/voice-profile)
- Modify: `server/src/settings/voice-profile.service.spec.ts`(更新测试)
- Create: `server/src/novel/novel-voice-profile.controller.spec.ts`(或加到 novel.controller.spec)

- [ ] **Step 1: 重写 VoiceProfileService(对 VoiceProfile 表 CRUD)**

`server/src/settings/voice-profile.service.ts` 整体替换:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModelConfigService } from './model-config.service';
import { buildChatModel, type ModelConfigRecord } from '../agentos/model-factory';
import { MAX_TOKENS_BY_TIER } from '../agentos/agent-tree.config';
import { PROFILE_BUILDER_PROMPT } from './profile-builder.prompt';

export function buildProfilePrompt(samples: string[]): string {
  const body = samples.map((s, i) => `【样本 ${i + 1}】\n${s}`).join('\n\n---\n\n');
  return `下面是这位作者的若干段代表性文字。请据此归纳出一份「作者画像」Markdown。\n\n${body}`;
}

@Injectable()
export class VoiceProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelConfigs: ModelConfigService,
  ) {}

  list(userId: string) {
    return this.prisma.voiceProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, data: { name: string; profile: string }) {
    return this.prisma.voiceProfile.create({
      data: { ...data, userId },
    });
  }

  async update(userId: string, id: string, data: { name?: string; profile?: string }) {
    await this.assertOwned(userId, id);
    return this.prisma.voiceProfile.update({ where: { id }, data });
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwned(userId, id);
    await this.prisma.voiceProfile.delete({ where: { id } });
    return { ok: true };
  }

  /** 注入用:取小说选中的画像 Markdown(无则 null)。 */
  async getForNovel(userId: string, novelId: string): Promise<string | null> {
    const novel = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { voiceProfile: { select: { profile: true } } },
    });
    return novel?.voiceProfile?.profile ?? null;
  }

  async generate(userId: string, samples: string[]): Promise<{ profile: string }> {
    const active = await this.modelConfigs.getActive(userId);
    if (!active) {
      throw new Error('尚未配置模型,请在设置页「设置」中添加并激活一个模型');
    }
    const config: ModelConfigRecord = {
      id: active.id, provider: active.provider, model: active.model,
      baseUrl: active.baseUrl, apiKey: active.apiKey,
      temperature: active.temperature, updatedAt: active.updatedAt,
    };
    const model = await buildChatModel(config, MAX_TOKENS_BY_TIER.long);
    const { createAgent } = await import('langchain');
    const agent = createAgent({ model: model as never, systemPrompt: PROFILE_BUILDER_PROMPT } as never);
    const result = (await agent.invoke({
      messages: [{ role: 'user', content: buildProfilePrompt(samples) }],
    } as never)) as { messages: Array<{ content?: unknown }> };
    return { profile: extractLastText(result.messages) };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.voiceProfile.findFirst({
      where: { id, userId }, select: { id: true },
    });
    if (!owned) throw new NotFoundException('Voice profile not found');
  }
}

function extractLastText(messages: Array<{ content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i]?.content;
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}
```
注意 `createAgent` 从 `'langchain'` import(同 deep-agent.service.ts)。

- [ ] **Step 2: DTO**

`server/src/settings/dto/voice-profile.dto.ts`:
```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateVoiceProfileDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @MaxLength(8000) profile!: string;
}
export class UpdateVoiceProfileDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsString() @MaxLength(8000) profile?: string;
}
export class GenerateVoiceProfileDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8)
  @IsString({ each: true }) @MaxLength(4000, { each: true })
  samples!: string[];
}
```
(顶部 import `IsArray, ArrayMinSize, ArrayMaxSize` from class-validator。)

- [ ] **Step 3: 重写 Controller**

`server/src/settings/voice-profile.controller.ts` 整体替换(路径改 `/settings/voice-profiles`):
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VoiceProfileService } from './voice-profile.service';
import { CreateVoiceProfileDto, UpdateVoiceProfileDto, GenerateVoiceProfileDto } from './dto/voice-profile.dto';

@Controller('settings/voice-profiles')
export class VoiceProfileController {
  constructor(private readonly voice: VoiceProfileService) {}

  @Get() list(@CurrentUser() user: RequestUser) { return this.voice.list(user.id); }
  @Post() create(@CurrentUser() user: RequestUser, @Body() dto: CreateVoiceProfileDto) { return this.voice.create(user.id, dto); }
  @Patch(':id') update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateVoiceProfileDto) { return this.voice.update(user.id, id, dto); }
  @Delete(':id') remove(@CurrentUser() user: RequestUser, @Param('id') id: string) { return this.voice.remove(user.id, id); }
  @Post('generate') generate(@CurrentUser() user: RequestUser, @Body() dto: GenerateVoiceProfileDto) { return this.voice.generate(user.id, dto.samples); }
}
```
删除旧的 `dto/put-voice-profile.dto.ts` 和 `dto/generate-voice-profile.dto.ts`(被 voice-profile.dto.ts 取代)。

- [ ] **Step 4: NovelService.setVoiceProfile**

`server/src/novel/novel.service.ts` 加方法(用现有 `assertOwned`):
```ts
  /** 设/清当前小说的作者画像(跨租户防护:voiceProfileId 必须属于该用户)。 */
  async setVoiceProfile(userId: string, novelId: string, voiceProfileId: string | null) {
    await this.assertOwned(userId, novelId);
    if (voiceProfileId) {
      const owned = await this.prisma.voiceProfile.findFirst({
        where: { id: voiceProfileId, userId }, select: { id: true },
      });
      if (!owned) throw new NotFoundException('Voice profile not found');
    }
    await this.prisma.novel.update({
      where: { id: novelId },
      data: { voiceProfileId },
    });
    return { ok: true };
  }
```

- [ ] **Step 5: NovelController 加 PUT :id/voice-profile**

`server/src/novel/novel.controller.ts` 加(用 `@Put`):
```ts
  @Put(':id/voice-profile')
  async setVoiceProfile(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { voiceProfileId: string | null },
  ): Promise<{ ok: true }> {
    await this.novels.setVoiceProfile(user.id, id, body.voiceProfileId);
    return { ok: true };
  }
```
(import `Put` 到 `@nestjs/common` import 列表。)

- [ ] **Step 6: 更新/加测试**

- `voice-profile.service.spec.ts`:更新 mock 适配新 PrismaMock(voiceProfile.findMany/create/update/delete/findFirst + novel.findFirst);测试 list/create/update/remove/getForNovel/generate-guard。getForNovel 测 novel 有/无 voiceProfile 两种。
- novel.controller.spec 或新 spec:setVoiceProfile 路由转发。

- [ ] **Step 7: typecheck + lint + jest + commit**
```bash
cd server && pnpm exec tsc --noEmit && pnpm run lint && pnpm test
cd /Users/taowen/project/narratox && git add -A && git commit -m "feat(server): VoiceProfile CRUD + PUT /novels/:id/voice-profile"
```

---

## Task 3: 注入改读小说选中画像

**Files:** Modify `server/src/agentos/deep-agent.service.ts`

- [ ] **Step 1: 改 runTurn 的画像读取**

找到 `Promise.all([this.modelConfigs.getActive(userId), this.voiceProfile.get(userId)])`(P1.5 加的),把 `this.voiceProfile.get(userId)` 改成 `this.voiceProfile.getForNovel(userId, novelId)`:
```ts
    const [activeConfig, voiceProfileMd] = await Promise.all([
      this.modelConfigs.getActive(userId),
      this.voiceProfile.getForNovel(userId, novelId),
    ]);
```
(其余 voiceSlice/validatorSlice 构造不变。)

- [ ] **Step 2: typecheck + jest + commit**
```bash
cd server && pnpm exec tsc --noEmit && pnpm test
cd /Users/taowen/project/narratox && git add server/src/agentos/deep-agent.service.ts && git commit -m "feat(agent): inject novel's selected voice profile (getForNovel)"
```

---

## Task 4: MAIN_AGENT_PROMPT 软引导

**Files:** Modify `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: MAIN_AGENT_PROMPT 加一句**

在 `MAIN_AGENT_PROMPT` 的【规则】或【写作阶段】段加:
```
- 若 get_novel_info 显示当前小说未设置作者画像(voiceProfile),可顺带提醒作者「左侧『画像』面板可以挑一个」;不强制,不影响写作。
```

- [ ] **Step 2: typecheck + lint + commit**
```bash
cd server && pnpm exec tsc --noEmit && pnpm run lint
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-prompts.ts && git commit -m "feat(agent): MAIN soft-nudge to pick a voice profile"
```

---

## Task 5: FE 类型 + API + 路由

**Files:** Modify `agent-ui/src/types/settings.ts`, `agent-ui/src/api/settings.ts`, `agent-ui/src/api/routes.ts`, `agent-ui/src/api/novels.ts`, `agent-ui/src/types/novel.ts`

- [ ] **Step 1: types/settings.ts**

把旧的 `VoiceProfile = string | null` 改成:
```ts
export interface VoiceProfile {
  id: string
  name: string
  profile: string
  createdAt: string
  updatedAt: string
}
export interface CreateVoiceProfileInput { name: string; profile: string }
export interface UpdateVoiceProfileInput { name?: string; profile?: string }
export interface GenerateVoiceProfileInput { samples: string[] }
```

- [ ] **Step 2: routes.ts**

把旧的 `SettingsVoice` / `SettingsVoiceGenerate` 改成:
```ts
  SettingsVoiceProfiles: (base: string) => `${base}/settings/voice-profiles`,
  SettingsVoiceProfile: (base: string, id: string) => `${base}/settings/voice-profiles/${id}`,
  SettingsVoiceProfileGenerate: (base: string) => `${base}/settings/voice-profiles/generate`,
  NovelVoiceProfile: (base: string, novelId: string) => `${base}/novels/${novelId}/voice-profile`,
```

- [ ] **Step 3: api/settings.ts**

替换旧的 getVoiceProfile/putVoiceProfile/generateVoiceProfile 为:
```ts
export const listVoiceProfiles = (base, token) => asJson<VoiceProfile[]>(fetch(APIRoutes.SettingsVoiceProfiles(base), { headers: headers(token) }))
export const createVoiceProfile = (base, token, input: CreateVoiceProfileInput) => asJson<VoiceProfile>(fetch(APIRoutes.SettingsVoiceProfiles(base), { method:'POST', headers:headers(token), body:JSON.stringify(input) }))
export const updateVoiceProfile = (base, token, id, input: UpdateVoiceProfileInput) => asJson<VoiceProfile>(fetch(APIRoutes.SettingsVoiceProfile(base,id), { method:'PATCH', headers:headers(token), body:JSON.stringify(input) }))
export const deleteVoiceProfile = (base, token, id) => asJson<{ok:true}>(fetch(APIRoutes.SettingsVoiceProfile(base,id), { method:'DELETE', headers:headers(token) }))
export const generateVoiceProfile = (base, token, input: GenerateVoiceProfileInput) => asJson<{profile:string}>(fetch(APIRoutes.SettingsVoiceProfileGenerate(base), { method:'POST', headers:headers(token), body:JSON.stringify(input) }))
```
(import 类型从 @/types/settings 更新。)

- [ ] **Step 4: api/novels.ts + types/novel.ts**

`api/novels.ts` 加:
```ts
export const setNovelVoiceProfile = (base: string, token: string, novelId: string, voiceProfileId: string | null) =>
  asJson<{ ok: true }>(fetch(APIRoutes.NovelVoiceProfile(base, novelId), { method: 'PUT', headers: headers(token), body: JSON.stringify({ voiceProfileId }) }))
```
`types/novel.ts` 的 `Novel` interface 加 `voiceProfileId?: string | null`。

- [ ] **Step 5: typecheck + lint + format + commit**
```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:fix
cd /Users/taowen/project/narratox && git add agent-ui/src && git commit -m "feat(agent-ui): VoiceProfile types + CRUD/switch api + routes"
```

---

## Task 6: FE /settings —— 画像库(列表 + 编辑/新建)

**Files:**
- Create: `agent-ui/src/components/settings/VoiceProfileList.tsx`
- Create: `agent-ui/src/components/settings/VoiceProfileEditor.tsx`(从旧 VoiceProfile.tsx 拆出三状态编辑器)
- Delete: `agent-ui/src/components/settings/VoiceProfile.tsx`(被上两个取代)
- Modify: `agent-ui/src/app/settings/page.tsx`(挂 VoiceProfileList)

- [ ] **Step 1: VoiceProfileEditor.tsx**

把旧 `VoiceProfile.tsx` 的三状态编辑逻辑(`loading/empty/ready`、generate、save)移到 `VoiceProfileEditor.tsx`,改为受控组件(props: `profile?: VoiceProfile`(编辑模式,有则预填); `onSaved()` 回调; `onCancel()`)。内部用 create/update API(有 profile.id → update;无 → create,需 name 输入框)。「重新生成」用 generate API 填 md。加 name 输入框(顶部)。保存后 onSaved。

- [ ] **Step 2: VoiceProfileList.tsx**

列表:`listVoiceProfiles` 加载 → 卡片(名称 + MarkdownRenderer 预览截断 + 「编辑」「删除」)。「新建画像」按钮 → 显示 `<VoiceProfileEditor onSaved={refresh} onCancel={...} />`。编辑 → `<VoiceProfileEditor profile={p} onSaved={refresh} />`。删除 → confirm + deleteVoiceProfile。

- [ ] **Step 3: settings page 挂 VoiceProfileList**

`app/settings/page.tsx`:`import VoiceProfileList from '@/components/settings/VoiceProfileList'`,把 `<VoiceProfile />` 换成 `<VoiceProfileList />`。删除旧 `VoiceProfile.tsx`。

- [ ] **Step 4: typecheck + lint + format + commit**
```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:fix
cd /Users/taowen/project/narratox && git add -A && git commit -m "feat(agent-ui): voice profile library (list + editor) in /settings"
```

---

## Task 7: FE 工作台 —— IconRail「画像」按钮 + 抽屉面板

**Files:**
- Modify: `agent-ui/src/components/workspace/IconRail.tsx`(加画像按钮)
- Create: `agent-ui/src/components/workspace/VoiceProfileDrawer.tsx`(抽屉:下拉切换 + 预览)
- Modify: `agent-ui/src/app/novels/[id]/page.tsx`(挂抽屉 + 状态)

- [ ] **Step 1: VoiceProfileDrawer.tsx**

props: `novelId`, `selectedId: string | null`, `onClose`。内部:`listVoiceProfiles` 加载;下拉(含「无(默认风格)」);切换 → `setNovelVoiceProfile(endpoint, token, novelId, id)` + toast;MarkdownRenderer 渲染选中画像;未选提示。UI:右侧/overlay 抽屉,深色 token。

- [ ] **Step 2: IconRail 加按钮**

`IconRail.tsx` 加一个画像 icon 按钮(`onClick` 调外部传入的 `onOpenVoiceProfile` 回调),镜像现有 icon 按钮样式。IconRail 加 prop `onOpenVoiceProfile?: () => void`。

- [ ] **Step 3: page.tsx 挂抽屉**

`app/novels/[id]/page.tsx`:加 `const [voiceDrawerOpen, setVoiceDrawerOpen] = useState(false)`;传 `onOpenVoiceProfile={() => setVoiceDrawerOpen(true)}` 给 IconRail;`voiceDrawerOpen` 时渲染 `<VoiceProfileDrawer novelId={id} selectedId={novel?.voiceProfileId ?? null} onClose={...} />`。novel 刷新后 voiceProfileId 更新。

- [ ] **Step 4: typecheck + lint + format + commit**
```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:fix
cd /Users/taowen/project/narratox && git add -A && git commit -m "feat(agent-ui): workspace voice profile drawer (view + switch)"
```

---

## Task 8: Final 验证

- [ ] **Step 1: server 全 gate**
```bash
cd server && pnpm exec tsc --noEmit && pnpm run lint && pnpm test
```
- [ ] **Step 2: agent-ui 全 gate**
```bash
cd agent-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format
```
- [ ] **Step 3: 手测**:/settings 建多个画像;工作台切换;写入注入正确;删画像后小说回落默认。
- [ ] **Step 4: 报告 + 合并准备**

---

## Self-Review

**Spec 覆盖**:§3.1 schema→T1;§3.2 API→T2;§3.3 注入→T3;§3.4 /settings 库→T6;§3.5 工作台抽屉→T7;§3.6 迁移→T1;§3.7 软引导→T4;§7 切片全覆盖 ✓。

**类型一致**:`VoiceProfile {id,name,profile,createdAt,updatedAt}` 前后端一致;`getForNovel(userId,novelId)` 服务/注入一致;`setVoiceProfile(userId,novelId,voiceProfileId|null)` 一致;FE `setNovelVoiceProfile(base,token,novelId,id|null)` 一致 ✓。

**注意**:Task 2 重写 service 时 `createAgent` 从 `'langchain'` import(非 'deepagents',同 deep-agent.service.ts)。Task 1 迁移 SQL 的 `gen_random_uuid()` 需 Postgres 13+(默认有);执行前确认。

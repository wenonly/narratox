# User Auth + Multi-tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real user accounts (register/login) with JWT auth on the NestJS server, scope every session/message to its owner, and turn agent-ui into a dedicated client with login/register pages.

**Architecture:** Server (NestJS) is the auth authority: `User` table + bcryptjs + `@nestjs/jwt`, a global `JwtAuthGuard` (only `/health`, `/auth/register`, `/auth/login` are `@Public`). `SessionsService` takes a `userId` on every method and filters all queries by it. agent-ui persists the JWT in `localStorage` (via the existing Zustand store) and sends it as the existing `Authorization: Bearer` header — the run send path and `os.ts` need ~no change; the manual token input is replaced by login. `/agents` + `/teams` endpoints are removed; agent-ui hardcodes the single `deep-agent`.

**Tech Stack:** NestJS 11, `@nestjs/jwt`, `bcryptjs`, Prisma 7 (PostgreSQL), class-validator; Next.js 15 App Router, Zustand, shadcn/ui, nuqs.

**Spec:** `docs/superpowers/specs/2026-06-16-user-auth-and-multi-tenancy-design.md`

**Branch:** `feat/user-auth-multi-tenancy` (already created; the spec is committed there).

**Conventions for this repo:**
- Server tests: `pnpm --dir server test` (Jest, ESM via `NODE_OPTIONS=--experimental-vm-modules`, ts-jest). Run a single file: `pnpm --dir server test -- auth.service.spec.ts`.
- Server build: `pnpm --dir server build`.
- agent-ui has **no test runner** — its gate is `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate` (lint + format + typecheck). Verify behavior manually.
- Postgres must be running for migration/boot steps: `docker compose up -d` from repo root.
- **Secrets:** `JWT_SECRET` only ever lives in gitignored `server/.env`. Never put a real value in tracked files.
- **Keep the repo green:** each task commit must compile + pass tests. Task 6 (service + controller) is one task precisely because the `SessionsService` signature change and its only caller must land together.

---

## File map

**Server (create):**
- `server/src/auth/auth.module.ts` — wires `JwtModule`, controller, service, guard (global via `APP_GUARD`).
- `server/src/auth/auth.controller.ts` — `/auth/register`, `/auth/login`, `/auth/me`.
- `server/src/auth/auth.service.ts` — register/login/issue; bcrypt + JWT.
- `server/src/auth/jwt-auth.guard.ts` — verifies Bearer, sets `req.user`, honors `@Public`.
- `server/src/auth/public.decorator.ts` — `@Public()` + `IS_PUBLIC_KEY`.
- `server/src/auth/current-user.decorator.ts` — `@CurrentUser()` param decorator + `RequestUser` type.
- `server/src/auth/dto/register.dto.ts`, `server/src/auth/dto/login.dto.ts` — class-validator DTOs.
- `server/src/auth/*.spec.ts` — unit tests for service, guard, controller.

**Server (modify):**
- `server/prisma/schema.prisma` — add `User`; add `userId` to `Session`.
- `server/src/app.module.ts` — import `AuthModule`.
- `server/src/main.ts` — global `ValidationPipe`.
- `server/src/agentos/sessions.service.ts` + `.spec.ts` — `userId` on every method.
- `server/src/agentos/agentos.controller.ts` + `.spec.ts` — `@CurrentUser` passthrough; remove `/agents`+`/teams`; `@Public()` on `/health`. *(Landed atomically with the service change in Task 6.)*
- `server/package.json`, `server/.env`, `server/.env.example`.

**agent-ui (create):**
- `agent-ui/src/api/auth.ts` — `loginAPI`, `registerAPI`, `meAPI`.
- `agent-ui/src/components/auth/RequireAuth.tsx` — client guard + `/auth/me` probe.
- `agent-ui/src/app/(auth)/login/page.tsx`, `agent-ui/src/app/(auth)/register/page.tsx`.
- `agent-ui/src/components/ui/input.tsx` — shadcn Input primitive.

**agent-ui (modify):**
- `agent-ui/src/store.ts` — persist `authToken`; add `user` + `setUser` + `logout`.
- `agent-ui/src/types/os.ts` — add `AuthUser` + `AuthResult`.
- `agent-ui/src/api/routes.ts` — add `Login`/`Register`/`Me` route builders.
- `agent-ui/src/app/page.tsx` — wrap `RequireAuth`; drop `NEXT_PUBLIC_OS_SECURITY_KEY` seeding + props.
- `agent-ui/src/hooks/useChatActions.ts` — stop fetching agents/teams; hardcode `agentId='deep-agent'`.
- `agent-ui/src/components/chat/Sidebar/Sidebar.tsx` — remove `AuthToken`/pickers; add user+logout; drop `hasEnvToken`/`envToken` props.

**agent-ui (delete):**
- `agent-ui/src/components/chat/Sidebar/AuthToken.tsx`.

---

## Task 1: Deps + Prisma schema + migration + env

**Files:**
- Modify: `server/package.json`
- Modify: `server/prisma/schema.prisma`
- Create (generated): `server/prisma/migrations/<timestamp>_add_user_auth/migration.sql`
- Modify: `server/.env`
- Modify: `server/.env.example`

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm --dir server add @nestjs/jwt bcryptjs class-validator class-transformer
pnpm --dir server add -D @types/bcryptjs
```

- [ ] **Step 2: Rewrite the Prisma schema**

Replace the entire contents of `server/prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  username     String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @default(now())
  sessions     Session[]
}

model Session {
  // Externally supplied identity: this id equals the UI session_id and the
  // LangGraph thread_id. Intentionally has NO default so a missing id fails
  // loudly rather than silently auto-generating a mismatched id.
  id        String    @id
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  agentId   String    @default("deep-agent")
  name      String
  createdAt DateTime  @default(now())
  // Bumped explicitly by SessionsService.appendTurn. Intentionally NOT
  // @updatedAt so it remains explicitly settable and testable.
  updatedAt DateTime  @default(now())
  messages  Message[]

  @@index([agentId])
  @@index([userId, updatedAt])
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  role      String
  content   String
  createdAt DateTime @default(now())
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```

- [ ] **Step 3: Ensure Postgres is up**

Run (from repo root): `docker compose up -d`
Expected: the compose service is healthy.

- [ ] **Step 4: Generate the migration SQL without applying it**

Run:
```bash
pnpm --dir server exec prisma migrate dev --name add_user_auth --create-only
```
Expected output mentions `✔ Generated Migration` and writes a file under `server/prisma/migrations/<timestamp>_add_user_auth/migration.sql`. Open it and confirm it contains `CREATE TABLE "User"`, `ALTER TABLE "Session" ADD COLUMN "userId"`, a foreign key, and `CREATE INDEX ... "Session_userId_updatedAt_idx"`.

- [ ] **Step 5: Apply fresh (resets the dev DB — acceptable; spec §4 documents this)**

Run:
```bash
pnpm --dir server exec prisma migrate reset --force
```
Expected: drops + recreates the schema, applies all migrations, regenerates `@prisma/client`. No seed step. Exits 0.

- [ ] **Step 6: Validate the schema + that the client type-checks**

Run:
```bash
pnpm --dir server exec prisma validate
pnpm --dir server build
```
Expected: `The schema at prisma/schema.prisma is valid 🚀`; build succeeds (the regenerated client now exports `User`).

- [ ] **Step 7: Add `JWT_SECRET` to env files**

In `server/.env` (gitignored), append one line (use any long random string — keep it only in this file):
```
JWT_SECRET=dev-change-me-some-long-random-string-0123456789abcdef
```

In `server/.env.example` (tracked), append:
```
JWT_SECRET=
```

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml server/prisma/schema.prisma server/prisma/migrations server/.env.example
git commit -m "feat(server): User model + Session.userId, JWT/bcrypt/class-validator deps

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: AuthService + DTOs (TDD)

**Files:**
- Create: `server/src/auth/dto/register.dto.ts`
- Create: `server/src/auth/dto/login.dto.ts`
- Create: `server/src/auth/auth.service.ts`
- Test: `server/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write the DTOs**

`server/src/auth/dto/register.dto.ts`:
```ts
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  username?: string;
}
```

`server/src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 2: Write the failing service test**

`server/src/auth/auth.service.spec.ts`:
```ts
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
  };

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('signed-token') } },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('register', () => {
    it('hashes the password, stores a real hash, lowercases email, issues a token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(
        async ({ data }: { data: { email: string; passwordHash: string; username: string | null } }) => ({
          id: 'u1', email: data.email, username: data.username,
        }),
      );

      const res = await service.register('A@B.com', 'password123', 'al');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
      const created = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
      expect(created.email).toBe('a@b.com');
      expect(created.passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', created.passwordHash)).toBe(true);
      expect(res).toEqual({ token: 'signed-token', user: { id: 'u1', email: 'a@b.com', username: 'al' } });
    });

    it('throws ConflictException when the email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(service.register('a@b.com', 'password123')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues a token when the password matches', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', username: 'al', passwordHash: hash });
      const res = await service.login('a@b.com', 'password123');
      expect(res).toEqual({ token: 'signed-token', user: { id: 'u1', email: 'a@b.com', username: 'al' } });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('a@b.com', 'password123')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', username: null, passwordHash: hash });
      await expect(service.login('a@b.com', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --dir server test -- auth.service.spec.ts`
Expected: FAIL — `Cannot find module './auth.service'`.

- [ ] **Step 4: Write the minimal implementation**

`server/src/auth/auth.service.ts`:
```ts
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const SALT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET env var is required');
    }
  }

  async register(
    email: string,
    password: string,
    username?: string,
  ): Promise<AuthResult> {
    const normalized = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) throw new ConflictException('email already registered');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: normalized, passwordHash, username: username ?? null },
    });
    return this.issue(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (!user) throw new UnauthorizedException('invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    return this.issue(user);
  }

  private async issue(user: {
    id: string;
    email: string;
    username: string | null;
  }): Promise<AuthResult> {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email, username: user.username } };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir server test -- auth.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/dto server/src/auth/auth.service.ts server/src/auth/auth.service.spec.ts
git commit -m "feat(server): AuthService (register/login) + DTOs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: JwtAuthGuard + @Public + @CurrentUser (TDD)

**Files:**
- Create: `server/src/auth/public.decorator.ts`
- Create: `server/src/auth/current-user.decorator.ts`
- Create: `server/src/auth/jwt-auth.guard.ts`
- Test: `server/src/auth/jwt-auth.guard.spec.ts`

- [ ] **Step 1: Write the decorators**

`server/src/auth/public.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Mark a handler/route as not requiring authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`server/src/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  id: string;
  email: string;
}

/** Extracts req.user (set by JwtAuthGuard) into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser =>
    ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 2: Write the failing guard test**

`server/src/auth/jwt-auth.guard.spec.ts`:
```ts
import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwt: { verifyAsync: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    jwt = { verifyAsync: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const module = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwt },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();
    guard = module.get(JwtAuthGuard);
  });

  const ctxWith = (authorization?: string): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authorization ? { authorization } : {},
        }),
      }),
    }) as unknown as ExecutionContext;

  it('passes and sets req.user for a valid Bearer token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', email: 'a@b.com' });
    const c = ctxWith('Bearer good-token');
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(c.switchToHttp().getRequest().user).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('throws 401 when there is no Authorization header', async () => {
    await expect(guard.canActivate(ctxWith())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the token fails to verify', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt malformed'));
    await expect(guard.canActivate(ctxWith('Bearer bad'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the scheme is not Bearer', async () => {
    await expect(guard.canActivate(ctxWith('Token xyz'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('skips auth for @Public handlers without touching JwtService', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctxWith())).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --dir server test -- jwt-auth.guard.spec.ts`
Expected: FAIL — `Cannot find module './jwt-auth.guard'`.

- [ ] **Step 4: Write the minimal implementation**

`server/src/auth/jwt-auth.guard.ts`:
```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { RequestUser } from './current-user.decorator';

function extractBearer(header?: string): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractBearer(request.headers?.authorization);
    if (!token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token);
      const user: RequestUser = { id: payload.sub, email: payload.email };
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir server test -- jwt-auth.guard.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/public.decorator.ts server/src/auth/current-user.decorator.ts server/src/auth/jwt-auth.guard.ts server/src/auth/jwt-auth.guard.spec.ts
git commit -m "feat(server): JwtAuthGuard + @Public + @CurrentUser

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: AuthController + AuthModule (TDD)

**Files:**
- Create: `server/src/auth/auth.controller.ts`
- Create: `server/src/auth/auth.controller.spec.ts`
- Create: `server/src/auth/auth.module.ts`

- [ ] **Step 1: Write the failing controller test**

`server/src/auth/auth.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { RequestUser } from './current-user.decorator';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    auth = {
      register: jest.fn().mockResolvedValue({
        token: 't',
        user: { id: 'u1', email: 'a@b.com', username: null },
      }),
      login: jest.fn().mockResolvedValue({
        token: 't',
        user: { id: 'u1', email: 'a@b.com', username: null },
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('register forwards email/password/username to AuthService', async () => {
    const res = await controller.register({ email: 'A@B.com', password: 'password123', username: 'al' });
    expect(auth.register).toHaveBeenCalledWith('A@B.com', 'password123', 'al');
    expect(res).toEqual({ token: 't', user: { id: 'u1', email: 'a@b.com', username: null } });
  });

  it('login forwards email/password to AuthService', async () => {
    await controller.login({ email: 'a@b.com', password: 'password123' });
    expect(auth.login).toHaveBeenCalledWith('a@b.com', 'password123');
  });

  it('me returns the request user unchanged', () => {
    const user: RequestUser = { id: 'u1', email: 'a@b.com' };
    expect(controller.me(user)).toEqual(user);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir server test -- auth.controller.spec.ts`
Expected: FAIL — `Cannot find module './auth.controller'`.

- [ ] **Step 3: Write the controller**

`server/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService, type AuthUser } from './auth.service';
import { CurrentUser, type RequestUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(
    @Body() dto: RegisterDto,
  ): Promise<{ token: string; user: AuthUser }> {
    return this.auth.register(dto.email, dto.password, dto.username);
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<{ token: string; user: AuthUser }> {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }
}
```

- [ ] **Step 4: Write the module**

`server/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir server test -- auth.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/auth.controller.ts server/src/auth/auth.controller.spec.ts server/src/auth/auth.module.ts
git commit -m "feat(server): AuthController (/auth/register|login|me) + AuthModule

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Wire AuthModule into AppModule + global ValidationPipe

**Files:**
- Modify: `server/src/app.module.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Import AuthModule**

Replace `server/src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AgentosModule } from './agentos/agentos.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, AgentModule, AgentosModule],
})
export class AppModule {}
```

(`AuthModule` registers the global `APP_GUARD`; importing it is enough for the guard to apply app-wide. `PrismaModule` is `@Global` so `AuthService` can inject it without importing it here.)

- [ ] **Step 2: Add a global ValidationPipe**

Replace `server/src/main.ts` with:

```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Strip/reject unknown fields on DTOs (RegisterDto/LoginDto). Inline-typed
  // bodies (e.g. the multipart run body) have an Object metatype and are
  // skipped by the pipe, so they are unaffected.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  // Enable shutdown hooks so SIGINT/SIGTERM trigger onModuleDestroy
  // (and therefore PrismaService.$disconnect()).
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 3: Build + run the server**

Run:
```bash
pnpm --dir server build
PORT=3001 pnpm --dir server start:prod
```
Expected: server boots without error (no `JWT_SECRET` error because `.env` has it). Leave it running for Task 7's smoke test (or restart it there).

- [ ] **Step 4: Commit**

```bash
git add server/src/app.module.ts server/src/main.ts
git commit -m "feat(server): wire AuthModule (global guard) + ValidationPipe

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Per-user scoping across SessionsService + AgentosController

> This is one task (not two) on purpose: changing every `SessionsService` method to require a `userId` breaks the type-check of its only caller (`AgentosController`). Both must land in the same commit to keep the repo green.

**Files:**
- Modify: `server/src/agentos/sessions.service.ts`
- Modify: `server/src/agentos/sessions.service.spec.ts`
- Modify: `server/src/agentos/agentos.controller.ts`
- Modify: `server/src/agentos/agentos.controller.spec.ts`

- [ ] **Step 1: Rewrite the service test to require a `userId` on every method**

Replace the entire contents of `server/src/agentos/sessions.service.spec.ts` with:

```ts
import { SessionsService } from './sessions.service';
import type { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return {
    session: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  } as unknown as PrismaService;
}

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

describe('SessionsService', () => {
  describe('resolveSession', () => {
    it('creates a new owned session (uuid + name) when no id given', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({
        id: 'new-id', userId: 'u1', agentId: 'deep-agent', name: 'short',
        createdAt: EPOCH, updatedAt: EPOCH,
      });
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('u1', undefined, 'deep-agent', 'short');

      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', agentId: 'deep-agent', name: 'short' }),
      });
      expect(result.id).toBe('new-id');
    });

    it('seeds name from the first message, truncated to 30 chars', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({ name: '' });
      const service = new SessionsService(prisma);

      await service.resolveSession('u1', undefined, 'deep-agent', 'x'.repeat(40));

      const data = (prisma.session.create as jest.Mock).mock.calls[0][0].data;
      expect(data.name).toBe('x'.repeat(30));
      expect(data.userId).toBe('u1');
    });

    it('reuses an existing session owned by the same user', async () => {
      const prisma = makePrismaMock();
      const existing = { id: 's1', userId: 'u1', name: 'old', createdAt: EPOCH, updatedAt: EPOCH };
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(existing);
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('u1', 's1', 'deep-agent', 'hi');

      expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a fresh own session when the id belongs to another user (no leak/reuse)', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({ id: 's1', userId: 'someone-else' });
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 'new', userId: 'u1' });
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('u1', 's1', 'deep-agent', 'hi');

      expect(prisma.session.create).toHaveBeenCalled();
      expect(result.id).toBe('new');
    });
  });

  describe('listSessions', () => {
    it('filters by userId + agentId, newest-first', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      await service.listSessions('u1', 'deep-agent');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', agentId: 'deep-agent' },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });

  describe('getRuns', () => {
    it('returns [] without reading messages when the session is not owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new SessionsService(prisma);

      const result = await service.getRuns('u1', 'sX');

      expect(prisma.session.findFirst).toHaveBeenCalledWith({ where: { id: 'sX', userId: 'u1' } });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('pairs consecutive user+assistant messages when owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue({ id: 's1', userId: 'u1' });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'user', content: 'q1', createdAt: EPOCH },
        { role: 'assistant', content: 'a1', createdAt: EPOCH },
        { role: 'user', content: 'q2', createdAt: EPOCH },
        { role: 'assistant', content: 'a2', createdAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      const result = await service.getRuns('u1', 's1');

      expect(result).toEqual([
        { userContent: 'q1', assistantContent: 'a1', createdAt: EPOCH },
        { userContent: 'q2', assistantContent: 'a2', createdAt: EPOCH },
      ]);
    });
  });

  describe('appendTurn', () => {
    it('is a no-op when the session is not owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new SessionsService(prisma);

      await service.appendTurn('u1', 'sX', 'hi', 'hello');

      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('writes user+assistant messages and bumps updatedAt when owned', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findFirst as jest.Mock).mockResolvedValue({ id: 's1', userId: 'u1' });
      const service = new SessionsService(prisma);

      await service.appendTurn('u1', 's1', 'hi', 'hello');

      expect(prisma.message.create).toHaveBeenCalledTimes(2);
      expect(prisma.message.create).toHaveBeenNthCalledWith(1, {
        data: { sessionId: 's1', role: 'user', content: 'hi' },
      });
      expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
        data: { sessionId: 's1', role: 'assistant', content: 'hello' },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { updatedAt: expect.any(Date) },
      });
    });
  });

  describe('deleteSession', () => {
    it('deletes only an owned session (deleteMany by id+userId)', async () => {
      const prisma = makePrismaMock();
      const service = new SessionsService(prisma);

      await service.deleteSession('u1', 's1');

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { id: 's1', userId: 'u1' },
      });
    });
  });
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `pnpm --dir server test -- sessions.service.spec.ts`
Expected: FAIL — current methods don't accept `userId`, and the mock lacks `findFirst`/`deleteMany`.

- [ ] **Step 3: Rewrite the service with `userId` scoping**

Replace the entire contents of `server/src/agentos/sessions.service.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Session } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_NAME = 30;

function seedName(hint: string): string {
  const trimmed = hint.trim();
  if (!trimmed) return 'New chat';
  return trimmed.length > MAX_NAME ? trimmed.slice(0, MAX_NAME) : trimmed;
}

/** 一轮对话（配对后的 user+assistant），用于 GET /sessions/:id/runs。 */
export interface RunPair {
  userContent: string;
  assistantContent: string;
  createdAt: Date;
}

/**
 * 纯 Prisma 的 UI 只读模型：sessions 列表/命名 + 逐字 transcript。
 * agent 记忆由 checkpointer 管理，不读本服务写入的 messages。
 * 所有方法都按 userId 隔离——用户永远读写不到别人的会话。
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解析会话（按 userId 隔离）：
   * - 无 id → 为该用户新建(uuid)；
   * - 有 id 且归属本用户 → 复用；
   * - 有 id 但属于他人（或不存在）→ 为该用户新建一个随机 uuid，
   *   不泄露、不复用别人的会话。
   */
  async resolveSession(
    userId: string,
    maybeId: string | undefined,
    agentId: string,
    firstNameHint: string,
  ): Promise<Session> {
    if (maybeId) {
      const existing = await this.prisma.session.findUnique({
        where: { id: maybeId },
      });
      if (existing && existing.userId === userId) return existing;
    }
    return this.prisma.session.create({
      data: {
        id: randomUUID(),
        userId,
        agentId,
        name: seedName(firstNameHint),
      },
    });
  }

  /** 列出某用户某 agent 的会话，按 updated_at 倒序。 */
  async listSessions(userId: string, agentId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, agentId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 把逐字消息配对成 runs（user 在前、紧跟其 assistant），oldest-first。 */
  async getRuns(userId: string, sessionId: string): Promise<RunPair[]> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return [];
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const runs: RunPair[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
        runs.push({
          userContent: messages[i].content,
          assistantContent: messages[i + 1].content,
          createdAt: messages[i].createdAt,
        });
        i++; // consume the assistant message too
      }
    }
    return runs;
  }

  /** 流结束后落库一轮的逐字 user+assistant，并刷新 updatedAt（仅限本用户会话）。 */
  async appendTurn(
    userId: string,
    sessionId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return; // 不属于本用户 → no-op，绝不改别人的会话
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content: userContent },
    });
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: assistantContent },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  /** 删除会话行（仅限本用户；messages 随 onDelete:Cascade 一并删除）。 */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    });
  }
}
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `pnpm --dir server test -- sessions.service.spec.ts`
Expected: PASS (all). *(The controller still won't compile yet — that's fixed in steps 5–7 below, before the commit.)*

- [ ] **Step 5: Rewrite the controller test for the new signatures**

Replace the entire contents of `server/src/agentos/agentos.controller.spec.ts` with:

```ts
import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { DeepAgentService } from './deep-agent.service';
import type { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';
import type { RequestUser } from '../auth/current-user.decorator';
import { AGENT_ID } from './agentos.constants';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

function createFakeRes(): { res: Response; chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    setHeader: () => {},
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
    end: () => {},
  } as unknown as Response;
  return { res, chunks };
}

function makeSessionsMock(
  overrides: Partial<{
    resolveSession: jest.Mock;
    appendTurn: jest.Mock;
    listSessions: jest.Mock;
    getRuns: jest.Mock;
    deleteSession: jest.Mock;
  }> = {},
) {
  return {
    resolveSession:
      overrides.resolveSession ??
      jest.fn(async () => ({ id: 'sess-1', userId: 'u1', name: 'n', createdAt: EPOCH, updatedAt: EPOCH })),
    appendTurn: overrides.appendTurn ?? jest.fn(async () => undefined),
    listSessions: overrides.listSessions ?? jest.fn(async () => []),
    getRuns: overrides.getRuns ?? jest.fn(async () => []),
    deleteSession: overrides.deleteSession ?? jest.fn(async () => undefined),
  } as unknown as SessionsService;
}

function buildController(
  deltas: (m: string) => AsyncIterable<string>,
  sessions: SessionsService = makeSessionsMock(),
): AgentosController {
  const fakeService = {
    streamTurn: ({ userMessage }: { threadId: string; userMessage: string }) =>
      deltas(userMessage),
  } as unknown as DeepAgentService;
  return new AgentosController(fakeService, new StreamAdapter(), sessions);
}

function parseFrames(chunks: string[]): AgentosFrame[] {
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => JSON.parse(c)) as AgentosFrame[];
}

describe('AgentosController', () => {
  it('GET /health returns empty object', () => {
    const controller = buildController(async function* () {});
    expect(controller.health()).toEqual({});
  });

  it('does NOT expose /agents or /teams endpoints', () => {
    const controller = buildController(async function* () {}) as unknown as {
      agents?: unknown;
      teams?: unknown;
    };
    expect(controller.agents).toBeUndefined();
    expect(controller.teams).toBeUndefined();
  });

  it('POST runs scopes resolve/append by user, streams frames, persists the turn', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      yield 'He';
      yield 'llo';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith('u1', 'sess-1', AGENT_ID, 'hi');
    const frames = parseFrames(chunks);
    expect(frames.map((f) => f.event)).toEqual(['RunStarted', 'RunContent', 'RunContent', 'RunCompleted']);
    expect(frames[0].session_id).toBe('sess-1');
    expect(frames.at(-1)?.content).toBe('Hello');
    expect(sessions.appendTurn).toHaveBeenCalledWith('u1', 'sess-1', 'hi', 'Hello');
  });

  it('POST runs creates a session when session_id is absent', async () => {
    const sessions = makeSessionsMock({
      resolveSession: jest.fn(async () => ({ id: 'fresh', userId: 'u1', name: 'hi', createdAt: EPOCH, updatedAt: EPOCH })),
    });
    const controller = buildController(async function* () {
      yield 'ok';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith('u1', undefined, AGENT_ID, 'hi');
    expect(parseFrames(chunks)[0].session_id).toBe('fresh');
  });

  it('POST runs emits RunError and does NOT persist when the service throws', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      throw new Error('boom');
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    const last = parseFrames(chunks).at(-1);
    expect(last?.event).toBe('RunError');
    expect(last?.content).toBe('boom');
    expect(sessions.appendTurn).not.toHaveBeenCalled();
  });

  it('GET /sessions maps rows to the UI shape and scopes by user', async () => {
    const sessions = makeSessionsMock({
      listSessions: jest.fn(async () => [
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.listSessions(USER);

    expect(sessions.listSessions).toHaveBeenCalledWith('u1', AGENT_ID);
    expect(result).toEqual({
      data: [{ session_id: 's1', session_name: 'First', created_at: 1767225600, updated_at: 1767225600 }],
    });
  });

  it('GET /sessions/:id/runs maps run pairs and scopes by user', async () => {
    const sessions = makeSessionsMock({
      getRuns: jest.fn(async () => [
        { userContent: 'hi', assistantContent: 'hello', createdAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.getSessionRuns(USER, 's1');

    expect(sessions.getRuns).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual([{ run_input: 'hi', content: 'hello', created_at: 1767225600 }]);
  });

  it('DELETE /sessions/:id removes the session and returns {ok:true}, scoped by user', async () => {
    const sessions = makeSessionsMock({
      deleteSession: jest.fn(async () => undefined),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.deleteSession(USER, 's1');

    expect(sessions.deleteSession).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 6: Run the controller test to verify it fails**

Run: `pnpm --dir server test -- agentos.controller.spec.ts`
Expected: FAIL — the controller methods don't accept `RequestUser`, and `agents()`/`teams()` still exist.

- [ ] **Step 7: Rewrite the controller**

Replace the entire contents of `server/src/agentos/agentos.controller.ts` with:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AGENT_ID } from './agentos.constants';
import { DeepAgentService } from './deep-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';
import { Public } from '../auth/public.decorator';
import {
  CurrentUser,
  type RequestUser,
} from '../auth/current-user.decorator';

const now = (): number => Math.floor(Date.now() / 1000);
const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);

@Controller()
export class AgentosController {
  constructor(
    private readonly deepAgent: DeepAgentService,
    private readonly adapter: StreamAdapter,
    private readonly sessions: SessionsService,
  ) {}

  /** UI 心跳门：status 200 即标记 endpoint 激活。公开。 */
  @Public()
  @Get('health')
  health(): Record<string, never> {
    return {};
  }

  /** 列出当前用户的会话（UI Sessions 侧边栏）。created_at/updated_at 为 unix 秒。 */
  @Get('sessions')
  async listSessions(
    @CurrentUser() user: RequestUser,
  ): Promise<{
    data: Array<{
      session_id: string;
      session_name: string;
      created_at: number;
      updated_at: number;
    }>;
  }> {
    const rows = await this.sessions.listSessions(user.id, AGENT_ID);
    return {
      data: rows.map((s) => ({
        session_id: s.id,
        session_name: s.name,
        created_at: toUnix(s.createdAt),
        updated_at: toUnix(s.updatedAt),
      })),
    };
  }

  /** 某会话的历史 run（UI 点击侧边栏恢复时拉取）。返回裸数组。 */
  @Get('sessions/:id/runs')
  async getSessionRuns(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<Array<{ run_input: string; content: string; created_at: number }>> {
    const runs = await this.sessions.getRuns(user.id, id);
    return runs.map((r) => ({
      run_input: r.userContent,
      content: r.assistantContent,
      created_at: toUnix(r.createdAt),
    }));
  }

  /** 删除会话（UI SessionItem 的删除按钮）。 */
  @Delete('sessions/:id')
  async deleteSession(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.sessions.deleteSession(user.id, id);
    return { ok: true };
  }

  /**
   * 核心流式入口：multipart FormData -> 逐帧 JSON 推流。
   * 尊重入参 session_id（空→新建），用解析后的 id 作 thread_id；
   * 流成功结束后把这一轮逐字写入 messages 表供 UI 渲染。
   */
  @Post('agents/:id/runs')
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // phase 1 单 agent：路由的 :id 为兼容 AgentOS 而保留，实际固定用 AGENT_ID。
    @CurrentUser() user: RequestUser,
    @Param('id') _id: string,
    @Body() body: { message?: string; session_id?: string; stream?: string },
    @Res() res: Response,
  ): Promise<void> {
    const message = body?.message ?? '';
    res.setHeader('Content-Type', 'application/json');

    let sessionId = body?.session_id ?? '';
    let fullReply = '';
    let completed = false;

    try {
      const session = await this.sessions.resolveSession(
        user.id,
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;

      for await (const frame of this.adapter.toFrames(
        AGENT_ID,
        sessionId,
        this.deepAgent.streamTurn({ threadId: sessionId, userMessage: message }),
      )) {
        if (frame.event === 'RunContent' || frame.event === 'RunCompleted') {
          fullReply = frame.content ?? fullReply;
        }
        if (frame.event === 'RunCompleted') completed = true;
        res.write(JSON.stringify(frame) + '\n');
      }
    } catch (err) {
      const errorFrame: AgentosFrame = {
        event: 'RunError',
        content: err instanceof Error ? err.message : String(err),
        created_at: now(),
      };
      res.write(JSON.stringify(errorFrame) + '\n');
    } finally {
      res.end();
      // 流成功且确有用户消息才落库；DB 写失败不回滚已推送的流（best-effort）。
      if (completed && message) {
        try {
          await this.sessions.appendTurn(user.id, sessionId, message, fullReply);
        } catch (err) {
          console.error(
            `[agentos] appendTurn failed for session ${sessionId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }
}
```

- [ ] **Step 8: Run the FULL server test suite (the repo must be green now)**

Run: `pnpm --dir server test && pnpm --dir server build`
Expected: ALL tests pass (auth + sessions + controller + stream-adapter) and the build compiles.

- [ ] **Step 9: Commit**

```bash
git add server/src/agentos/sessions.service.ts server/src/agentos/sessions.service.spec.ts server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(server): per-user scoping in SessionsService + AgentosController

SessionsService methods take userId; AgentosController passes req.user.id
via @CurrentUser, marks /health @Public, drops /agents + /teams.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Server end-to-end smoke (manual)

**Files:** none (verification only).

- [ ] **Step 1: Start the server**

Run:
```bash
docker compose up -d
PORT=3001 pnpm --dir server start:prod
```
Expected: boots cleanly (no `JWT_SECRET` error). Leave it running.

- [ ] **Step 2: Register**

Run:
```bash
curl -s -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"password123","username":"alice"}'
```
Expected: JSON `{"token":"...","user":{"id":"...","email":"alice@example.com","username":"alice"}}`.

- [ ] **Step 3: Login (capture token)**

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"password123"}' | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).token))")
echo "$TOKEN"
```
Expected: prints a non-empty JWT (three dot-separated base64 segments).

- [ ] **Step 4: /auth/me with token**

Run: `curl -s http://localhost:3001/auth/me -H "Authorization: Bearer $TOKEN"`
Expected: `{"id":"...","email":"alice@example.com","username":"alice"}`.

- [ ] **Step 5: Public health + removed endpoints**

Run:
```bash
curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:3001/health
curl -s -o /dev/null -w "agents:%{http_code}\n" http://localhost:3001/agents
curl -s -o /dev/null -w "teams:%{http_code}\n"  http://localhost:3001/teams
```
Expected: `health:200`, `agents:404`, `teams:404`.

- [ ] **Step 6: Guarded routes without/with token**

Run:
```bash
curl -s -o /dev/null -w "sessions-no-auth:%{http_code}\n" http://localhost:3001/sessions
curl -s http://localhost:3001/sessions -H "Authorization: Bearer $TOKEN"
```
Expected: `sessions-no-auth:401`, then `{"data":[]}`.

- [ ] **Step 7: (Optional) end-to-end chat isolation**

Register a second user (`bob@example.com`), then for alice send a turn and confirm bob's `/sessions` stays empty:
```bash
curl -s -X POST http://localhost:3001/agents/deep-agent/runs \
  -H "Authorization: Bearer $TOKEN" \
  -F 'message=introduce yourself in one sentence' -F 'session_id='
```
Expected: streamed `RunStarted`/`RunContent`/`RunCompleted` frames. Then `GET /sessions` (alice) shows one session; `GET /sessions` (bob's token) shows `{"data":[]}`.

- [ ] **Step 8: No commit (verification only)**

If anything fails, fix it before proceeding to the agent-ui tasks. The server is the foundation for the UI.

---

## Task 8: agent-ui store + types + routes (data layer)

**Files:**
- Modify: `agent-ui/src/store.ts`
- Modify: `agent-ui/src/types/os.ts`
- Modify: `agent-ui/src/api/routes.ts`

- [ ] **Step 1: Add `AuthUser`/`AuthResult` types**

In `agent-ui/src/types/os.ts`, append:

```ts
export interface AuthUser {
  id: string
  email: string
  username?: string | null
}

export interface AuthResult {
  token: string
  user: AuthUser
}
```

- [ ] **Step 2: Add auth route builders**

In `agent-ui/src/api/routes.ts`, add three keys to the `APIRoutes` object (alongside the existing `Status`, `GetSessions`, etc.):

```ts
  Login: (agentOSUrl: string) => `${agentOSUrl}/auth/login`,
  Register: (agentOSUrl: string) => `${agentOSUrl}/auth/register`,
  Me: (agentOSUrl: string) => `${agentOSUrl}/auth/me`,
```

- [ ] **Step 3: Add `user` + `logout` to the store and persist `authToken`**

In `agent-ui/src/store.ts`:

1. Update the import from `@/types/os` (line ~4) to also bring in `AuthUser`:
```ts
import {
  AgentDetails,
  AuthUser,
  SessionEntry,
  TeamDetails,
  type ChatMessage
} from '@/types/os'
```

2. Inside the `Store` interface, immediately after the `authToken: string` / `setAuthToken` lines, add:
```ts
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  logout: () => void
```

3. Inside the `create` initializer, immediately after `setAuthToken: (authToken) => set(() => ({ authToken })),` add:
```ts
      user: null,
      setUser: (user) => set(() => ({ user })),
      logout: () => set(() => ({ authToken: '', user: null })),
```

4. In the `partialize` (the `persist` options), persist `authToken` and `user` so refresh keeps the session. Replace the existing `partialize` body:
```ts
      partialize: (state) => ({
        selectedEndpoint: state.selectedEndpoint,
        authToken: state.authToken,
        user: state.user
      }),
```

(`selectedEndpoint` already defaults to `'http://localhost:3001'` — leave that default as-is; it is now the fixed server address.)

- [ ] **Step 4: Validate**

Run: `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate`
Expected: lint + format + typecheck all pass.

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/store.ts agent-ui/src/types/os.ts agent-ui/src/api/routes.ts
git commit -m "feat(agent-ui): persist authToken, add user/logout + auth types/routes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: agent-ui auth API client + Input primitive

**Files:**
- Create: `agent-ui/src/api/auth.ts`
- Create: `agent-ui/src/components/ui/input.tsx`

- [ ] **Step 1: Create the Input primitive (shadcn)**

Run:
```bash
pnpm --dir agent-ui dlx shadcn@latest add input
```
If the interactive prompt asks anything, accept the defaults. This creates `agent-ui/src/components/ui/input.tsx` matching the existing `button.tsx` styling.

If the CLI is unavailable, create `agent-ui/src/components/ui/input.tsx` manually with exactly:

```tsx
import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
```

- [ ] **Step 2: Create the auth API client**

`agent-ui/src/api/auth.ts`:
```ts
import { APIRoutes } from './routes'
import type { AuthResult, AuthUser } from '@/types/os'

export const loginAPI = async (
  base: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  const res = await fetch(APIRoutes.Login(base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!res.ok) {
    throw new Error(res.status === 401 ? '邮箱或密码错误' : `登录失败 (${res.status})`)
  }
  return res.json()
}

export const registerAPI = async (
  base: string,
  email: string,
  password: string,
  username?: string
): Promise<AuthResult> => {
  const res = await fetch(APIRoutes.Register(base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, username })
  })
  if (!res.ok) {
    throw new Error(res.status === 409 ? '该邮箱已注册' : `注册失败 (${res.status})`)
  }
  return res.json()
}

export const meAPI = async (base: string, token: string): Promise<AuthUser> => {
  const res = await fetch(APIRoutes.Me(base), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`unauthorized (${res.status})`)
  return res.json()
}
```

- [ ] **Step 3: Validate**

Run: `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate`
Expected: passes (the new `Input` import resolves).

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/api/auth.ts agent-ui/src/components/ui/input.tsx
git commit -m "feat(agent-ui): auth API client (login/register/me) + Input primitive

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: agent-ui RequireAuth guard

**Files:**
- Create: `agent-ui/src/components/auth/RequireAuth.tsx`

- [ ] **Step 1: Create the guard**

`agent-ui/src/components/auth/RequireAuth.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useStore } from '@/store'
import { meAPI } from '@/api/auth'

/**
 * 客户端鉴权守卫：token 在 localStorage（zustand persist），Next.js
 * middleware 读不到 localStorage，故用客户端守卫。等 store rehydrate 后：
 * - 无 token → 跳 /login；
 * - 有 token → GET /auth/me 校验，401 则登出并跳 /login。
 */
export default function RequireAuth({
  children
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const hydrated = useStore((s) => s.hydrated)
  const authToken = useStore((s) => s.authToken)
  const endpoint = useStore((s) => s.selectedEndpoint)
  const logout = useStore((s) => s.logout)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!hydrated) return
    if (!authToken) {
      router.replace('/login')
      return
    }
    meAPI(endpoint, authToken)
      .then(() => setChecked(true))
      .catch(() => {
        logout()
        router.replace('/login')
      })
  }, [hydrated, authToken, endpoint, router, logout])

  if (!hydrated || !authToken || !checked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background/80 text-sm text-muted">
        Loading…
      </div>
    )
  }
  return <>{children}</>
}
```

- [ ] **Step 2: Validate**

Run: `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/auth/RequireAuth.tsx
git commit -m "feat(agent-ui): RequireAuth guard with /auth/me probe

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: agent-ui login + register pages

**Files:**
- Create: `agent-ui/src/app/(auth)/login/page.tsx`
- Create: `agent-ui/src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Create the login page**

`agent-ui/src/app/(auth)/login/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useStore } from '@/store'
import { loginAPI } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const setAuthToken = useStore((s) => s.setAuthToken)
  const setUser = useStore((s) => s.setUser)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { token, user } = await loginAPI(endpoint, email, password)
      setAuthToken(token)
      setUser(user)
      router.replace('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background/80">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-primary/15 bg-background p-6"
      >
        <h1 className="text-lg font-semibold">登录</h1>
        <Input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </Button>
        <p className="text-center text-xs text-muted">
          没有账号？
          <Link href="/register" className="underline">
            注册
          </Link>
        </p>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create the register page**

`agent-ui/src/app/(auth)/register/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useStore } from '@/store'
import { registerAPI } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function RegisterPage() {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const setAuthToken = useStore((s) => s.setAuthToken)
  const setUser = useStore((s) => s.setUser)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { token, user } = await registerAPI(
        endpoint,
        email,
        password,
        username || undefined
      )
      setAuthToken(token)
      setUser(user)
      router.replace('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background/80">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-primary/15 bg-background p-6"
      >
        <h1 className="text-lg font-semibold">注册</h1>
        <Input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="text"
          placeholder="用户名（可选）"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          type="password"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '注册中…' : '注册'}
        </Button>
        <p className="text-center text-xs text-muted">
          已有账号？
          <Link href="/login" className="underline">
            登录
          </Link>
        </p>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Validate**

Run: `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate`
Expected: passes. (These routes are not yet wired into navigation — that happens in Task 12.)

- [ ] **Step 4: Commit**

```bash
git add 'agent-ui/src/app/(auth)'
git commit -m "feat(agent-ui): /login + /register pages

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: agent-ui switch-over — wire guard, simplify init, clean sidebar, delete AuthToken

**Files:**
- Modify: `agent-ui/src/app/page.tsx`
- Modify: `agent-ui/src/hooks/useChatActions.ts`
- Modify: `agent-ui/src/components/chat/Sidebar/Sidebar.tsx`
- Delete: `agent-ui/src/components/chat/Sidebar/AuthToken.tsx`

- [ ] **Step 0: Read the two files you're about to edit**

Before editing, Read `agent-ui/src/hooks/useChatActions.ts` and `agent-ui/src/components/chat/Sidebar/Sidebar.tsx` in full. The edits below name exact anchors; resolve any `pnpm validate` errors that remain after applying them (unused destructures, dangling references) by trimming those specific lines.

- [ ] **Step 1: Wrap the dashboard with `RequireAuth` and drop the env-token seeding**

Replace the entire contents of `agent-ui/src/app/page.tsx` with:

```tsx
'use client'
import Sidebar from '@/components/chat/Sidebar/Sidebar'
import { ChatArea } from '@/components/chat/ChatArea'
import RequireAuth from '@/components/auth/RequireAuth'
import { Suspense } from 'react'

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequireAuth>
        <div className="flex h-screen bg-background/80">
          <Sidebar />
          <ChatArea />
        </div>
      </RequireAuth>
    </Suspense>
  )
}
```

- [ ] **Step 2: Simplify `useChatActions.initialize()` — drop agent/team discovery, hardcode `agentId`**

In `agent-ui/src/hooks/useChatActions.ts`:

1. On the `import { getAgentsAPI, getStatusAPI, getTeamsAPI } from '@/api/os'` line, drop `getAgentsAPI` and `getTeamsAPI`, keeping only `getStatusAPI`.
2. Delete the `getAgents` and `getTeams` `useCallback` wrappers entirely.
3. Replace the entire `initialize` `useCallback` (and its dependency array) with:

```ts
  const initialize = useCallback(async () => {
    setIsEndpointLoading(true)
    try {
      const status = await getStatus()
      if (status === 200) {
        setIsEndpointActive(true)
        setMode('agent')
        if (!agentId) setAgentId('deep-agent')
      } else {
        setIsEndpointActive(false)
        setMode('agent')
        setSelectedModel('')
        setAgentId(null)
      }
    } catch (error) {
      console.error('Error initializing :', error)
      setIsEndpointActive(false)
    } finally {
      setIsEndpointLoading(false)
    }
  }, [getStatus, setIsEndpointActive, setIsEndpointLoading, setMode, setSelectedModel, setAgentId, agentId])
```

4. Replace the `return` object with (drop `getAgents`/`getTeams`):

```ts
  return {
    clearChat,
    addMessage,
    focusChatInput,
    initialize
  }
```

5. Trim dead destructures/imports the edits above orphaned. Specifically, remove from this file any of these that are no longer referenced anywhere in it after the edits: `setTeams`, `setDbId`, `setTeamId`, `setAgents`, the `AgentDetails` and `TeamDetails` type imports. (`setMode`, `setSelectedModel`, `setAgentId`, `getStatus`, `setIsEndpointActive`, `setIsEndpointLoading`, `agentId`, `selectedEndpoint`, `authToken` are still used — keep them.)

- [ ] **Step 3: Clean the Sidebar — remove `AuthToken`, pickers, and env-token props; add user + logout**

In `agent-ui/src/components/chat/Sidebar/Sidebar.tsx`:

1. Remove these three imports:
   - `import { ModeSelector } from '@/components/chat/Sidebar/ModeSelector'`
   - `import { EntitySelector } from '@/components/chat/Sidebar/EntitySelector'`
   - `import AuthToken from './AuthToken'`
2. Add one import: `import { useRouter } from 'next/navigation'`. (The existing `Button`, `useStore`, `truncateText`, `toast` imports are already present — reuse them.)
3. Change the component signature to drop the `hasEnvToken`/`envToken` props:
```tsx
const Sidebar = () => {
```
4. Inside the component, next to the other `useStore` destructures, add:
```tsx
  const router = useRouter()
  const user = useStore((state) => state.user)
  const logout = useStore((state) => state.logout)

  const handleLogout = () => {
    logout()
    router.replace('/login')
  }
```
5. In the JSX, replace the `<AuthToken hasEnvToken={hasEnvToken} envToken={envToken} />` line with:
```tsx
          {user && (
            <div className="flex items-center justify-between rounded-xl border border-primary/15 bg-accent p-3 text-xs">
              <span className="truncate font-medium text-muted">
                {truncateText(user.username || user.email, 24)}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                登出
              </Button>
            </div>
          )}
```
6. Remove the `<ModeSelector />` and `<EntitySelector />` render lines from the `isEndpointActive` block, and remove the now-dead `ModelDisplay` conditional that depended on discovery (`{selectedModel && (agentId || teamId) && (<ModelDisplay model={selectedModel} />)}`). If `ModelDisplay`/`mode`/`teamId`/`selectedModel` destructures become unused after this, remove them too.

> The `Endpoint` editor is intentionally LEFT in place for now (it renders the fixed `selectedEndpoint`); any manual change to it self-protects via 401→logout. Fully removing it is deferred. Keep `isEndpointActive`/`getStatus`/`initialize` as-is.

- [ ] **Step 4: Delete the manual token component**

Run:
```bash
git rm agent-ui/src/components/chat/Sidebar/AuthToken.tsx
```

- [ ] **Step 5: Validate**

Run: `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate`
Expected: lint + format + typecheck pass with no unused-variable or missing-import errors. Fix anything `validate` reports (unused destructures, leftover references to `setTeams`/`ModelDisplay`, etc.).

- [ ] **Step 6: Commit**

```bash
git add -A agent-ui
git commit -m "feat(agent-ui): wire RequireAuth, drop agent/team discovery, remove manual token UI

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Final verification (both apps)

- [ ] **1. Server tests green**

Run: `pnpm --dir server test`
Expected: all pass.

- [ ] **2. Server boots**

Run (server already running from Task 7, or restart): `PORT=3001 pnpm --dir server start:prod`
Expected: clean boot.

- [ ] **3. agent-ui gate green**

Run: `pnpm --dir agent-ui format:fix && pnpm --dir agent-ui validate`
Expected: passes.

- [ ] **4. Manual end-to-end in the browser**

Start both (`pnpm dev` from repo root → agent-ui :3000, server :3001). Then:
1. Open `http://localhost:3000` → redirected to `/login`.
2. Click "注册", create `carol@example.com` / password → lands on the chat dashboard.
3. Reload the page → still logged in (token persisted), no redirect.
4. Send a message → streams a reply; the session appears in the Sessions sidebar.
5. Send a second message in the same session → the agent remembers the previous turn (checkpointer thread continuity).
6. Click the session in the sidebar → history loads.
7. Click "登出" → returns to `/login`; `GET /sessions` now 401s until you log back in.
8. Register a second user, confirm they see **only their own** sessions (isolation).

- [ ] **5. Merge readiness**

Run: `git log --oneline main..HEAD` (review the task commits), then optionally finish via the `superpowers:finishing-a-development-branch` skill.

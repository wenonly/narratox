# syntax=docker/dockerfile:1
# narratox server(NestJS 11 + Prisma 7 + langgraph/deepagents)
# 构建上下文必须是仓库根(docker build -f server/Dockerfile .)—— 因为要 COPY 平级的 知识库/ 进镜像。
# 不用 alpine:Prisma 7 查询引擎 + langgraph 在 musl 上偶发坑;bookworm-slim 自带 libssl3。

FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# 与 agent-ui/.github/workflows/validate.yml 的 pnpm 版本对齐,保证 lockfile 解析一致。
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

# ---- deps:装依赖 + prisma generate(锁文件不变即命中缓存)----
FROM base AS deps
COPY server/package.json server/pnpm-lock.yaml ./
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
RUN pnpm install --frozen-lockfile
# prisma.config.ts 的 datasource.url = env('DATABASE_URL') 在 config 加载时急切求值,
# 即便 generate 不连库也得有这个变量。给个占位 URL;runner 阶段 FROM base(不继承本阶段 ENV),
# 占位不会进运行时镜像 —— 真实 DATABASE_URL 由 compose 在运行时注入。
ENV DATABASE_URL=postgresql://build-placeholder
RUN pnpm exec prisma generate

# ---- builder:nest build + postbuild(postbuild 把 src/agentos/prompts/*.md cp 进 dist/)----
FROM deps AS builder
COPY server/tsconfig.json server/tsconfig.build.json server/nest-cli.json ./
COPY server/src ./src
# pnpm build 触发 postbuild 生命周期钩子(nest build && cp -R src/agentos/prompts dist/agentos/)。
# 不能绕过 pnpm 直接调 nest build —— 会漏掉 prompts 的 cp,运行时启动会抛
# "[agent-prompts] 找不到 prompts/*.md"。
RUN pnpm build

# ---- runner:运行时 ----
# 保留完整 node_modules:prisma CLI 是 devDep,migrate deploy 要用它。
# 未来可用 `pnpm deploy` 或多阶段 --prod + 独立 migrate 容器瘦身,本期不做。
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./
# 知识库语料:KnowledgeService 运行时扫 KB_DIR/<分类>/*.md,必须 bake 进镜像。
COPY 知识库 ./知识库
ENV KB_DIR=/app/知识库
EXPOSE 3001
# 入口:先 migrate deploy(幂等),再启动。
# 直接调 node_modules/.bin/prisma —— runner 阶段没装 package.json(pnpm exec 需要包上下文,
# 会报 ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE),二进制直调无此依赖。
# checkpointer 的 agent_memory schema 由 Nest boot 时 saver.setup() 自建(同样幂等)。
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main"]

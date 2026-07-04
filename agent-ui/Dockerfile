# syntax=docker/dockerfile:1
# narratox agent-ui(Next.js 15 App Router,纯前端)
# 构建上下文必须是仓库根(docker build -f agent-ui/Dockerfile .)。
# 依赖 next.config.ts 的 output:'standalone' —— 产出 .next/standalone/server.js + 最小 node_modules。

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

# ---- deps:装依赖(锁文件不变即命中缓存)----
FROM base AS deps
COPY agent-ui/package.json agent-ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder:next build(standalone)----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY agent-ui/ ./
# NEXT_PUBLIC_* 是构建期 inline:bake 进前端 bundle 作为 selectedEndpoint 的默认值。
# compose 默认 http://localhost(同源走 Caddy);Vercel/prod 设真实域名。
ARG NEXT_PUBLIC_DEFAULT_ENDPOINT=http://localhost:3001
ENV NEXT_PUBLIC_DEFAULT_ENDPOINT=$NEXT_PUBLIC_DEFAULT_ENDPOINT
RUN pnpm build

# ---- runner:仅 standalone 产物 + static + public ----
FROM base AS runner
ENV NODE_ENV=production PORT=3000
WORKDIR /app
# standalone 不含 .next/static 和 public,必须单独 COPY。
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
# Next standalone server.js 读 PORT env,默认 3000。
CMD ["node", "server.js"]

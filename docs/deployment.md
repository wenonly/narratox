# narratox 部署指南

一套 Docker Compose 全家桶:Postgres + server + agent-ui + Caddy 反代,**单端口入口**,一条命令拉起。

## 两条部署路(选一条)

| 路径 | 适用 | compose | server/ui 镜像怎么来 | 文档 |
|---|---|---|---|---|
| **A. 本机/自托管 build** | 部署机器有源码、能 `docker build`(VPS / 本机) | 根 [`docker-compose.yml`](../docker-compose.yml) | `build:` 块现场构建 | **本文档** |
| **B. NAS load**(离线/弱机) | NAS 等无源码、不想 build 的机器 | [`dist/docker-compose.yml`](../dist/docker-compose.yml) | 本机 build 好 → `docker save` 成 tar → NAS `docker load` | [docs/nas-deploy.md](./nas-deploy.md) |

两条路共享同一套 Dockerfile(server/Dockerfile + agent-ui/Dockerfile)、同一个 Caddyfile、同一套 env 变量(只差 NAS 路径多一个 `IMAGE_TAG` 指定架构)。**单端口入口、Caddy 同源反代、4 容器协作机制完全相同**(见下「架构」)。

## 架构

```
浏览器 ──► Caddy (:80 / :443, 自动 HTTPS)
              ├── /api/* ──────────────────────────► server:3001  (内网)
              │   (NestJS setGlobalPrefix('api'),所有 server 端点都在 /api 下;
              │    flush_interval -1 透传流式;新增端点零 Caddy 配置)
              └── 其余(/、/_next 静态…) ──────────► agent-ui:3000 (内网)

server:3001 ──► postgres:5432 (内网,5432 也发布到宿主兼顾 dev)
```

agent-ui 的默认 endpoint **不靠 env** —— `store.ts` 回退到 `window.location.origin`:浏览器打开 `http://localhost` 默认连 localhost,打开 `https://<域名>` 默认连该域名。Caddy 同源反代到内网 server → **无 CORS、部署后零配置**。只有 Caddy 的 80/443 对外。

---

## 为什么整套都得是容器(server 不能 serverless)

server 是**长驻有状态进程**,四个属性都与 serverless 冲突:

1. `DissectAgentService.jobs: Map<string, DissectJob>` —— 拆解任务的 emitter + AbortController 存进程内,fire-and-forget 异步跑,单次拆解可达数分钟到数小时。进程一回收 job 全丢。
2. LLM 客户端 `Map` 缓存(按 `${modelId}:${updatedAt}:${maxTokens}:${temp}`)—— 进程亲和,冷启动重算。
3. 三个 `res.write` 长连接端点(`/agents/:id/runs`、`/benchmarks/:id/dissect`、`/benchmarks/:id/stream`)—— 一次请求跑完整条 agent 链路(recursionLimit 500),HTTP 连接开数分钟,远超任何 serverless 平台的函数超时。
4. `知识库/` 语料运行时从磁盘扫。

→ server **必须**长驻容器。agent-ui 虽是纯前端(可上 serverless),但既然 server 必须容器化,全家桶塞进一套 compose 比"前端 serverless + 后端容器"两套部署简单得多 → 统一 Compose。

---

## 部署步骤

```sh
# 1. 准备环境变量
cp .env.example .env
# 编辑 .env:
#   JWT_SECRET=$(openssl rand -hex 32)        ← 必填,缺失 compose 拒绝启动
#   prod 再设:
#     CADDY_DOMAIN=narratox.example.com    (裸域名 → Caddy 自动签 Let's Encrypt)
#     POSTGRES_PASSWORD=<强密码>
# (NEXT_PUBLIC_DEFAULT_ENDPOINT 默认不用设 —— 浏览器用自身 origin,打开啥就连啥)

# 2. 起整套(首次会 build 两个镜像)
docker compose up -d --build

# 3. 访问
# 本地:http://localhost
# prod :https://<域名>(Caddy 自动签 Let's Encrypt,首次可能等 10-30s)
```

启动顺序由 `depends_on` + healthcheck 保证:`postgres` healthy → `server`(先 `prisma migrate deploy` 再 `node dist/main`)→ `agent-ui` → `caddy`。

- 数据库 migrate **自动跑**(server CMD 里),无需手动。
- checkpointer 的 `agent_memory` schema 由 Nest boot 时 `saver.setup()` 自建(幂等)。
- 知识库语料(`知识库/`)bake 进 server 镜像 —— 改了语料要重新 `docker compose build server`。

---

## 停止 / 升级

```sh
docker compose down              # 停(数据保留在 narratox-pgdata volume)
docker compose down -v           # 停 + 删数据(谨慎!)

# 升级代码:
docker compose build server agent-ui   # 重建改动方
docker compose up -d                   # 滚起重启(migrate 自动跑)
```

---

## prod hardening

- **postgres 端口**:compose 默认发布 `5432:5432`(兼顾本地 dev:`pnpm dev` 时 host 上的 server 连 `localhost:5432`)。prod 上要么在防火墙封掉 5432,要么直接删掉 postgres 的 `ports`(server 走内网 `postgres:5432` 仍能连)。
- **Caddy HTTPS**:设了真实 `CADDY_DOMAIN` 后,Caddy 自动签 Let's Encrypt。要求 80/443 端口对外开放、域名 A 记录指向主机。
- **不要多副本**:`DissectAgentService.jobs` 是单进程 `Map`,server **不能多副本**(jobs 不共享)。要 scale 必须先把 jobs 状态挪到 Redis/DB,本期未做。

---

## 环境变量参考

| 变量 | 必填 | 作用 | 注入时机 |
|---|---|---|---|
| `JWT_SECRET` | ✅ | JWT 签名。`openssl rand -hex 32` | server 运行时 |
| `DATABASE_URL` | ✅ | Postgres 连接串(Prisma `public` + checkpointer `agent_memory` 两 schema) | server 运行时(compose 自动拼) |
| `PORT` | ❌ | server 监听端口(默认 3000,compose 设 3001) | server 运行时 |
| `KB_DIR` | ❌ | 知识库目录(镜像内 `/app/知识库`,本地 `<repo>/知识库`) | server 运行时 |
| `NEXT_PUBLIC_DEFAULT_ENDPOINT` | ❌(仅跨源部署才设) | 前端默认 server 入口;**默认不设 → 浏览器用自身 origin 同源走 Caddy**。仅当 agent-ui 与 server 不同源时显式设 server 完整 URL | **agent-ui 构建期** |
| `CADDY_DOMAIN` | ❌(prod 建议) | Caddy 站点域名(自动 HTTPS) | caddy 运行时 |
| `POSTGRES_USER/PASSWORD/DB` | ❌ | Postgres 凭证(默认 narratox) | postgres + server 运行时 |

> 模型 provider 的 API Key **不在** env —— 在 `/settings` UI 按用户配置并落库(`Vendor.apiKey`)。

---

## 常见坑

- **Caddy `flush_interval -1` 不能去** —— 否则流式帧(agent 活动 / 拆解进度)被缓冲,前端看不到逐帧。已在 Caddyfile 配好,改 Caddyfile 时别删。
- **server `stop_grace_period` 别短于 30s** —— `enableShutdownHooks` 要 SIGTERM 优雅关连接;agent run 可能正跑。
- **改 Prisma schema 后必须手动 `pnpm --dir server prisma generate`**(本地);镜像构建会自动 generate。
- **知识库 / prompts 更新** → 重新 `docker compose build server`(corpus 和 prompts 都 bake 进镜像,不是挂载)。
- **postgres 5432 在 prod** 暴露风险 —— 见 prod hardening。

---

## 验证(本地端到端)

```sh
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build

# 1. 健康检查(经 Caddy 透传到 server)
curl http://localhost/health

# 2. 浏览器开 http://localhost → 注册 → 登录 → 新建小说 → 发消息 → 看流式逐帧(Caddy 不缓冲)
# 3. /dissect 上传一本书 → 开始拆解 → 日志逐帧 → 关闭再查看日志续接(长连接 + 后台 agent)

# 4. 重启数据持久
docker compose down && docker compose up -d
# 数据仍在(volume);server 日志有 "prisma migrate deploy" + checkpointer setup
```

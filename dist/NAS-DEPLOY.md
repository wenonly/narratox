# NAS 部署 narratox

> 本文件是 **源文档**(版本化)。`dist/NAS-DEPLOY.md` 是打包时复制过去的副本,内容一致,随 tar 分发给 NAS 用户。

NAS 部署用 **load 模式**:本机 build 镜像 → `docker save` 打 tar → 传到 NAS → `docker load` → `docker compose up`。NAS 上**没有源码、不 build**,镜像以 `image:` 引用 load 进来的本地镜像。

> 本机自托管(有源码、能 build)走 [docs/deployment.md](./deployment.md)(`docker compose up -d --build`)。两条路用的 compose 不同:根 `docker-compose.yml` 是 build 模式,`dist/docker-compose.yml` 是 load 模式。

## 0. 选对镜像 tar(看 NAS 的 CPU 架构)

| NAS 机型示例 | 架构 | 用哪个 tar |
|---|---|---|
| Synology DS920+/DS1522+/DS423+/大多数 Plus 系列、QNAP Intel 机型 | **amd64** | `narratox-amd64.tar.gz` |
| Synology DS220/DS420j 等 ARM 机型、树莓派 | **arm64** | `narratox-arm64.tar.gz` |

> NAS SSH 里跑 `uname -m`:`x86_64` = amd64;`aarch64` / `arm64` = arm64。
> 不确定就两个 tar 都传,只 load 对的那个(另一个 load 了也无害,只是占空间)。

## 1. 把 dist/ 整个传到 NAS

例如(SCP,把 NAS 换成你的地址):
```sh
scp -r dist/ user@nas-ip:/volume1/docker/narratox/
```
(Synology 常用 `/volume1/docker/`;QNAP 常用 `/share/Container/`。放哪儿都行,只要 Docker 有权读。)

## 2. 在 NAS 上 load 镜像

SSH 进 NAS,`cd` 到传过去的目录:
```sh
cd /volume1/docker/narratox
docker load -i narratox-amd64.tar.gz   # 或 narratox-arm64.tar.gz,看架构
# 看到 "Loaded image: narratox-server:amd64" + "Loaded image: narratox-ui:amd64" 即成功
docker images | grep narratox           # 确认两个镜像在
```

> ⚠️ **不要 `docker compose up --build`** —— NAS 上没有源码,build 会失败。镜像已经从 tar load,compose 用 `image:` 引用即可。

## 3. 改 .env

```sh
cp .env.example .env
```
编辑 `.env`,至少改:
- `IMAGE_TAG=amd64` ← **必须跟 load 的 tar 对齐**(`narratox-amd64.tar.gz` → `amd64`;`narratox-arm64.tar.gz` → `arm64`)。compose 用 `narratox-server:${IMAGE_TAG}` / `narratox-ui:${IMAGE_TAG}` 找镜像,对不上就 `pull access denied`。
- `JWT_SECRET=` ← 填强随机:在 NAS 上跑 `openssl rand -hex 32`(若 NAS 没有 openssl,在本机生成后填进去)
- `POSTGRES_PASSWORD=` ← 改强密码(默认 narratox 太弱;NAS 暴露内网也别用默认)
- `CADDY_HTTP_PORT=8080` ← NAS 上想用的访问端口(默认 8080,避免占 80)
- `CADDY_HTTPS_PORT=8443` ← HTTPS 端口(局域网不用 HTTPS 可忽略)
- `CADDY_DOMAIN=:80` ← **保持 `:80`**(局域网 IP 访问用)。若有真实域名要 HTTPS,改成裸域名(如 `narratox.example.com`),且路由器要端口转发 80/443 到 NAS。

## 4. 起整套

```sh
docker compose up -d
```
(server / agent-ui 镜像已 load;首次会从 Docker Hub 拉 `postgres:16-alpine` + `caddy:2-alpine`,NAS 联网即可。)

## 5. 访问

浏览器开 **`http://<NAS 的 IP>:<CADDY_HTTP_PORT>`**(默认 8080):
- 局域网:`http://192.168.1.50:8080`(举例)
- 浏览器打开啥地址,前端默认就连那个地址(Caddy 同源反代,零配置)

注册 → 登录 → 新建小说 / 上传拆解,整条链路可用。

## 常用命令(在 NAS 部署目录)
```sh
docker compose ps              # 看状态
docker compose logs -f server  # 跟踪 server 日志
docker compose down            # 停(数据保留在 volume)
docker compose down -v         # 停 + 删数据库(慎)
docker compose up -d           # 重启
```

## 数据持久

postgres 数据在 docker volume `<项目名>_narratox-pgdata`(由 docker 管理,NAS 重启不丢;项目名默认是部署目录的目录名,如 `narratox`)。
要备份:`docker run --rm -v <项目名>_narratox-pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pg-backup.tgz -C /data .`

## 升级代码

NAS 上不重新构建。在本机重新打镜像 → load 到 NAS:
```sh
# 本机:重新打镜像 + 打 tar(见下「重新打包」节)
# NAS:
docker load -i narratox-amd64.tar.gz   # 覆盖加载新版本(同名同 tag 覆盖)
docker compose up -d                    # 检测到新镜像,滚起重启容器
```

## 重新打包(在本机执行)

NAS 用的 tar 在本机生成。流程:`docker build` → `docker tag <arch>` → `docker save | gzip > dist/`。

```sh
cd <repo 根>

# 1. build 两架构镜像(Mac 是 arm64,amd64 经 QEMU 跨架构,慢但能跑)
docker build --platform linux/amd64 -f server/Dockerfile  -t narratox-server:amd64 .
docker build --platform linux/amd64 -f agent-ui/Dockerfile -t narratox-ui:amd64    .
docker build --platform linux/arm64 -f server/Dockerfile  -t narratox-server:arm64 .
docker build --platform linux/arm64 -f agent-ui/Dockerfile -t narratox-ui:arm64    .

# 2. 同步 dist 的部署文件
cp Caddyfile dist/
cp docs/nas-deploy.md dist/NAS-DEPLOY.md
#   ⚠️ 不能 cp 进 dist/ 的:docker-compose.yml 和 .env.example —— 这俩在 dist/ 是 load 模式
#      专用(image: + IMAGE_TAG 等 NAS 配置),跟根目录的 build 模式版本结构不同,直接覆盖
#      会丢 IMAGE_TAG,触发「pull access denied」。改这俩直接编辑 dist/ 里的文件(见下方
#      「dist compose 维护」),Caddyfile 两边一致可以 cp。

# 3. 打 tar(docker save 多镜像一 tar,共享 base 层只存一份)
docker save narratox-server:amd64 narratox-ui:amd64 | gzip > dist/narratox-amd64.tar.gz
docker save narratox-server:arm64 narratox-ui:arm64 | gzip > dist/narratox-arm64.tar.gz

# 4. 验证 tar 内容
tar -xzf dist/narratox-amd64.tar.gz -O manifest.json | python3 -m json.tool
#   应看到 RepoTags: ["narratox-server:amd64"] 和 ["narratox-ui:amd64"]
```

> `dist/` 已 gitignore(tar 是本地构建产物,460MB 不入 git)。NAS 上需要的是 `dist/` 这个目录本身。

### dist compose 维护(重要)

根 `docker-compose.yml` 与 `dist/docker-compose.yml` **不一样**:
- **根**:本机有源码 → `build:` 块,默认镜像名 `narratox-<service>:latest`
- **dist**:NAS 无源码 → `image: narratox-<svc>:${IMAGE_TAG}`,引用 load 的 tar

所以**不能用 `cp docker-compose.yml dist/`** 覆盖 dist 的 compose。改 dist compose 时直接编辑 `dist/docker-compose.yml`,保持 `image:` + `IMAGE_TAG` 形态。两个 compose 的 postgres / caddy / volumes 段保持一致。

## 常见坑

- **`pull access denied for narratox-server` / `manifest unknown`** → `.env` 的 `IMAGE_TAG` 跟实际 load 的 tar 不匹配(load 了 amd64 但写 arm64,或反之),或忘了 `docker load`。compose 找不到本地镜像就会去 Docker Hub 拉,而我们是私有镜像。
- **`exec format error` 启动失败** → 镜像架构和 NAS 不匹配(amd64 镜像跑在 arm64 NAS 或反之)。换另一个 tar。
- **端口被占**(`bind: address already in use`)→ NAS 上 8080/8443 被别的服务占。改 `.env` 的 `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` 到空闲端口,recreate。
- **`docker compose` 命令不存在** → 旧版 Docker 用 `docker-compose`(带连字符)。Synology Container Manager 较新版本支持 `docker compose`。
- **Caddy 自动签证书失败**(设了真实域名才发生)→ Let's Encrypt 需要公网 80 可达。路由器没转发 80、或内网-only 域名都不行。局域网用就保持 `CADDY_DOMAIN=:80`(HTTP,不要 HTTPS)。
- **NAS 性能弱,server 启动慢** → langgraph + prisma 启动有 5-15s 初始化,首次迁移更久。看 `docker compose logs server` 等 "Nest application successfully started"。
- **NAS 完全离线** → tar 里**没装** postgres/caddy(那俩从 Docker Hub 拉)。需先在有网机器上 `docker pull postgres:16-alpine caddy:2-alpine` 再 `docker save` 一起传过去。

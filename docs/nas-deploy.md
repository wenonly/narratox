# NAS 部署 narratox

本目录是自包含部署包。把整个 `dist/` 传到 NAS,按下面步骤起。

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

## 3. 改 .env

```sh
cp .env.example .env
```
编辑 `.env`,至少改:
- `JWT_SECRET=` ← 填强随机:在 NAS 上跑 `openssl rand -hex 32`(若 NAS 没有 openssl,在本机生成后填进去)
- `POSTGRES_PASSWORD=` ← 改强密码(默认 narratox 太弱;NAS 暴露内网也别用默认)
- `CADDY_HTTP_PORT=8080` ← NAS 上想用的访问端口(默认 8080,避免占 80)
- `CADDY_HTTPS_PORT=8443` ← HTTPS 端口(局域网不用 HTTPS 可忽略)
- `CADDY_DOMAIN=:80` ← **保持 `:80`**(局域网 IP 访问用)。若有真实域名要 HTTPS,改成裸域名(如 `narratox.example.com`),且路由器要端口转发 80/443 到 NAS。

## 4. 起整套

```sh
docker compose up -d
```
(镜像已 load,**不需要 `--build`**。首次会拉 `postgres:16-alpine` + `caddy:2-alpine`,NAS 联网即可。)

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

postgres 数据在 docker volume `narratox_narratox-pgdata`(由 docker 管理,NAS 重启不丢)。
要备份:`docker run --rm -v narratox_narratox-pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pg-backup.tgz -C /data .`

## 升级代码

NAS 上不重新构建。在本机重新打镜像 → load 到 NAS:
```sh
# 本机:打新镜像 → 传 tar
# NAS:
docker load -i narratox-amd64.tar.gz   # 覆盖加载新版本
docker compose up -d                    # 用新镜像重启容器
```

## 常见坑

- **`exec format error` 启动失败** → 镜像架构和 NAS 不匹配(amd64 镜像跑在 arm64 NAS 或反之)。换另一个 tar。
- **端口被占**(`bind: address already in use`)→ NAS 上 8080/8443 被别的服务占。改 `.env` 的 `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` 到空闲端口,recreate。
- **`docker compose` 命令不存在** → 旧版 Docker 用 `docker-compose`(带连字符)。Synology Container Manager 较新版本支持 `docker compose`。
- **Caddy 自动签证书失败**(设了真实域名才发生)→ Let's Encrypt 需要公网 80 可达。路由器没转发 80、或内网-only 域名都不行。局域网用就保持 `CADDY_DOMAIN=:80`(HTTP,不要 HTTPS)。
- **NAS 性能弱,server 启动慢** → langgraph + prisma 启动有 5-15s 初始化,首次迁移更久。看 `docker compose logs server` 等 "Nest application successfully started"。

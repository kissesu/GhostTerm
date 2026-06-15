# 腾讯云 Lighthouse 部署 Runbook

GhostTerm `ghostterm-server` 部署到腾讯云轻量应用服务器(Lighthouse)的运维文档。

- **服务器**:腾讯云 Lighthouse 4C8G / Ubuntu 24.04(成都一区)
- **公网 IP**:`129.28.42.191`(IPv6 `2402:4e00:c000:1000:7a4e:83a8:3ab6:0`)
- **实例 ID**:`lhins-1p35ulxc`
- **SSH**:`ssh ghostterm-prod`(同 IP 上同机的 thesis-tool 用 `ssh thesis-prod`,端口 **52022**)
- **HTTPS 入口**:`https://129.28.42.191:38080`(自签 IP 证书,CA:FALSE + serverAuth EKU)
- **客户端**:GhostTerm Tauri 桌面应用通过 Rust `reqwest` 转发(绕 WebView 自签证书限制 + cert pinning)

> 不走 DNS 域名,IP 直连 + 自签证书 + Tauri Rust 代理。80/443 已被同机 thesis-tool-rust 占用,
> ghostterm 走 38080 高端口免备案。换 IP 时同步走 [§Caddy 自签证书重签](#caddy-自签证书重签) +
> 客户端 bump 版本流程。
>
> 历史 atlas 部署(西安 103.236.85.144,systemd + apt postgres + systemd-creds TPM 方案)
> 见 `_archived/deployment-atlas.md`,已于 2026-06-15 下线。

## 部署架构

```
Tauri client (Mac/Windows)
  ↓ invoke('http_request_cmd', ...)  -- WebView 不直接发请求
Rust reqwest(编内 cert pinning + tls_built_in_root_certs(false) + https_only)
  ↓ HTTPS :38080
docker compose stack (project=ghostterm,与同机 thesis-tool 独立栈)
  ├─ caddy:2-alpine          (TLS termination,反代 ghostterm-server:8080)
  ├─ ghostterm-server        (alpine + bind-mount linux/amd64 binary,Type=long-running)
  └─ postgres:16-alpine      (业务库,GUC RLS,docker network 内访问,无 host 端口暴露)
```

## 同机共存说明

同台机器跑了两个独立 docker compose 栈,**互不耦合**:

| 项目 | compose project | host 端口 | docker network |
|---|---|---|---|
| thesis-tool-rust | `thesis-tool-prod` | 80 / 443(thesis 自己的 Caddy) | `thesis-tool-prod_default` |
| ghostterm | `ghostterm` | 38080(本栈的 Caddy) | `ghostterm` |

不共用 Caddy、不共用 postgres、不共用网络。任一栈崩溃不影响另一栈。

## 启停 / 状态

```bash
ssh ghostterm-prod

cd /opt/ghostterm

# 查状态
docker compose -f docker-compose.prod.yml ps

# 重启 ghostterm-server(零停机更新二进制后用)
docker compose -f docker-compose.prod.yml restart ghostterm-server

# 重启 caddy(改 Caddyfile.prod 后用,admin off 故必须 restart 不能 reload)
docker compose -f docker-compose.prod.yml restart caddy

# 全栈停 / 起
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# 健康检查
curl -sk https://127.0.0.1:38080/healthz
# 期待: {"db":"ok","status":"ok"}
```

## 日志

```bash
# ghostterm-server
docker logs --tail 50 ghostterm-server
docker logs -f ghostterm-server                     # 实时

# caddy(JSON 格式 → 容器内 /var/log/caddy/ghostterm.log 100MB 滚动)
docker logs --tail 50 ghostterm-caddy
docker exec ghostterm-caddy tail -f /var/log/caddy/ghostterm.log

# postgres
docker logs --tail 50 ghostterm-postgres
```

## 关键路径

| 路径(host 视角) | 说明 |
|------|------|
| `/opt/ghostterm/bin/ghostterm-server` | Go binary(Mac cross-compile linux/amd64,bind mount 进容器) |
| `/opt/ghostterm/docker-compose.prod.yml` | 生产 compose stack |
| `/opt/ghostterm/Caddyfile.prod` | Caddy 配置(:38080 + 自签 cert + JSON log) |
| `/opt/ghostterm/migrations/` | 56 个 migration 文件(`docker run --rm migrate/migrate` 应用) |
| `/opt/ghostterm/bootstrap-tencent.sh` | 一次性首部署脚本(幂等,secrets/cert 存在则跳过) |
| `/etc/ghostterm/server.env` | server 环境变量(含 DATABASE_URL 明文),chmod 640 |
| `/etc/ghostterm/secrets/pg_root_pw` | postgres root 密码(hex),chmod 600 |
| `/etc/ghostterm/secrets/pg_app_pw` | progress_app 角色密码(hex,DATABASE_URL 引用),chmod 600 |
| `/etc/ghostterm/secrets/jwt_access` | JWT access HMAC 密钥(base64 ≥3 字符类),chmod 600 |
| `/etc/ghostterm/secrets/jwt_refresh` | JWT refresh HMAC 密钥(base64),chmod 600 |
| `/etc/ghostterm/secrets/data_key` | pgcrypto 列加密主密钥(base64 ≥32 字节),chmod 600 |
| `/etc/ghostterm/cert.pem` | Caddy 自签 IP 证书(CN=129.28.42.191,SAN=IP+localhost,10 年) |
| `/etc/ghostterm/key.pem` | Caddy 私钥,chmod 640 |
| docker volume `ghostterm_pgdata` | postgres data(/var/lib/postgresql/data) |
| docker volume `ghostterm_filedata` | 用户上传文件(/var/lib/ghostterm/files in container) |
| docker volume `ghostterm_caddylogs` | Caddy access log(/var/log/caddy in container) |
| **本机 Mac 备份**:`~/Documents/ghostterm-secrets/tencent/` | secrets + cert 离场备份(chmod 600;TODO) |

## 端口

| 端口 | 用途 | 防火墙 |
|------|------|--------|
| 22 | SSH 默认(腾讯云轻量应用默认开)| **不用**,腾讯云轻量应用 ssh 已改 52022 |
| 52022 | SSH(thesis 部署时改的,root + ed25519) | 已开 0.0.0.0/0 |
| 38080 | Caddy HTTPS(业务入口,反代到 ghostterm-server:8080) | **需在腾讯云 Lighthouse 控制台手工开** |
| 容器内 5432 | postgres(仅 docker network 内访问) | 不暴露 |
| 容器内 8080 | ghostterm-server(仅 caddy 容器反代访问) | 不暴露 |

> **腾讯云 Lighthouse 防火墙坑**:控制台 → 实例 → 防火墙 → 添加规则。TCP 协议 + 端口 38080 +
> 来源 `0.0.0.0/0`(IPv4)+ `::/0`(IPv6)。否则现象:`nc -zv` 显示 succeeded(三次握手过),
> 但 TLS handshake 包到不了 Caddy(hypervisor 层应用流量丢弃),Mac `curl -k` 返回 exit=35
> SSL_ERROR_SYSCALL,Caddy 端无任何 log。区分腾讯云防火墙拦截 vs Caddy/cert 问题的快速法:
> ssh 进机器内部 `curl -sk https://127.0.0.1:38080/healthz`,通 = 必是控制台防火墙问题。

## 首次部署(bootstrap-tencent.sh)

```bash
# Mac 本地
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm/server
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /tmp/ghostterm-server-linux-amd64 ./cmd/server

# 上传
ssh ghostterm-prod 'mkdir -p /opt/ghostterm/{bin,migrations}'
scp /tmp/ghostterm-server-linux-amd64 ghostterm-prod:/opt/ghostterm/bin/ghostterm-server
scp deploy/docker-compose.prod.yml deploy/Caddyfile.prod deploy/bootstrap-tencent.sh ghostterm-prod:/opt/ghostterm/
scp migrations/*.sql ghostterm-prod:/opt/ghostterm/migrations/

# 跑(幂等;secrets / cert 已存在则跳过生成)
ssh ghostterm-prod 'bash /opt/ghostterm/bootstrap-tencent.sh'
```

bootstrap 脚本完成的事:
1. 建 `/etc/ghostterm/{secrets/}` 骨架,权限 700 / 600
2. 生成 5 个 secrets(pg_root_pw / pg_app_pw 用 hex,jwt × 2 / data_key 用 base64,满足 server config ≥3 字符类校验)
3. 签自签 IP 证书(CA:FALSE + keyUsage critical + serverAuth EKU,**3 个 ext 必带**,否则 rustls webpki 拒)
4. 渲染 `/etc/ghostterm/server.env`(含完整 DATABASE_URL)
5. 起 postgres → 等 healthy → `docker run --rm migrate up` → 设 progress_app 密码 + `ALTER ROLE progress_app SET jit = off`
6. 起 ghostterm-server + caddy → 内网 curl 验证

## 升级 ghostterm-server(Mac → 腾讯云)

```bash
# Mac 本地 cross-compile
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm/server
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /tmp/ghostterm-server-linux-amd64 ./cmd/server

# scp + 替换 + restart(restart 中断 < 1s)
scp /tmp/ghostterm-server-linux-amd64 ghostterm-prod:/tmp/ghostterm-server
ssh ghostterm-prod 'sudo mv /tmp/ghostterm-server /opt/ghostterm/bin/ghostterm-server && \
                    sudo chmod 755 /opt/ghostterm/bin/ghostterm-server && \
                    docker compose -f /opt/ghostterm/docker-compose.prod.yml restart ghostterm-server && \
                    sleep 2 && \
                    curl -sk https://127.0.0.1:38080/healthz'
```

## 应用新 migration

migrations 源放在仓库 `server/migrations/00XX_*.{up,down}.sql`。生产应用:

```bash
# 1. Mac 本地写好 SQL 后 commit + push,本机有 master 副本
# 2. scp 上去
scp server/migrations/*.sql ghostterm-prod:/opt/ghostterm/migrations/

# 3. 在腾讯云上跑 migrate(用 host docker run,挂 secret 取 root password)
ssh ghostterm-prod '
  PG_ROOT_PW=$(cat /etc/ghostterm/secrets/pg_root_pw)
  docker run --rm \
    --network ghostterm \
    -v /opt/ghostterm/migrations:/migrations:ro \
    migrate/migrate:v4.19.1 \
    -path=/migrations \
    -database="postgres://postgres:${PG_ROOT_PW}@postgres:5432/progress?sslmode=disable" \
    up'

# 4. verify
ssh ghostterm-prod 'docker exec ghostterm-postgres psql -U postgres -d progress \
  -c "SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1"'

# 5. 重启服务(让 ghostterm-server 重新加载 schema cache)
ssh ghostterm-prod 'docker compose -f /opt/ghostterm/docker-compose.prod.yml restart ghostterm-server'
```

## Caddy 自签证书重签

证书过期 / 换 IP / 客户端 cert pinning 强制升级 / SAN/CN 调整时用。**必带 3 个 ext** 否则 rustls webpki 拒。

```bash
ssh ghostterm-prod '
  HOST_IP=129.28.42.191
  sudo cp -p /etc/ghostterm/cert.pem /etc/ghostterm/cert.pem.bak.$(date +%Y%m%d-%H%M%S)
  sudo cp -p /etc/ghostterm/key.pem  /etc/ghostterm/key.pem.bak.$(date +%Y%m%d-%H%M%S)
  sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /etc/ghostterm/key.pem \
    -out    /etc/ghostterm/cert.pem \
    -subj   "/CN=${HOST_IP}" \
    -addext "subjectAltName=IP:${HOST_IP},IP:127.0.0.1,DNS:localhost" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
  sudo chmod 644 /etc/ghostterm/cert.pem
  sudo chmod 640 /etc/ghostterm/key.pem
  docker compose -f /opt/ghostterm/docker-compose.prod.yml restart caddy'
```

**重签后必同步客户端**(Tauri 编内 cert pinning,旧 client 无法连):

```bash
# Mac 本地:拉回 cert + 替换编内 + cargo rebuild Tauri + 发布新版本
ssh ghostterm-prod 'cat /etc/ghostterm/cert.pem' > src-tauri/certs/tencent-ip.pem

# 验证 cert 合规(SAN/CA:FALSE/serverAuth)
openssl x509 -in src-tauri/certs/tencent-ip.pem -noout -text | grep -E "Subject|Issuer|DNS|IP Address|CA:|Key Usage|Extended"

# 严格 curl 验证(不 -k 应能 200,不通则 client 也连不上)
curl --cacert src-tauri/certs/tencent-ip.pem https://129.28.42.191:38080/healthz

# bump 版本号 4 处:.env.production / package.json / Cargo.toml / tauri.conf.json
# → push tag → tauri-action 自动 build dmg/msi → 通知用户升级
```

## 性能调优 — PG JIT 角色级关闭

bootstrap 已自动跑过一次。新机重灌或换库时必跑:

```bash
ssh ghostterm-prod 'docker exec ghostterm-postgres psql -U postgres -d progress \
  -c "ALTER ROLE progress_app SET jit = off"'
ssh ghostterm-prod 'docker compose -f /opt/ghostterm/docker-compose.prod.yml restart ghostterm-server'
```

verify:

```bash
ssh ghostterm-prod 'docker exec ghostterm-postgres psql -U postgres -d progress \
  -c "SELECT rolconfig FROM pg_roles WHERE rolname = '\''progress_app'\''"'
# 期待:{jit=off}
```

详见 memory `feedback_pg_jit_anti_optimization_with_rls_view_diagnose.md`。

## 已知约束

1. **腾讯云 Lighthouse 防火墙必须显式开 38080** — 详见 [§端口](#端口) 备注,默认只放 22/80/443
2. **Caddy admin API off** → `restart caddy` 不能 `reload`(本栈用 docker restart,中断 < 1s)
3. **Tauri WebView 自签证书** → `client.ts doFetch` 通过 `http_request_cmd` 调用 Rust `reqwest` 转发(编内 cert pinning,关闭公共 CA bundle)
4. **secrets 是 host 明文文件** → 与 atlas 的 systemd-creds TPM 派生方案不同,本栈走 file mount + chmod 600。Lighthouse 轻量机型常无 TPM,systemd-creds 不可用故放弃;防御深度依赖 root 私有 + docker secrets file source。备份必须保留 Mac 端 `~/Documents/ghostterm-secrets/tencent/`
5. **Sentry / 错误监控目前关闭** — `SENTRY_DSN=""` 时 SDK no-op,API 仍可用但 event 静默丢弃。GlitchTip self-host 已废弃,不再保留监控通路

## 备份(待补)

atlas 上的 age-加密 pg_dump + systemd timer 这套机制本栈**未启用**。当前无生产数据,首次部署后建议在
T+7 业务接入时补:

1. 生成 age key pair(Mac 端用 `age-keygen` 出 `tencent-backup.key` + pub)
2. 在 host 装 `apt install -y age`
3. 把 `server/deploy/backup.sh` 适配 docker(改用 `docker exec ghostterm-postgres pg_dump`)
4. 写 systemd timer:`OnCalendar=*-*-* 02:00:00` + 随机延迟 0-15min
5. 保留策略 14/30/60 天分层(参考 atlas runbook)

## 应急访问通道

| 场景 | 入口 |
|------|------|
| SSH 不通(fail2ban / 出口 IP 被封) | 1. 切手机热点;2. 腾讯云控制台「VNC 登录」;3. 控制台防火墙白名单加当前 IP |
| 整个实例失联 | 控制台「快照」回滚或「重装系统」 |
| 38080 公网不通,内网 curl 通 | 控制台 → 防火墙规则,补 TCP/38080 入站 |

## Secrets 索引(位置参考,不含值)

- **Mac**:`~/Documents/ghostterm-secrets/tencent/`(chmod 600,**TODO**:首次备份)
  - `pg_root_pw` / `pg_app_pw` / `jwt_access` / `jwt_refresh` / `data_key` 明文备份
  - `cert.pem` / `key.pem` 备份
- **腾讯云 `/etc/ghostterm/secrets/`**(chmod 600,root only)
  - `pg_root_pw` / `pg_app_pw`(hex,DATABASE_URL 引用)
  - `jwt_access` / `jwt_refresh`(base64 ≥3 字符类)
  - `data_key`(base64 ≥32 字节)
- **腾讯云 `/etc/ghostterm/server.env`**(chmod 640,root:root,docker compose env_file 读)
  - 含 DATABASE_URL 完整串 + 4 个 secret env + 其它非敏感配置
- **管理员账号**:`admin / admin123`(migration 0001 seed bcrypt hash 写死,密码丢失时按 `reference_atlas_admin_password_reset_runbook.md` 重置)

## 文档待补

- Mac 端 secrets 离场备份脚本(scp + chmod 600)
- 备份机制(age + docker exec pg_dump + systemd timer)
- 域名切换流程(若后续上 ICP 备案 + Let's Encrypt)

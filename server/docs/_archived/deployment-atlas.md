# Atlas 服务器部署 Runbook

GhostTerm `ghostterm-server` 部署到 atlas 物理机的完整运维文档。

- **服务器**：西安铂金 4H8G / Ubuntu 24.04（具体供应商面板入口待补）
- **公网 IP**：`103.236.85.144`（旧机 `43.132.191.253` 已于 2026-05-09 资源回收，与本机无关）
- **SSH**：`ssh atlas`（端口 `22`，root + ed25519 密钥；本仓库 `~/.ssh/config` 已配 alias）
- **HTTPS**：`https://103.236.85.144:38080`（自签 IP 证书，CA:FALSE + serverAuth EKU）
- **客户端**：GhostTerm Tauri 桌面应用通过 Rust `reqwest` 转发（绕过 WebView 自签证书限制 + cert pinning）

> 不走 DNS 域名，IP 直连 + 自签证书 + Tauri Rust 代理。当前没有 ICP 备案需求；切域名时需重新签证书 + 加 SAN。

## 部署架构

```
Tauri client (Mac/Windows)
  ↓ invoke('http_request_cmd', ...)  -- WebView 不直接发请求
Rust reqwest（编内 cert pinning + tls_built_in_root_certs(false) + https_only）
  ↓ HTTPS :38080
Caddy [tls /etc/ghostterm/cert.pem /etc/ghostterm/key.pem; admin off]
  ↓ reverse_proxy 127.0.0.1:18080
ghostterm-server (systemd unit, user=ghostterm)
  ↓ DATABASE_URL (LoadCredentialEncrypted) → progress_app@localhost:5432/progress
PostgreSQL 16 (apt) + 27 migrations + RLS FORCE
```

## 启停 / 状态

```bash
ssh atlas

# 查状态
sudo systemctl status ghostterm-server caddy postgresql

# 重启 ghostterm-server
sudo systemctl restart ghostterm-server

# 重启 Caddy（注意：因 Caddyfile 设 admin off，不能 reload，必须 restart）
sudo systemctl restart caddy

# 健康检查
curl -sk https://127.0.0.1:38080/healthz
# 期待: {"db":"ok","status":"ok"}
```

## 日志

```bash
# ghostterm-server
sudo journalctl -u ghostterm-server -n 50 --no-pager
sudo journalctl -u ghostterm-server -f                   # 实时

# Caddy（含 access log；JSON 格式 → /var/log/caddy/ghostterm.log 100MB 滚动）
sudo journalctl -u caddy -n 50 --no-pager
sudo tail -f /var/log/caddy/ghostterm.log

# PostgreSQL
sudo journalctl -u postgresql -n 50 --no-pager

# 备份（systemd timer 触发）
sudo journalctl -u ghostterm-backup -n 50 --no-pager
```

## 关键路径

| 路径 | 说明 |
|------|------|
| `/usr/local/bin/ghostterm-server` | Go binary（Mac cross-compile linux/amd64） |
| `/etc/systemd/system/ghostterm-server.service` | systemd unit（user=ghostterm，sandboxing 加固） |
| `/etc/ghostterm/server.env` | 非敏感配置（HTTP_ADDR / JWT_*_TTL / BCRYPT_COST / FILE_* / RATE_LIMIT_* / TRUSTED_PROXIES / ALLOWED_ORIGINS），640 root:ghostterm |
| `/etc/ghostterm/credentials/*.cred` | systemd 加密 secrets（jwt_access / jwt_refresh / database_url / data_key），TPM 派生密钥仅 boot 周期可解 |
| `/etc/ghostterm/cert.pem` | Caddy 自签证书（CN=103.236.85.144，CA:FALSE + serverAuth EKU + IP/localhost SAN） |
| `/etc/ghostterm/key.pem` | Caddy 私钥（640 caddy:caddy） |
| `/etc/ghostterm/age.pub` | age 公钥，备份脚本用其加密 pg_dump 输出 |
| `/etc/caddy/Caddyfile` | Caddy 配置（admin off + TLS 1.3 + HSTS + reverse_proxy + JSON access log） |
| `/var/lib/ghostterm/files/` | 用户上传文件存储（service ReadWritePaths 白名单内） |
| `/var/log/ghostterm/` | 应用日志（service ReadWritePaths 白名单内） |
| `/var/log/caddy/ghostterm.log` | Caddy access/error 日志（JSON，100MB × 5 滚动 90 天保留） |
| `/var/backups/ghostterm/progress_*.sql.gz.age` | age 加密的每日 pg_dump |
| `/usr/local/bin/migrate` | golang-migrate 工具 |
| `/usr/local/bin/ghostterm-backup.sh` | 备份脚本（被 systemd timer 触发） |
| `/etc/systemd/system/ghostterm-backup.{service,timer}` | 备份 systemd 单元（OnCalendar 02:00 + 0-15min 随机延迟） |
| `/opt/ghostterm/src/` | 仓库 clone（部署源 + systemd unit 模板 + migrations） |
| Mac 本地 secrets 备份 | `~/Documents/ghostterm-secrets/`（含 age 私钥、credentials 明文备份；chmod 600） |

## 端口

| 端口 | 用途 | 防火墙 |
|------|------|--------|
| 22 | SSH（标准端口，root + ed25519） | 已开 0.0.0.0/0 |
| 38080 | Caddy HTTPS（业务入口，反代到 ghostterm-server） | 已开 0.0.0.0/0 |
| 38090 | GlitchTip 错误监控 web/API（明文 http，docker compose 暴露 0.0.0.0:38090→web 容器 8000） | 已开 0.0.0.0/0 |
| 18080 | ghostterm-server HTTP（内部，仅 127.0.0.1 listen） | 不公开 |
| 5432 | PostgreSQL（业务库，仅 localhost） | 不公开 |
| docker 网络 | GlitchTip 内部 postgres + valkey + web + worker（docker compose default network） | 不公开 |

## 升级 ghostterm-server（Mac → atlas）

```bash
# Mac 本地 cross-compile
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm/server
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /tmp/ghostterm-server-linux ./cmd/server

# scp + 替换 + restart（systemd Type=simple，restart 中断 < 1s）
scp /tmp/ghostterm-server-linux atlas:/tmp/ghostterm-server-linux
ssh atlas 'sudo systemctl stop ghostterm-server && \
           sudo mv /tmp/ghostterm-server-linux /usr/local/bin/ghostterm-server && \
           sudo chmod 755 /usr/local/bin/ghostterm-server && \
           sudo systemctl start ghostterm-server && \
           sleep 2 && \
           curl -sk https://127.0.0.1:38080/healthz'
```

**runbook 同步点**：每次 GhostTerm release bump（如 v0.7.x → v0.8.0）必须同步更新 `/etc/ghostterm/server.env` 的 `SENTRY_RELEASE=ghostterm-server@<新版本>` 字段并 restart，否则 GlitchTip 上 Issues release 标签停留旧版误导诊断。

```bash
# 仅 release 字段同步（不需重 build binary 时）
ssh atlas 'sudo sed -i "s/^SENTRY_RELEASE=.*/SENTRY_RELEASE=ghostterm-server@<新版本>/" /etc/ghostterm/server.env && \
           sudo systemctl restart ghostterm-server && \
           sleep 2 && \
           sudo journalctl -u ghostterm-server -n 5 --no-pager | grep -i sentry'
```

## 应用新 migration

migrations 源放在仓库 `server/migrations/00XX_*.{up,down}.sql`。当前 atlas 通过部署时把仓库 clone 到 `/opt/ghostterm/src/` 直接引用。具体应用：

```bash
# 1. Mac 本地写好 SQL 后 commit + push
# 2. atlas 上 pull 最新代码
ssh atlas 'cd /opt/ghostterm/src && sudo -u ghostterm git pull --ff-only'

# 3. 应用 migrate（DATABASE_URL 走 unix socket，避免暴露密码）
ssh atlas 'sudo -u postgres /usr/local/bin/migrate \
             -path /opt/ghostterm/src/server/migrations \
             -database "postgres://postgres@/progress?host=/var/run/postgresql&sslmode=disable" \
             up'

# 4. verify
ssh atlas 'sudo -u postgres psql -d progress -c "SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1"'

# 5. 重启服务（让 ghostterm-server 重新加载 schema cache）
ssh atlas 'sudo systemctl restart ghostterm-server'
```

## 备份与恢复

### 备份机制

- **触发**：systemd `ghostterm-backup.timer`（OnCalendar `*-*-* 02:00:00` + 0-15 分钟随机延迟）
- **脚本**：`/usr/local/bin/ghostterm-backup.sh`，user=ghostterm，sandboxed，仅 `/var/backups/ghostterm` 可写
- **加密**：每个 dump 用 `age` 加密成 `.sql.gz.age`，公钥 `/etc/ghostterm/age.pub`，私钥仅 Mac 本地 `~/Documents/ghostterm-secrets/`
- **保留策略**：详见 `server/deploy/backup.sh`（典型 14/30/60/90 天分层）

### 手动触发备份

```bash
ssh atlas 'sudo systemctl start ghostterm-backup.service'
# 或直接调脚本：
ssh atlas 'sudo -u ghostterm /usr/local/bin/ghostterm-backup.sh'
```

### 列出备份

```bash
ssh atlas 'ls -lh /var/backups/ghostterm/'
```

### 从加密 pg_dump 恢复（灾难恢复）

```bash
# 1. 从 atlas 把 .age 备份拉回 Mac
scp atlas:/var/backups/ghostterm/progress_YYYYMMDD_HHMMSS.sql.gz.age ./

# 2. Mac 本地 age 解密（私钥在 ~/Documents/ghostterm-secrets/）
age -d -i ~/Documents/ghostterm-secrets/age-key.txt \
    progress_YYYYMMDD_HHMMSS.sql.gz.age > progress_dump.sql.gz

# 3. 上传明文 dump 回 atlas（仅在恢复窗口存在，恢复完即删）
scp progress_dump.sql.gz atlas:/tmp/

# 4. 停服务 + 恢复
ssh atlas 'sudo systemctl stop ghostterm-server && \
           sudo -u postgres dropdb progress && \
           sudo -u postgres createdb progress && \
           sudo -u postgres bash -c "gunzip -c /tmp/progress_dump.sql.gz | psql progress" && \
           rm /tmp/progress_dump.sql.gz'

# 5. 重建 progress_app 角色 grants（pg_dump 不带 ACL）
ssh atlas 'sudo -u postgres psql -d progress <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO progress_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO progress_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO progress_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO progress_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO progress_app;
SQL'

# 6. JIT off + 启服务
ssh atlas 'sudo -u postgres psql -d progress -c "ALTER ROLE progress_app SET jit = off"'
ssh atlas 'sudo systemctl start ghostterm-server'
```

## 监控与故障恢复

### 健康检查失败

```bash
# 1. 服务状态
ssh atlas 'sudo systemctl status ghostterm-server --no-pager'

# 2. 最近错误
ssh atlas 'sudo journalctl -u ghostterm-server -n 30 --no-pager | grep -iE "error|fail|panic"'

# 3. DB 连接
ssh atlas 'sudo -u postgres psql -d progress -c "SELECT 1"'

# 4. Caddy listen
ssh atlas 'sudo ss -tnlp | grep -E ":38080|:18080"'

# 5. 前端 Tauri 报 reqwest send failed → 必先看实际目标 IP（参考 memory）
#    surge-cli dump request | grep ghostterm  (Mac 装了 Surge/Clash 时)
```

### Caddy 配置变更（admin off 不能 reload）

Caddyfile `admin off` 关闭了 `127.0.0.1:2019` admin API，`systemctl reload caddy` 必失败（"connection refused localhost:2019"）。**必须 restart 不能 reload**：

```bash
# 改完 /etc/caddy/Caddyfile 后
ssh atlas 'sudo caddy validate --config /etc/caddy/Caddyfile'  # 先验证
ssh atlas 'sudo systemctl restart caddy'                        # 再 restart
```

### Caddy 自签证书重签（过期 / 客户端 cert pinning 强制升级 / SAN/CN 调整）

**重签命令必带 3 个 ext** 否则 rustls webpki 拒（详见 `feedback_rustls_self_signed_cert_must_be_ca_false_with_server_auth_eku.md`）：

```bash
ssh atlas '
  sudo cp -p /etc/ghostterm/cert.pem /etc/ghostterm/cert.pem.bak.$(date +%Y%m%d-%H%M%S);
  sudo cp -p /etc/ghostterm/key.pem  /etc/ghostterm/key.pem.bak.$(date +%Y%m%d-%H%M%S);
  sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /etc/ghostterm/key.pem \
    -out /etc/ghostterm/cert.pem \
    -subj "/CN=103.236.85.144" \
    -addext "subjectAltName=IP:103.236.85.144,IP:127.0.0.1,DNS:localhost" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth";
  sudo chown caddy:caddy /etc/ghostterm/cert.pem /etc/ghostterm/key.pem;
  sudo chmod 644 /etc/ghostterm/cert.pem;
  sudo chmod 640 /etc/ghostterm/key.pem;
  sudo systemctl restart caddy'
```

**重签后必跑客户端同步**（Tauri 编内 cert pinning，旧 client 无法连）：

```bash
# Mac 本地：拉回 cert + 替换编内 + cargo rebuild Tauri + 发布新版本强制升级
ssh atlas 'sudo cat /etc/ghostterm/cert.pem' > src-tauri/certs/atlas-ip.pem

# 验证（严格模式不 -k 应能 200，不通则 client 也连不上）
curl --cacert src-tauri/certs/atlas-ip.pem https://103.236.85.144:38080/healthz

# bump 版本号 4 处 → push tag → tauri-action 自动 build dmg/msi → 通知用户升级
```

## 应急访问通道

| 场景 | 入口 |
|------|------|
| SSH 不通（fail2ban / 防火墙拦本地出口 IP） | 1. 切手机热点（出口 IP 变运营商池）；2. 服务商面板 web 终端 / VNC（带外通道）；3. 主机商防火墙白名单加当前 IP |
| sshd 损坏 | 服务商 web 终端 → 修复 + 重启 ssh.service |
| 整个实例失联 | 服务商面板「快照 / 备份」回滚到上次备份点 |
| Mac 本地诊断 reqwest 异常 | 先 `surge-cli dump request` / `lsof -iTCP -p $(pgrep ghostterm)` 看 socket 真实目标 IP，确认是否被本地代理（Surge/Clash）接管 |

> **TODO**：补具体供应商名称 + 面板 URL + 应急联系方式。当前部署归属未在文档中固化，运维交接时必须由当前所有者口述。

## 已知约束

1. **Caddy admin API off** → `systemctl reload caddy` 必失败，配置变更必须 `restart`（短暂 < 1s 中断）
2. **Tauri WebView 自签证书** → `client.ts doFetch` 通过 `http_request_cmd` 调用 Rust `reqwest` 转发（编内 cert pinning，关闭公共 CA bundle）
3. **WebSocket（Phase 12 通知功能）** → 仍走 WebView 原生 WebSocket，wss:// 自签证书同问题；待 Tauri Rust + tokio-tungstenite + tauri::event bridge 实现
4. **secrets 在 boot 后即解密注入 tmpfs** → `/etc/ghostterm/credentials/*.cred` 是加密文件，磁盘快照拿到无法解密；但 service 重启会重新读 → 备份机制必须保留 Mac 端 `~/Documents/ghostterm-secrets/` 的 age + credentials 明文（未上链）
5. **systemd LoadCredentialEncrypted 仅当前 boot 周期可用** → 移机 / 换主机时旧 .cred 文件作废，必须用新主机的 systemd-creds 重新加密注入
6. **GlitchTip 6.x ↔ @sentry/react 版本兼容窗口窄** → 必锁 `@sentry/react@^8`（v8 LTS）；v10 envelope header `event_id` 空字符串触发 GlitchTip pydantic UUID parser 422 拒（详见 memory `feedback_glitchtip_61_incompat_sentry_javascript_v10_must_downgrade_v8_lts`）
7. **macOS WKWebView ATS 拒明文 http** → GlitchTip envelope 走 `http://103.236.85.144:38090` 在 production 通过 `src-tauri/Info.plist` NSAppTransportSecurity 例外允许；**dev 模式不 embed Info.plist**，开发者本地 dev 跑 sentry 不上报，错误看 cargo stderr / webview console 兜底
8. **GlitchTip 中文化资产非持久化** → 中文 dist 通过 `docker cp` 进 web 容器 RW 层，`docker compose down/up` 或 `force-recreate` 必丢；**`restart` 才保留**；envelope 上报始终走 `/api/*/envelope/` 不受 web 控制台影响（即使 SPA 404 SDK 仍能正常上报）；持久化方案见 memory `reference_glitchtip_zh_hans_i18n_deployment_runbook.md`「持久化路径」章节（自定义 Dockerfile + docker save/load）尚未做

## 关键 Bug 修复记录

| 日期 | 问题 | 修复 |
|------|------|------|
| 2026-05-04 | Login 直接 INSERT refresh_tokens 违反 0002_rls.sql 设计（dockertest 假绿） | migration 0019_issue_refresh_token_function：CREATE FUNCTION SECURITY DEFINER OWNER progress_rls_definer；改 auth_service.go 调函数 |
| 2026-05-04 | 部分 view 查询触发 PG JIT 反优化（与 0006/0011/0012 progress timeline view 含 `jsonb_agg + RLS` 相关） | `ALTER ROLE progress_app SET jit = off`（角色级配置永久生效） |
| 2026-05-09 | atlas 自签证书 `basicConstraints=CA:TRUE` 让 reqwest rustls webpki 拒 `InvalidCertificate(CaUsedAsEndEntity)`，所有 v0.6.x client 登录失败 | 重签证书 `CA:FALSE` + `serverAuth` EKU + `digitalSignature,keyEncipherment` keyUsage；编内 `src-tauri/certs/atlas-ip.pem` 同步；Tauri client v0.7.0 强制升级 |
| 2026-05-09 | 旧 atlas `43.132.191.253` 资源回收，新 IP `103.236.85.144` 上线 | 全仓 IP 替换：`.env.production` / `tauri.conf.json` CSP / `~/.ssh/config` HostName / 本文档；client cert pinning fingerprint 同步 |
| 2026-05-09 | GlitchTip 6.1 + `@sentry/react` v10 envelope header `event_id=""` 让 GlitchTip pydantic UUID parser 422 拒，"dmg 第一次上报后续不上报" | 降级 `@sentry/react` v10.52→v8.55.2 LTS；GlitchTip 6.x 接 SDK 必锁 v8（详见 memory `feedback_glitchtip_61_incompat_sentry_javascript_v10_must_downgrade_v8_lts`）|
| 2026-05-09 | GlitchTip 监控接入 v0.7.1 + Tauri Info.plist NSAppTransportSecurity ATS 例外 | 三侧 SDK 接入：前端 `@sentry/react@^8` + Tauri `sentry@^0.48`（rustls features）+ atlas Go `sentry-go v0.46.2`；DSN `http://d37cfb...e@103.236.85.144:38090/1`（atlas Go 用 127.0.0.1 同机 loopback）；ATS 例外仅 production .app bundle 生效，dev 模式 sentry 不上报 |
| 2026-05-09 | GlitchTip 中文化 fork build 部署后 web 控制台 `/zh-Hans/static/*` 全 404 | Angular 21 `--localize` build 把 dist 内 `index.html` 的 `<base href>` 写死成 `/zh-Hans/`，但 GlitchTip 单一 locale serve 在根 `/`，浏览器拼出 `/zh-Hans/static/main-X.js` 全 404；修法：tar 前 `sed 's\|<base href="/zh-Hans/"/>\|<base href="/"/>\|g' index.html`；同时 docker cp 必须 4 处（`/code/dist/` + `/code/dist/glitchtip-frontend/` + `/code/static/glitchtip-frontend/` + **`/code/static/` STATIC_ROOT**）原 runbook 漏第 4 处让 main-X.js 仍 404；macOS tar 必带 `COPYFILE_DISABLE=1` 防 `._*` AppleDouble 文件污染 collectstatic 权限；详见 memory `reference_glitchtip_zh_hans_i18n_deployment_runbook.md` |

## 性能调优 — PG JIT 角色级关闭（部署后必跑）

PostgreSQL 16 默认开 JIT；GhostTerm 的 progress timeline view 含 `jsonb_agg + LEFT JOIN + RLS`，JIT 编译开销远超执行时间，反让查询慢 2-3 个数量级。

部署后**必跑**一次：

```bash
ssh atlas 'sudo -u postgres psql -d progress -c "ALTER ROLE progress_app SET jit = off"'
ssh atlas 'sudo systemctl restart ghostterm-server'
```

验证：

```bash
ssh atlas "sudo -u postgres psql -d progress -c \"SELECT rolconfig FROM pg_roles WHERE rolname = 'progress_app'\""
# 期待：{jit=off}
```

详见 memory `feedback_pg_jit_anti_optimization_with_rls_view_diagnose.md`。

## 性能诊断 runbook — 慢请求双侧观测

**永远先看服务端 access log**，不要从客户端 DevTools Network 直接归因服务端：

```bash
# 看最近响应时间分布
ssh atlas 'sudo journalctl -u ghostterm-server --since "5 minutes ago" --no-pager | grep -oE "in [0-9.]+(ms|s)" | sort | uniq -c | sort -rn | head -20'

# 看具体慢请求
ssh atlas 'sudo journalctl -u ghostterm-server -n 100 --no-pager | grep -E "in [0-9]+\.[0-9]+s"'

# Caddy access log（含完整 URL + status + 耗时）
ssh atlas 'sudo tail -100 /var/log/caddy/ghostterm.log | jq -c "select(.duration | tonumber > 1)"'
```

| 服务端 log | 客户端 Network | 真因 |
|-----------|---------------|------|
| 快（<300ms）| 慢（>1s） | 客户端 reqwest cold start / TLS handshake / Tauri IPC 开销 / **本地代理软件接管**（Surge/Clash fake-IP relay） |
| 慢（>1s） | 慢（>1s） | DB 查询 / RLS / N+1 / lock |
| 快 | 快 | 没问题 |

详见 memory `feedback_perf_diagnosis_check_server_log_before_blaming_client_or_db.md` + `feedback_macos_tauri_dev_network_diag_must_check_actual_target_first.md`。

## Secrets 索引（位置参考，不含值）

- **Mac**：`~/Documents/ghostterm-secrets/`（chmod 600）
  - `age-key.txt`：age 私钥，解 atlas backup 用
  - `credentials/*.cred` 明文备份：迁机时用 systemd-creds 在新主机重新加密
  - `atlas-server.env` 备份（如有）
- **服务端 `/etc/ghostterm/credentials/*.cred`**（systemd LoadCredentialEncrypted，TPM 派生）
  - `jwt_access.cred`：JWT_ACCESS_SECRET
  - `jwt_refresh.cred`：JWT_REFRESH_SECRET
  - `database_url.cred`：DATABASE_URL（含密码）
  - `data_key.cred`：应用层数据加密 key
- **服务端 `/etc/ghostterm/server.env`**（chmod 640 root:ghostterm，非敏感）
  - `HTTP_ADDR=127.0.0.1:18080`、`JWT_*_TTL`、`BCRYPT_COST`、`FILE_*`、`RATE_LIMIT_*`、`TRUSTED_PROXIES`、`ALLOWED_ORIGINS`
- **管理员账号**：`admin / admin123`（migration 0001 seed bcrypt hash 写死，密码丢失时按 `reference_atlas_admin_password_reset_runbook.md` 重置）

## 文档待补清单

- 服务商面板入口 + 应急联系方式（取代旧文档腾讯云特有章节）
- migrations 的实际部署流程（当前推断 `/opt/ghostterm/src/` git pull + `migrate -path ...`，需 verify deploy/ 脚本细节）
- 备份保留策略具体配置（参考 `server/deploy/backup.sh`，需 review 与 systemd timer 是否一致）
- jwt_access.cred / jwt_refresh.cred 在 atlas `/etc/ghostterm/credentials/` 缺失情况说明（boot 时已注入 tmpfs 故服务运行不受影响，但下次 reboot 必挂；运维交接前必须修）

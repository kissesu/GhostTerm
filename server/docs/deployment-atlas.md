# Atlas 服务器部署 Runbook

GhostTerm progress-server 部署到腾讯云轻量服务器 atlas（香港地域）的完整运维文档。

- **服务器**：腾讯云轻量 lhins-pjvakthr，香港二区
- **公网 IP**：43.132.191.253
- **SSH**：`ssh atlas`（端口 22022，root + ed25519 密钥）
- **HTTPS**：`https://43.132.191.253:38080`（自签 IP 证书）
- **客户端**：GhostTerm Tauri 桌面应用通过 Rust reqwest 转发（绕过 WebView 自签证书限制）

> 备案接入未在腾讯云，**atlas.xanlan.cn 域名 443 端口被 VPC 拦**。当前部署用 IP 直连 + 自签证书 + Tauri Rust 代理。

## 部署架构

```
Tauri client (Mac/Windows)
  ↓ invoke('http_request_cmd', ...)  -- 绕过 WebView SSL 校验
Rust reqwest (.danger_accept_invalid_certs)
  ↓ HTTPS :38080
Caddy (atlas) [tls /etc/caddy/certs/ip-self.{pem,key}]
  ↓ reverse_proxy 127.0.0.1:18080
progress-server (systemd unit)
  ↓ DATABASE_URL postgres_app@localhost:5432/progress
PostgreSQL 16 (apt) + 19 migrations + RLS FORCE
```

## 启停 / 状态

```bash
ssh atlas

# 查状态
sudo systemctl status progress-server caddy postgresql

# 重启 progress-server
sudo systemctl restart progress-server

# 重载 Caddy 配置（不停服）
sudo systemctl reload caddy

# 健康检查
curl -sk https://127.0.0.1:38080/healthz
# 期待: {"db":"ok","status":"ok"}
```

## 日志

```bash
# progress-server
sudo journalctl -u progress-server -n 50 --no-pager
sudo journalctl -u progress-server -f                 # 实时

# Caddy（含 access log）
sudo journalctl -u caddy -n 50 --no-pager

# PostgreSQL
sudo journalctl -u postgresql -n 50 --no-pager

# 备份日志
sudo tail -f /var/log/ghostterm-backup.log
```

## 关键路径

| 路径 | 说明 |
|------|------|
| `/usr/local/bin/progress-server` | Go binary（Mac cross-compile linux/amd64） |
| `/etc/ghostterm/server.env` | 环境变量（PASSWORD/JWT secrets，640 root:ghostterm） |
| `/etc/systemd/system/progress-server.service` | systemd unit |
| `/var/lib/ghostterm/migrations/` | golang-migrate SQL 文件 |
| `/var/lib/ghostterm/files/` | 用户上传文件存储 |
| `/etc/caddy/Caddyfile` | Caddy 配置 |
| `/etc/caddy/certs/ip-self.{pem,key}` | 自签 IP 证书（CN=43.132.191.253，10 年有效） |
| `/var/backups/ghostterm/` | daily pg_dump + weekly configs + weekly files |
| `/etc/cron.d/ghostterm-backup` | 每天 03:00 自动备份 |
| Mac `~/Documents/ghostterm-secrets/atlas-progress-server.env` | secrets 备份（PG_PASS / JWT secrets） |

## 端口

| 端口 | 用途 | 防火墙 |
|------|------|--------|
| 22022 | SSH（自定义非常用端口） | 已开 0.0.0.0/0 |
| 38080 | Caddy HTTPS（公网入口） | 已开 0.0.0.0/0 |
| 18080 | progress-server HTTP（内部，仅 127.0.0.1 listen） | 不公开 |
| 5432 | PostgreSQL（仅 localhost） | 不公开 |

## 升级 progress-server（Mac → atlas）

```bash
# Mac 本地
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm/server
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /tmp/progress-server-linux ./cmd/server

# scp + 替换 + restart
scp /tmp/progress-server-linux atlas:/tmp/progress-server-linux
ssh atlas 'sudo systemctl stop progress-server && \
           sudo mv /tmp/progress-server-linux /usr/local/bin/progress-server && \
           sudo chmod 755 /usr/local/bin/progress-server && \
           sudo systemctl start progress-server && \
           sleep 2 && \
           curl -sk https://127.0.0.1:38080/healthz'
```

## 应用新 migration

```bash
# Mac 本地写好 server/migrations/00XX_*.up.sql 和 00XX_*.down.sql
scp server/migrations/00XX_*.sql atlas:/tmp/
ssh atlas 'sudo mv /tmp/00XX_*.sql /var/lib/ghostterm/migrations/ && \
           sudo chown postgres:postgres /var/lib/ghostterm/migrations/00XX_* && \
           sudo -u postgres /usr/local/bin/migrate \
             -path /var/lib/ghostterm/migrations \
             -database "postgres://postgres@/progress?host=/var/run/postgresql&sslmode=disable" \
             up'
```

## 备份与恢复

### 手动触发备份

```bash
ssh atlas 'sudo /usr/local/bin/ghostterm-backup.sh'
```

### 列出备份

```bash
ssh atlas 'ls -lh /var/backups/ghostterm/'
```

### 从 pg_dump 恢复（灾难恢复）

```bash
# 1. 停服务
ssh atlas 'sudo systemctl stop progress-server'

# 2. 恢复（注意：会覆盖现有数据）
ssh atlas 'sudo -u postgres dropdb progress && \
           sudo -u postgres createdb progress && \
           sudo -u postgres bash -c "gunzip -c /var/backups/ghostterm/progress_YYYY-MM-DD.sql.gz | psql progress"'

# 3. 重建 progress_app 角色 grants（恢复忽略 ACL）
ssh atlas 'sudo -u postgres psql -d progress <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO progress_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO progress_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO progress_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO progress_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO progress_app;
SQL'

# 4. 重启服务
ssh atlas 'sudo systemctl start progress-server'
```

### 备份保留策略

| 类型 | 频率 | 保留 |
|------|------|------|
| pg_dump | 每天 03:00 | 14 天滚动 |
| configs（systemd unit / Caddyfile / certs / migrations） | 每周一 03:00 | 60 天 |
| files（用户上传文件） | 每周日 03:00 | 30 天 |

## 监控与故障恢复

### 健康检查失败

```bash
# 1. 检查 progress-server
ssh atlas 'sudo systemctl status progress-server'

# 2. 看最近错误
ssh atlas 'sudo journalctl -u progress-server -n 30 --no-pager | grep -iE "error|fail"'

# 3. 检查 DB 连接
ssh atlas 'sudo -u postgres psql -d progress -c "SELECT 1"'

# 4. 检查 Caddy listen
ssh atlas 'sudo ss -tnlp | grep -E ":38080|:18080"'
```

### Caddy 自签证书过期（10 年后）

```bash
# 重新签 cert（CN + IP SAN + DNS:localhost）
ssh atlas 'sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /etc/caddy/certs/ip-self.key \
  -out /etc/caddy/certs/ip-self.pem \
  -subj "/CN=43.132.191.253" \
  -addext "subjectAltName=IP:43.132.191.253,IP:127.0.0.1,DNS:localhost" && \
  sudo chown caddy:caddy /etc/caddy/certs/ip-self.* && \
  sudo chmod 644 /etc/caddy/certs/ip-self.pem && \
  sudo chmod 600 /etc/caddy/certs/ip-self.key && \
  sudo systemctl reload caddy'
```

## 应急访问通道

| 场景 | 入口 |
|------|------|
| SSH 不通 | 腾讯云控制台「OrcaTerm 免密登录」（带外通道，不依赖 22022） |
| sshd 损坏 | OrcaTerm 网页终端 → 修复 + 重启 ssh.service |
| 整个实例失联 | 控制台「快照」回滚到上次备份点 |
| CWP 临时 ban Mac IP | 等 30 分钟自动解 / 控制台「主机安全」加白名单 / 切手机热点 |

## 已知约束

1. **域名 atlas.xanlan.cn 接入备案不在腾讯云** → 国内访问 443 被 VPC 拦；当前用 IP 直连 38080 绕开
2. **Tauri WebView 自签证书** → client.ts doFetch 通过 `http_request_cmd` 调用 Rust reqwest 转发
3. **WebSocket（Phase 12 通知功能）** → 仍走 WebView 原生 WebSocket，wss:// 自签证书 同问题；待 Tauri Rust + tokio-tungstenite + tauri::event bridge 实现
4. **文件上传 multipart** → client.ts doFetch 当前 Tauri 分支不支持 FormData；上传失败需要重写
5. **腾讯云 hairpin NAT 不支持** → 服务端访问自己公网 IP 超时；自检用 127.0.0.1

## 关键 Bug 修复记录

| 日期 | 问题 | 修复 |
|------|------|------|
| 2026-05-04 | Login 直接 INSERT refresh_tokens 违反 0002_rls.sql 设计（dockertest 假绿） | 新 migration 0019_issue_refresh_token_function：CREATE FUNCTION SECURITY DEFINER OWNER progress_rls_definer；改 auth_service.go:206 调函数 |
| 2026-05-04 | 部分 view 查询触发 PG JIT 反优化（与 0006/0011/0012 progress timeline view 含 jsonb_agg + RLS 相关）| `ALTER ROLE progress_app SET jit = off`（角色级配置永久生效） |

## 性能调优 — PG JIT 角色级关闭（部署后必跑）

PostgreSQL 16 默认开 JIT；GhostTerm 的 progress timeline view 含 `jsonb_agg + LEFT JOIN + RLS`，JIT 编译开销远超执行时间，反让查询慢 2-3 个数量级。

部署后**必跑**一次：
```bash
ssh atlas 'sudo -u postgres psql -d progress -c "ALTER ROLE progress_app SET jit = off"'
ssh atlas 'sudo systemctl restart progress-server'
```

验证：
```bash
ssh atlas 'sudo -u postgres psql -d progress -c "SELECT rolconfig FROM pg_roles WHERE rolname = '\''progress_app'\''"'
# 期待：{jit=off}
```

详见 memory `feedback_pg_jit_anti_optimization_with_rls_view_diagnose.md`。

## 性能诊断 runbook — 慢请求双侧观测

**永远先看服务端 access log**，不要从客户端 DevTools Network 直接归因服务端：

```bash
# 看最近响应时间分布
ssh atlas 'sudo journalctl -u progress-server --since "5 minutes ago" --no-pager | grep -oE "in [0-9.]+(ms|s)" | sort | uniq -c | sort -rn | head -20'

# 看具体慢请求
ssh atlas 'sudo journalctl -u progress-server -n 100 --no-pager | grep -E "in [0-9]+\.[0-9]+s"'
```

| 服务端 log | 客户端 Network | 真因 |
|-----------|---------------|------|
| 快（<300ms）| 慢（>1s） | 客户端 reqwest cold start / TLS handshake / Tauri IPC 开销 |
| 慢（>1s） | 慢（>1s） | DB 查询 / RLS / N+1 / lock |
| 快 | 快 | 没问题 |

详见 memory `feedback_perf_diagnosis_check_server_log_before_blaming_client_or_db.md`。

## Secrets 索引（位置参考，不含值）

- **Mac**：`~/Documents/ghostterm-secrets/atlas-progress-server.env`（chmod 600）
  - `PG_PASS`、`JWT_ACCESS`、`JWT_REFRESH`、`HTTP_ADDR`
- **服务端**：`/etc/ghostterm/server.env`（chmod 640 owner=root:ghostterm）
  - `DATABASE_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`HTTP_ADDR=127.0.0.1:18080` 等
- **管理员账号**：admin / admin123（migration 0001 seed，**生产部署后立即改密码**）

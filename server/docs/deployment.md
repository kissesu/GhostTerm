# 进度模块部署 Runbook

GhostTerm 进度模块生产部署指南。

> 路径约定：本文档所有相对路径以仓库根 `GhostTerm/` 为基准。

## 1. 架构总览

```
[Caddy/nginx] ─ HTTPS ─→ [progress-server :8080] ─ pgx ─→ [Postgres 16]
                              │                              │
                              │                              └─ progress_app (NOBYPASSRLS)
                              │                                 progress_rls_definer (BYPASSRLS, NOLOGIN)
                              │
                              ├─ Notification outbox worker (2s tick)
                              └─ DeadlineChecker (30min tick)
```

## 2. 生产 docker-compose 模板

```yaml
# /opt/ghostterm/docker-compose.prod.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_root_password
      POSTGRES_DB: progress
    volumes:
      - pgdata:/var/lib/postgresql/data
    secrets:
      - pg_root_password
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 5s
      retries: 12

  migrate:
    image: migrate/migrate:v4.19.1
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./migrations:/migrations:ro
    command: >
      -path=/migrations
      -database=postgres://postgres:${PG_ROOT_PW}@postgres:5432/progress?sslmode=disable
      up
    restart: "no"

  progress-server:
    image: ghostterm/progress-server:1.0.0
    depends_on:
      migrate:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: postgres://progress_app:${PG_APP_PW}@postgres:5432/progress?sslmode=disable
      HTTP_ADDR: ":8080"
      JWT_ACCESS_TTL: 15m
      JWT_REFRESH_TTL: 168h
      BCRYPT_COST: "12"
      FILE_STORAGE_PATH: /var/lib/ghostterm/files
      FILE_MAX_SIZE_MB: "100"
    secrets:
      - jwt_access_secret
      - jwt_refresh_secret
    volumes:
      - filedata:/var/lib/ghostterm/files
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 10s
      retries: 6

secrets:
  pg_root_password:
    external: true
  jwt_access_secret:
    external: true
  jwt_refresh_secret:
    external: true

volumes:
  pgdata:
  filedata:
```

> 注：`progress_app` 角色由 0001 migration 自动创建（NOBYPASSRLS），但**无密码**。
> 生产部署在 migrate 完成后单独执行：
> ```sql
> ALTER ROLE progress_app PASSWORD '<from secrets>';
> ```

## 3. 迁移 runbook

```bash
# 上线时升级 schema：
DATABASE_URL='postgres://postgres:...@host:5432/progress?sslmode=disable'
migrate -path ./migrations -database "$DATABASE_URL" up

# 回滚到指定版本（需要 down 文件齐全；生产慎用）：
migrate -path ./migrations -database "$DATABASE_URL" down 1

# 查询当前版本：
migrate -path ./migrations -database "$DATABASE_URL" version
```

> **绝不**在 server 二进制启动时跑迁移；保留 migrate CLI 单独执行可避免重启副作用。

## 4. 备份策略

```bash
# 每日 04:00 全量 + WAL 归档（pg_basebackup 路径，按需）
pg_dump -U postgres -Fc -d progress -f /backup/progress-$(date +%F).dump

# 文件存储（FILE_STORAGE_PATH）建议挂载在独立卷上，
# 用 rclone / restic 同步到对象存储；保留 30 天 + 周快照永久。
```

恢复：
```bash
pg_restore -U postgres -d progress_restore /backup/progress-2026-04-29.dump
```

## 5. 监控与日志

| 信号 | 推荐采集方式 |
|---|---|
| HTTP 5xx 率 | server stdout 含 chi.Logger 行；ship 到 Loki/CloudWatch |
| `/healthz` 503 | 反代上游剔除 + alerting webhook |
| 通知 outbox 积压 | `SELECT count(*) FROM notifications WHERE delivered_at IS NULL AND created_at < now()-interval '1 minute'` |
| Deadline 通知错误 | server stderr `deadline checker error: ...` |
| WS 连接数 | `WSHub.TotalUsers()`（暂未导出 metric，监控可走 `pg_stat_activity` 看 ws_tickets 消费） |

> 接入完整 Prometheus 暴露在 v1.1 路线上，v1 用 stderr/stdout 即可。

## 6. 回滚流程

1. **定位错误版本**：`docker image ls ghostterm/progress-server` 找上一个 tag
2. **修改 compose**：`image: ghostterm/progress-server:<previous>`
3. **重启**：`docker compose up -d progress-server`
4. **验证**：`curl https://<host>/healthz` 返回 200，前端登录测试
5. **schema 回滚（仅当 migration 引入兼容性问题）**：
   - 先 `docker compose stop progress-server`
   - `migrate ... down N`（N=不兼容的迁移数）
   - 启回 server 旧版本
   - 修复后再前进；`up` 不应跨过被 down 的版本

## 7. 安全注意

- `progress_app` 必须 NOBYPASSRLS（0001 migration 已创建为 NOBYPASSRLS）
- `progress_rls_definer` 必须 NOLOGIN（仅作为 SECURITY DEFINER 函数 owner）
- JWT 密钥 ≥ 32 字节；生产用 docker secrets 注入而非 env
- 备份文件加密（dump 含 token_hash 等敏感数据）
- 定期 audit `SELECT rolname, rolsuper, rolbypassrls FROM pg_authid` 防止人为升权

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| `/healthz` 503 | DB pool ping 失败：检查 `progress_app` 密码 / 连接池满 / Postgres 网络 |
| WS 连不上 | 检查 nginx/Caddy `Upgrade` header 是否 forward；CheckOrigin 白名单 |
| 通知不推送 | outbox worker 是否在跑（`docker logs progress-server | grep outbox`）；DB delivered_at 是否更新 |
| 文件 500 | `FILE_STORAGE_PATH` 是否可写；磁盘是否满；`files_storage_path_key` 唯一约束冲突（同 sha256） |

> **已知 v1 限制**：相同 sha256 内容的二次上传会因 `files.storage_path UNIQUE` 失败。
> 修复方向：service 层先 SELECT 是否已有同 storage_path，已有则复用 file 行而不重新 INSERT。
> v1 在 migrate 与 client UX 上避免（filename 加时间戳）。

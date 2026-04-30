# GhostTerm 进度模块 — Backend (Go)

进度模块（progress-server）是 GhostTerm 桌面端论文工作室的后端服务，
负责客户/项目状态机驱动的协作流转 + RBAC + 财务结算 + 实时通知。

## 技术栈

- Go 1.25
- chi (HTTP router) + ogen (OpenAPI 代码生成)
- pgx/v5 + pgxpool（含 NUMERIC text codec）
- Postgres 16（强 RLS：项目可见性、payments 数据隔离）
- gorilla/websocket（实时通知推送）
- golang-migrate/v4（schema 迁移）
- dockertest（集成 + e2e 测试自起容器）
- testify + bcrypt + golang-jwt

## 目录结构

```
server/
├── cmd/server/main.go        # 入口：装配 services + router + 后台 worker
├── internal/
│   ├── api/
│   │   ├── handlers/          # ogen handler 实现（auth/customer/project/...）
│   │   ├── middleware/        # auth + RBAC chi 中间件
│   │   ├── oas/               # ogen 生成代码（不要手改）
│   │   └── router.go          # chi 装配 + 错误信封映射
│   ├── auth/                  # bcrypt + JWT 工具
│   ├── config/                # 配置加载 + Money type
│   ├── cron/                  # DeadlineChecker 后台任务
│   ├── db/                    # 连接池 + GUC + 事务 helper
│   ├── services/              # 9 个业务 service + statemachine
│   └── testutil/              # dockertest postgres helper
├── migrations/
│   ├── 0001_init.up.sql       # 全量 DDL + 角色 + 权限
│   └── 0002_rls.up.sql        # RLS policy + SECURITY DEFINER 函数
├── tests/
│   ├── integration/           # 直调 service 层（per-test postgres）
│   └── e2e/                   # 真实 HTTP/WS（共享 postgres + 编译产物）
├── openapi.yaml               # 单一 spec，前后端 + ogen 共用
└── go.mod
```

## 前置条件

- Go 1.25+
- Docker Desktop / OrbStack（用于本地集成 / e2e 测试）
- pnpm 10（前端 + 监督脚本）

## 本地开发

```bash
# 1. 启 postgres + 自动应用迁移
cd server
docker compose up -d postgres migrate

# 2. 设置开发态环境变量（或拷贝 .env.example → .env）
export DATABASE_URL='postgres://postgres:devpass@localhost:5432/progress?sslmode=disable'
export JWT_ACCESS_SECRET='dev-access-secret-32-bytes-min!!'
export JWT_REFRESH_SECRET='dev-refresh-secret-32-bytes-min!'
export FILE_STORAGE_PATH='./data/files'

# 3. 跑服务
go run ./cmd/server
# → progress-server listening on :8080
```

## 测试命令

```bash
# 单元测试（不需 docker）
go test -short -count=1 ./internal/...

# 集成测试（需要 docker daemon）
go test -count=1 -timeout 600s ./tests/integration/...

# e2e 测试（编译 server + 共享 postgres + 13 个 flow）
go test -count=1 -timeout 900s ./tests/e2e/...
```

## 环境变量

| 变量名 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | Postgres 连接串。生产建议用 `progress_app` 角色（NOBYPASSRLS）。 |
| `JWT_ACCESS_SECRET` | ✓ | — | access token HMAC 密钥，至少 32 字节。 |
| `JWT_REFRESH_SECRET` | ✓ | — | refresh token HMAC 密钥，至少 32 字节。 |
| `HTTP_ADDR` |  | `:8080` | HTTP 监听地址。 |
| `JWT_ACCESS_TTL` |  | `15m` | access token 有效期。`time.Duration` 字面量。 |
| `JWT_REFRESH_TTL` |  | `168h` | refresh token 有效期（7 天）。 |
| `BCRYPT_COST` |  | `12` | bcrypt cost。生产 ≥10；测试 4 节省时间。 |
| `FILE_STORAGE_PATH` |  | `./data/files` | 文件落盘根目录。 |
| `FILE_MAX_SIZE_MB` |  | `100` | 单文件大小上限（MB）。 |

> **配置文件优先级**：`.env`（仅本地开发）< 环境变量。生产部署不依赖 .env。

## 健康检查

- `GET /healthz` → 200 + `{"status":"ok","db":"ok"}`
- DB 连接异常时返回 503 + `{"status":"degraded","db":"<err>"}`

## OpenAPI

- 唯一 spec：`server/openapi.yaml`
- ogen 输出：`server/internal/api/oas/`（自动生成，禁止手改）
- 前端 types：`src/features/progress/api/types.gen.ts`，由 `pnpm gen-progress-types` 生成
- 详细参见 [`server/docs/api.md`](docs/api.md)

## 部署

参见 [`server/docs/deployment.md`](docs/deployment.md)。

## CI

GitHub Actions workflow：`.github/workflows/progress-module-ci.yml`
- lint: tsc + go vet
- frontend-test: vitest
- backend-unit: `go test ./internal/...`
- backend-integration: dockertest postgres
- e2e: 完整 13 个 flow

## 许可

私有，归属 GhostTerm 项目。

# 进度模块 API 文档

## 单一来源：`server/openapi.yaml`

进度模块的 HTTP 接口定义在 `server/openapi.yaml`（OpenAPI 3.0.3）。
所有客户端 SDK / 服务端 handler skeleton / 前端 type 文件均从该 spec 生成，
**不允许手动维护多份**。

## 视图入口

```bash
# 用 redocly / swagger-ui 本地预览
npx @redocly/cli preview-docs server/openapi.yaml
```

## 服务端代码生成

ogen 生成的 server stub 位于 `server/internal/api/oas/`。

```bash
# 在 server/ 目录下重新生成（修改 openapi.yaml 后必跑）
cd server
go generate ./...
# 等价于 ogen --config ogen.yml openapi.yaml
```

> 生成代码标注 "DO NOT EDIT"，禁止手改；改 spec 即可。

## 前端类型生成

前端 TS 类型文件 `src/features/progress/api/types.gen.ts` 由 spec 生成。

```bash
pnpm gen-progress-types
```

CI 中会校验 spec 与生成产物一致；漂移时 PR 会失败。

## 业务结构

| 模块 | endpoint 前缀 | 关键端点 |
|---|---|---|
| Auth | `/api/auth/*` | login / refresh / logout / me |
| Users (admin) | `/api/users` | list / create / update / delete |
| RBAC | `/api/roles` `/api/permissions` | list + role 权限映射 |
| Customers | `/api/customers` | CRUD |
| Projects | `/api/projects/*` | CRUD + `/events` 状态机驱动 + `/status-changes` 审计 |
| Feedbacks | `/api/projects/{id}/feedbacks` `/api/feedbacks/{id}` | 反馈记录 |
| Files | `/api/files` `/api/projects/{id}/files` | 上传 + 项目附件 + 论文版本 |
| Quote changes | `/api/projects/{id}/quote-changes` | 费用变更 + 当前报价同步 |
| Payments | `/api/projects/{id}/payments` | 收款 + 开发结算 |
| Notifications | `/api/notifications` | List + 标记已读 |
| Earnings | `/api/me/earnings` | 当前用户结算汇总 |
| Dashboard | `/api/dashboard/risks` | 风险总览（临期 / 超期 / 应收） |
| WebSocket | `/api/ws/ticket` `/api/ws/notifications` | 实时通知通道 |

## 状态机

详细见 spec §6.2 与 `server/internal/services/statemachine/transitions.go`。
状态机由 `POST /api/projects/{id}/events` 驱动；每次跳转写一条 `status_change_logs`。

## 错误信封

所有 4xx/5xx 响应统一格式：

```json
{
  "error": {
    "code": "<machine-readable code>",
    "message": "<人类可读描述>"
  }
}
```

`code` 取值见 `openapi.yaml` 中的 `ErrorEnvelopeErrorCode` enum。

## 认证

- 登录返回 access (15min) + refresh (7d) 双 token
- access 通过 `Authorization: Bearer <token>` 头携带
- refresh rotate：每次 refresh 旧 token 立即作废（重放检测）
- WS 不支持 Authorization 头：先 `POST /api/ws/ticket` 拿一次性 ticket，
  再用 `?ticket=...` 升级

## 详细 schema

请直接查阅 `server/openapi.yaml`，IDE 装 OpenAPI 插件后可跳转查看。

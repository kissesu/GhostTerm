/*
@file interfaces.go
@description 进度模块所有 service 的接口定义（Phase 0a 占位）。
             各 service 的具体实现由对应 phase 的 worker 提供，本文件仅声明契约：
             - 谁实现：Phase 4-12 的 worker 各自在 customer_service.go / project_service.go / ... 中实现
             - 谁消费：router 层的 ogen handler，通过依赖注入持有 interface 引用
             - 为什么用 interface：subagent 并行开发时 service 实现可与 handler 编译解耦，
               handler 只依赖接口，避免 worker 之间相互阻塞
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
)

// ============================================================
// 通用类型（DTO 层占位）
//
// 真正的 model 结构体由 internal/models/ 包定义，本文件用 any/interface{}
// 占位避免提前耦合具体字段；各 phase 在实现 service 时把 any 替换为具体 model 类型。
// ============================================================

// SessionContext 携带当前请求的用户身份与权限上下文。
//
// 业务背景：
// - JWT 中间件解析 token 后注入；service 层据此做 RBAC 过滤
// - 字段细节由 Phase 2/3 决定（user_id / role_id / token_version）
type SessionContext = any

// PageQuery 通用分页参数。
type PageQuery struct {
	Limit  int
	Offset int
}

// ============================================================
// AuthService — Phase 2 实现
// ============================================================

// AuthService 负责用户登录、token 签发与刷新。
//
// 实现要点（v2 part2 §W2）：
// - access token 短期（15min）+ refresh token 长期（30d）
// - users.token_version 字段递增用于强制登出
// - logout 不在数据库存 token，靠递增 version 让旧 token 失效
type AuthService interface {
	// Login 邮箱+密码换 access/refresh token
	Login(ctx context.Context, email, password string) (accessToken, refreshToken string, user any, err error)

	// Refresh 用 refresh token 换新 access token，校验 token_version 匹配
	Refresh(ctx context.Context, refreshToken string) (accessToken string, err error)

	// Logout 递增当前用户 token_version，使所有已签发 token 失效
	Logout(ctx context.Context, sc SessionContext) error

	// VerifyAccessToken 中间件用，校验 token 合法性并返回用户上下文
	VerifyAccessToken(ctx context.Context, accessToken string) (SessionContext, error)

	// IssueWSTicket 签发短期（30s）WebSocket 票据，浏览器 WS 不支持 Authorization header
	IssueWSTicket(ctx context.Context, sc SessionContext) (ticket string, expiresAt time.Time, err error)

	// VerifyWSTicket WebSocket 升级时校验票据
	VerifyWSTicket(ctx context.Context, ticket string) (SessionContext, error)
}

// ============================================================
// RBACService — Phase 3 实现
// ============================================================

// RBACService 负责权限判定与 SQL 可见性过滤。
//
// 实现要点（spec §5）：
// - 资源级权限（resource + action + scope）从 role_permissions 表加载
// - 状态触发权限是 Go 硬编码表（见 spec §5.3）
// - 数据可见性靠注入 SQL WHERE 子句（spec §5.4），不用 RLS（v2 改为应用层过滤）
type RBACService interface {
	// HasPermission 判断当前 session 是否拥有指定 resource+action 的权限
	HasPermission(ctx context.Context, sc SessionContext, resource, action string) (bool, error)

	// CanTriggerEvent 判断当前 session 在指定项目状态下能否触发事件（状态触发权限）
	CanTriggerEvent(ctx context.Context, sc SessionContext, projectID int64, eventCode string) (bool, error)

	// VisibilityFilter 返回可注入到 WHERE 子句的 SQL 片段 + 参数（用于 SELECT 列表过滤）
	// 结果如：("created_by = $1 OR holder_user_id = $1", []any{userID})
	VisibilityFilter(ctx context.Context, sc SessionContext, resource string) (sqlFragment string, args []any, err error)

	// ListPermissions 列出系统所有 permission 记录（仅超管）
	ListPermissions(ctx context.Context, sc SessionContext) ([]any, error)

	// ListRoles 列出所有角色
	ListRoles(ctx context.Context, sc SessionContext) ([]any, error)
}

// ============================================================
// CustomerService — Phase 4 (Worker A) 实现
// ============================================================

// CustomerService 客户 CRUD。
type CustomerService interface {
	List(ctx context.Context, sc SessionContext, q PageQuery) ([]any, error)
	Get(ctx context.Context, sc SessionContext, id int64) (any, error)
	Create(ctx context.Context, sc SessionContext, input any) (any, error)
	Update(ctx context.Context, sc SessionContext, id int64, input any) (any, error)
}

// ============================================================
// ProjectService — Phase 5 (Worker B) 实现
// ============================================================

// ProjectService 项目 CRUD + 状态机驱动事件。
//
// 实现要点（v2 part2 §W9）：
// - 状态变更必须在 tx 内：UPDATE projects + INSERT status_change_logs + INSERT notifications 同事务
// - applyStateChange 用列名白名单 + 静态 SQL（禁止 fmt.Sprintf 拼接列名）
// - executeStateChange 出错回滚整个 tx（v2 part2 §W3）
type ProjectService interface {
	List(ctx context.Context, sc SessionContext, statusFilter *string, q PageQuery) ([]any, error)
	Get(ctx context.Context, sc SessionContext, id int64) (any, error)
	Create(ctx context.Context, sc SessionContext, input any) (any, error)
	Update(ctx context.Context, sc SessionContext, id int64, input any) (any, error)

	// TriggerEvent 状态机入口：校验 transition 合法性 → applyStateChange → 写日志 → 发通知
	TriggerEvent(ctx context.Context, sc SessionContext, projectID int64, eventCode string, remark string, newHolderUserID *int64) (any, error)

	// ListStatusChanges 查询项目状态变更日志（按时间正序）
	ListStatusChanges(ctx context.Context, sc SessionContext, projectID int64) ([]any, error)
}

// ============================================================
// FileService — Phase 6 (Worker C) 实现
// ============================================================

// FileService 文件上传/下载 + thesis_versions 管理。
//
// 实现要点（v2 part2 §W5）：
// - thesis_versions 用 (project_id, version_no) 唯一约束 + 应用层 SELECT FOR UPDATE 锁防并发
// - 文件存储路径 /var/lib/progress-server/files/<uuid>，DB 只存元数据
// - MIME 白名单：v1 限制 docx/pdf/png/jpg/zip 等，超出返回 mime_not_allowed
type FileService interface {
	// Upload 接收 multipart 上传，返回文件元数据（含 file_id 和 uuid）
	Upload(ctx context.Context, sc SessionContext, filename string, mimeType string, size int64, body io.Reader) (any, error)

	// Download 流式返回文件内容
	Download(ctx context.Context, sc SessionContext, fileID int64) (filename string, mimeType string, size int64, body io.ReadCloser, err error)

	// ListProjectFiles 列出项目附件（sample_doc / source_code）
	ListProjectFiles(ctx context.Context, sc SessionContext, projectID int64, category *string) ([]any, error)

	// AttachToProject 把已上传文件挂到项目下指定 category（同事务更新 project_files 表）
	AttachToProject(ctx context.Context, sc SessionContext, projectID, fileID int64, category string) (any, error)

	// CreateThesisVersion 上传论文新版（永不覆盖，version_no 自动 +1）
	CreateThesisVersion(ctx context.Context, sc SessionContext, projectID, fileID int64, remark string) (any, error)

	// ListThesisVersions 列出项目的论文版本历史
	ListThesisVersions(ctx context.Context, sc SessionContext, projectID int64) ([]any, error)
}

// ============================================================
// FeedbackService — Phase 7 (Worker D) 实现
// ============================================================

// FeedbackService 客户反馈记录。
//
// 实现要点（v2 part2 §W3）：
// - Create 必须在事务内同时 INSERT notifications（new_feedback 类型给开发者）
// - notification 通过 outbox worker 异步推送（commit 后）
type FeedbackService interface {
	List(ctx context.Context, sc SessionContext, projectID int64) ([]any, error)
	Create(ctx context.Context, sc SessionContext, projectID int64, input any) (any, error)
	UpdateStatus(ctx context.Context, sc SessionContext, feedbackID int64, status string) (any, error)
}

// ============================================================
// QuoteChangeService — Phase 8 (Worker E) 实现
// ============================================================

// QuoteChangeService 项目费用变更（追加 / 修改 / 售后）。
//
// 实现要点：
// - delta 与 new_quote 二选一：append/after_sales 用 delta，modify 用 new_quote
// - 写入 quote_change_logs + UPDATE projects.current_quote 必须同事务
// - 售后变更同时累加 after_sales_total 字段
type QuoteChangeService interface {
	List(ctx context.Context, sc SessionContext, projectID int64) ([]any, error)
	Create(ctx context.Context, sc SessionContext, projectID int64, input any) (any, error)
}

// ============================================================
// PaymentService — Phase 9 (Worker F) 实现
// ============================================================

// PaymentService 收款与开发结算记录。
//
// 实现要点（spec §4.1 + v2 part2 §W3）：
// - direction=customer_in：累加 projects.total_received
// - direction=dev_settlement：必须 related_user_id + screenshot_id（DB CHECK 约束已保护）
//   commit 后给 related_user 发 settlement_received 通知
type PaymentService interface {
	List(ctx context.Context, sc SessionContext, projectID int64) ([]any, error)
	Create(ctx context.Context, sc SessionContext, projectID int64, input any) (any, error)

	// MyEarnings 当前用户收益视图（dev_earnings_view，service 层强制注入 user_id 过滤）
	MyEarnings(ctx context.Context, sc SessionContext) (any, error)
}

// ============================================================
// NotificationService — Phase 12 实现
// ============================================================

// NotificationService 通知 outbox 事务化写入 + 异步推送。
//
// 实现要点（v2 part2 §W3）：
// - Create 接受 tx 参数，与业务操作同事务（避免业务成功但通知丢失）
// - Outbox worker 周期扫描 delivered_at IS NULL 的记录，调用 Hub.SendToUser 推送
// - 推送成功后 UPDATE delivered_at；用户离线时通知保留待下次连接拉取
type NotificationService interface {
	// Create 同事务写入通知（必须返回错误，由调用方决定是否回滚）
	Create(ctx context.Context, tx pgx.Tx, input any) error

	// List 当前用户通知列表，可按 unreadOnly 过滤
	List(ctx context.Context, sc SessionContext, unreadOnly bool) ([]any, error)

	// MarkRead 单条标记
	MarkRead(ctx context.Context, sc SessionContext, notificationID int64) error

	// MarkAllRead 全部标记
	MarkAllRead(ctx context.Context, sc SessionContext) error

	// FlushOutbox outbox worker 调用，扫描未投递通知并推送给在线连接
	FlushOutbox(ctx context.Context) error
}

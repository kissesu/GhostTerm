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
	// Login username+密码换 access/refresh token
	Login(ctx context.Context, username, password string) (accessToken, refreshToken string, user any, err error)

	// Refresh 用 refresh token 换新 access token，校验 token_version 匹配
	Refresh(ctx context.Context, refreshToken string) (accessToken string, err error)

	// Logout 递增当前用户 token_version，使所有已签发 token 失效
	Logout(ctx context.Context, sc SessionContext) error

	// VerifyAccessToken 中间件用，校验 token 合法性并返回用户上下文
	VerifyAccessToken(ctx context.Context, accessToken string) (SessionContext, error)

	// Me 读取当前 session 的用户基础信息（不返回 password_hash / token_version）
	Me(ctx context.Context, sc SessionContext) (any, error)

	// IssueWSTicket 签发短期（30s）WebSocket 票据，浏览器 WS 不支持 Authorization header
	IssueWSTicket(ctx context.Context, sc SessionContext) (ticket string, expiresAt time.Time, err error)

	// VerifyWSTicket WebSocket 升级时校验票据
	VerifyWSTicket(ctx context.Context, ticket string) (SessionContext, error)
}

// ============================================================
// RBACService — Phase 3 实现
// ============================================================

// RBACService 负责"端点级权限判定"。
//
// 设计调整（v2 part1 §C2 vs v1 spec §5.4）：
//   - 数据行可见性：由 Postgres RLS + project_members + helper 函数承担，
//     应用层不再注入 WHERE 可见性子句
//   - 端点级权限：仍由本 service 处理（"能否调用 POST /api/projects" / "能否触发 E10"），
//     与 RLS 正交 —— RLS 决定看不看得见行，RBAC 决定能不能调接口
//
// 实现要点：
//   - 权限"码"约定为 "<resource>:<action>"（如 "project:read"、"customer:create"）
//   - 状态触发事件用 "event:<EventCode>" 命名空间（如 "event:E10"）
//   - `*:*` 通配代表超管（与 0001 migration 预置一致）
//   - role→permset 在内存缓存 5min（sync.Map + timestamp 过期）减少 DB 压力
type RBACService interface {
	// HasPermission 判断 roleID 对应角色是否拥有 perm 编码（"<resource>:<action>"）的权限。
	//
	// userID 仅用于将来扩展（如个人级 ACL）；当前实现仅按 roleID 决策，
	// 但保留参数避免后续接口改动 ripple 到所有 caller。
	HasPermission(ctx context.Context, userID, roleID int64, perm string) (bool, error)

	// CanTriggerEvent 判断当前 session 能否在指定 projectID 上触发 eventCode。
	//
	// 校验链：
	//   1. HasPermission(role, "event:"+eventCode)
	//   2. is_admin (roleID==1) OR project_members 中存在 (projectID, userID) 记录
	//   注：状态机本身的"前置状态-持球者-允许角色"细化校验由 Phase 5 的状态机引擎做
	CanTriggerEvent(ctx context.Context, userID, roleID, projectID int64, eventCode string) (bool, error)

	// VisibilityFilter 返回 SELECT 时可拼到 WHERE 的 SQL 片段。
	//
	// v2 起 RLS 已承担所有行级可见性，本方法保留只为"future-proof"：调用方
	// 永远拿到 "TRUE" + nil（让 SQL 编译器优化掉），实际过滤由 RLS 完成。
	// 不删该方法是因为：handler 层 helper 已习惯调它，删除会引发整片重构 noise。
	VisibilityFilter(ctx context.Context, userID, roleID int64, scope string) (sqlFragment string, args []any, err error)

	// ListPermissions 列出系统所有 permission 行（用于管理 UI / 调试）
	ListPermissions(ctx context.Context) ([]Permission, error)

	// ListRoles 列出所有角色
	ListRoles(ctx context.Context) ([]Role, error)

	// LoadUserPermissions 读取某 roleID 绑定的全部权限码集合（map 用于 O(1) 查询）。
	//
	// 主要用途：
	//   1. /api/auth/me 响应附带用户权限码列表（前端 PermissionGate 使用）
	//   2. JWT claims 预加载（如未来需要把 perms 编进 token，避免重复查 DB）
	LoadUserPermissions(ctx context.Context, roleID int64) (map[string]bool, error)
}

// Permission 是 RBACService.ListPermissions 返回的视图模型。
//
// 字段对齐 0001 migration permissions 表，前端通过 OpenAPI Permission schema 消费。
type Permission struct {
	ID       int64
	Resource string
	Action   string
	Scope    string
}

// Code 返回业务侧使用的权限编码 "<resource>:<action>"。
//
// 业务背景：UI 按 PermissionGate perm="event:E10" 的形式判定权限，
// scope 字段（all/member）用于 RLS 行级控制，不参与 code 拼装。
func (p Permission) Code() string {
	return p.Resource + ":" + p.Action
}

// Role 是 RBACService.ListRoles 返回的视图模型。
type Role struct {
	ID          int64
	Name        string
	Description *string
	IsSystem    bool
	CreatedAt   time.Time
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
//   tx 内调 insert_notification_secure SECURITY DEFINER 函数（migration 0002 §insert_notification_secure），
//   不允许业务层 raw INSERT 绕过权限校验
// - Outbox worker 周期扫描 delivered_at IS NULL 的记录，调用 WSHub.Broadcast 推送
// - 推送成功后 UPDATE delivered_at；用户离线时通知保留待下次连接拉取
type NotificationService interface {
	// Create 同事务写入通知；调用 insert_notification_secure SECURITY DEFINER 函数。
	// projectID 可为 nil（系统级通知，如 settlement_received 不必关联 project）。
	// 返回新建通知的 ID 与完整记录；调用方决定 tx 是否提交。
	Create(
		ctx context.Context,
		tx pgx.Tx,
		userID int64,
		ntype string,
		projectID *int64,
		title, body string,
	) (Notification, error)

	// List 当前用户通知列表，可按 unreadOnly 过滤；limit<=0 时由实现层兜底默认值
	List(ctx context.Context, userID int64, unreadOnly bool, limit int) ([]Notification, error)

	// MarkRead 单条标记
	MarkRead(ctx context.Context, userID, notificationID int64) error

	// MarkAllRead 全部标记
	MarkAllRead(ctx context.Context, userID int64) error

	// FlushOutbox outbox worker 调用，扫描未投递通知并推送给在线连接
	FlushOutbox(ctx context.Context) error
}

// Notification 是通知视图模型，对齐 oas.Notification + DB notifications 列。
//
// 业务背景：service 层不直接返回 oas.Notification 避免反向依赖；
// handler 层做 services.Notification → oas.Notification 转换。
type Notification struct {
	ID          int64
	UserID      int64
	Type        string  // notification_type enum 字符串
	ProjectID   *int64  // 可为 nil
	Title       string
	Body        string
	IsRead      bool
	CreatedAt   time.Time
	ReadAt      *time.Time // 未读时为 nil
	DeliveredAt *time.Time // outbox 已推送时间；nil 表示待推送
}

// WSHub 是 NotificationService 推送通知的下游接口。
//
// 业务背景：
// - 解耦"产生通知"与"推送通道"，让 outbox worker 可以单独测试
// - WSHub 实现挂在 router/main 层，存"在线连接 map<userID, []conn>"
// - Broadcast 失败不阻塞 outbox 写 delivered_at —— 用户离线就保留 nil 让 List 时仍能取到
//
// Phase 12 wireup（ws.go handler）需要 RegisterClient 在升级握手成功后注册连接，
// 因此 RegisterClient 直接进 interface（让 handler 仅依赖 services.WSHub 抽象）。
type WSHub interface {
	// Broadcast 把通知推送给指定用户的所有在线连接；用户离线时返回 ErrNoSubscribers。
	// 实现必须并发安全（多个 goroutine 同时 Broadcast）。
	Broadcast(notification Notification) error

	// RegisterClient 注册一条 WS 连接到指定用户的列表。
	// 返回 deregister 闭包：调用即从 hub 移除该 conn（read loop 检测到断线时调用）。
	// conn 类型用 any 避免 services 包反向依赖 gorilla/websocket；handler 层断言为 *websocket.Conn。
	RegisterClient(userID int64, conn any) func()
}

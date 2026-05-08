/*
@file audit_service.go
@description 安全审计事件写入服务 (finding #20)。
             配套 migration 0027 的 security_audit_log 表 + INSERT-only RULE，
             应用账户被攻陷时攻击者无法清除/伪造审计 trail。

             业务覆盖事件（11 类）：
               login_success / login_failed / logout
               password_changed
               role_changed / user_created / user_disabled
               super_admin_action
               file_downloaded
               refresh_token_reuse_detected
               rate_limit_triggered

             nil 安全：service 实例为 nil 时 Log 短路返 nil（测试场景免注入），
             生产 main.go 必须传非 nil（router 启动期 fail-fast 校验）。

@author Atlas.oi
@date 2026-05-08
*/

package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditEventType 是 security_audit_log.event_type 的合法值。
//
// 业务约束：DB CHECK 约束锁定枚举集合，新增事件类型必须先改 migration。
// 命名遵循 `<noun>_<verb>` snake_case，与 OAS / 前端字典对齐。
type AuditEventType string

// 安全审计事件枚举 —— 与 migration 0027 CHECK 约束 1:1 对齐。
//
// 添加新事件需要 3 步同步（漏一即 DB INSERT 失败）：
//  1. 这里新增常量
//  2. migration 新加 CHECK 值
//  3. 调用方 service 业务路径加 audit.Log
const (
	AuditEventLoginSuccess              AuditEventType = "login_success"
	AuditEventLoginFailed               AuditEventType = "login_failed"
	AuditEventLogoutSuccess             AuditEventType = "logout"
	AuditEventPasswordChanged           AuditEventType = "password_changed"
	AuditEventRoleChanged               AuditEventType = "role_changed"
	AuditEventUserCreated               AuditEventType = "user_created"
	AuditEventUserDisabled              AuditEventType = "user_disabled"
	AuditEventSuperAdminAction          AuditEventType = "super_admin_action"
	AuditEventFileDownloaded            AuditEventType = "file_downloaded"
	AuditEventRefreshTokenReuseDetected AuditEventType = "refresh_token_reuse_detected"
	AuditEventRateLimitTriggered        AuditEventType = "rate_limit_triggered"
)

// AuditEvent 是单条审计事件的输入参数。
//
// 字段语义：
//   - UserID：触发该动作的当前会话用户；登录失败 / 系统事件可为 nil
//   - TargetUserID：被作用的目标用户（创建用户 / 角色变更 / 禁用用户场景）；
//     与 UserID 同时存在表示"actor 对 target 做了某动作"，自动作动作时调用方可只填 UserID
//   - ClientIP：空串视为 NULL（INET 类型不接受空串），由 INSERT 内 NULLIF 转换
//   - UserAgent：直接保存原值，空串入库
//   - Metadata：业务自定义 JSON 字段；nil → '{}' 默认 jsonb（DB DEFAULT 不可省，因为
//     pgx 在 marshal nil map 时会写 NULL 而不是 {}，触发 NOT NULL 约束）
type AuditEvent struct {
	EventType    AuditEventType
	UserID       *int64
	TargetUserID *int64
	ClientIP     string
	UserAgent    string
	Metadata     map[string]any
}

// AuditService 写入 security_audit_log 表。
//
// 设计取舍：
//   - 不返回 *AuditService 的 receiver 方法都加 nil 短路：测试 fixture 不注入也不
//     panic，生产由 main.go fail-fast 保证非 nil（router 启动期 deps.Audit != nil 校验）
//   - 失败策略：DB 写入失败返 error 给 caller；caller 负责"是否阻断业务路径"决策
//     （登录路径建议 log 但不阻断，敏感写路径建议阻断回滚）
type AuditService struct {
	db *pgxpool.Pool
}

// NewAuditService 构造 AuditService。
//
// 业务约束：db 必填；缺失即返回 error 让 main.go fail-fast。
func NewAuditService(db *pgxpool.Pool) (*AuditService, error) {
	if db == nil {
		return nil, errors.New("audit_service: db pool is required")
	}
	return &AuditService{db: db}, nil
}

// Log 写入一条安全审计事件。
//
// 业务流程：
//  1. nil 短路：测试场景 service 未注入时静默返回（不阻断业务）
//  2. Metadata 序列化：nil → []byte("{}")；JSON marshal 失败立即返 error
//  3. INSERT security_audit_log：ClientIP 用 NULLIF($N,”)::INET 转空串为 SQL NULL
//
// 设计取舍：
//   - 用 NULLIF 而不是 services.NullableIP：让 SQL 自带 NULL 转换，调用方不必每次包 helper
//   - UserAgent 空串直接入库：TEXT 列可空串，不需要转 NULL（与 0008 migration 既有列对齐）
//   - 不在事务里：security_audit_log 是独立资源，不参与业务表的 ACID 边界
func (s *AuditService) Log(ctx context.Context, e AuditEvent) error {
	// nil 短路：测试 fixture 不注入 audit service 时跳过写入
	if s == nil {
		return nil
	}

	var metadataJSON []byte
	if e.Metadata == nil {
		metadataJSON = []byte("{}")
	} else {
		b, err := json.Marshal(e.Metadata)
		if err != nil {
			return fmt.Errorf("audit_service: marshal metadata: %w", err)
		}
		metadataJSON = b
	}

	_, err := s.db.Exec(ctx, `
		INSERT INTO security_audit_log
			(event_type, user_id, target_user_id, client_ip, user_agent, metadata)
		VALUES
			($1, $2, $3, NULLIF($4, '')::INET, $5, $6::JSONB)
	`, string(e.EventType), e.UserID, e.TargetUserID, e.ClientIP, e.UserAgent, metadataJSON)
	if err != nil {
		return fmt.Errorf("audit_service: insert audit log: %w", err)
	}
	return nil
}

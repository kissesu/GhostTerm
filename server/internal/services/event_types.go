/*
@file event_types.go
@description 实时同步事件 envelope 定义（spec v3.5 §3）。
             Event 是客户端收到的事件帧 schema，由 EventHub.Publish 时填入 ID；
             Heartbeat 是心跳帧 payload，每 30s 推一次让客户端比较 latestId 检测漏帧。
@author Atlas.oi
@date 2026-05-09
*/

package services

import "time"

// EventType 5 类业务事件枚举（spec v3.5 §3）
type EventType string

const (
	EventProjectCreated         EventType = "project.created"
	EventProjectUpdated         EventType = "project.updated"
	EventRolePermissionsUpdated EventType = "role_permissions.updated"
	EventFeedbackCreated        EventType = "feedback.created"
	EventPaymentCreated         EventType = "payment.created"
)

// Event 客户端收到的事件帧 schema（ID 由 hub 在 Publish 时填）
type Event struct {
	ID            int64     `json:"id"`
	Type          EventType `json:"type"`
	OccurredAt    time.Time `json:"occurredAt"`
	ActorUserID   int64     `json:"actorUserId"`
	Data          any       `json:"data"`
	TargetUserIDs []int64   `json:"-"` // 仅路由用，不序列化给客户端
}

// Heartbeat 心跳帧 payload（每 30s 推一次让客户端比较 latestId 检测漏帧）
type Heartbeat struct {
	LatestID int64 `json:"latestId"`
}

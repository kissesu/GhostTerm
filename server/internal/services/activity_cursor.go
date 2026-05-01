// @file activity_cursor.go
// @description 进度时间线游标实现（at + kind + sourceId 三元组 base64url JSON）
//
// 业务背景：7 张事件表 UNION ALL 后排序，单 timestamp 不安全（同毫秒并发），
// 单 (at, sourceId) 不安全（不同表 BIGSERIAL 可能撞 ID）；三元组才稳定唯一。
//
// @author Atlas.oi
// @date 2026-05-01

package services

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

// ErrInvalidCursor 表示游标解码失败（非法 base64 / json / 缺字段）。
var ErrInvalidCursor = errors.New("services: invalid activity cursor")

// activityCursor 是 timeline 分页游标的内部表示。
// 字段全为必填：缺一项即 ErrInvalidCursor。
type activityCursor struct {
	At       time.Time `json:"at"`
	Kind     string    `json:"kind"`
	SourceID int64     `json:"sourceId"`
}

// encodeCursor 把 cursor 序列化为 base64url JSON 字符串。
// 失败仅在 json.Marshal 失败时（实际不可能，类型固定）。
func encodeCursor(c activityCursor) (string, error) {
	b, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// decodeCursor 解码客户端传来的游标字符串。
// 空字符串返回零值游标 + nil 错误（首页查询）；
// 非法格式 / 缺字段返回 ErrInvalidCursor，handler 层映射为 422。
func decodeCursor(s string) (activityCursor, error) {
	if s == "" {
		return activityCursor{}, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return activityCursor{}, ErrInvalidCursor
	}
	var c activityCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return activityCursor{}, ErrInvalidCursor
	}
	if c.At.IsZero() || c.Kind == "" || c.SourceID <= 0 {
		return activityCursor{}, ErrInvalidCursor
	}
	return c, nil
}

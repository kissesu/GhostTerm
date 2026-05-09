/*
@file auth_test.go
@description AuthHandler 错误响应构造单元测试 —— 验证 finding Info follow-up：
             ErrPasswordNotSet 走 details.reason='password_not_set' 让前端精确识别。
@author Atlas.oi
@date 2026-05-09
*/

package handlers

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// TestPasswordNotSetLoginRes_DetailsReasonPresent 验证 finding Info：
// passwordNotSetLoginRes 必须把 details.reason='password_not_set' 写进 ErrorEnvelope，
// 让前端精确识别"首次设置"场景而无需匹配 message 字符串。
func TestPasswordNotSetLoginRes_DetailsReasonPresent(t *testing.T) {
	res := passwordNotSetLoginRes()
	require.NotNil(t, res)

	// 转回 ErrorEnvelope 检查 code / message / details
	envelope := oas.ErrorEnvelope(*res)
	assert.Equal(t, oas.ErrorEnvelopeErrorCodeUnauthorized, envelope.Error.Code,
		"code 必须是 unauthorized 保持向后兼容")
	assert.Contains(t, envelope.Error.Message, "首次设置",
		"message 仍带 首次设置 关键字作 fallback 文案")

	require.True(t, envelope.Error.Details.IsSet(), "details 必须 set 让前端能取 reason")
	require.False(t, envelope.Error.Details.IsNull(), "details 不应为 null")

	details := envelope.Error.Details.Value
	require.Contains(t, details, "reason", "details 必须含 reason key")
	// details["reason"] 是 jx.Raw（[]byte 别名），原样字节即 JSON 字符串字面量
	// 直接 string() 转换得到 `"password_not_set"`（含双引号）
	assert.Equal(t, `"password_not_set"`, string(details["reason"]),
		"details.reason 必须是 password_not_set 让前端识别首次设置场景")
}

// TestPasswordNotSetSentinelExists 验证 ErrPasswordNotSet 是 services 层公开 sentinel
// —— 防止重构时不小心把 sentinel 删掉让 handler 拿不到。
func TestPasswordNotSetSentinelExists(t *testing.T) {
	require.NotNil(t, services.ErrPasswordNotSet)
	assert.True(t, errors.Is(services.ErrPasswordNotSet, services.ErrPasswordNotSet))
}

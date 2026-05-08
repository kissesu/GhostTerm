/*
@file bodylimit_test.go
@description BodyLimit middleware 单测（finding #14）。
             覆盖 4 类场景：
              1. body 远小于上限正常通过
              2. body 等于上限刚好通过
              3. body 超上限 → ReadAll 返 *http.MaxBytesError
              4. nil body（GET/HEAD 等）不报错
@author Atlas.oi
@date 2026-05-08
*/

package middleware_test

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/api/middleware"
)

func TestBodyLimit_AllowsUnderLimit(t *testing.T) {
	mw := middleware.BodyLimit(100)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Equal(t, "small payload", string(body))
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("small payload"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestBodyLimit_AllowsExactLimit(t *testing.T) {
	mw := middleware.BodyLimit(13) // "small payload" 恰好 13 字节
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err, "等于上限的 body 必须通过")
		assert.Equal(t, "small payload", string(body))
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("small payload"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestBodyLimit_RejectsOverLimit(t *testing.T) {
	mw := middleware.BodyLimit(10)
	var readErr error
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
		if readErr != nil {
			http.Error(w, "too big", http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("this body is way over 10 bytes"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	require.Error(t, readErr, "ReadAll 必须返回错误")
	var maxErr *http.MaxBytesError
	assert.True(t, errors.As(readErr, &maxErr),
		"必须是 *http.MaxBytesError 让 handler 能精确翻译为 413；实际 %v", readErr)
}

func TestBodyLimit_NilBodyPasses(t *testing.T) {
	mw := middleware.BodyLimit(100)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GET/HEAD 请求 r.Body 通常是 http.NoBody（非 nil 但 read 立即 EOF）
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Empty(t, body)
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestBodyLimit_ZeroDisables 验证 maxBytes <= 0 时不限制（兜底场景）。
// 业务背景：调用方传错配置（例如 cfg.FileMaxSizeMB 为 0）时不让请求全 413，
// 上层应该 fail-fast 拒绝该配置；middleware 不做该判断只保证 0 = 不挂限制。
func TestBodyLimit_ZeroDisables(t *testing.T) {
	mw := middleware.BodyLimit(0)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Equal(t, "this body is much longer than zero", string(body))
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("this body is much longer than zero"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

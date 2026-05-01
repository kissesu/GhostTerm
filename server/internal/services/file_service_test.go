/*
@file file_service_test.go
@description FileService 纯逻辑单元测试（不依赖 Postgres）：
             - SanitizeFilename 全部边界 case
             - detectAndValidateMIME 白名单 / 文本 / 拒绝路径
             - ensureUnderRoot 路径遍历兜底
             集成测试（涉及 RLS / 事务）见 server/tests/integration/file_test.go。
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================
// SanitizeFilename
// ============================================================

func TestSanitizeFilename_HappyPath(t *testing.T) {
	cases := map[string]string{
		"report.pdf":              "report.pdf",
		"中文文件名.docx":              "中文文件名.docx",
		"v2 final.zip":            "v2 final.zip",
		"a-b_c.tar.gz":            "a-b_c.tar.gz",
		"thesis-v3 (final).docx":  "thesis-v3 (final).docx",
	}
	for in, want := range cases {
		got, err := SanitizeFilename(in)
		require.NoError(t, err, "input=%q", in)
		assert.Equal(t, want, got)
	}
}

func TestSanitizeFilename_PathTraversalRejected(t *testing.T) {
	bad := []string{
		"../../../etc/passwd",
		"..\\..\\windows\\system32",
		"/etc/passwd",
		"C:\\Users\\admin\\secret",
		"a/b/c.pdf",
		"a\\b.pdf",
		"a/../b.pdf",
		"..",
		".",
		"",
		"   ",
		"file.pdf\x00.exe", // NUL 注入（绕 Web Server 截断的经典攻击）
	}
	for _, n := range bad {
		_, err := SanitizeFilename(n)
		assert.ErrorIs(t, err, ErrFileNameInvalid, "应拒绝 %q", n)
	}
}

func TestSanitizeFilename_TooLong(t *testing.T) {
	long := strings.Repeat("a", MaxFileNameBytes+1)
	_, err := SanitizeFilename(long)
	assert.ErrorIs(t, err, ErrFileNameInvalid)

	// 边界值：恰好 255 字节通过
	exact := strings.Repeat("a", MaxFileNameBytes)
	got, err := SanitizeFilename(exact)
	require.NoError(t, err)
	assert.Equal(t, exact, got)
}

func TestSanitizeFilename_InvalidUTF8(t *testing.T) {
	// 非法 UTF-8 序列
	_, err := SanitizeFilename(string([]byte{0xFF, 0xFE, 0xFD}))
	assert.ErrorIs(t, err, ErrFileNameInvalid)
}

// ============================================================
// detectAndValidateMIME
// ============================================================

func TestDetectMIME_Allowed(t *testing.T) {
	// PNG magic header
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	mime, err := detectAndValidateMIME(pngHeader, "")
	require.NoError(t, err)
	assert.Equal(t, "image/png", mime)

	// PDF magic %PDF-1.4
	pdfHeader := []byte("%PDF-1.4\n")
	mime, err = detectAndValidateMIME(pdfHeader, "")
	require.NoError(t, err)
	assert.Contains(t, mime, "application/pdf")

	// JPEG magic
	jpegHeader := []byte{0xFF, 0xD8, 0xFF, 0xE0}
	mime, err = detectAndValidateMIME(jpegHeader, "")
	require.NoError(t, err)
	assert.Equal(t, "image/jpeg", mime)

	// 纯文本
	mime, err = detectAndValidateMIME([]byte("hello world\n"), "")
	require.NoError(t, err)
	assert.Contains(t, mime, "text/plain")
}

func TestDetectMIME_Rejected(t *testing.T) {
	// PE 可执行文件（MZ 头）
	peHeader := []byte{0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00}
	_, err := detectAndValidateMIME(peHeader, "")
	assert.ErrorIs(t, err, ErrMIMENotAllowed)

	// HTML（伪装成 image/png 但嗅探出 HTML）
	htmlHeader := []byte("<!DOCTYPE html><html><body>")
	_, err = detectAndValidateMIME(htmlHeader, "")
	assert.ErrorIs(t, err, ErrMIMENotAllowed)
}

// 兜底路径：sniff 返 octet-stream + 文件名扩展在白名单 → 放行 + 推断 MIME
func TestDetectMIME_OctetStreamFallbackByExt(t *testing.T) {
	// 不识别的二进制（HEIC magic 的简化模拟，sniff 会返 octet-stream）
	bin := []byte{0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63}

	// .heic 扩展应放行 + 返 image/heic
	mime, err := detectAndValidateMIME(bin, "photo.heic")
	require.NoError(t, err)
	assert.Equal(t, "image/heic", mime)

	// .avif 同理
	mime, err = detectAndValidateMIME(bin, "screenshot.avif")
	require.NoError(t, err)
	assert.Equal(t, "image/avif", mime)

	// .mov 视频：Go sniff 不识别 quicktime ftyp，靠扩展名兜底
	mime, err = detectAndValidateMIME(bin, "clip.mov")
	require.NoError(t, err)
	assert.Equal(t, "video/quicktime", mime)

	// .mp4 兜底：sniff 识别失败时按扩展名补救
	mime, err = detectAndValidateMIME(bin, "clip.mp4")
	require.NoError(t, err)
	assert.Equal(t, "video/mp4", mime)

	// 未知扩展仍拒绝（防恶意 .exe 改 .heic 后又改回 .exe）
	_, err = detectAndValidateMIME(bin, "malware.exe")
	assert.ErrorIs(t, err, ErrMIMENotAllowed)

	// 无文件名也拒绝
	_, err = detectAndValidateMIME(bin, "")
	assert.ErrorIs(t, err, ErrMIMENotAllowed)
}

// ============================================================
// ensureUnderRoot
// ============================================================

func TestEnsureUnderRoot_Allowed(t *testing.T) {
	root := "/var/lib/progress/files"
	cases := []string{
		"/var/lib/progress/files/abcdef/abcdef0123",
		"/var/lib/progress/files/aa/sha256_value",
		"/var/lib/progress/files",
	}
	for _, p := range cases {
		assert.NoError(t, ensureUnderRoot(root, p), "应放行 %q", p)
	}
}

func TestEnsureUnderRoot_Rejected(t *testing.T) {
	root := "/var/lib/progress/files"
	cases := []string{
		"/var/lib/progress/files-other/secret", // 字面前缀但目录不同
		"/etc/passwd",
		"/var/lib/progress/files/../../etc/passwd",
		"/var/lib/progress",
	}
	for _, p := range cases {
		err := ensureUnderRoot(root, p)
		cleaned := filepath.Clean(p)
		// filepath.Clean 已把 ../../ 简化；仅前缀检查仍可能放行 same-prefix 路径
		// 真正 escape 的会被拒绝
		if strings.HasPrefix(cleaned, root+"/") || cleaned == root {
			continue
		}
		assert.ErrorIs(t, err, ErrPathTraversal, "应拒绝 %q (cleaned=%q)", p, cleaned)
	}
}

// ============================================================
// NewFileService 参数校验
// ============================================================

func TestNewFileService_RequiresAllDeps(t *testing.T) {
	// 仅校验 pool nil 路径（其它字段需要先有 pool 才会被检查；
	// 集成测试覆盖 storage path / max size 全套）。
	_, err := NewFileService(FileServiceDeps{
		StoragePath:  t.TempDir(),
		MaxSizeBytes: 1024,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pool is required")
}

// ============================================================
// 错误类型识别（handler 层 errors.Is 依赖）
// ============================================================

func TestFileSentinelErrors_AreIdentifiable(t *testing.T) {
	// 各 sentinel 必须可以 errors.Is 识别（否则 handler 层映射 HTTP code 会失败）
	wrapped := errors.New("wrapped: " + ErrFileNameInvalid.Error())
	assert.NotErrorIs(t, wrapped, ErrFileNameInvalid, "未 wrap 的字符串不应被识别")

	// 实际使用：fmt.Errorf("...: %w", err) 才能 errors.Is
	wrapped2 := errors.Join(ErrMIMENotAllowed, errors.New("ctx"))
	assert.ErrorIs(t, wrapped2, ErrMIMENotAllowed)
}

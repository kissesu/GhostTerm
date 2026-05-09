/*
@file flow_10_file_upload_limits_test.go
@description e2e flow #10：文件上传 body size 限制 + MIME 白名单端到端验证（finding L3 follow-up）。

             业务规则：
             - POST /api/files：multipart 上传，BodyLimit = FILE_MAX_SIZE_MB + 10MB（缓冲）
               e2e 配置 FILE_MAX_SIZE_MB=10 → BodyLimit 20MB
             - 上限内 + MIME 白名单命中 → 201 + FileMetadata
             - 超过 BodyLimit → 413 request_body_too_large
             - MIME 不在白名单（含 OLE 容器 + 不识别扩展名）→ 415 mime_not_allowed

             测试矩阵（与 integration 测试 service 层 1MB 限额互补，本测试关注 HTTP 层 BodyLimit）：
             - 9MB PDF（小于 10MB 服务限 + 20MB body 限）→ 201
             - 25MB body（大于 20MB body 限）→ 413
             - OLE 魔数 + .xyz 扩展名（不在 oleExtToMIME 表内）→ 415

@author Atlas.oi
@date 2026-05-09
*/

package e2e

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pdfMagic 是 PDF 文件头 4 字节，让 http.DetectContentType 识别为 application/pdf。
var pdfMagic = []byte("%PDF")

// oleMagic 是 OLE Compound File 8 字节魔数（D0CF11E0...）。
// file_service.go 的 oleExtToMIME 表仅识别 .doc/.xls/.ppt 后缀；其它扩展应被拒。
var oleMagic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// makePDFPayload 构造前缀是 PDF 魔数的 size 字节 buffer，其余字节用 0x20 填充。
//
// 业务背景：service 层 sniff 仅看前 512 字节；超过 512 字节后填充任意 byte 不影响 MIME 嗅探。
// 用 bytes.Repeat 而非 binary fixture 避免新建二进制文件（与 brief 要求一致）。
func makePDFPayload(size int) []byte {
	buf := make([]byte, size)
	copy(buf, pdfMagic)
	for i := len(pdfMagic); i < size; i++ {
		buf[i] = 0x20 // ASCII space 让 sniff 不会因为 NUL 字节切到其它分支
	}
	return buf
}

// TestFlow10_FileUpload_HappyPathLargeFile 验证 9MB PDF（小于 10MB 服务限 + 20MB body 限）成功。
//
// 业务规则证明：BodyLimit + service.MaxSizeBytes 双限协作 —— 9MB 在两者之内 → 201。
func TestFlow10_FileUpload_HappyPathLargeFile(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	// 9MB（< 10MB FILE_MAX_SIZE_MB；< 20MB BodyLimit）
	const size = 9 * 1024 * 1024
	payload := makePDFPayload(size)

	resp := cs.uploadFile(t, "large-9mb.pdf", "application/pdf", payload)
	expectStatus(t, resp, http.StatusCreated, "upload 9MB PDF")

	meta := decodeEnvelope[fileMetaModel](t, resp)
	assert.Equal(t, "large-9mb.pdf", meta.Filename)
	assert.Greater(t, meta.ID, int64(0))
}

// TestFlow10_FileUpload_OversizeRequestRejected 验证 25MB body（大于 20MB BodyLimit）→ 413。
//
// 业务规则证明：finding #14 的 BodyLimit middleware 在 multipart 拆解前就拒绝超大请求体，
// 防止恶意大上传塞爆服务器内存 / 磁盘 buffer。
//
// 注：此前 integration 测试覆盖的是 service.Upload 层 ErrFileTooLarge（基于声明 size）；
// HTTP 层 BodyLimit 是更早的拦截，本测试是端到端补强。
func TestFlow10_FileUpload_OversizeRequestRejected(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	// 25MB（> 20MB BodyLimit = 10MB FILE_MAX_SIZE_MB + 10MB 缓冲）
	const size = 25 * 1024 * 1024
	payload := makePDFPayload(size)

	resp := cs.uploadFile(t, "huge-25mb.pdf", "application/pdf", payload)
	// MaxBytesReader 拒绝时 BodyLimit middleware 通常返 413
	// （bodylimit.go 用 http.MaxBytesReader 包 r.Body；超限读取时由 super_admin_invariants.go
	// 的 oversizedBodyErrorBody 写 "request_body_too_large"）
	require.Equal(t, http.StatusRequestEntityTooLarge, resp.statusCode,
		"25MB body 必须被 BodyLimit middleware 拒为 413，body=%s", resp.bodyString())

	// 验证错误 envelope code = request_body_too_large
	assert.Contains(t, resp.bodyString(), "request_body_too_large",
		"413 envelope 必须携带 code=request_body_too_large")
}

// TestFlow10_FileUpload_OLEUnknownExtensionRejected 验证 OLE 魔数 + 不识别扩展名 → 415。
//
// 业务背景：file_service.oleMagic + oleExtToMIME 仅识别 .doc/.xls/.ppt 三个 OLE 容器 ext；
// 其它扩展（.xyz / .msi / .msg 等）应被拒绝防 PE 改名 .pdf 攻击的同模式 OLE 改名。
//
// 测试构造 OLE 魔数 + .xyz 扩展名 + Content-Type 谎报 application/pdf：
//   - sniff 命中 OLE → oleExtToMIME[".xyz"] miss → 走 ErrMIMENotAllowed → 415
func TestFlow10_FileUpload_OLEUnknownExtensionRejected(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	// OLE 魔数 + 100 字节填充让总长足够 sniff
	payload := bytes.Repeat([]byte{0x00}, 100)
	copy(payload, oleMagic)

	resp := cs.uploadFile(t, "fake.xyz", "application/pdf", payload)
	// service 层返 ErrMIMENotAllowed → handler 映射 415
	require.Equal(t, http.StatusUnsupportedMediaType, resp.statusCode,
		"OLE 魔数 + 不识别扩展名必须 415，body=%s", resp.bodyString())

	body := resp.bodyString()
	// 错误 envelope code 应是 mime_not_allowed
	assert.True(t,
		strings.Contains(body, "mime_not_allowed") ||
			strings.Contains(body, "MIME"),
		"415 envelope 应含 mime_not_allowed 标识，实际 body=%s", body)
}

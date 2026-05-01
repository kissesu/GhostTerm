/*
@file flow_05_file_thesis_test.go
@description e2e flow #5：文件上传 + 论文版本递增 + 路径遍历兜底。

             业务规则：
             - POST /api/files：multipart 上传 PDF；服务端 sniff MIME 验证，sha256 内容寻址
             - POST /api/projects/{id}/thesis-versions：基于 fileId 创建论文版本，
               version_no 自动 +1，永不覆盖（spec §6.6）
             - 文件名含 ".." → SanitizeFilename 拒绝 → 422

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// minimalPDF 是 4 字节 PDF 魔数 + 极简结构，让 http.DetectContentType 识别为 application/pdf。
//
// 业务背景：file_service 使用 net/http.DetectContentType sniff；只要前 4 字节是 %PDF
// 就识别为 application/pdf；后面附简单 EOF 标志让文件可解析（虽然 e2e 不验证 PDF 完整性）。
var minimalPDF = []byte("%PDF-1.4\n%EOF\n")

func TestFlow05_FileAndThesisVersion(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	project := createProject(t, cs, "thesis-customer", "thesis-project",
		time.Now().Add(45*24*time.Hour), "3000.00")

	// ============================================================
	// 上传第一份 PDF
	// ============================================================
	resp := cs.uploadFile(t, "thesis-v1.pdf", "application/pdf", minimalPDF)
	expectStatus(t, resp, http.StatusCreated, "upload PDF v1")
	meta := decodeEnvelope[fileMetaModel](t, resp)
	require.Greater(t, meta.ID, int64(0))
	assert.Equal(t, "thesis-v1.pdf", meta.Filename)

	// ============================================================
	// 创建 thesis_version v1
	// ============================================================
	createV1 := cs.do(t, http.MethodPost,
		urlf("/api/projects/%d/thesis-versions", project.ID),
		map[string]any{
			"fileId": meta.ID,
			"remark": "初稿",
		}, true)
	expectStatus(t, createV1, http.StatusCreated, "create thesis v1")
	v1 := decodeEnvelope[thesisVersionModel](t, createV1)
	assert.Equal(t, 1, v1.VersionNo)
	assert.Equal(t, meta.ID, v1.FileID)

	// ============================================================
	// 上传第二份 + 创建 v2，版本号自动递增
	// ============================================================
	resp2 := cs.uploadFile(t, "thesis-v2.pdf", "application/pdf",
		append([]byte("%PDF-1.4\n"), []byte("修订版本内容")...))
	expectStatus(t, resp2, http.StatusCreated, "upload PDF v2")
	meta2 := decodeEnvelope[fileMetaModel](t, resp2)

	createV2 := cs.do(t, http.MethodPost,
		urlf("/api/projects/%d/thesis-versions", project.ID),
		map[string]any{
			"fileId": meta2.ID,
			"remark": "修订版",
		}, true)
	expectStatus(t, createV2, http.StatusCreated, "create thesis v2")
	v2 := decodeEnvelope[thesisVersionModel](t, createV2)
	assert.Equal(t, 2, v2.VersionNo, "version_no 自动递增")

	// ============================================================
	// GET 列表：2 条版本
	// ============================================================
	listResp := cs.do(t, http.MethodGet,
		urlf("/api/projects/%d/thesis-versions", project.ID), nil, true)
	expectStatus(t, listResp, http.StatusOK, "list thesis versions")
	type listEnv struct {
		Data []thesisVersionModel `json:"data"`
	}
	var list listEnv
	listResp.decode(t, &list)
	assert.Len(t, list.Data, 2)

	// ============================================================
	// 路径遍历兜底：filename 含 ".." 子串必须被拒
	//
	// 注意：Go mime/multipart 解码时会自动 strip filename 中的 / \
	//       前缀（仅保留 basename），所以 "../etc/passwd" 实际到达 handler 时
	//       已经是 "passwd"——sanitize 层面看不到路径遍历。
	//       本测试用 "bad..name.pdf" 让 ".." 子串真正进入 SanitizeFilename，
	//       验证 strings.Contains(name, "..") 拒绝逻辑生效。
	// ============================================================
	traversal := cs.uploadFile(t, "bad..name.pdf", "application/pdf", minimalPDF)
	assert.NotEqual(t, http.StatusCreated, traversal.statusCode,
		"含 .. 子串的文件名必须被拒，实际 status=%d body=%s",
		traversal.statusCode, traversal.bodyString())
}

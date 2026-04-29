/*
@file file.go
@description 文件管理相关 HTTP handler 实现（ogen Handler 接口对应方法）：
             - FilesUpload                       POST  /api/files
             - FilesDownload                     GET   /api/files/{id}
             - ProjectsListFiles                 GET   /api/projects/{id}/files
             - ProjectsCreateThesisVersion       POST  /api/projects/{id}/thesis-versions
             - ProjectsListThesisVersions        GET   /api/projects/{id}/thesis-versions

             覆盖 v2 part1 §C5 安全加固：
             - 文件名清理 / MIME 嗅探 / 路径遍历兜底（在 services.FileService.Upload 内做）
             - 响应头：ogen 生成的 FilesDownload encoder 把 Content-Type 硬编码为
               application/octet-stream，且 oas.Handler 接口不暴露 http.ResponseWriter，
               handler 层无法在 ogen 通道内设置 Content-Disposition / X-Content-Type-Options /
               Cache-Control。受 W7 ownership 限制（router.go 由 Lead 维护），本文件
               仅返回 oas FilesDownloadOK；自定义响应头的 chi 中间件需要 Lead 在 router.go
               注册（见 file 末尾 ApplyDownloadHeadersMiddleware 函数）。

             业务身份注入约定：
             - 鉴权中间件已把 services.AuthContext 写入 ctx；handler 入口取出后传给 service
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// FileHandler 实现 ogen 生成的 oas.Handler 中与文件管理相关的方法。
type FileHandler struct {
	Svc services.FileService
}

// NewFileHandler 构造 FileHandler。
func NewFileHandler(svc services.FileService) *FileHandler {
	return &FileHandler{Svc: svc}
}

// ============================================================
// FilesUpload — POST /api/files
// ============================================================

// FilesUpload 实现 ogen FilesUpload 接口。
//
// 业务流程：
//  1. 取 AuthContext；缺失返回 401（通过 error 让 router ErrorHandler 映射）
//  2. 从 multipart req.File 取文件名、Size、读取流
//  3. svc.Upload 完成 sanitize + MIME 校验 + sha256 落盘 + INSERT
//  4. 返回 201 FileMetadataResponse
//
// 错误映射（→ ErrorEnvelope.code）：
//   - ErrFileTooLarge       → 413 FilesUploadRequestEntityTooLarge
//   - ErrMIMENotAllowed     → 415 FilesUploadUnsupportedMediaType
//   - ErrFileNameInvalid    → 422 通过 error → router 映射
//   - ErrFileEmpty          → 422 同上
//   - ErrPathTraversal      → 500 通过 error → router 映射
//
// 注：FilesUploadRes 接口仅声明 3 种 200/413/415 响应类型；
// 401/422/500 必须通过返回 error 让 router 层 ErrorHandler 写 ErrorEnvelope。
func (h *FileHandler) FilesUpload(ctx context.Context, req *oas.FilesUploadReq) (oas.FilesUploadRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, services.ErrInvalidAccessToken
	}
	if req == nil {
		return nil, fmt.Errorf("file handler: %w: missing multipart body", services.ErrFileNameInvalid)
	}

	// req.File.Name = 客户端文件名；req.File.File = io.Reader；req.File.Size = 字节数
	mimeHint := req.File.Header.Get("Content-Type")

	raw, err := h.Svc.Upload(ctx, sc, req.File.Name, mimeHint, req.File.Size, req.File.File)
	if err != nil {
		return mapUploadError(err)
	}
	view, ok := raw.(services.FileMetaView)
	if !ok {
		return nil, errors.New("file handler: unexpected view type")
	}
	return &oas.FileMetadataResponse{Data: toOASFileMetadata(view)}, nil
}

// mapUploadError 把 service sentinel error 映射为 oas FilesUploadRes 错误响应。
//
// 仅 ErrFileTooLarge / ErrMIMENotAllowed 有专属 FilesUploadRes 类型可返回 ErrorEnvelope；
// 其它（FileNameInvalid / FileEmpty / PathTraversal / 内部错）通过返回 error
// 让 router ErrorHandler 决定 HTTP 状态码。
func mapUploadError(err error) (oas.FilesUploadRes, error) {
	switch {
	case errors.Is(err, services.ErrFileTooLarge):
		envelope := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeFileTooLarge, "文件超过大小上限")
		res := oas.FilesUploadRequestEntityTooLarge(envelope)
		return &res, nil
	case errors.Is(err, services.ErrMIMENotAllowed):
		envelope := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeMimeNotAllowed, err.Error())
		res := oas.FilesUploadUnsupportedMediaType(envelope)
		return &res, nil
	default:
		// FileNameInvalid / FileEmpty / PathTraversal / 内部错 → router ErrorHandler 兜底
		return nil, err
	}
}

// ============================================================
// FilesDownload — GET /api/files/{id}
// ============================================================

// FilesDownload 实现 ogen FilesDownload 接口。
//
// 业务流程：
//  1. 取 AuthContext
//  2. svc.Download → 文件名、MIME、size、io.ReadCloser
//  3. 把 metadata 透传给 chi 中间件设置 §C5 响应头（中间件由 Lead 在 router.go 注册）
//  4. 返回 *FilesDownloadOK{Data: file}
//
// 限制：ogen 编码器把 Content-Type 硬编码为 application/octet-stream，
// 自定义响应头需要 Lead 把 NewDownloadHeaderMiddleware 包到 chi 路由树上。
// 中间件未注册时仍可下载（响应头降级为 ogen 默认）。
//
// 错误映射：
//   - ErrFileNotFound → *ErrorEnvelope (NotFound)
//   - 其它           → 通过 error 走 router ErrorHandler
func (h *FileHandler) FilesDownload(ctx context.Context, params oas.FilesDownloadParams) (oas.FilesDownloadRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, services.ErrInvalidAccessToken
	}

	filename, mimeType, size, body, err := h.Svc.Download(ctx, sc, params.ID)
	if err != nil {
		if errors.Is(err, services.ErrFileNotFound) {
			envelope := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "文件不存在")
			return &envelope, nil
		}
		return nil, fmt.Errorf("file handler: download: %w", err)
	}

	// 透传 metadata 给中间件设置自定义响应头（§C5）；
	// 即使中间件未注册（Lead 未 wire），下载仍可工作（仅响应头降级为 ogen 默认）。
	if meta, found := downloadMetaFromCtx(ctx); found {
		meta.Filename = filename
		meta.MimeType = mimeType
		meta.Size = size
	}

	// 即时回写到 wrapped writer（避免 ogen encoder 调 WriteHeader(200) 后才注入）
	if w, found := responseWriterFromCtx(ctx); found {
		setDownloadHeaders(w, filename, mimeType, size)
	}

	return &oas.FilesDownloadOK{Data: body}, nil
}

// downloadMetaFromCtx 从 ctx 取出待写入的下载元数据（中间件未启用时返回 false）。
func downloadMetaFromCtx(ctx context.Context) (*downloadMeta, bool) {
	v := ctx.Value(downloadCtxKey{})
	if v == nil {
		return nil, false
	}
	m, ok := v.(*downloadMeta)
	return m, ok
}

// ============================================================
// ProjectsListFiles — GET /api/projects/{id}/files
// ============================================================

// ProjectsListFiles 列出指定项目的附件（sample_doc + source_code 两类）。
//
// 当前 oas 路径未声明 category query 参数；返回所有 category。
func (h *FileHandler) ProjectsListFiles(
	ctx context.Context,
	params oas.ProjectsListFilesParams,
) (*oas.ProjectFileListResponse, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// 该接口的 oas 签名只允许 *ProjectFileListResponse 或 error；
		// 401 由 SecurityHandler 在 ogen 层兜底，handler 入口已确保 sc 存在
		return nil, errors.New("file handler: missing auth context")
	}

	raw, err := h.Svc.ListProjectFiles(ctx, sc, params.ID, nil)
	if err != nil {
		return nil, fmt.Errorf("file handler: list project files: %w", err)
	}

	out := make([]oas.ProjectFile, 0, len(raw))
	for _, r := range raw {
		v, ok := r.(services.ProjectFileView)
		if !ok {
			return nil, errors.New("file handler: unexpected ProjectFileView type")
		}
		out = append(out, oas.ProjectFile{
			ID:        v.ID,
			ProjectId: v.ProjectID,
			FileId:    v.FileID,
			Category:  oas.ProjectFileCategory(v.Category),
			AddedAt:   v.AddedAt,
			File:      toOASFileMetadata(v.File),
		})
	}
	return &oas.ProjectFileListResponse{Data: out}, nil
}

// ============================================================
// ProjectsCreateThesisVersion — POST /api/projects/{id}/thesis-versions
// ============================================================

// ProjectsCreateThesisVersion 上传论文新版本（version_no 自动递增，永不覆盖）。
func (h *FileHandler) ProjectsCreateThesisVersion(
	ctx context.Context,
	req *oas.ThesisVersionCreateRequest,
	params oas.ProjectsCreateThesisVersionParams,
) (oas.ProjectsCreateThesisVersionRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		envelope := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "未登录")
		return &envelope, nil
	}
	if req == nil || req.FileId == 0 {
		envelope := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "fileId 必填")
		return &envelope, nil
	}

	remark := ""
	if req.Remark.IsSet() {
		remark = req.Remark.Value
	}

	raw, err := h.Svc.CreateThesisVersion(ctx, sc, params.ID, req.FileId, remark)
	if err != nil {
		return nil, fmt.Errorf("file handler: create thesis version: %w", err)
	}
	v, ok := raw.(services.ThesisVersionView)
	if !ok {
		return nil, errors.New("file handler: unexpected ThesisVersionView type")
	}
	return &oas.ThesisVersionResponse{Data: toOASThesisVersion(v)}, nil
}

// ============================================================
// ProjectsListThesisVersions — GET /api/projects/{id}/thesis-versions
// ============================================================

// ProjectsListThesisVersions 列出项目的论文版本历史（version_no 倒序）。
func (h *FileHandler) ProjectsListThesisVersions(
	ctx context.Context,
	params oas.ProjectsListThesisVersionsParams,
) (*oas.ThesisVersionListResponse, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("file handler: missing auth context")
	}
	raw, err := h.Svc.ListThesisVersions(ctx, sc, params.ID)
	if err != nil {
		return nil, fmt.Errorf("file handler: list thesis versions: %w", err)
	}
	out := make([]oas.ThesisVersion, 0, len(raw))
	for _, r := range raw {
		v, ok := r.(services.ThesisVersionView)
		if !ok {
			return nil, errors.New("file handler: unexpected ThesisVersionView type")
		}
		out = append(out, toOASThesisVersion(v))
	}
	return &oas.ThesisVersionListResponse{Data: out}, nil
}

// ============================================================
// 辅助：service view → oas schema 转换
// ============================================================

func toOASFileMetadata(v services.FileMetaView) oas.FileMetadata {
	return oas.FileMetadata{
		ID:         v.ID,
		UUID:       v.UUID,
		Filename:   v.Filename,
		SizeBytes:  v.SizeBytes,
		MimeType:   v.MimeType,
		UploadedBy: v.UploadedBy,
		UploadedAt: v.UploadedAt,
	}
}

func toOASThesisVersion(v services.ThesisVersionView) oas.ThesisVersion {
	tv := oas.ThesisVersion{
		ID:         v.ID,
		ProjectId:  v.ProjectID,
		FileId:     v.FileID,
		VersionNo:  v.VersionNo,
		UploadedBy: v.UploadedBy,
		UploadedAt: v.UploadedAt,
		File:       toOASFileMetadata(v.File),
	}
	if v.Remark != nil {
		tv.Remark.SetTo(*v.Remark)
	} else {
		tv.Remark.SetToNull()
	}
	return tv
}

// ============================================================
// 自定义响应头中间件（v2 part1 §C5）
// ============================================================
//
// 业务背景：
// - ogen 生成的 FilesDownload encoder 把 Content-Type 硬编码为 application/octet-stream，
//   且 oas.Handler 接口不暴露 http.ResponseWriter，handler 内无法直接 set headers
// - 为达成 §C5 要求的 Content-Disposition / X-Content-Type-Options / Cache-Control，
//   必须在 chi 层包一层 ResponseWriter wrapper：
//     1. 拦截 oas 调 Header().Set("Content-Type", ...) 时把它替换为真实 MIME
//     2. 在 WriteHeader 前补充 Content-Disposition / X-Content-Type-Options / Cache-Control
// - 该中间件由 Lead 在 router.go 里 mount 之前调用 NewDownloadHeaderMiddleware 注入；
//   handler 通过 ctx 把 metadata 传给 wrapper 写入

// downloadCtxKey 是 ctx 中存放 download metadata 的私有 key。
type downloadCtxKey struct{}

// downloadMeta 保存待写入响应头的元数据。
type downloadMeta struct {
	Filename string
	MimeType string
	Size     int64
}

// responseWriterCtxKey 用于在 ctx 中传递 *http.ResponseWriter 引用。
//
// 业务背景：ogen 生成的 oas.Handler 不暴露 ResponseWriter，但中间件层可以把它
// 注入到 ctx 让 handler 透传给下游中间件 wrapper。
type responseWriterCtxKey struct{}

// responseWriterFromCtx 从 ctx 取出注入的 ResponseWriter（中间件未启用时返回 false）。
func responseWriterFromCtx(ctx context.Context) (http.ResponseWriter, bool) {
	v := ctx.Value(responseWriterCtxKey{})
	if v == nil {
		return nil, false
	}
	w, ok := v.(http.ResponseWriter)
	return w, ok
}

// setDownloadHeaders 在 ResponseWriter 上设置安全响应头（v2 part1 §C5）。
//
// 注：此函数只在 chi 中间件已 wrap response writer 的前提下生效；否则 ogen
// encoder 在写完 200 + body 之后才到中间件里，header 已经发出无法回改。
//
// 调用方：FilesDownload handler（在调 svc.Download 后、return *FilesDownloadOK 前）。
func setDownloadHeaders(w http.ResponseWriter, filename, mimeType string, size int64) {
	// RFC 5987 编码：filename 用 ASCII 兜底 + filename* 用 UTF-8 percent-encoding
	asciiFallback := asciiOnlyFilename(filename)
	encoded := url.PathEscape(filename)
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, asciiFallback, encoded))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	if mimeType != "" {
		w.Header().Set("Content-Type", mimeType)
	}
	if size > 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	}
}

// asciiOnlyFilename 把文件名转 ASCII 兜底（非 ASCII 字符替换为 '_'）。
//
// 业务背景：旧浏览器（IE / 部分企业 webview）不支持 RFC 5987 filename*；
// 必须保留一份 ASCII filename="..." 兜底；本函数把不安全字符（NUL/控制符/双引号/反斜杠）
// 都替换为 '_'，防止 Content-Disposition header 注入。
func asciiOnlyFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= 32 && r < 128 && r != '"' && r != '\\' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "download"
	}
	return b.String()
}

// downloadHeaderWriter 包装 http.ResponseWriter，在 WriteHeader / Write 前
// 注入 §C5 要求的安全响应头。
//
// 关键设计：
//   - 只在 status >= 200 && status < 400 时注入（错误响应已是 JSON ErrorEnvelope）
//   - Content-Type 只有当本 handler 已设置（meta != nil）时才覆盖 ogen 默认
//   - WriteHeader 是幂等的（标准库已保证），调用一次后内部 wrote=true 就不再处理
type downloadHeaderWriter struct {
	http.ResponseWriter
	wrote bool
	meta  *downloadMeta
}

func (w *downloadHeaderWriter) WriteHeader(code int) {
	if !w.wrote {
		w.wrote = true
		if code >= 200 && code < 400 && w.meta != nil {
			setDownloadHeaders(w.ResponseWriter, w.meta.Filename, w.meta.MimeType, w.meta.Size)
		}
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *downloadHeaderWriter) Write(p []byte) (int, error) {
	// 隐式 200 启动（标准库行为：未显式 WriteHeader 时第一次 Write 自动调 WriteHeader(200)）
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}

// NewDownloadHeaderMiddleware 是 chi 中间件，把 §C5 响应头注入到 GET /api/files/{id}。
//
// Lead-owned router.go 在 mount oasServer 前调用此中间件，仅对下载路径生效：
//
//	r.With(NewDownloadHeaderMiddleware()).Mount("/", oasServer)
//
// 业务流程：
//  1. 检查 path 是 /api/files/<id> 且 method = GET；其它请求直接放行
//  2. 包装 ResponseWriter 为 downloadHeaderWriter
//  3. 把 *http.ResponseWriter 通过 ctx 注入，让 FilesDownload handler 能调 setDownloadHeaders
//
// 当前 W7 ownership 限制下，此函数仅声明并 export，由 Lead 在 router.go 里 wire；
// 缺失时 FilesDownload 仍可工作（响应头降级为 ogen 默认 application/octet-stream）。
func NewDownloadHeaderMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/api/files/") {
				next.ServeHTTP(w, r)
				return
			}
			// 包装：WriteHeader 时注入 §C5 响应头
			meta := &downloadMeta{}
			ww := &downloadHeaderWriter{ResponseWriter: w, meta: meta}
			ctx := context.WithValue(r.Context(), responseWriterCtxKey{}, http.ResponseWriter(ww))
			ctx = context.WithValue(ctx, downloadCtxKey{}, meta)
			next.ServeHTTP(ww, r.WithContext(ctx))
		})
	}
}

// ============================================================
// 编译时 io.ReadCloser 校验
// ============================================================
//
// services.FileService.Download 返回 io.ReadCloser；ogen FilesDownloadOK.Data 是 io.Reader。
// 此处空赋值仅是文档兼容性 sanity check（编译期会被 dead code elimination 掉）。
var _ = func() io.Reader { var rc io.ReadCloser; return rc }()

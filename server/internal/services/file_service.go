/*
@file file_service.go
@description FileService 的具体实现（Phase 6 Worker C）。

             覆盖 v2 part1 §C5 安全加固：
               1. 文件名清理：拒绝 ../ 和 / \\ 与 NUL，限长 255 字节，UUID 落盘隔离原始文件名
               2. MIME 嗅探：服务端 http.DetectContentType 取前 512 字节，与白名单比对
                  - 不信任客户端 Content-Type；声明与嗅探不一致时按嗅探结果判定
                  - 例外：text/plain → text/markdown / application/json 等放行（文本子类）
               3. 路径遍历兜底：filepath.Clean + Abs，校验在 FileStoragePath 下；偏移即拒绝
               4. SHA-256 内容寻址：<storage>/<sha256[0:2]>/<sha256[全>>，自动去重
               5. 写盘原子化：tmp 文件 + Rename，避免读到半截文件
               6. RLS 注入：Upload 由 INSERT 走 GUC 事务；Download 通过 RLS 查 files

             interfaces.go 把 FileService 的方法签名约定为 any 视图模型，本文件实现层用具体类型
             （FileMetaView / ProjectFileView / ThesisVersionView）；handler 层 type-assert 后转 oas。

@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ============================================================
// 常量
// ============================================================

// SniffSize 是 http.DetectContentType 所需的前置字节数（标准库要求 ≥512）。
const SniffSize = 512

// MaxFileNameBytes 是文件名 UTF-8 字节上限。
//
// 业务背景：
//   - Postgres TEXT 存储文件名无长度限制，但前端列表 UI 与文件系统都按 255 字节卡
//   - UTF-8 中文每字符 3 字节，255 字节 ≈ 85 个汉字，足够日常用
const MaxFileNameBytes = 255

// ============================================================
// Sentinel errors —— handler 层据此映射到 ErrorEnvelope.code
// ============================================================

// ErrFileNameInvalid 文件名包含路径分隔符 / 父目录 / NUL 字节 / 超长。
var ErrFileNameInvalid = errors.New("file_name_invalid")

// ErrFileEmpty 文件长度为 0。
var ErrFileEmpty = errors.New("file_empty")

// ErrFileTooLarge 上传体超过 cfg.MaxSizeBytes（spec §9.4 单文件 50MB / 100MB）。
var ErrFileTooLarge = errors.New("file_too_large")

// ErrMIMENotAllowed 嗅探结果不在白名单 / 与声明不符且不是放行的 text 子类。
var ErrMIMENotAllowed = errors.New("mime_not_allowed")

// ErrPathTraversal 计算出的存储路径不在 FileStoragePath 之下（防御编程，应永不触发）。
var ErrPathTraversal = errors.New("path_traversal")

// ErrFileNotFound 文件不存在 / 当前 session 无可见性（RLS 拦截）。
//
// 业务背景：与 ErrCustomerNotFound 同样的安全语义 —— 不区分"不存在"与"无权限"，
// 防止按 id 探测文件存在性。
var ErrFileNotFound = errors.New("file_not_found")

// ErrThesisVersionImmutable 试图 UPDATE / DELETE 已存在的 thesis_versions 行。
//
// 业务背景：spec §9.2 论文版本永不覆盖。本 service 不暴露 Update/Delete 入口；
// 保留 sentinel 让 handler 层 panic 之外的"被绕过"路径有可识别错误。
var ErrThesisVersionImmutable = errors.New("thesis_version_immutable")

// ============================================================
// MIME 白名单（v1 业务允许）
// ============================================================

// allowedMIME 直接匹配嗅探结果（http.DetectContentType 永远附加 "; charset=..."，
// 比对时会先剥 charset；因此这里只列纯 type）。
var allowedMIME = map[string]bool{
	// PDF
	"application/pdf": true,
	// Office (Word / Excel / PowerPoint)
	"application/msword":                                                        true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"application/vnd.ms-excel":                                                  true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
	"application/vnd.ms-powerpoint":                                             true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	// 图片
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	// 压缩包（源码 / 论文素材）
	"application/zip":                  true,
	"application/x-rar-compressed":     true,
	"application/x-7z-compressed":      true,
	"application/x-tar":                true,
	"application/x-gzip":               true,
	// 视频（mp4 sniff 能识别；mov 共用 ftyp box 但 sniff 大概率落 octet-stream 由 ext 兜底）
	"video/mp4": true,
}

// allowedTextPrefix 单独处理：http.DetectContentType 给文本的格式是 "text/plain; charset=utf-8"，
// 嗅探不区分 markdown / json / csv / yaml；都按 text/* 放行（前端 mime hint 不可信，但纯文本无主机风险）。
var allowedTextPrefix = []string{
	"text/plain",
	"text/csv",
	"text/markdown",
	"application/json",
}

// extToInferredMIME：sniff 返 octet-stream 时按 client filename 扩展名兜底白名单
// http.DetectContentType 不识别 HEIC/AVIF/SVG 等现代图片格式，但实际 GhostTerm 用户
// 大量上传手机微信截图（iOS HEIC）/ 现代相机 / 视频；sniff 失败时按扩展名放行
//
// 安全权衡（重要）：
//   - 仅图片 + 视频 ext 走兜底；文档类（pdf/doc/xlsx 等）不在此表
//   - 原因：PE / Mach-O 等可执行文件改名 .pdf 上传，sniff 多数返 octet-stream，
//     若 .pdf 在兜底表里就会被错误放行；spec §C5 明确把这种攻击列为必拒
//   - 图片视频被改名劫持的风险仅限渲染崩溃，无 RCE 路径，可接受
//   - 加密 PDF / 损坏 docx 等少数 sniff 失败的合法文档，请用户解密 / 修复后再传
var extToInferredMIME = map[string]string{
	// 现代图片格式（sniff 不识别但前端能预览）
	".heic": "image/heic",
	".heif": "image/heif",
	".avif": "image/avif",
	".svg":  "image/svg+xml",
	".bmp":  "image/bmp",
	".tiff": "image/tiff",
	".tif":  "image/tiff",
	// 旧图片格式 sniff 偶尔失效兜底
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	// 视频：仅 mp4 / mov（业务范围）；mov sniff 不识别由 ext 兜底
	".mp4": "video/mp4",
	".mov": "video/quicktime",
}

// ============================================================
// 视图模型（DB 层 → service 层）
// ============================================================

// FileMetaView 是 Upload / Download / List 响应的文件视图。
//
// 字段对齐 0001 migration files 表 + openapi.yaml FileMetadata schema。
// StoragePath 在 service 层暴露用于 Download 时打开磁盘文件；handler 在 oas 转换时不写出。
type FileMetaView struct {
	ID          int64
	UUID        uuid.UUID
	Filename    string
	SizeBytes   int64
	MimeType    string
	StoragePath string
	UploadedBy  int64
	UploadedAt  time.Time
}

// ProjectFileView 是 ListProjectFiles 返回的项目附件视图。
//
// project_files 关联表 + 嵌套 file 元数据（与 oas.ProjectFile schema 对齐）。
type ProjectFileView struct {
	ID        int64
	ProjectID int64
	FileID    int64
	Category  string
	AddedAt   time.Time
	File      FileMetaView
}

// ThesisVersionView 是 CreateThesisVersion / ListThesisVersions 返回的论文版本视图。
//
// 字段含 nullable Remark（指针）；snapshot 嵌入文件元数据避免前端二次拉取。
type ThesisVersionView struct {
	ID         int64
	ProjectID  int64
	FileID     int64
	VersionNo  int
	Remark     *string
	UploadedBy int64
	UploadedAt time.Time
	File       FileMetaView
}

// ============================================================
// Service 装配
// ============================================================

// FileServiceDeps 装配 NewFileService 所需依赖。
//
// 业务背景：拒绝直接 import config —— services 层不感知"配置怎么读"，
// 由 main.go 把 cfg.FileStoragePath / cfg.FileMaxSizeMB 转 byte 上限传入。
type FileServiceDeps struct {
	Pool         *pgxpool.Pool
	StoragePath  string // 绝对路径根目录；启动时 MkdirAll 确保存在
	MaxSizeBytes int64  // 单文件大小上限（字节）
}

// fileService 是 FileService 的具体实现。
type fileService struct {
	pool         *pgxpool.Pool
	storageRoot  string // 已规范化（filepath.Abs + Clean）
	maxSizeBytes int64
}

// 编译时校验
var _ FileService = (*fileService)(nil)

// NewFileService 创建 FileService 实现。
//
// 业务流程：
//  1. 校验依赖完整性（pool / storage / max size 缺失即拒）
//  2. MkdirAll storage root（0o755 让运维进程可读）
//  3. 路径规范化：转绝对 + Clean，方便后续路径遍历检查
func NewFileService(deps FileServiceDeps) (FileService, error) {
	if deps.Pool == nil {
		return nil, errors.New("file_service: pool is required")
	}
	if strings.TrimSpace(deps.StoragePath) == "" {
		return nil, errors.New("file_service: storage path is required")
	}
	if deps.MaxSizeBytes <= 0 {
		return nil, errors.New("file_service: max size must be positive")
	}
	abs, err := filepath.Abs(deps.StoragePath)
	if err != nil {
		return nil, fmt.Errorf("file_service: abs storage path: %w", err)
	}
	abs = filepath.Clean(abs)
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("file_service: mkdir storage: %w", err)
	}
	return &fileService{
		pool:         deps.Pool,
		storageRoot:  abs,
		maxSizeBytes: deps.MaxSizeBytes,
	}, nil
}

// ============================================================
// 文件名清理
// ============================================================

// SanitizeFilename 校验并标准化客户端上传的文件名。
//
// 规则（任一不满足即返回 ErrFileNameInvalid）：
//   - 长度 1..MaxFileNameBytes（UTF-8 字节数）
//   - 不含 NUL (0x00)
//   - 不含 / \\
//   - 不能完全等于 "." / ".." / 空白
//   - 不含 ".." 子串（防 ../etc/passwd 这类利用）
//
// 通过后返回 filepath.Base(name) 结果（兜底剥任何意外路径前缀）。
//
// 业务背景：DB 仅存"展示用"文件名；落盘文件名是 sha256，永不参与文件系统操作。
// 但下载 Content-Disposition 会回传该值，浏览器对 ../ 也会解释为父目录，
// 因此这里仍要严格校验，避免 v1 把恶意名字回灌给浏览器。
func SanitizeFilename(name string) (string, error) {
	if len(name) == 0 {
		return "", ErrFileNameInvalid
	}
	if len(name) > MaxFileNameBytes {
		return "", ErrFileNameInvalid
	}
	if !utf8.ValidString(name) {
		return "", ErrFileNameInvalid
	}
	if strings.ContainsAny(name, "/\\") {
		return "", ErrFileNameInvalid
	}
	if strings.ContainsRune(name, 0x00) {
		return "", ErrFileNameInvalid
	}
	if strings.Contains(name, "..") {
		return "", ErrFileNameInvalid
	}
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." {
		return "", ErrFileNameInvalid
	}
	// 兜底：filepath.Base 即使输入已经无 / \\，再过一道也无副作用
	base := filepath.Base(trimmed)
	if base == "." || base == ".." || base == "" {
		return "", ErrFileNameInvalid
	}
	return base, nil
}

// ============================================================
// MIME 校验
// ============================================================

// detectAndValidateMIME 用 http.DetectContentType 嗅探前 512 字节，与白名单 + 文本前缀比对。
//
// 业务流程：
//  1. http.DetectContentType 永远返回非空（最差也是 application/octet-stream）
//  2. 剥离 "; charset=..." 后缀做精确比对
//  3. 命中 allowedMIME → ok
//  4. 命中 allowedTextPrefix（StartsWith）→ ok
//  5. octet-stream + clientFilename 扩展名在 extToInferredMIME → ok（按扩展推断 MIME）
//  6. 否则 ErrMIMENotAllowed
//
// 设计取舍：
//   - 不在乎客户端 declaredMIME：声明与嗅探一致是常态，不一致时直接采信嗅探结果（更安全）
//   - 嗅探到 application/octet-stream：HEIC/AVIF/SVG 等现代图片 sniff 不出，按扩展名兜底；
//     扩展名可被恶意改但本服务不执行文件，仅存储 + 客户端下载，风险可控
func detectAndValidateMIME(header []byte, clientFilename string) (string, error) {
	sniffed := http.DetectContentType(header)
	// 剥 charset
	mainType := sniffed
	if idx := strings.Index(sniffed, ";"); idx > 0 {
		mainType = strings.TrimSpace(sniffed[:idx])
	}
	mainType = strings.ToLower(mainType)

	if allowedMIME[mainType] {
		return sniffed, nil
	}
	for _, p := range allowedTextPrefix {
		if strings.HasPrefix(mainType, p) {
			return sniffed, nil
		}
	}
	// 兜底：sniff 失败（典型 octet-stream）但客户端文件名扩展名在白名单 → 放行 + 用扩展推断 MIME
	if mainType == "application/octet-stream" && clientFilename != "" {
		ext := strings.ToLower(filepath.Ext(clientFilename))
		if inferred, ok := extToInferredMIME[ext]; ok {
			return inferred, nil
		}
	}
	return sniffed, fmt.Errorf("%w: %s", ErrMIMENotAllowed, sniffed)
}

// ============================================================
// 路径校验
// ============================================================

// ensureUnderRoot 校验 absPath 在 root 下；偏移即返回 ErrPathTraversal。
//
// 业务背景：os.Open / os.Create 自身不防 .. 越界（POSIX 允许 fopen("../etc/passwd")）；
// 必须在文件系统调用前手动比对前缀，且必须用绝对 + Clean 后的路径，
// 否则 "<root>/sub/.." 与 "<root>" 字面前缀比对会通过但实际跳出 root。
func ensureUnderRoot(root, absPath string) error {
	cleaned := filepath.Clean(absPath)
	rootSep := root
	if !strings.HasSuffix(rootSep, string(os.PathSeparator)) {
		rootSep = root + string(os.PathSeparator)
	}
	if cleaned != root && !strings.HasPrefix(cleaned, rootSep) {
		return ErrPathTraversal
	}
	return nil
}

// ============================================================
// Upload
// ============================================================

// Upload 接收客户端上传，做完整安全加固后入库。
//
// 业务流程（v2 part1 §C5）：
//  1. 文件名 sanitize（拒绝 .. / 路径分隔符 / NUL / 超长）
//  2. 读前 512 字节 sniff MIME；与白名单比对（不信任 declaredMIME）
//  3. 把 sniff 头 + 剩余流拼回，边写盘边算 sha256，同时累加字节数
//  4. 写盘策略：先 .tmp 再 Rename，原子；最终路径 <root>/<sha256[0:2]>/<sha256>
//     —— 内容寻址，相同内容多次上传只占一份磁盘
//  5. 路径遍历兜底校验（root/.../filename 永远在 root 下）
//  6. INSERT files 走 RLS 事务（GUC 注入）；files_insert policy 仅校验 current_user_id() 非空
//
// SessionContext = AuthContext，调用方必须传具体 AuthContext 而非 nil。
//
// 设计取舍：
//   - 不预读完整 body 入内存（大文件场景）：边读边写边算 hash，单次流式
//   - sha256 冲突：实际不可能（碰撞概率 2^-128），但仍处理"目标文件已存在"的去重场景
//     —— 已存在时跳过 Rename 并使用现存文件路径，节省磁盘
//   - 出错回滚：tmp 路径用 os.Remove 兜底；INSERT 失败时已 rename 的最终路径不删
//     （别的 file 行可能引用同一 sha256，删了会脏其它行）
func (s *fileService) Upload(
	ctx context.Context,
	sc SessionContext,
	filename string,
	mimeType string,
	size int64,
	body io.Reader,
) (any, error) {
	// 1. session
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}

	// 2. 大小预检（multipart Header 通常带 Size，未带时仍按读取实际字节为准）
	if size > 0 && size > s.maxSizeBytes {
		return nil, ErrFileTooLarge
	}

	// 3. 文件名清理
	cleanName, err := SanitizeFilename(filename)
	if err != nil {
		return nil, err
	}

	// 4. 读 sniff 头
	sniffBuf := make([]byte, SniffSize)
	n, err := io.ReadFull(body, sniffBuf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("file_service: read sniff: %w", err)
	}
	sniffBuf = sniffBuf[:n]
	if n == 0 {
		return nil, ErrFileEmpty
	}
	sniffedMIME, err := detectAndValidateMIME(sniffBuf, cleanName)
	if err != nil {
		return nil, err
	}
	// 客户端声明 MIME 与嗅探不符时，仅记录在 mimeType 字段为嗅探结果（DB 存安全值）
	_ = mimeType // 不直接信任，留参数为审计兼容

	// 5. 边写盘边算 hash
	tmpFile, err := os.CreateTemp(s.storageRoot, ".upload-*.tmp")
	if err != nil {
		return nil, fmt.Errorf("file_service: create tmp: %w", err)
	}
	tmpPath := tmpFile.Name()
	// 失败兜底：成功路径会显式 rename + remove tmp
	cleanupTmp := func() { _ = os.Remove(tmpPath) }

	hasher := sha256.New()
	// 把 sniff 部分写入 tmp + hasher
	if _, err := io.Copy(io.MultiWriter(tmpFile, hasher), bytes.NewReader(sniffBuf)); err != nil {
		_ = tmpFile.Close()
		cleanupTmp()
		return nil, fmt.Errorf("file_service: write sniff: %w", err)
	}

	// 边读边写：用 io.LimitReader 卡上限 + 1（多读 1 字节用于检测溢出）
	// total 已含 sniff 字节
	total := int64(n)
	limit := s.maxSizeBytes - total + 1
	if limit < 0 {
		_ = tmpFile.Close()
		cleanupTmp()
		return nil, ErrFileTooLarge
	}
	limited := io.LimitReader(body, limit)
	written, err := io.Copy(io.MultiWriter(tmpFile, hasher), limited)
	if err != nil {
		_ = tmpFile.Close()
		cleanupTmp()
		return nil, fmt.Errorf("file_service: write body: %w", err)
	}
	total += written
	if err := tmpFile.Close(); err != nil {
		cleanupTmp()
		return nil, fmt.Errorf("file_service: close tmp: %w", err)
	}
	if total > s.maxSizeBytes {
		cleanupTmp()
		return nil, ErrFileTooLarge
	}
	if total == 0 {
		cleanupTmp()
		return nil, ErrFileEmpty
	}

	// 6. 计算最终路径：<root>/<sha[0:2]>/<sha>
	sum := hex.EncodeToString(hasher.Sum(nil))
	subDir := filepath.Join(s.storageRoot, sum[:2])
	finalPath := filepath.Join(subDir, sum)

	// 7. 路径遍历兜底
	if err := ensureUnderRoot(s.storageRoot, finalPath); err != nil {
		cleanupTmp()
		return nil, err
	}

	// 8. 创建子目录 + Rename（去重：finalPath 已存在则保留旧文件，删 tmp）
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		cleanupTmp()
		return nil, fmt.Errorf("file_service: mkdir subdir: %w", err)
	}
	if _, statErr := os.Stat(finalPath); statErr == nil {
		// 已存在（同 sha256 内容已上传过）→ 删 tmp，复用旧文件
		cleanupTmp()
	} else if errors.Is(statErr, os.ErrNotExist) {
		if err := os.Rename(tmpPath, finalPath); err != nil {
			cleanupTmp()
			return nil, fmt.Errorf("file_service: rename: %w", err)
		}
	} else {
		cleanupTmp()
		return nil, fmt.Errorf("file_service: stat final: %w", statErr)
	}

	// 9. INSERT files 走 RLS 事务
	fileUUID := uuid.New()
	var view FileMetaView
	err = progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}
		row := tx.QueryRow(ctx, `
			INSERT INTO files (uuid, filename, size_bytes, mime_type, storage_path, uploaded_by)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, uuid, filename, size_bytes, mime_type, storage_path, uploaded_by, uploaded_at
		`, fileUUID, cleanName, total, sniffedMIME, finalPath, ac.UserID)
		return row.Scan(
			&view.ID, &view.UUID, &view.Filename, &view.SizeBytes,
			&view.MimeType, &view.StoragePath, &view.UploadedBy, &view.UploadedAt,
		)
	})
	if err != nil {
		// INSERT 失败但 finalPath 是内容寻址 + 可能被其他 file 行复用 → 不删磁盘文件
		return nil, fmt.Errorf("file_service: insert files: %w", err)
	}
	return view, nil
}

// ============================================================
// Download
// ============================================================

// Download 流式返回文件内容（不一次性 load 进内存）。
//
// 业务流程：
//  1. session 注入 + 走 RLS 查 files（policy 见 0002 migration：上传者本人 / 项目成员 / ...）
//  2. 校验 storage_path 仍在 root 下（防御编程：DB 行被篡改也兜底）
//  3. os.Open RDONLY 返回 *os.File（实现 io.ReadCloser）
//
// 返回的 io.ReadCloser 由 caller 负责关闭（典型路径：handler defer close）。
func (s *fileService) Download(
	ctx context.Context,
	sc SessionContext,
	fileID int64,
) (string, string, int64, io.ReadCloser, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return "", "", 0, nil, ErrInvalidSessionContext
	}

	var view FileMetaView
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}
		row := tx.QueryRow(ctx, `
			SELECT id, uuid, filename, size_bytes, mime_type, storage_path, uploaded_by, uploaded_at
			FROM files
			WHERE id = $1
		`, fileID)
		return row.Scan(
			&view.ID, &view.UUID, &view.Filename, &view.SizeBytes,
			&view.MimeType, &view.StoragePath, &view.UploadedBy, &view.UploadedAt,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", 0, nil, ErrFileNotFound
		}
		return "", "", 0, nil, fmt.Errorf("file_service: select file: %w", err)
	}

	// 路径遍历兜底（DB 行被改动也防得住）
	abs, err := filepath.Abs(view.StoragePath)
	if err != nil {
		return "", "", 0, nil, fmt.Errorf("file_service: abs storage path: %w", err)
	}
	if err := ensureUnderRoot(s.storageRoot, abs); err != nil {
		return "", "", 0, nil, err
	}

	f, err := os.Open(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", "", 0, nil, ErrFileNotFound
		}
		return "", "", 0, nil, fmt.Errorf("file_service: open file: %w", err)
	}
	return view.Filename, view.MimeType, view.SizeBytes, f, nil
}

// ============================================================
// ListProjectFiles
// ============================================================

// ListProjectFiles 列出指定项目的附件（sample_doc / source_code 两类）。
//
// category 为 nil → 返回所有；非 nil → 仅匹配该 category。
// 行级可见性靠 RLS（is_admin OR is_member(project_id)）。
func (s *fileService) ListProjectFiles(
	ctx context.Context,
	sc SessionContext,
	projectID int64,
	category *string,
) ([]any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}

	var rows pgx.Rows
	var queryErr error
	out := []any{}
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}
		if category == nil {
			rows, queryErr = tx.Query(ctx, `
				SELECT
					pf.id, pf.project_id, pf.file_id, pf.category, pf.added_at,
					f.id, f.uuid, f.filename, f.size_bytes, f.mime_type, f.storage_path,
					f.uploaded_by, f.uploaded_at
				FROM project_files pf
				JOIN files f ON f.id = pf.file_id
				WHERE pf.project_id = $1
				ORDER BY pf.added_at DESC, pf.id DESC
			`, projectID)
		} else {
			rows, queryErr = tx.Query(ctx, `
				SELECT
					pf.id, pf.project_id, pf.file_id, pf.category, pf.added_at,
					f.id, f.uuid, f.filename, f.size_bytes, f.mime_type, f.storage_path,
					f.uploaded_by, f.uploaded_at
				FROM project_files pf
				JOIN files f ON f.id = pf.file_id
				WHERE pf.project_id = $1 AND pf.category = $2
				ORDER BY pf.added_at DESC, pf.id DESC
			`, projectID, *category)
		}
		if queryErr != nil {
			return fmt.Errorf("file_service: query project files: %w", queryErr)
		}
		defer rows.Close()
		for rows.Next() {
			var v ProjectFileView
			if err := rows.Scan(
				&v.ID, &v.ProjectID, &v.FileID, &v.Category, &v.AddedAt,
				&v.File.ID, &v.File.UUID, &v.File.Filename, &v.File.SizeBytes,
				&v.File.MimeType, &v.File.StoragePath, &v.File.UploadedBy, &v.File.UploadedAt,
			); err != nil {
				return fmt.Errorf("file_service: scan project file: %w", err)
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ============================================================
// AttachToProject
// ============================================================

// AttachToProject 把已上传文件挂到项目下。
//
// category 必须 = "sample_doc" 或 "source_code"（DB CHECK 约束保护）。
// RLS 策略：is_admin OR is_member(project_id)；非 member 触发即 INSERT 0 行 → 返回 ErrFileNotFound。
func (s *fileService) AttachToProject(
	ctx context.Context,
	sc SessionContext,
	projectID, fileID int64,
	category string,
) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}
	if category != "sample_doc" && category != "source_code" {
		return nil, fmt.Errorf("%w: invalid category %q", ErrFileNameInvalid, category)
	}

	var v ProjectFileView
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}
		row := tx.QueryRow(ctx, `
			INSERT INTO project_files (project_id, file_id, category)
			VALUES ($1, $2, $3)
			RETURNING id, project_id, file_id, category, added_at
		`, projectID, fileID, category)
		if err := row.Scan(&v.ID, &v.ProjectID, &v.FileID, &v.Category, &v.AddedAt); err != nil {
			return err
		}
		// 拉文件元数据
		fr := tx.QueryRow(ctx, `
			SELECT id, uuid, filename, size_bytes, mime_type, storage_path, uploaded_by, uploaded_at
			FROM files WHERE id = $1
		`, fileID)
		return fr.Scan(
			&v.File.ID, &v.File.UUID, &v.File.Filename, &v.File.SizeBytes,
			&v.File.MimeType, &v.File.StoragePath, &v.File.UploadedBy, &v.File.UploadedAt,
		)
	})
	if err != nil {
		return nil, fmt.Errorf("file_service: attach to project: %w", err)
	}
	return v, nil
}

// ============================================================
// CreateThesisVersion / ListThesisVersions
// ============================================================
//
// 这两个方法委托给 thesis_versions_service.go 内的 helper 函数实现，
// 但接口声明在 FileService 上 —— 业务上"论文版本"是文件功能的子能力。

// CreateThesisVersion 委托到 createThesisVersionImpl（同一 service 实例共享 pool）。
func (s *fileService) CreateThesisVersion(
	ctx context.Context,
	sc SessionContext,
	projectID, fileID int64,
	remark string,
) (any, error) {
	return createThesisVersionImpl(ctx, s.pool, sc, projectID, fileID, remark)
}

// ListThesisVersions 委托到 listThesisVersionsImpl。
func (s *fileService) ListThesisVersions(
	ctx context.Context,
	sc SessionContext,
	projectID int64,
) ([]any, error) {
	return listThesisVersionsImpl(ctx, s.pool, sc, projectID)
}

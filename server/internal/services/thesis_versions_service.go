/*
@file thesis_versions_service.go
@description 论文版本不可变（immutable）的语义实现。

             业务背景（spec §9.2）：
             - 上传新版 → INSERT 一行 thesis_versions，version_no 单调递增
             - 永不允许 UPDATE / DELETE 已存在版本（保留全部历史 audit trail）
             - DB 层用 UNIQUE(project_id, version_no) + 应用层不暴露 mutator 双保险

             并发设计（v2 part2 §W5）：
             - 同一项目并发上传 v3：两个 tx 都跑 SELECT MAX(version_no)+1 = 3 → 一个 INSERT 成功
               另一个 INSERT 因 UNIQUE 冲突失败；service 层捕获 23505 重新计算
             - 不用 advisory lock：DB 唯一约束已是单一可信源，advisory lock 多一道复杂度
             - 不用 SERIALIZABLE：UNIQUE 已强制原子，REPEATABLE READ 不必要

             RLS 注入：
             - thesis_versions_all policy = is_admin OR is_member(project_id)
             - 非 member 调用 Create → INSERT 失败（policy 拦截 + return 0 rows）
             - 非 member 调用 List → SELECT 0 行
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// createThesisVersionImpl 在事务内分配 version_no 并 INSERT thesis_versions。
//
// 业务流程：
//  1. SetSessionContext 让 RLS 看到 user/role
//  2. SELECT COALESCE(MAX(version_no), 0) + 1 → next_v
//  3. INSERT thesis_versions(...) RETURNING 全字段 + 嵌套文件 metadata
//  4. UNIQUE(project_id, version_no) 冲突 → 重试一次（外层 tx 已 rollback，不重试同一 tx）
//
// remark 空字符串等同 NULL（前端写空白等价于不填）。
func createThesisVersionImpl(
	ctx context.Context,
	pool *pgxpool.Pool,
	sc SessionContext,
	projectID, fileID int64,
	remark string,
) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}

	// 重试一次：第一次 SELECT MAX 与第二次 INSERT 之间被并发 INSERT 抢先 → UNIQUE 冲突
	const maxAttempts = 3
	var view ThesisVersionView
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := progressdb.InTx(ctx, pool, func(tx pgx.Tx) error {
			if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
				return err
			}

			// 计算 next version_no（当前事务可见的最大值 + 1）
			var nextV int
			if err := tx.QueryRow(ctx, `
				SELECT COALESCE(MAX(version_no), 0) + 1
				FROM thesis_versions
				WHERE project_id = $1
			`, projectID).Scan(&nextV); err != nil {
				return fmt.Errorf("thesis_version: select max version: %w", err)
			}

			var remarkArg interface{}
			if strings.TrimSpace(remark) == "" {
				remarkArg = nil
			} else {
				remarkArg = remark
			}

			row := tx.QueryRow(ctx, `
				INSERT INTO thesis_versions (project_id, file_id, version_no, remark, uploaded_by)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING id, project_id, file_id, version_no, remark, uploaded_by, uploaded_at
			`, projectID, fileID, nextV, remarkArg, ac.UserID)
			var dbRemark *string
			if err := row.Scan(
				&view.ID, &view.ProjectID, &view.FileID, &view.VersionNo,
				&dbRemark, &view.UploadedBy, &view.UploadedAt,
			); err != nil {
				return err
			}
			view.Remark = dbRemark

			// 拉嵌套 file metadata
			fr := tx.QueryRow(ctx, `
				SELECT id, uuid, filename, size_bytes, mime_type, storage_path, uploaded_by, uploaded_at
				FROM files WHERE id = $1
			`, fileID)
			return fr.Scan(
				&view.File.ID, &view.File.UUID, &view.File.Filename, &view.File.SizeBytes,
				&view.File.MimeType, &view.File.StoragePath, &view.File.UploadedBy, &view.File.UploadedAt,
			)
		})
		if err == nil {
			return view, nil
		}
		// UNIQUE 冲突 → 重试
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			continue
		}
		return nil, fmt.Errorf("thesis_version: create: %w", err)
	}
	return nil, fmt.Errorf("thesis_version: create: exhausted %d retries on UNIQUE conflict", maxAttempts)
}

// listThesisVersionsImpl 列出项目的所有论文版本（version_no 倒序，最新在前）。
//
// 嵌套返回 file 元数据，避免前端二次拉取（spec §9.2 UI 列表展示）。
func listThesisVersionsImpl(
	ctx context.Context,
	pool *pgxpool.Pool,
	sc SessionContext,
	projectID int64,
) ([]any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}

	out := []any{}
	err := progressdb.InTx(ctx, pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT
				tv.id, tv.project_id, tv.file_id, tv.version_no, tv.remark,
				tv.uploaded_by, tv.uploaded_at,
				f.id, f.uuid, f.filename, f.size_bytes, f.mime_type, f.storage_path,
				f.uploaded_by, f.uploaded_at
			FROM thesis_versions tv
			JOIN files f ON f.id = tv.file_id
			WHERE tv.project_id = $1
			ORDER BY tv.version_no DESC
		`, projectID)
		if err != nil {
			return fmt.Errorf("thesis_version: query list: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var v ThesisVersionView
			var dbRemark *string
			if err := rows.Scan(
				&v.ID, &v.ProjectID, &v.FileID, &v.VersionNo, &dbRemark,
				&v.UploadedBy, &v.UploadedAt,
				&v.File.ID, &v.File.UUID, &v.File.Filename, &v.File.SizeBytes,
				&v.File.MimeType, &v.File.StoragePath, &v.File.UploadedBy, &v.File.UploadedAt,
			); err != nil {
				return fmt.Errorf("thesis_version: scan: %w", err)
			}
			v.Remark = dbRemark
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

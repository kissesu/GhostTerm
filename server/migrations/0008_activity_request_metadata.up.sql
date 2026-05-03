-- @file 0008_activity_request_metadata.up.sql
-- @description 时间线审计字段扩充 - 7 张事件源表 + projects 各加 client_ip/user_agent 列；
--              project_activity_view 重建携带这两列。
--
--              业务背景（用户原话 2026-05-03）：
--                "需要在反馈、状态、创建 tag 右侧显示提交当前时间线的用户账号的功能, 这样
--                 时间线信息才完整"
--                后续展开为审计四件套：actorUsername (Task 1) + clientIP/userAgent (本迁移) +
--                dwellMs (后续) + attachmentCount (后续)
--
--              选型决策（用户拍板 B，2026-05-03）：
--                - 不建共享 activity_metadata 表
--                - 7 张活动事件源表（projects/feedbacks/status_change_logs/quote_change_logs/
--                  payments/thesis_versions/project_files）各加 client_ip/user_agent
--                - 不动 files 表：files 是文件元数据存储，本身不是 activity event
--                  （project_activity_view 不 UNION files），加列属 YAGNI
--                - 跳过 event_channel 列（用户明确"只有 tauri，不会开发 web/api/mobile"，
--                  单值字段不携带信息属 YAGNI）
--
--              IP 列用 INET 类型而非 TEXT：PostgreSQL 原生支持 IPv4/IPv6 + 网段查询；
--              user_agent 用 TEXT（NULL 允许，老数据回填用 NULL）。
--
-- @author Atlas.oi
-- @date 2026-05-03

BEGIN;

-- =========================================================
-- 1. 7 张活动事件源表加 client_ip/user_agent（INET / TEXT，NULL 允许向后兼容老行）
-- =========================================================

ALTER TABLE projects           ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;
ALTER TABLE feedbacks          ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;
ALTER TABLE status_change_logs ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;
ALTER TABLE quote_change_logs  ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;
ALTER TABLE payments           ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;
ALTER TABLE thesis_versions    ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;
ALTER TABLE project_files      ADD COLUMN client_ip INET, ADD COLUMN user_agent TEXT;

-- =========================================================
-- 2. project_activity_view 重建：UNION ALL 8 个分支携带 client_ip/user_agent 列
--    （0006 视图同名，DROP + CREATE 完整复刻原 SELECT 形状 + 加新列）
-- =========================================================

DROP VIEW IF EXISTS project_activity_view;

CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    p.id AS source_id,
    p.id AS project_id,
    'project_created'::text AS kind,
    p.created_at AS occurred_at,
    p.created_by AS actor_id,
    p.client_ip,
    p.user_agent,
    jsonb_build_object(
        'name', p.name,
        'status', p.status::text,
        'priority', p.priority::text,
        'deadline', p.deadline,
        'originalQuote', p.original_quote::text
    ) AS payload
FROM projects p

UNION ALL
SELECT
    f.id, f.project_id, 'feedback'::text, f.recorded_at, f.recorded_by,
    f.client_ip, f.user_agent,
    jsonb_build_object(
        'content', f.content,
        'source', f.source::text,
        'status', f.status::text
    )
FROM feedbacks f

UNION ALL
SELECT
    s.id, s.project_id, 'status_change'::text, s.triggered_at, s.triggered_by,
    s.client_ip, s.user_agent,
    jsonb_build_object(
        'eventCode', s.event_code,
        'eventName', s.event_name,
        'fromStatus', s.from_status::text,
        'toStatus', s.to_status::text,
        'fromHolderRoleId', s.from_holder_role_id,
        'toHolderRoleId', s.to_holder_role_id,
        'fromHolderUserId', s.from_holder_user_id,
        'toHolderUserId', s.to_holder_user_id,
        'remark', s.remark
    )
FROM status_change_logs s

UNION ALL
SELECT
    q.id, q.project_id, 'quote_change'::text, q.changed_at, q.changed_by,
    q.client_ip, q.user_agent,
    jsonb_build_object(
        'changeType', q.change_type::text,
        'delta', q.delta::text,
        'oldQuote', q.old_quote::text,
        'newQuote', q.new_quote::text,
        'reason', q.reason,
        'phase', q.phase::text
    )
FROM quote_change_logs q

UNION ALL
SELECT
    pay.id, pay.project_id, 'payment'::text, pay.recorded_at, pay.recorded_by,
    pay.client_ip, pay.user_agent,
    jsonb_build_object(
        'direction', pay.direction::text,
        'amount', pay.amount::text,
        'paidAt', pay.paid_at,
        'relatedUserId', pay.related_user_id,
        'screenshotId', pay.screenshot_id,
        'remark', pay.remark
    )
FROM payments pay

UNION ALL
SELECT
    tv.id, tv.project_id, 'thesis_version'::text, tv.uploaded_at, tv.uploaded_by,
    tv.client_ip, tv.user_agent,
    jsonb_build_object(
        'fileId', tv.file_id,
        'versionNo', tv.version_no,
        'remark', tv.remark
    )
FROM thesis_versions tv

UNION ALL
SELECT
    pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by,
    pf.client_ip, pf.user_agent,
    jsonb_build_object(
        'fileId', pf.file_id,
        'category', pf.category
    )
FROM project_files pf;

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

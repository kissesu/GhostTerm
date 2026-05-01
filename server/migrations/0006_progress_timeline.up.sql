-- @file 0006_progress_timeline.up.sql
-- @description 进度时间线聚合所需 schema 改动
--   1. project_files 加 added_by NOT NULL（先 TRUNCATE 让现有行不阻塞）
--   2. 补齐性能索引（VIEW UNION ALL 按 project_id + 时间倒序读取需要）
--   3. 创建 project_activity_view 聚合 7 张事件表
-- @author Atlas.oi
-- @date 2026-05-01

BEGIN;

-- 1. project_files 清场 + 加 added_by NOT NULL
TRUNCATE TABLE project_files RESTART IDENTITY CASCADE;

ALTER TABLE project_files
    ADD COLUMN added_by BIGINT NOT NULL REFERENCES users(id);

CREATE INDEX idx_project_files_added_by
    ON project_files(added_by);

-- 2. 补齐性能索引（IF NOT EXISTS 兼容已存在）
CREATE INDEX IF NOT EXISTS idx_project_files_project_added_at
    ON project_files(project_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_project_recorded_at
    ON payments(project_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_thesis_versions_project_uploaded_at
    ON thesis_versions(project_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_change_logs_project_triggered_at
    ON status_change_logs(project_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_change_logs_project_changed_at
    ON quote_change_logs(project_id, changed_at DESC);

-- 3. 聚合 VIEW（7 张事件表 UNION ALL，payload jsonb）
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
    jsonb_build_object(
        'content', f.content,
        'source', f.source::text,
        'status', f.status::text
    )
FROM feedbacks f

UNION ALL
SELECT
    s.id, s.project_id, 'status_change'::text, s.triggered_at, s.triggered_by,
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
    jsonb_build_object(
        'fileId', tv.file_id,
        'versionNo', tv.version_no,
        'remark', tv.remark
    )
FROM thesis_versions tv

UNION ALL
SELECT
    pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by,
    jsonb_build_object(
        'fileId', pf.file_id,
        'category', pf.category
    )
FROM project_files pf;

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

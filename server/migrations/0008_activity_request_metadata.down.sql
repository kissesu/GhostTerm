-- @file 0008_activity_request_metadata.down.sql
-- @description 回滚 0008：恢复 0006 视图（不带 client_ip/user_agent）+ 删 8 张表的两列
-- @author Atlas.oi
-- @date 2026-05-03

BEGIN;

DROP VIEW IF EXISTS project_activity_view;

ALTER TABLE projects           DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;
ALTER TABLE feedbacks          DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;
ALTER TABLE status_change_logs DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;
ALTER TABLE quote_change_logs  DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;
ALTER TABLE payments           DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;
ALTER TABLE thesis_versions    DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;
ALTER TABLE project_files      DROP COLUMN IF EXISTS client_ip, DROP COLUMN IF EXISTS user_agent;

-- 重建 0006 原版 view（不带 client_ip/user_agent 列）
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
UNION ALL SELECT f.id, f.project_id, 'feedback'::text, f.recorded_at, f.recorded_by,
    jsonb_build_object('content', f.content, 'source', f.source::text, 'status', f.status::text)
FROM feedbacks f
UNION ALL SELECT s.id, s.project_id, 'status_change'::text, s.triggered_at, s.triggered_by,
    jsonb_build_object('eventCode', s.event_code, 'eventName', s.event_name,
        'fromStatus', s.from_status::text, 'toStatus', s.to_status::text,
        'fromHolderRoleId', s.from_holder_role_id, 'toHolderRoleId', s.to_holder_role_id,
        'fromHolderUserId', s.from_holder_user_id, 'toHolderUserId', s.to_holder_user_id,
        'remark', s.remark)
FROM status_change_logs s
UNION ALL SELECT q.id, q.project_id, 'quote_change'::text, q.changed_at, q.changed_by,
    jsonb_build_object('changeType', q.change_type::text, 'delta', q.delta::text,
        'oldQuote', q.old_quote::text, 'newQuote', q.new_quote::text,
        'reason', q.reason, 'phase', q.phase::text)
FROM quote_change_logs q
UNION ALL SELECT pay.id, pay.project_id, 'payment'::text, pay.recorded_at, pay.recorded_by,
    jsonb_build_object('direction', pay.direction::text, 'amount', pay.amount::text,
        'paidAt', pay.paid_at, 'relatedUserId', pay.related_user_id,
        'screenshotId', pay.screenshot_id, 'remark', pay.remark)
FROM payments pay
UNION ALL SELECT tv.id, tv.project_id, 'thesis_version'::text, tv.uploaded_at, tv.uploaded_by,
    jsonb_build_object('fileId', tv.file_id, 'versionNo', tv.version_no, 'remark', tv.remark)
FROM thesis_versions tv
UNION ALL SELECT pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by,
    jsonb_build_object('fileId', pf.file_id, 'category', pf.category)
FROM project_files pf;

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

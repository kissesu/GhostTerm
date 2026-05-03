-- @file 0009_activity_view_dwell_ms.down.sql
-- @description 回滚 0009：恢复 0008 视图（status_change 不带 dwellMs）
-- @author Atlas.oi
-- @date 2026-05-03

BEGIN;

DROP VIEW IF EXISTS project_activity_view;

CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
SELECT p.id, p.id, 'project_created'::text, p.created_at, p.created_by,
    p.client_ip, p.user_agent,
    jsonb_build_object('name', p.name, 'status', p.status::text, 'priority', p.priority::text,
        'deadline', p.deadline, 'originalQuote', p.original_quote::text)
FROM projects p
UNION ALL SELECT f.id, f.project_id, 'feedback'::text, f.recorded_at, f.recorded_by,
    f.client_ip, f.user_agent,
    jsonb_build_object('content', f.content, 'source', f.source::text, 'status', f.status::text)
FROM feedbacks f
UNION ALL SELECT s.id, s.project_id, 'status_change'::text, s.triggered_at, s.triggered_by,
    s.client_ip, s.user_agent,
    jsonb_build_object('eventCode', s.event_code, 'eventName', s.event_name,
        'fromStatus', s.from_status::text, 'toStatus', s.to_status::text,
        'fromHolderRoleId', s.from_holder_role_id, 'toHolderRoleId', s.to_holder_role_id,
        'fromHolderUserId', s.from_holder_user_id, 'toHolderUserId', s.to_holder_user_id,
        'remark', s.remark)
FROM status_change_logs s
UNION ALL SELECT q.id, q.project_id, 'quote_change'::text, q.changed_at, q.changed_by,
    q.client_ip, q.user_agent,
    jsonb_build_object('changeType', q.change_type::text, 'delta', q.delta::text,
        'oldQuote', q.old_quote::text, 'newQuote', q.new_quote::text,
        'reason', q.reason, 'phase', q.phase::text)
FROM quote_change_logs q
UNION ALL SELECT pay.id, pay.project_id, 'payment'::text, pay.recorded_at, pay.recorded_by,
    pay.client_ip, pay.user_agent,
    jsonb_build_object('direction', pay.direction::text, 'amount', pay.amount::text,
        'paidAt', pay.paid_at, 'relatedUserId', pay.related_user_id,
        'screenshotId', pay.screenshot_id, 'remark', pay.remark)
FROM payments pay
UNION ALL SELECT tv.id, tv.project_id, 'thesis_version'::text, tv.uploaded_at, tv.uploaded_by,
    tv.client_ip, tv.user_agent,
    jsonb_build_object('fileId', tv.file_id, 'versionNo', tv.version_no, 'remark', tv.remark)
FROM thesis_versions tv
UNION ALL SELECT pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by,
    pf.client_ip, pf.user_agent,
    jsonb_build_object('fileId', pf.file_id, 'category', pf.category)
FROM project_files pf;

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

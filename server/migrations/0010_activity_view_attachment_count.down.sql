-- @file 0010_activity_view_attachment_count.down.sql
-- @description 回滚 0010：恢复 0009 视图（feedback 不带 attachmentCount）
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
UNION ALL
SELECT sc.id, sc.project_id, 'status_change'::text, sc.triggered_at, sc.triggered_by,
    sc.client_ip, sc.user_agent,
    jsonb_build_object('eventCode', sc.event_code, 'eventName', sc.event_name,
        'fromStatus', sc.from_status::text, 'toStatus', sc.to_status::text,
        'fromHolderRoleId', sc.from_holder_role_id, 'toHolderRoleId', sc.to_holder_role_id,
        'fromHolderUserId', sc.from_holder_user_id, 'toHolderUserId', sc.to_holder_user_id,
        'remark', sc.remark, 'dwellMs', sc.dwell_ms)
FROM (
    SELECT s.*,
        EXTRACT(EPOCH FROM (s.triggered_at - LAG(s.triggered_at) OVER (
            PARTITION BY s.project_id ORDER BY s.triggered_at))) * 1000 AS dwell_ms
    FROM status_change_logs s
) sc
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

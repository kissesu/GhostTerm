-- @file 0020_remove_dealing_status.down.sql
-- @description 回滚 0020：恢复 dealing 状态 + dealing_at 列；删除 progress:project:cancel 权限。
--              注意：原 dealing 状态项目数据已被 0020 TRUNCATE，回滚后无法恢复（用户授权清空）。
-- @author Atlas.oi
-- @date 2026-05-04

BEGIN;

-- 1. 清空（与 up 镜像；回滚也是从干净状态开始）
TRUNCATE TABLE projects RESTART IDENTITY CASCADE;
DROP VIEW IF EXISTS project_activity_view;

-- 2. 删除 cancel 权限（含 role_permissions 引用因 ON DELETE CASCADE 一并清）
DELETE FROM permissions WHERE (resource, action, scope) IN (
    ('progress', 'project', 'cancel'),
    ('progress', 'project', 'after_sales')
);

-- 3. 恢复 dealing 到 enum
ALTER TABLE projects ALTER COLUMN status DROP DEFAULT;
ALTER TABLE projects ALTER COLUMN status TYPE TEXT USING status::TEXT;
ALTER TABLE status_change_logs ALTER COLUMN from_status TYPE TEXT USING from_status::TEXT;
ALTER TABLE status_change_logs ALTER COLUMN to_status TYPE TEXT USING to_status::TEXT;
ALTER TABLE quote_change_logs ALTER COLUMN phase TYPE TEXT USING phase::TEXT;

DROP TYPE project_status;
CREATE TYPE project_status AS ENUM (
    'dealing',
    'quoting',
    'developing',
    'confirming',
    'delivered',
    'paid',
    'archived',
    'after_sales',
    'cancelled'
);

ALTER TABLE projects ALTER COLUMN status TYPE project_status USING status::project_status;
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'dealing';
ALTER TABLE status_change_logs ALTER COLUMN from_status TYPE project_status USING from_status::project_status;
ALTER TABLE status_change_logs ALTER COLUMN to_status TYPE project_status USING to_status::project_status;
ALTER TABLE quote_change_logs ALTER COLUMN phase TYPE project_status USING phase::project_status;

-- 4. 恢复 dealing_at 列
ALTER TABLE projects ADD COLUMN dealing_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 5. 视图重建（复刻 0018 完整版本）
CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    p.id AS source_id, p.id AS project_id, 'project_created'::text AS kind,
    p.created_at AS occurred_at, p.created_by AS actor_id, p.client_ip, p.user_agent,
    jsonb_build_object(
        'name', p.name,
        'status', p.status::text,
        'priority', p.priority::text,
        'deadline', p.deadline,
        'originalQuote', p.original_quote::text,
        'openingDoc', CASE WHEN of.id IS NOT NULL THEN jsonb_build_object('id', of.id, 'filename', of.filename) ELSE NULL END,
        'assignmentDoc', CASE WHEN af.id IS NOT NULL THEN jsonb_build_object('id', af.id, 'filename', af.filename) ELSE NULL END,
        'wechatChats', COALESCE(wc.list, '[]'::jsonb),
        'developers', COALESCE(devs.list, '[]'::jsonb)
    ) AS payload
FROM projects p
LEFT JOIN files of ON of.id = p.opening_doc_id
LEFT JOIN files af ON af.id = p.assignment_doc_id
LEFT JOIN (
    SELECT pf.project_id, jsonb_agg(jsonb_build_object('id', files.id, 'filename', files.filename) ORDER BY pf.id) AS list
    FROM project_files pf JOIN files ON files.id = pf.file_id WHERE pf.category = 'wechat_chat' GROUP BY pf.project_id
) wc ON wc.project_id = p.id
LEFT JOIN (
    SELECT pd.project_id, jsonb_agg(jsonb_build_object('id', u.id, 'displayName', COALESCE(u.display_name, u.username)) ORDER BY pd.assigned_at, u.id) AS list
    FROM project_developers pd JOIN users u ON u.id = pd.user_id GROUP BY pd.project_id
) devs ON devs.project_id = p.id
UNION ALL
SELECT f.id, f.project_id, 'feedback'::text, f.recorded_at, f.recorded_by, f.client_ip, f.user_agent,
    jsonb_build_object('content', f.content, 'source', f.source::text, 'status', f.status::text,
        'attachmentCount', COALESCE(att.cnt, 0), 'attachments', COALESCE(att.list, '[]'::jsonb))
FROM feedbacks f
LEFT JOIN (
    SELECT fa.feedback_id, jsonb_agg(jsonb_build_object('id', files.id, 'filename', files.filename) ORDER BY fa.id) AS list, COUNT(*) AS cnt
    FROM feedback_attachments fa JOIN files ON files.id = fa.file_id GROUP BY fa.feedback_id
) att ON att.feedback_id = f.id
UNION ALL
SELECT sc.id, sc.project_id, 'status_change'::text, sc.triggered_at, sc.triggered_by, sc.client_ip, sc.user_agent,
    jsonb_build_object('eventCode', sc.event_code, 'eventName', sc.event_name,
        'fromStatus', sc.from_status::text, 'toStatus', sc.to_status::text,
        'fromHolderRoleId', sc.from_holder_role_id, 'toHolderRoleId', sc.to_holder_role_id,
        'fromHolderUserId', sc.from_holder_user_id, 'toHolderUserId', sc.to_holder_user_id,
        'remark', sc.remark, 'dwellMs', sc.dwell_ms)
FROM (
    SELECT s.*, EXTRACT(EPOCH FROM (s.triggered_at - LAG(s.triggered_at) OVER (PARTITION BY s.project_id ORDER BY s.triggered_at))) * 1000 AS dwell_ms
    FROM status_change_logs s WHERE s.event_code != 'E0'
) sc
UNION ALL
SELECT q.id, q.project_id, 'quote_change'::text, q.changed_at, q.changed_by, q.client_ip, q.user_agent,
    jsonb_build_object('changeType', q.change_type::text, 'delta', q.delta::text,
        'oldQuote', q.old_quote::text, 'newQuote', q.new_quote::text, 'reason', q.reason, 'phase', q.phase::text)
FROM quote_change_logs q
UNION ALL
SELECT pay.id, pay.project_id, 'payment'::text, pay.recorded_at, pay.recorded_by, pay.client_ip, pay.user_agent,
    jsonb_build_object('direction', pay.direction::text, 'amount', pay.amount::text,
        'paidAt', pay.paid_at, 'relatedUserId', pay.related_user_id, 'screenshotId', pay.screenshot_id,
        'remark', pay.remark, 'attachments', COALESCE(patt.list, '[]'::jsonb))
FROM payments pay
LEFT JOIN (
    SELECT pa.payment_id, jsonb_agg(jsonb_build_object('id', files.id, 'filename', files.filename) ORDER BY pa.attached_at, files.id) AS list
    FROM payment_attachments pa JOIN files ON files.id = pa.file_id GROUP BY pa.payment_id
) patt ON patt.payment_id = pay.id
UNION ALL
SELECT tv.id, tv.project_id, 'thesis_version'::text, tv.uploaded_at, tv.uploaded_by, tv.client_ip, tv.user_agent,
    jsonb_build_object('fileId', tv.file_id, 'versionNo', tv.version_no, 'remark', tv.remark, 'filename', tvf.filename)
FROM thesis_versions tv JOIN files tvf ON tvf.id = tv.file_id
UNION ALL
SELECT pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by, pf.client_ip, pf.user_agent,
    jsonb_build_object('fileId', pf.file_id, 'category', pf.category, 'filename', pff.filename)
FROM project_files pf JOIN files pff ON pff.id = pf.file_id WHERE pf.category != 'wechat_chat';

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

-- @file 0018_activity_view_project_created_developers.up.sql
-- @description 用户反馈 2026-05-03"项目创建详情应该显示对接开发人员字段"。
--              在 project_activity_view 的 project_created 分支加 developers jsonb_agg
--              数组（来自 project_developers JOIN users）让前端 ActivityDetailDialog
--              拿到对接开发人员名单。
--
--              其他 6 个分支（feedback / status_change / quote_change / payment /
--              thesis_version / project_file_added）与 0016 完全一致，整体 DROP+CREATE
--              （ALTER VIEW 不能 ADD COLUMN，参见记忆 feedback_pg_view_lag_subquery_alter_view）。
--
-- @author Atlas.oi
-- @date 2026-05-03

BEGIN;

DROP VIEW IF EXISTS project_activity_view;

CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
-- project_created 分支【0018 新增 developers】：LEFT JOIN project_developers + users 拿 displayName
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
        'originalQuote', p.original_quote::text,
        'openingDoc', CASE
            WHEN of.id IS NOT NULL
            THEN jsonb_build_object('id', of.id, 'filename', of.filename)
            ELSE NULL
        END,
        'assignmentDoc', CASE
            WHEN af.id IS NOT NULL
            THEN jsonb_build_object('id', af.id, 'filename', af.filename)
            ELSE NULL
        END,
        'wechatChats', COALESCE(wc.list, '[]'::jsonb),
        'developers', COALESCE(devs.list, '[]'::jsonb)
    ) AS payload
FROM projects p
LEFT JOIN files of ON of.id = p.opening_doc_id
LEFT JOIN files af ON af.id = p.assignment_doc_id
LEFT JOIN (
    SELECT
        pf.project_id,
        jsonb_agg(
            jsonb_build_object('id', files.id, 'filename', files.filename)
            ORDER BY pf.id
        ) AS list
    FROM project_files pf
    JOIN files ON files.id = pf.file_id
    WHERE pf.category = 'wechat_chat'
    GROUP BY pf.project_id
) wc ON wc.project_id = p.id
LEFT JOIN (
    SELECT
        pd.project_id,
        jsonb_agg(
            jsonb_build_object('id', u.id, 'displayName', COALESCE(u.display_name, u.username))
            ORDER BY pd.assigned_at, u.id
        ) AS list
    FROM project_developers pd
    JOIN users u ON u.id = pd.user_id
    GROUP BY pd.project_id
) devs ON devs.project_id = p.id

UNION ALL
-- feedback 分支：保留 0016 attachments jsonb_agg 设计
SELECT
    f.id, f.project_id, 'feedback'::text, f.recorded_at, f.recorded_by,
    f.client_ip, f.user_agent,
    jsonb_build_object(
        'content', f.content,
        'source', f.source::text,
        'status', f.status::text,
        'attachmentCount', COALESCE(att.cnt, 0),
        'attachments', COALESCE(att.list, '[]'::jsonb)
    )
FROM feedbacks f
LEFT JOIN (
    SELECT
        fa.feedback_id,
        jsonb_agg(
            jsonb_build_object('id', files.id, 'filename', files.filename)
            ORDER BY fa.id
        ) AS list,
        COUNT(*) AS cnt
    FROM feedback_attachments fa
    JOIN files ON files.id = fa.file_id
    GROUP BY fa.feedback_id
) att ON att.feedback_id = f.id

UNION ALL
-- status_change：保留 0016 过滤 E0 + LAG dwell_ms 设计
SELECT
    sc.id, sc.project_id, 'status_change'::text, sc.triggered_at, sc.triggered_by,
    sc.client_ip, sc.user_agent,
    jsonb_build_object(
        'eventCode', sc.event_code,
        'eventName', sc.event_name,
        'fromStatus', sc.from_status::text,
        'toStatus', sc.to_status::text,
        'fromHolderRoleId', sc.from_holder_role_id,
        'toHolderRoleId', sc.to_holder_role_id,
        'fromHolderUserId', sc.from_holder_user_id,
        'toHolderUserId', sc.to_holder_user_id,
        'remark', sc.remark,
        'dwellMs', sc.dwell_ms
    )
FROM (
    SELECT
        s.*,
        EXTRACT(EPOCH FROM (
            s.triggered_at - LAG(s.triggered_at) OVER (
                PARTITION BY s.project_id
                ORDER BY s.triggered_at
            )
        )) * 1000 AS dwell_ms
    FROM status_change_logs s
    WHERE s.event_code != 'E0'
) sc

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
-- payment 分支：保留 0015/0016 LEFT JOIN payment_attachments + jsonb_agg 设计
SELECT
    pay.id, pay.project_id, 'payment'::text, pay.recorded_at, pay.recorded_by,
    pay.client_ip, pay.user_agent,
    jsonb_build_object(
        'direction', pay.direction::text,
        'amount', pay.amount::text,
        'paidAt', pay.paid_at,
        'relatedUserId', pay.related_user_id,
        'screenshotId', pay.screenshot_id,
        'remark', pay.remark,
        'attachments', COALESCE(patt.list, '[]'::jsonb)
    )
FROM payments pay
LEFT JOIN (
    SELECT
        pa.payment_id,
        jsonb_agg(
            jsonb_build_object('id', files.id, 'filename', files.filename)
            ORDER BY pa.attached_at, files.id
        ) AS list
    FROM payment_attachments pa
    JOIN files ON files.id = pa.file_id
    GROUP BY pa.payment_id
) patt ON patt.payment_id = pay.id

UNION ALL
-- thesis_version 分支：保留 0016 JOIN files 拿 filename
SELECT
    tv.id, tv.project_id, 'thesis_version'::text, tv.uploaded_at, tv.uploaded_by,
    tv.client_ip, tv.user_agent,
    jsonb_build_object(
        'fileId', tv.file_id,
        'versionNo', tv.version_no,
        'remark', tv.remark,
        'filename', tvf.filename
    )
FROM thesis_versions tv
JOIN files tvf ON tvf.id = tv.file_id

UNION ALL
-- project_file_added 分支：保留 0016 JOIN files 拿 filename + 过滤 wechat_chat
SELECT
    pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by,
    pf.client_ip, pf.user_agent,
    jsonb_build_object(
        'fileId', pf.file_id,
        'category', pf.category,
        'filename', pff.filename
    )
FROM project_files pf
JOIN files pff ON pff.id = pf.file_id
WHERE pf.category != 'wechat_chat';

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

-- @file 0011_activity_view_feedback_attachments.up.sql
-- @description project_activity_view 重建：feedback 分支 LEFT JOIN feedback_attachments + files 用
--              jsonb_agg 把附件列表 (id+filename) 嵌入 payload，取代仅有 attachmentCount 的限制。
--
--              业务背景（用户反馈 2026-05-03）：
--                "时间线和反馈详情需要显示附件名称, 且可以点击下载附件"
--                attachmentCount 仅给数量，无法在详情弹窗渲染可点击下载链接 → 必须给前端
--                完整 (id, filename) 数组才能拼 /api/files/:id/download URL
--
--              attachmentCount 字段保留向后兼容（前端时间线 chip 行仍可用），新增 attachments 数组
--              让详情弹窗渲染完整文件名 + 下载链接。
--
-- @author Atlas.oi
-- @date 2026-05-03

BEGIN;

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
-- feedback 分支：LEFT JOIN feedback_attachments + files 聚合 attachments 数组（id + filename）
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

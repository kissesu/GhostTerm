-- @file 0015_activity_view_payment_attachments.up.sql
-- @description project_activity_view 重建：payment 分支 LEFT JOIN payment_attachments + files 用
--              jsonb_agg 把附件列表 (id+filename) 嵌入 payload。
--
--              业务背景（用户反馈 2026-05-03）：
--                "结算时间线详情弹窗没有显示结算凭证截图"
--                migration 0014 已建 payment_attachments 表 + Payment OAS schema 已含 attachments，
--                但时间线 activity 系统通过 project_activity_view 单独聚合 payment 行，未走
--                Payment 实体路径 → 详情弹窗的 PaymentActivityPayload 拿不到 attachments。
--
--              本迁移在 view 的 payment 分支同样 LEFT JOIN payment_attachments + files 聚合
--              attachments 数组（id + filename），与 0011 feedback 分支对称。
--
--              ALTER VIEW 不能 ADD COLUMN，必须 DROP+CREATE 完整复刻 0012 全部 7 个 UNION 分支。
--
-- @author Atlas.oi
-- @date 2026-05-03

BEGIN;

DROP VIEW IF EXISTS project_activity_view;

CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
-- project_created 分支：保留 0012 创建期附件 inline 设计
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
        'wechatChats', COALESCE(wc.list, '[]'::jsonb)
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

UNION ALL
-- feedback 分支：保留 0011 attachments jsonb_agg 设计
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
-- status_change：保留 0012 过滤 E0 + 0009 LAG dwell_ms 设计
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
-- payment 分支【新增】：LEFT JOIN payment_attachments + files 聚合 attachments 数组（id + filename）
-- 与 0011 feedback 分支对称：详情弹窗渲染下载链接需要 filename，不能仅 file_id
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
-- project_file_added：保留 0012 过滤 wechat_chat 设计（已 inline 进 project_created）
SELECT
    pf.id, pf.project_id, 'project_file_added'::text, pf.added_at, pf.added_by,
    pf.client_ip, pf.user_agent,
    jsonb_build_object(
        'fileId', pf.file_id,
        'category', pf.category
    )
FROM project_files pf
WHERE pf.category != 'wechat_chat';

GRANT SELECT ON project_activity_view TO progress_app;

COMMIT;

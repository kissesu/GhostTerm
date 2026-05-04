-- @file 0016_activity_view_file_filename.up.sql
-- @description project_activity_view 重建：thesis_version + project_file_added 两个分支
--              JOIN files 拿 filename 嵌入 payload。
--
--              业务背景（用户反馈 2026-05-03）：
--                "源码详情弹窗的文件应该显示文件名而不是'下载文件'"
--                ActivityDetailDialog `project_file_added` / `thesis_version` case 因为
--                payload 只含 fileId 没 filename，前端只能用占位 "下载文件" / "下载论文版本" 调
--                FileItem，用户看不到真实文件名（如 "毕设_v1.pdf"）。
--
--              本迁移在 view 的 thesis_version + project_file_added 分支 JOIN files
--              拿 filename 嵌入 jsonb_build_object，与 0012 创建期 openingDoc/assignmentDoc
--              对称（jsonb_build_object('id', f.id, 'filename', f.filename)）。
--
--              ALTER VIEW 不能 ADD COLUMN 也不能改 SELECT 投影列结构，必须 DROP+CREATE
--              完整复刻 0015 全部 7 个 UNION 分支。其余 5 个分支保留 0015 原貌。
--
--              JOIN 而非 LEFT JOIN：thesis_versions.file_id 与 project_files.file_id
--              均为 NOT NULL FK，无孤儿行，INNER JOIN 性能更优。
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
-- payment 分支：保留 0015 LEFT JOIN payment_attachments + jsonb_agg 设计
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
-- thesis_version 分支【0016 新增 filename】：JOIN files 拿 filename，详情弹窗显示真实文件名
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
-- project_file_added 分支【0016 新增 filename】：JOIN files 拿 filename
-- 保留 0012 过滤 wechat_chat 设计（已 inline 进 project_created）
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

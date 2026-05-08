-- @file 0026_pgcrypto_init.up.sql
-- @description 启用 pgcrypto + ALTER feedbacks.content/payments.remark TYPE TEXT→BYTEA + 重建 view (finding #4)
--
--              业务背景：
--              - 云厂商 SRE 直读 PG data 目录可见客户敏感对话与款项备注 → 列级加密
--              - pgp_sym_encrypt 写 / pgp_sym_decrypt 读，主密钥从 GT_DATA_KEY env 注入 application 层
--              - HKDF-SHA256 从主密钥派生 per-column 子密钥（CipherService.deriveKey）
--
--              Path B 设计：
--              - project_activity_view 复刻 0020 全部 7 个 UNION 分支
--              - feedback / payment 分支用 encode(bytea, 'base64') 让密文以 base64 字符串
--                嵌入 jsonb（保字段名 + jsonb 字符串类型契约）
--              - activity_service 取出 payload 后对 kind in (feedback, payment) 做：
--                base64 decode → CipherService.Decrypt → 替换 JSON 字段
--              - OAS contract Content/Remark: string 不变，前端零改
--
--              数据策略：alpha 阶段 5 人自用，TRUNCATE 清空旧明文（避免 USING 子句对历史
--              明文做就地"自加密"在迁移期混合状态。0020 已 TRUNCATE 一次，现存数据是
--              测试数据可清）。生产首次部署在此 migration 之后进行，不存在数据迁移问题。
--
-- @author Atlas.oi
-- @date 2026-05-08

BEGIN;

-- =========================================================
-- 1. 启用 pgcrypto 扩展（pgp_sym_encrypt / pgp_sym_decrypt 来自此扩展）
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 2. DROP project_activity_view（依赖 feedbacks.content / payments.remark）
-- =========================================================

DROP VIEW IF EXISTS project_activity_view;

-- =========================================================
-- 3. TRUNCATE feedbacks/payments 历史明文数据
--    业务理由：alpha 自用环境历史明文不可"原地加密"（ALTER COLUMN TYPE BYTEA USING
--    无法在 SQL 中跑 pgp_sym_encrypt 因为没有 application 层主密钥）。清空是唯一
--    一致选择；0020 已清过一次，此次再清亦无业务损失。
-- =========================================================

TRUNCATE TABLE feedback_attachments CASCADE;
TRUNCATE TABLE payment_attachments CASCADE;
TRUNCATE TABLE feedbacks CASCADE;
TRUNCATE TABLE payments CASCADE;

-- =========================================================
-- 4. ALTER COLUMN TYPE TEXT → BYTEA
--    USING NULL 让残余行（TRUNCATE 后实际为空）走 NULL；feedbacks.content NOT NULL
--    所以 USING NULL 仅对 EMPTY 表合法。
-- =========================================================

ALTER TABLE feedbacks ALTER COLUMN content TYPE BYTEA USING NULL;
ALTER TABLE payments  ALTER COLUMN remark  TYPE BYTEA USING NULL;

COMMENT ON COLUMN feedbacks.content IS 'pgcrypto pgp_sym_encrypt 密文，主密钥从 GT_DATA_KEY env 派生（finding #4）';
COMMENT ON COLUMN payments.remark   IS 'pgcrypto pgp_sym_encrypt 密文，主密钥从 GT_DATA_KEY env 派生（finding #4）';

-- =========================================================
-- 5. 重建 project_activity_view —— 复刻 0020 全部 7 个 UNION 分支
--    feedback 分支：'content', encode(f.content, 'base64')
--    payment 分支：  'remark',  encode(pay.remark, 'base64')
--    其它 5 个分支字段 100% 不变
-- =========================================================

CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
-- project_created 分支（与 0020 一致）
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
-- feedback 分支：content 字段从 TEXT 变 BYTEA → encode(bytea, 'base64') 进 jsonb
SELECT
    f.id, f.project_id, 'feedback'::text, f.recorded_at, f.recorded_by,
    f.client_ip, f.user_agent,
    jsonb_build_object(
        'content', encode(f.content, 'base64'),
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
-- status_change 分支（与 0020 一致；保留 LAG dwell_ms + E0 过滤）
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
-- quote_change 分支（与 0020 一致）
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
-- payment 分支：remark 字段从 TEXT 变 BYTEA → encode(bytea, 'base64') 进 jsonb
SELECT
    pay.id, pay.project_id, 'payment'::text, pay.recorded_at, pay.recorded_by,
    pay.client_ip, pay.user_agent,
    jsonb_build_object(
        'direction', pay.direction::text,
        'amount', pay.amount::text,
        'paidAt', pay.paid_at,
        'relatedUserId', pay.related_user_id,
        'screenshotId', pay.screenshot_id,
        'remark', encode(pay.remark, 'base64'),
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
-- thesis_version 分支（与 0020 一致）
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
-- project_file_added 分支（与 0020 一致）
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

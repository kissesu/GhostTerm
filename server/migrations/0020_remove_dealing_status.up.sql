-- @file 0020_remove_dealing_status.up.sql
-- @description 删除 dealing 状态 + E1/E6 事件 + 双层守门简化。
--
--              业务背景（用户 2026-05-04 决策）：程序完全不存在给客户使用情况，
--              5 人小团队自用 alpha；cs 与客户不在软件内洽谈（在微信/电话外发生），
--              dealing"洽谈"阶段在软件内无追踪意义。
--              进度模块状态机简化：
--              - 删 dealing 状态（quoting/developing/.../archived 主链不变）
--              - 删 E1（旧"提交报价评估"= cs 转交开发动作，已无中介需求）
--              - 删 E6（旧"重新洽谈"指向 dealing，不再有此目标状态）
--              - E0 创建项目直接进 quoting（holder=dev，dev 立即报价）
--              - 新增 progress:project:cancel 权限码（管 E12/E13；admin 通配自然兼，cs grant）
--
--              数据策略（用户授权）：所有 projects 数据是测试数据可清空 →
--              TRUNCATE CASCADE 一次清掉 projects 及所有 FK 从属表，避免 enum 值删除
--              在已有数据上的迁移复杂度。
--
--              视图重建：project_activity_view 引用 projects.status / status_change_logs.from_status/to_status
--              （都是 project_status 类型），enum 替换前必须 DROP，replace 后按 0018 完整 7 UNION
--              分支重建（dev_earnings_view 不引用 enum 列保留）。
--
-- @author Atlas.oi
-- @date 2026-05-04

BEGIN;

-- =========================================================
-- 1. 清空所有项目相关测试数据（用户授权）
-- =========================================================

-- TRUNCATE 项目主表 CASCADE 会一并清空所有 FK 表（含 status_change_logs / project_files /
-- feedbacks / payments / quote_change_logs / notifications / project_members / project_developers /
-- thesis_versions / payment_attachments / feedback_attachments）
TRUNCATE TABLE projects RESTART IDENTITY CASCADE;

-- =========================================================
-- 2. DROP project_activity_view（依赖 projects.status / status_change_logs.from_status/to_status）
--    dev_earnings_view 不引用 enum 列保留
-- =========================================================

DROP VIEW IF EXISTS project_activity_view;

-- =========================================================
-- 3. 替换 project_status enum：去掉 dealing
--    PG 不支持 ALTER TYPE...REMOVE VALUE，必须走 column→TEXT→DROP/CREATE TYPE→column→enum
-- =========================================================

-- 3.1 解除列默认值约束（不然 ALTER COLUMN TYPE 会抱怨）
ALTER TABLE projects ALTER COLUMN status DROP DEFAULT;

-- 3.2 把所有 enum 列暂时改 TEXT
ALTER TABLE projects ALTER COLUMN status TYPE TEXT USING status::TEXT;
ALTER TABLE status_change_logs ALTER COLUMN from_status TYPE TEXT USING from_status::TEXT;
ALTER TABLE status_change_logs ALTER COLUMN to_status TYPE TEXT USING to_status::TEXT;
ALTER TABLE quote_change_logs ALTER COLUMN phase TYPE TEXT USING phase::TEXT;

-- 3.3 替换 enum 类型
DROP TYPE project_status;
CREATE TYPE project_status AS ENUM (
    'quoting',
    'developing',
    'confirming',
    'delivered',
    'paid',
    'archived',
    'after_sales',
    'cancelled'
);

-- 3.4 把 TEXT 列改回 enum 类型
ALTER TABLE projects ALTER COLUMN status TYPE project_status USING status::project_status;
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'quoting';
ALTER TABLE status_change_logs ALTER COLUMN from_status TYPE project_status USING from_status::project_status;
ALTER TABLE status_change_logs ALTER COLUMN to_status TYPE project_status USING to_status::project_status;
ALTER TABLE quote_change_logs ALTER COLUMN phase TYPE project_status USING phase::project_status;

-- =========================================================
-- 4. 删 projects.dealing_at 列（dealing 状态去除后该列无意义）
-- =========================================================

ALTER TABLE projects DROP COLUMN dealing_at;

-- =========================================================
-- 5. 新增 progress:project:cancel 权限码 + cs 角色 grant
--    业务规则：取消/重启项目（E12/E13）由 cs 触发；admin 通过 *:* 通配自然有权
--    dev 不 grant（业务上 dev 不应擅自取消客户项目）
-- =========================================================

INSERT INTO permissions (resource, action, scope) VALUES
    ('progress', 'project', 'cancel'),
    ('progress', 'project', 'after_sales');

-- cs (id=3) grant cancel + after_sales（破坏性/holder=nil 类事件统一由 cs 操作）
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 3, id FROM permissions
    WHERE (resource, action, scope) IN (
        ('progress', 'project', 'cancel'),
        ('progress', 'project', 'after_sales')
    );

-- =========================================================
-- 6. 重建 project_activity_view（复刻 0018 的 7 UNION 分支完整定义）
--    与 0018 完全一致，仅因 enum 重建必须 DROP 后重新 CREATE
-- =========================================================

CREATE VIEW project_activity_view
WITH (security_barrier = true, security_invoker = true)
AS
-- project_created 分支
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
-- feedback 分支
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
-- status_change 分支：保留 0016 过滤 E0 + LAG dwell_ms 设计
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
        'remark', tv.remark,
        'filename', tvf.filename
    )
FROM thesis_versions tv
JOIN files tvf ON tvf.id = tv.file_id

UNION ALL
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

-- ============================================================
-- 0002_rls.up.sql
-- @file 进度模块 v1 RLS + SECURITY DEFINER 函数
-- @description
--   覆盖范围（v2-revisions C2 + part3 NC3 + part4 NC4 + part5 NC4-fix + W20）：
--     1. helper functions（current_user_id / current_role_id / is_admin / is_member）
--     2. ENABLE + FORCE RLS on 13 张敏感表
--     3. RLS policies（projects/customers/files/feedbacks/payments/...）
--     4. SECURITY DEFINER 函数（insert_notification_secure / consume_ws_ticket /
--        rotate_refresh_token），owner = progress_rls_definer，
--        路径：CREATE OR REPLACE → ALTER FUNCTION ... OWNER TO → REVOKE → GRANT
--     5. progress_rls_definer 表权限（仅授予函数实际需要的：
--        notifications INSERT / ws_tickets SELECT+UPDATE / refresh_tokens SELECT+INSERT+UPDATE）
--     6. dev_earnings_view 改为 SECURITY BARRIER VIEW
-- @author Atlas.oi
-- @date 2026-04-29
-- ============================================================

-- =========================================================
-- 1. helper functions（每请求由后端 SET LOCAL app.user_id / app.role_id）
-- =========================================================

-- 从会话变量读取当前 user_id；未设置时返回 NULL（导致 RLS 全部拒绝，安全默认）
CREATE OR REPLACE FUNCTION current_user_id() RETURNS BIGINT AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::BIGINT
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION current_role_id() RETURNS BIGINT AS $$
    SELECT NULLIF(current_setting('app.role_id', true), '')::BIGINT
$$ LANGUAGE SQL STABLE;

-- 是否超管（role_id = 1，预置超管角色 id）
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
    SELECT current_role_id() = 1
$$ LANGUAGE SQL STABLE;

-- 是否是某项目的成员（在 project_members 中存在记录）
CREATE OR REPLACE FUNCTION is_member(p_project_id BIGINT) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM project_members
        WHERE project_id = p_project_id AND user_id = current_user_id()
    )
$$ LANGUAGE SQL STABLE;

-- progress_app 需要 EXECUTE 这些 helper（SQL 函数默认 PUBLIC EXECUTE，但显式声明更稳）
GRANT EXECUTE ON FUNCTION current_user_id()         TO progress_app;
GRANT EXECUTE ON FUNCTION current_role_id()         TO progress_app;
GRANT EXECUTE ON FUNCTION is_admin()                TO progress_app;
GRANT EXECUTE ON FUNCTION is_member(BIGINT)         TO progress_app;

-- =========================================================
-- 2. ENABLE + FORCE RLS（part3 NC3：补全 notifications/refresh_tokens/ws_tickets）
-- FORCE RLS 让 owner 也走策略（避免 admin 连接绕过）
-- =========================================================

ALTER TABLE projects             ENABLE  ROW LEVEL SECURITY;
ALTER TABLE projects             FORCE   ROW LEVEL SECURITY;

ALTER TABLE project_files        ENABLE  ROW LEVEL SECURITY;
ALTER TABLE project_files        FORCE   ROW LEVEL SECURITY;

ALTER TABLE thesis_versions      ENABLE  ROW LEVEL SECURITY;
ALTER TABLE thesis_versions      FORCE   ROW LEVEL SECURITY;

ALTER TABLE project_members      ENABLE  ROW LEVEL SECURITY;
ALTER TABLE project_members      FORCE   ROW LEVEL SECURITY;

ALTER TABLE feedbacks            ENABLE  ROW LEVEL SECURITY;
ALTER TABLE feedbacks            FORCE   ROW LEVEL SECURITY;

ALTER TABLE feedback_attachments ENABLE  ROW LEVEL SECURITY;
ALTER TABLE feedback_attachments FORCE   ROW LEVEL SECURITY;

ALTER TABLE payments             ENABLE  ROW LEVEL SECURITY;
ALTER TABLE payments             FORCE   ROW LEVEL SECURITY;

ALTER TABLE quote_change_logs    ENABLE  ROW LEVEL SECURITY;
ALTER TABLE quote_change_logs    FORCE   ROW LEVEL SECURITY;

ALTER TABLE status_change_logs   ENABLE  ROW LEVEL SECURITY;
ALTER TABLE status_change_logs   FORCE   ROW LEVEL SECURITY;

ALTER TABLE customers            ENABLE  ROW LEVEL SECURITY;
ALTER TABLE customers            FORCE   ROW LEVEL SECURITY;

ALTER TABLE files                ENABLE  ROW LEVEL SECURITY;
ALTER TABLE files                FORCE   ROW LEVEL SECURITY;

-- NC3：敏感表
ALTER TABLE notifications        ENABLE  ROW LEVEL SECURITY;
ALTER TABLE notifications        FORCE   ROW LEVEL SECURITY;

ALTER TABLE refresh_tokens       ENABLE  ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens       FORCE   ROW LEVEL SECURITY;

ALTER TABLE ws_tickets           ENABLE  ROW LEVEL SECURITY;
ALTER TABLE ws_tickets           FORCE   ROW LEVEL SECURITY;

-- =========================================================
-- 3. RLS Policies
-- 模式：is_admin() OR is_member(project_id)
-- =========================================================

-- ====== projects ======
CREATE POLICY projects_select ON projects FOR SELECT
    USING (is_admin() OR is_member(id));

CREATE POLICY projects_insert ON projects FOR INSERT
    -- 任何登录用户都可创建（业务层再校验角色 = 客服 / 超管）
    WITH CHECK (current_user_id() IS NOT NULL);

CREATE POLICY projects_update ON projects FOR UPDATE
    USING (is_admin() OR is_member(id))
    WITH CHECK (is_admin() OR is_member(id));

CREATE POLICY projects_delete ON projects FOR DELETE
    USING (is_admin());

-- ====== project_files ======
CREATE POLICY project_files_all ON project_files FOR ALL
    USING (is_admin() OR is_member(project_id))
    WITH CHECK (is_admin() OR is_member(project_id));

-- ====== thesis_versions ======
CREATE POLICY thesis_versions_all ON thesis_versions FOR ALL
    USING (is_admin() OR is_member(project_id))
    WITH CHECK (is_admin() OR is_member(project_id));

-- ====== project_members（part3 NC3：v1 §C2 遗漏） ======
CREATE POLICY project_members_select ON project_members FOR SELECT
    USING (
        is_admin()
        OR user_id = current_user_id()
        OR is_member(project_id)
    );

CREATE POLICY project_members_insert ON project_members FOR INSERT
    WITH CHECK (is_admin() OR is_member(project_id));

CREATE POLICY project_members_delete ON project_members FOR DELETE
    USING (is_admin());

-- ====== feedbacks ======
CREATE POLICY feedbacks_all ON feedbacks FOR ALL
    USING (is_admin() OR is_member(project_id))
    WITH CHECK (is_admin() OR is_member(project_id));

-- ====== feedback_attachments（通过 feedback → project 间接判定） ======
CREATE POLICY feedback_attachments_all ON feedback_attachments FOR ALL
    USING (
        is_admin() OR EXISTS (
            SELECT 1 FROM feedbacks f
            WHERE f.id = feedback_id AND is_member(f.project_id)
        )
    )
    WITH CHECK (
        is_admin() OR EXISTS (
            SELECT 1 FROM feedbacks f
            WHERE f.id = feedback_id AND is_member(f.project_id)
        )
    );

-- ====== payments ======
-- dev_settlement 仅本人可见；customer_in 项目成员可见
CREATE POLICY payments_select ON payments FOR SELECT
    USING (
        is_admin()
        OR (direction = 'customer_in'    AND is_member(project_id))
        OR (direction = 'dev_settlement' AND related_user_id = current_user_id())
    );

CREATE POLICY payments_insert ON payments FOR INSERT
    WITH CHECK (
        is_admin() OR (
            is_member(project_id)
            AND (direction = 'customer_in' OR related_user_id IS NOT NULL)
        )
    );

-- ====== quote_change_logs ======
CREATE POLICY quote_changes_select ON quote_change_logs FOR SELECT
    USING (is_admin() OR is_member(project_id));

CREATE POLICY quote_changes_insert ON quote_change_logs FOR INSERT
    WITH CHECK (is_admin() OR is_member(project_id));

-- ====== status_change_logs ======
CREATE POLICY status_changes_select ON status_change_logs FOR SELECT
    USING (is_admin() OR is_member(project_id));

CREATE POLICY status_changes_insert ON status_change_logs FOR INSERT
    WITH CHECK (is_admin() OR is_member(project_id));

-- ====== customers ======
-- 客服仅自己创建的可见 + 通过项目成员关系间接可见；超管全部
CREATE POLICY customers_select ON customers FOR SELECT
    USING (
        is_admin()
        OR created_by = current_user_id()
        OR EXISTS (
            SELECT 1 FROM projects p
            WHERE p.customer_id = customers.id AND is_member(p.id)
        )
    );

CREATE POLICY customers_insert ON customers FOR INSERT
    WITH CHECK (current_user_id() IS NOT NULL);

CREATE POLICY customers_update ON customers FOR UPDATE
    USING (is_admin() OR created_by = current_user_id())
    WITH CHECK (is_admin() OR created_by = current_user_id());

-- ====== files ======
-- 上传者本人 + 引用项目的成员 + 引用反馈项目的成员 + 引用付款的本人
CREATE POLICY files_select ON files FOR SELECT
    USING (
        is_admin()
        OR uploaded_by = current_user_id()
        OR EXISTS (
            SELECT 1 FROM project_files pf
            JOIN projects p ON pf.project_id = p.id
            WHERE pf.file_id = files.id AND is_member(p.id)
        )
        OR EXISTS (
            SELECT 1 FROM thesis_versions tv
            WHERE tv.file_id = files.id AND is_member(tv.project_id)
        )
        OR EXISTS (
            SELECT 1 FROM projects p
            WHERE (p.opening_doc_id = files.id
                   OR p.assignment_doc_id = files.id
                   OR p.format_spec_doc_id = files.id)
              AND is_member(p.id)
        )
        OR EXISTS (
            SELECT 1 FROM feedback_attachments fa
            JOIN feedbacks f ON fa.feedback_id = f.id
            WHERE fa.file_id = files.id AND is_member(f.project_id)
        )
        OR EXISTS (
            SELECT 1 FROM payments pay
            WHERE pay.screenshot_id = files.id
              AND (
                  is_admin()
                  OR (pay.direction = 'dev_settlement' AND pay.related_user_id = current_user_id())
                  OR (pay.direction = 'customer_in'    AND is_member(pay.project_id))
              )
        )
    );

CREATE POLICY files_insert ON files FOR INSERT
    WITH CHECK (current_user_id() IS NOT NULL);

-- ====== notifications（part3 NC3） ======
-- 本人可见；本人可改 is_read（标记已读）
CREATE POLICY notifications_select ON notifications FOR SELECT
    USING (is_admin() OR user_id = current_user_id());

CREATE POLICY notifications_update ON notifications FOR UPDATE
    USING (is_admin() OR user_id = current_user_id())
    WITH CHECK (is_admin() OR user_id = current_user_id());

-- INSERT 由 SECURITY DEFINER insert_notification_secure 函数承担跨用户写入；
-- 这里仅放行 admin / 自我通知（FORCE RLS 下 INSERT 也走 policy）
CREATE POLICY notifications_insert ON notifications FOR INSERT
    WITH CHECK (
        is_admin()
        OR user_id = current_user_id()
    );

-- ====== ws_tickets（part3 NC3 + part4 W20） ======
-- W20: 删除 ws_tickets_update 直接 policy（UPDATE 仅由 consume_ws_ticket 函数完成）
CREATE POLICY ws_tickets_select ON ws_tickets FOR SELECT
    USING (is_admin() OR user_id = current_user_id());

CREATE POLICY ws_tickets_insert ON ws_tickets FOR INSERT
    WITH CHECK (current_user_id() IS NOT NULL);

-- DELETE 给 cleanup cron 使用（W11 cleanup cron 删过期 ticket）
CREATE POLICY ws_tickets_delete ON ws_tickets FOR DELETE
    USING (is_admin());

-- ====== refresh_tokens（part3 NC3） ======
-- 用户本人可 SELECT 自己的 refresh token 列表（可选用于"主动登出所有会话"）
-- INSERT/UPDATE 全部由 SECURITY DEFINER rotate_refresh_token 函数承担
CREATE POLICY refresh_tokens_select ON refresh_tokens FOR SELECT
    USING (is_admin() OR user_id = current_user_id());

-- =========================================================
-- 4. dev_earnings_view 改为 SECURITY BARRIER VIEW
-- 注：必须先 DROP 再 CREATE（CREATE OR REPLACE 不能改 WITH 选项）
-- =========================================================

DROP VIEW IF EXISTS dev_earnings_view;

CREATE VIEW dev_earnings_view WITH (security_barrier = true) AS
SELECT
    p.related_user_id           AS user_id,
    p.project_id,
    prj.name                    AS project_name,
    SUM(p.amount)               AS total_earned,
    COUNT(*)                    AS settlement_count,
    MAX(p.paid_at)              AS last_paid_at
FROM payments p
JOIN projects prj ON p.project_id = prj.id
WHERE p.direction = 'dev_settlement'
  AND (is_admin() OR p.related_user_id = current_user_id())
GROUP BY p.related_user_id, p.project_id, prj.name;

GRANT SELECT ON dev_earnings_view TO progress_app;

-- =========================================================
-- 5. SECURITY DEFINER 函数 + owner 切换（part5 NC4-fix / AB9 唯一路径）
-- 流程：
--   (1) CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql SECURITY DEFINER
--   (2) ALTER FUNCTION ... OWNER TO progress_rls_definer
--   (3) REVOKE ALL ... FROM PUBLIC
--   (4) GRANT EXECUTE ... TO progress_app
-- 不允许 DROP + CREATE（避免破坏依赖该函数的 down migration）
-- =========================================================

-- ====== insert_notification_secure ======
-- 业务层调用 SELECT insert_notification_secure(uid, type, pid, title, body)
-- 跨用户写入（如：状态机切换时为 holder_user 创建 ball_passed 通知）
-- 校验：admin / 自我通知 / 同项目成员之间，三种合法路径之一
CREATE OR REPLACE FUNCTION insert_notification_secure(
    p_user_id    BIGINT,
    p_type       notification_type,
    p_project_id BIGINT,
    p_title      TEXT,
    p_body       TEXT
) RETURNS BIGINT AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF NOT (
        is_admin()
        OR p_user_id = current_user_id()
        OR (
            p_project_id IS NOT NULL
            AND is_member(p_project_id)
            AND EXISTS (
                SELECT 1 FROM project_members pm
                WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id
            )
        )
    ) THEN
        RAISE EXCEPTION 'permission_denied: cannot notify user % in project %', p_user_id, p_project_id;
    END IF;
    INSERT INTO notifications (user_id, type, project_id, title, body)
    VALUES (p_user_id, p_type, p_project_id, p_title, p_body)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION insert_notification_secure(BIGINT, notification_type, BIGINT, TEXT, TEXT) OWNER TO progress_rls_definer;
REVOKE ALL ON FUNCTION insert_notification_secure(BIGINT, notification_type, BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_notification_secure(BIGINT, notification_type, BIGINT, TEXT, TEXT) TO progress_app;

-- ====== consume_ws_ticket ======
-- WS 升级时一次性消费 ticket：UPDATE used_at + 返回 user_id/role_id
-- 因为业务连接已被 RLS 限制（ws_tickets 无 UPDATE policy 给 progress_app），
-- 必须通过此 SECURITY DEFINER 函数（owner = progress_rls_definer，BYPASSRLS）
CREATE OR REPLACE FUNCTION consume_ws_ticket(p_hash BYTEA)
RETURNS TABLE(user_id BIGINT, role_id BIGINT) AS $$
BEGIN
    RETURN QUERY
        UPDATE ws_tickets SET used_at = NOW()
        WHERE ticket_hash = p_hash
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING ws_tickets.user_id, ws_tickets.role_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION consume_ws_ticket(BYTEA) OWNER TO progress_rls_definer;
REVOKE ALL ON FUNCTION consume_ws_ticket(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_ws_ticket(BYTEA) TO progress_app;

-- ====== rotate_refresh_token ======
-- Refresh 路径单语句原子化（NC2）：撤销旧 token + 签发新 token
-- 并发只有一个能 RETURNING，另一个 NoRows（重放检测）
CREATE OR REPLACE FUNCTION rotate_refresh_token(p_old_hash BYTEA, p_new_hash BYTEA, p_ttl INTERVAL)
RETURNS BIGINT AS $$
DECLARE
    v_user_id BIGINT;
BEGIN
    UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE token_hash = p_old_hash AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING user_id INTO v_user_id;
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (v_user_id, p_new_hash, NOW() + p_ttl);
    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) OWNER TO progress_rls_definer;
REVOKE ALL ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) TO progress_app;

-- =========================================================
-- 6. progress_rls_definer 表权限授予（part5 NC4-fix）
-- 仅授予 SECURITY DEFINER 函数实际需要的表权限：
--   - notifications：INSERT（insert_notification_secure）
--   - ws_tickets：SELECT + UPDATE（consume_ws_ticket）
--   - refresh_tokens：SELECT + INSERT + UPDATE（rotate_refresh_token）
--   - project_members：SELECT（insert_notification_secure 内 EXISTS 校验
--     接收人是否同项目成员；is_member() helper 也需要）
-- BYPASSRLS 让 owner 体内可绕过 RLS，但表层面仍需 GRANT
-- =========================================================

-- notifications：函数需 INSERT + SELECT
-- INSERT 来自 part5 NC4-fix；额外补 SELECT：
-- insert_notification_secure 内 INSERT ... RETURNING id 需要 SELECT 才能读 RETURNING 列
GRANT INSERT, SELECT ON notifications TO progress_rls_definer;
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO progress_rls_definer;

-- ws_tickets：函数需 SELECT + UPDATE（标记 used_at）
GRANT SELECT, UPDATE ON ws_tickets TO progress_rls_definer;

-- refresh_tokens：函数需 SELECT + INSERT + UPDATE
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO progress_rls_definer;
GRANT USAGE, SELECT ON SEQUENCE refresh_tokens_id_seq TO progress_rls_definer;

-- project_members：函数需 SELECT
-- 补 part5 NC4-fix 缺失：insert_notification_secure 内 EXISTS 子句 + is_member() helper
-- 都直接读 project_members，progress_rls_definer 必须有 SELECT 否则函数运行时
-- "permission denied for table project_members"
GRANT SELECT ON project_members TO progress_rls_definer;

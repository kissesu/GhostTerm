-- ============================================================
-- 0002_rls.down.sql
-- @file 进度模块 v1 RLS + SECURITY DEFINER 函数 回滚
-- @description
--   反向顺序：函数 → 视图 → policies → DISABLE RLS → helpers
--   注意：必须在 0001 down 之前执行，否则表已 DROP 后 ALTER TABLE 会失败
--   与 up 严格对齐：每条 GRANT/POLICY/FUNCTION 都有对应 REVOKE/DROP
-- @author Atlas.oi
-- @date 2026-04-29
-- ============================================================

-- =========================================================
-- 1. SECURITY DEFINER 函数（反向：先 REVOKE，再 DROP）
-- =========================================================

REVOKE EXECUTE ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) FROM progress_app;
DROP FUNCTION IF EXISTS rotate_refresh_token(BYTEA, BYTEA, INTERVAL);

REVOKE EXECUTE ON FUNCTION consume_ws_ticket(BYTEA) FROM progress_app;
DROP FUNCTION IF EXISTS consume_ws_ticket(BYTEA);

REVOKE EXECUTE ON FUNCTION insert_notification_secure(BIGINT, notification_type, BIGINT, TEXT, TEXT) FROM progress_app;
DROP FUNCTION IF EXISTS insert_notification_secure(BIGINT, notification_type, BIGINT, TEXT, TEXT);

-- =========================================================
-- 2. progress_rls_definer 表权限收回（part5 NC4-fix 反向）
-- =========================================================

REVOKE SELECT ON project_members FROM progress_rls_definer;

REVOKE USAGE, SELECT ON SEQUENCE refresh_tokens_id_seq FROM progress_rls_definer;
REVOKE SELECT, INSERT, UPDATE ON refresh_tokens FROM progress_rls_definer;

REVOKE SELECT, UPDATE ON ws_tickets FROM progress_rls_definer;

REVOKE USAGE, SELECT ON SEQUENCE notifications_id_seq FROM progress_rls_definer;
REVOKE INSERT, SELECT ON notifications FROM progress_rls_definer;

-- =========================================================
-- 3. 视图：还原为普通 VIEW（与 0001 up 一致）
-- 不能直接 DROP（0001 down 会再 DROP 一次，这里恢复到 0001 up 的形态）
-- =========================================================

REVOKE SELECT ON dev_earnings_view FROM progress_app;
DROP VIEW IF EXISTS dev_earnings_view;
CREATE VIEW dev_earnings_view AS
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
GROUP BY p.related_user_id, p.project_id, prj.name;
GRANT SELECT ON dev_earnings_view TO progress_app;

-- =========================================================
-- 4. RLS Policies（反向 DROP）
-- =========================================================

DROP POLICY IF EXISTS refresh_tokens_select       ON refresh_tokens;

DROP POLICY IF EXISTS ws_tickets_delete           ON ws_tickets;
DROP POLICY IF EXISTS ws_tickets_insert           ON ws_tickets;
DROP POLICY IF EXISTS ws_tickets_select           ON ws_tickets;

DROP POLICY IF EXISTS notifications_insert        ON notifications;
DROP POLICY IF EXISTS notifications_update        ON notifications;
DROP POLICY IF EXISTS notifications_select        ON notifications;

DROP POLICY IF EXISTS files_insert                ON files;
DROP POLICY IF EXISTS files_select                ON files;

DROP POLICY IF EXISTS customers_update            ON customers;
DROP POLICY IF EXISTS customers_insert            ON customers;
DROP POLICY IF EXISTS customers_select            ON customers;

DROP POLICY IF EXISTS status_changes_insert       ON status_change_logs;
DROP POLICY IF EXISTS status_changes_select       ON status_change_logs;

DROP POLICY IF EXISTS quote_changes_insert        ON quote_change_logs;
DROP POLICY IF EXISTS quote_changes_select        ON quote_change_logs;

DROP POLICY IF EXISTS payments_insert             ON payments;
DROP POLICY IF EXISTS payments_select             ON payments;

DROP POLICY IF EXISTS feedback_attachments_all    ON feedback_attachments;

DROP POLICY IF EXISTS feedbacks_all               ON feedbacks;

DROP POLICY IF EXISTS project_members_delete      ON project_members;
DROP POLICY IF EXISTS project_members_insert      ON project_members;
DROP POLICY IF EXISTS project_members_select      ON project_members;

DROP POLICY IF EXISTS thesis_versions_all         ON thesis_versions;

DROP POLICY IF EXISTS project_files_all           ON project_files;

DROP POLICY IF EXISTS projects_delete             ON projects;
DROP POLICY IF EXISTS projects_update             ON projects;
DROP POLICY IF EXISTS projects_insert             ON projects;
DROP POLICY IF EXISTS projects_select             ON projects;

-- =========================================================
-- 5. DISABLE RLS（反向 ENABLE/FORCE）
-- =========================================================

ALTER TABLE ws_tickets           NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE ws_tickets           DISABLE   ROW LEVEL SECURITY;

ALTER TABLE refresh_tokens       NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens       DISABLE   ROW LEVEL SECURITY;

ALTER TABLE notifications        NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE notifications        DISABLE   ROW LEVEL SECURITY;

ALTER TABLE files                NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE files                DISABLE   ROW LEVEL SECURITY;

ALTER TABLE customers            NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE customers            DISABLE   ROW LEVEL SECURITY;

ALTER TABLE status_change_logs   NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE status_change_logs   DISABLE   ROW LEVEL SECURITY;

ALTER TABLE quote_change_logs    NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE quote_change_logs    DISABLE   ROW LEVEL SECURITY;

ALTER TABLE payments             NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE payments             DISABLE   ROW LEVEL SECURITY;

ALTER TABLE feedback_attachments NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE feedback_attachments DISABLE   ROW LEVEL SECURITY;

ALTER TABLE feedbacks            NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE feedbacks            DISABLE   ROW LEVEL SECURITY;

ALTER TABLE project_members      NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_members      DISABLE   ROW LEVEL SECURITY;

ALTER TABLE thesis_versions      NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE thesis_versions      DISABLE   ROW LEVEL SECURITY;

ALTER TABLE project_files        NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_files        DISABLE   ROW LEVEL SECURITY;

ALTER TABLE projects             NO FORCE  ROW LEVEL SECURITY;
ALTER TABLE projects             DISABLE   ROW LEVEL SECURITY;

-- =========================================================
-- 6. helper functions（反向 DROP）
-- =========================================================

REVOKE EXECUTE ON FUNCTION is_member(BIGINT)         FROM progress_app;
REVOKE EXECUTE ON FUNCTION is_admin()                FROM progress_app;
REVOKE EXECUTE ON FUNCTION current_role_id()         FROM progress_app;
REVOKE EXECUTE ON FUNCTION current_user_id()         FROM progress_app;

DROP FUNCTION IF EXISTS is_member(BIGINT);
DROP FUNCTION IF EXISTS is_admin();
DROP FUNCTION IF EXISTS current_role_id();
DROP FUNCTION IF EXISTS current_user_id();

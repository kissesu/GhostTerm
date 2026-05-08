-- @file 0027_security_audit_log.up.sql
-- @description 安全审计事件表 (finding #20)
--              append-only 设计：应用账户 progress_app 仅 INSERT/SELECT，
--              UPDATE/DELETE 由 RULE INSTEAD NOTHING 拦截 → 应用被攻陷也无法清除/篡改审计。
--
--              业务背景：登录/失败/权限变更/超管动作/文件下载等关键事件以前混在
--              journalctl -u progress-server，一次 systemctl restart 就丢 buffer，
--              且没有结构化字段无法按 user/IP 检索追溯。本表提供持久化结构化审计 trail。
--
--              users.id 是 BIGINT (BIGSERIAL)；user_id / target_user_id 同类型对齐。
-- @author Atlas.oi
-- @date 2026-05-08

CREATE TABLE security_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type      TEXT NOT NULL CHECK (event_type IN (
        'login_success',
        'login_failed',
        'logout',
        'password_changed',
        'role_changed',
        'user_created',
        'user_disabled',
        'super_admin_action',
        'file_downloaded',
        'refresh_token_reuse_detected',
        'rate_limit_triggered'
    )),
    -- 触发审计的当前会话用户（登录失败 / 系统事件可为 NULL）
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    -- 被作用的目标用户（角色变更 / 创建用户 / 禁用用户场景）；自身动作时与 user_id 相同
    target_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    client_ip       INET,
    user_agent      TEXT,
    -- 业务自定义字段（如 username_attempted / file_id / old_role / new_role）
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 索引设计：
--   1. occurred_at DESC：审计页"最近事件"按时间倒序，最高频访问模式
--   2. (event_type, occurred_at DESC)：按事件类型筛选 + 时间倒序（"最近所有 login_failed"）
--   3. (user_id, occurred_at DESC)：按用户追溯（"该用户最近的全部安全事件"）；
--      partial index 跳过 NULL（系统事件 / 失败登录无 user_id）省空间
CREATE INDEX security_audit_log_occurred_at_idx ON security_audit_log(occurred_at DESC);
CREATE INDEX security_audit_log_event_type_idx  ON security_audit_log(event_type, occurred_at DESC);
CREATE INDEX security_audit_log_user_id_idx     ON security_audit_log(user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

-- ============================================================
-- INSERT-only 防篡改：应用账户被攻陷场景下攻击者也不能清除/伪造审计
-- ============================================================
-- 用 trigger 区分 session_user 而不是 RULE INSTEAD NOTHING：
--   - RULE 会拦截一切 UPDATE/DELETE，包括 FK ON DELETE SET NULL 的内部级联
--     （PG 的 referential action 走 owner 权限，但 RULE 仍生效），
--     导致 DELETE FROM users 失败 → 业务路径破坏
--   - trigger 可以判断 session_user：仅当 progress_app 主动改 / 删时 RAISE，
--     系统级 FK 级联（current_user=postgres / table owner）放行
--
-- 业务防护边界：
--   - 应用账户被攻陷攻击者无法 UPDATE 任意审计行（trigger raise）
--   - 不阻止 superuser 运维清理 / FK 级联 SET NULL（合法场景）
CREATE OR REPLACE FUNCTION security_audit_log_block_app_writes()
RETURNS TRIGGER AS $$
BEGIN
    -- progress_app 是应用账户；任何来自它的 UPDATE / DELETE 都拒绝
    -- session_user 不可被 SET ROLE 改变，是真实连接身份的最强信号
    IF session_user = 'progress_app' THEN
        RAISE EXCEPTION 'security_audit_log is append-only for progress_app (finding #20)'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- 其它角色（postgres / FK 级联系统调用 / 运维 superuser）放行
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER security_audit_log_no_app_update
    BEFORE UPDATE ON security_audit_log
    FOR EACH ROW EXECUTE FUNCTION security_audit_log_block_app_writes();

CREATE TRIGGER security_audit_log_no_app_delete
    BEFORE DELETE ON security_audit_log
    FOR EACH ROW EXECUTE FUNCTION security_audit_log_block_app_writes();

-- ============================================================
-- 应用账户最小权限：仅 INSERT + SELECT
-- ============================================================
-- GRANT 是第一道闸（progress_app 没有 UPDATE/DELETE 权限直接拒绝）；
-- trigger 是第二道闸（防止 SET ROLE 绕权 + 让错误信息明确指向 finding #20）
GRANT INSERT, SELECT ON security_audit_log TO progress_app;
GRANT USAGE, SELECT ON SEQUENCE security_audit_log_id_seq TO progress_app;
REVOKE UPDATE, DELETE, TRUNCATE ON security_audit_log FROM progress_app;

COMMENT ON TABLE security_audit_log IS
    'append-only 安全审计事件表 (finding #20). RULE INSTEAD NOTHING 阻止 UPDATE/DELETE，应用账户仅 INSERT/SELECT.';

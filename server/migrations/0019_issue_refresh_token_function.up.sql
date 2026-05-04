-- ============================================================
-- 0019_issue_refresh_token_function: 修复 auth_service.Login 直接 INSERT refresh_tokens 违反 0002_rls.sql 设计的 latent bug
--
-- 设计意图（0002_rls.sql line 287 注释明确）：
--   refresh_tokens 表 FORCE RLS + 仅 SELECT policy + 无 INSERT/UPDATE policy
--   所有写操作必须通过 SECURITY DEFINER 函数承担
--
-- 0002 实现：rotate_refresh_token 函数承担"轮转"路径的 SELECT 旧 + UPDATE revoked_at + INSERT 新
-- 0019 补全：issue_refresh_token 函数承担"登录"路径的纯 INSERT
--
-- progress_app NOBYPASSRLS 业务连接调用本函数 → 函数以 progress_rls_definer (BYPASSRLS) 身份执行 INSERT
-- 与 rotate_refresh_token 同模式
--
-- @author Atlas.oi
-- @date 2026-05-04
-- ============================================================

CREATE OR REPLACE FUNCTION issue_refresh_token(
    p_user_id     BIGINT,
    p_token_hash  BYTEA,
    p_expires_at  TIMESTAMPTZ
) RETURNS BIGINT AS $$
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (p_user_id, p_token_hash, p_expires_at)
    RETURNING id
$$ LANGUAGE SQL SECURITY DEFINER;

ALTER FUNCTION issue_refresh_token(BIGINT, BYTEA, TIMESTAMPTZ) OWNER TO progress_rls_definer;

REVOKE ALL ON FUNCTION issue_refresh_token(BIGINT, BYTEA, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_refresh_token(BIGINT, BYTEA, TIMESTAMPTZ) TO progress_app;

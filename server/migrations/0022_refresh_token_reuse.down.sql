-- ============================================================
-- 0022 down: 恢复 0019 版本的 rotate_refresh_token（不含 reuse 检测）
--
-- @author Atlas.oi
-- @date 2026-05-08
-- ============================================================

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

COMMENT ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) IS NULL;

-- 撤回 0022 加的 users SELECT/UPDATE 权限
REVOKE SELECT, UPDATE ON users FROM progress_rls_definer;


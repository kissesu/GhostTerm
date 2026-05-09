-- 回滚 0029：恢复 0022 的 rotate_refresh_token 函数 + 删 revocation_reason 列

CREATE OR REPLACE FUNCTION rotate_refresh_token(p_old_hash BYTEA, p_new_hash BYTEA, p_ttl INTERVAL)
RETURNS BIGINT AS $$
DECLARE
    v_active_user_id     BIGINT;
    v_historical_user_id BIGINT;
BEGIN
    UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE token_hash = p_old_hash AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING user_id INTO v_active_user_id;

    IF v_active_user_id IS NOT NULL THEN
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES (v_active_user_id, p_new_hash, NOW() + p_ttl);
        RETURN v_active_user_id;
    END IF;

    SELECT user_id INTO v_historical_user_id
    FROM refresh_tokens
    WHERE token_hash = p_old_hash
    LIMIT 1;

    IF v_historical_user_id IS NOT NULL THEN
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = v_historical_user_id AND revoked_at IS NULL;

        UPDATE users
        SET token_version = token_version + 1, updated_at = NOW()
        WHERE id = v_historical_user_id;

        RAISE NOTICE 'refresh_token_reuse_detected: user_id=%', v_historical_user_id;
        RETURN NULL;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) OWNER TO progress_rls_definer;
REVOKE ALL ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) TO progress_app;

ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS revocation_reason;

-- ============================================================
-- 0022_refresh_token_reuse: refresh token reuse 检测撤销全会话（finding #8）
--
-- 问题背景：
--   原 0019 的 rotate_refresh_token 函数在 active token 找不到时静默 RETURN NULL，
--   攻击者偷到 refresh 后用一次拿到新 token 对，受害者下次刷新撞旧 hash 被 401 拒，
--   攻击者长期持有有效 token 而服务端无任何告警。
--
-- 修复策略（标准 refresh-token-rotation reuse detection）：
--   1. active token 找到 → 正常 rotate（撤销旧 + 签发新）
--   2. 历史 token 找到（已 revoked 或已过期）= reuse 攻击信号 →
--      撤销该 user 全部 active refresh_tokens + bump users.token_version
--      让所有其它 access token 也立即失效
--   3. 完全无效 hash → 返 NULL（与 invalid 区分由 service 层 isHistoricalToken 查询完成）
--
-- 函数签名保持不变 (BYTEA, BYTEA, INTERVAL) → BIGINT，
-- service 层调用方式不变；仅内部行为升级。
--
-- @author Atlas.oi
-- @date 2026-05-08
-- ============================================================

CREATE OR REPLACE FUNCTION rotate_refresh_token(p_old_hash BYTEA, p_new_hash BYTEA, p_ttl INTERVAL)
RETURNS BIGINT AS $$
DECLARE
    v_active_user_id     BIGINT;
    v_historical_user_id BIGINT;
BEGIN
    -- ============================================
    -- 第一步：尝试找 active 状态的旧 token（未 revoke 未过期）
    -- 找到则走正常 rotation：UPDATE 旧为 revoked + INSERT 新
    -- ============================================
    UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE token_hash = p_old_hash AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING user_id INTO v_active_user_id;

    IF v_active_user_id IS NOT NULL THEN
        -- 正常 rotation 路径
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES (v_active_user_id, p_new_hash, NOW() + p_ttl);
        RETURN v_active_user_id;
    END IF;

    -- ============================================
    -- 第二步：active 没命中，检查是否在历史中存在过（已 revoked 或已过期）
    -- 命中 = reuse 攻击信号，撤销该 user 全部 active token + bump token_version
    -- ============================================
    SELECT user_id INTO v_historical_user_id
    FROM refresh_tokens
    WHERE token_hash = p_old_hash
    LIMIT 1;

    IF v_historical_user_id IS NOT NULL THEN
        -- REUSE DETECTED：撤销该 user 所有还活着的 refresh_tokens
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE user_id = v_historical_user_id AND revoked_at IS NULL;

        -- bump token_version 让所有 access token 在中间件比对时失效
        UPDATE users
        SET token_version = token_version + 1, updated_at = NOW()
        WHERE id = v_historical_user_id;

        -- 服务端日志告警（PG NOTICE 会进 server log，便于运维监控）
        RAISE NOTICE 'refresh_token_reuse_detected: user_id=%', v_historical_user_id;

        -- 返 NULL；service 层用 isHistoricalToken 查询区分 reuse vs invalid
        RETURN NULL;
    END IF;

    -- ============================================
    -- 第三步：完全无效 hash（从未入过库）
    -- ============================================
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) OWNER TO progress_rls_definer;
REVOKE ALL ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) TO progress_app;

COMMENT ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) IS
'refresh token rotation with reuse detection (finding #8). Active match → rotate; historical match → revoke-all + bump token_version (returns NULL); unknown → NULL. Caller distinguishes reuse vs invalid via isHistoricalToken.';

-- ============================================================
-- 表权限补全：reuse 检测路径需要 UPDATE users + SELECT (token_version 列)
--
-- 原 0002 仅给 progress_rls_definer 授予 notifications/ws_tickets/refresh_tokens/project_members
-- 0022 reuse 检测新增 UPDATE users SET token_version = token_version + 1, updated_at = NOW()
-- 函数即使 BYPASSRLS owner 也需表层面 GRANT，否则报 permission denied
--
-- 注意 PG 权限语义陷阱：UPDATE ... SET col = col + 1 引用了 col 表达式，
-- 需要同时具备 UPDATE + SELECT 权限（仅 UPDATE 会报 "permission denied for table"）
-- 仅授予 SELECT + UPDATE（不含 INSERT/DELETE）—— 最小权限原则
-- ============================================================
GRANT SELECT, UPDATE ON users TO progress_rls_definer;


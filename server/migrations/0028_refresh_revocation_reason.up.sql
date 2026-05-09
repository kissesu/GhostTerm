-- ============================================================
-- 0028_refresh_revocation_reason: refresh_tokens 加 revocation_reason 列
-- 解决 0022 reuse detection 在 logout race 误踢全 token_version 问题（finding M1）
--
-- 问题背景：
--   0022 rotate_refresh_token 把"历史命中的 token 再次被消费"当作 reuse 攻击：
--   bump users.token_version + revoke 全部 active refresh_tokens。
--   但 logout 路径会主动 revoke 当前 RT；若用户 logout 后再次用同一个 RT 调 refresh
--   （StrictMode 双 mount race / 多端登出冲突 / cleanup 重试 / 客户端 bug），
--   该 RT 的 hash 命中"历史"分支，触发全踢 —— 用户其它设备会话被误杀。
--
-- 修复策略：
--   把 revoke 的语义细化为枚举字段 revocation_reason：
--     'used'           : 正常 rotate 路径中旧 token 被消费完成
--     'logout'         : 用户主动登出
--     'rotate'         : 由 rotate 函数 revoke（与 'used' 等价；保留以备未来分流）
--     'reuse_detected' : 被识别为 reuse 攻击
--     'admin_revoke'   : 管理员强制撤销（未来扩展）
--   active 行 revocation_reason IS NULL；revoke 时填值。
--
--   service 层 reuse 检测路径在调用 rotate 前先看历史命中行的 reason：
--     - reason ∈ {used, logout, rotate} → 合法生命周期重放：仅返 ErrInvalidRefreshToken
--       不 bump token_version 不踢全会话（受 race 困扰的合法用户友好）
--     - reason IS NULL / reason='reuse_detected' → 真正的 reuse：走 0022 全踢路径
--
--   注意：本 migration 仅加列；rotate_refresh_token 函数内部仍走原 0022 逻辑
--   （因为函数本身无法判断"调用方是 logout 还是 refresh"）。区分判断在 Go service 层
--   的 isHistoricalToken 替代实现 historicalTokenReason 中完成。
--
-- 设计取舍：
--   - 用 CHECK 而非 ENUM：alpha 阶段语义可能继续演化；CHECK 改起来比 ENUM 加值容易
--   - revocation_reason 可空：active 行 NULL；revoked 行必须有值（trigger / app 层把关）
--   - 不加 INDEX：查询永远先按 token_hash 走 UNIQUE，reason 仅用于二次判定，不进 WHERE
--
-- @author Atlas.oi
-- @date 2026-05-09
-- ============================================================

ALTER TABLE refresh_tokens
    ADD COLUMN revocation_reason TEXT
        CHECK (revocation_reason IN ('used', 'logout', 'rotate', 'reuse_detected', 'admin_revoke'));

COMMENT ON COLUMN refresh_tokens.revocation_reason IS
'撤销原因（finding M1）：active 行 NULL；revoke 时由 service / 函数填 used / logout / rotate / reuse_detected / admin_revoke。reuse 检测据此区分合法生命周期重放与真攻击。';

-- ============================================================
-- 升级 rotate_refresh_token 函数：成功 rotate 时把旧 token 的 reason 标 'used'
--
-- 业务流程不变（与 0022 一致）：
--   1. active 命中 → revoke 旧 + INSERT 新 → 返 user_id
--   2. 历史命中 → revoke 全 + bump token_version → 返 NULL
--   3. 完全无效 → 返 NULL
--
-- 唯一改动：路径 1 + 路径 2 的 UPDATE refresh_tokens SET revoked_at 同时填 revocation_reason
-- 路径 1 = 'used'；路径 2 = 'reuse_detected'
-- ============================================================

CREATE OR REPLACE FUNCTION rotate_refresh_token(p_old_hash BYTEA, p_new_hash BYTEA, p_ttl INTERVAL)
RETURNS BIGINT AS $$
DECLARE
    v_active_user_id     BIGINT;
    v_historical_user_id BIGINT;
BEGIN
    -- 第一步：尝试找 active 旧 token；命中走正常 rotate（reason='used'）
    UPDATE refresh_tokens
    SET revoked_at = NOW(), revocation_reason = 'used'
    WHERE token_hash = p_old_hash AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING user_id INTO v_active_user_id;

    IF v_active_user_id IS NOT NULL THEN
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES (v_active_user_id, p_new_hash, NOW() + p_ttl);
        RETURN v_active_user_id;
    END IF;

    -- 第二步：active 没命中 → 检查历史；命中 = 真实 reuse（service 层会先做 reason 检查
    -- 所以本函数走到这里时已经被 service 判定为"历史中无合法 logout/used 记录"）
    SELECT user_id INTO v_historical_user_id
    FROM refresh_tokens
    WHERE token_hash = p_old_hash
    LIMIT 1;

    IF v_historical_user_id IS NOT NULL THEN
        UPDATE refresh_tokens
        SET revoked_at = NOW(), revocation_reason = 'reuse_detected'
        WHERE user_id = v_historical_user_id AND revoked_at IS NULL;

        UPDATE users
        SET token_version = token_version + 1, updated_at = NOW()
        WHERE id = v_historical_user_id;

        RAISE NOTICE 'refresh_token_reuse_detected: user_id=%', v_historical_user_id;
        RETURN NULL;
    END IF;

    -- 第三步：完全无效 hash
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) OWNER TO progress_rls_definer;
REVOKE ALL ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) TO progress_app;

COMMENT ON FUNCTION rotate_refresh_token(BYTEA, BYTEA, INTERVAL) IS
'refresh token rotation with reuse detection (finding #8 + M1). Active match → rotate (reason=used); historical match → revoke-all (reason=reuse_detected) + bump token_version (returns NULL); unknown → NULL. 调用方 (Go service) 必须先看 historicalTokenReason 区分 logout race 与真攻击，仅在真攻击时走全踢路径。';

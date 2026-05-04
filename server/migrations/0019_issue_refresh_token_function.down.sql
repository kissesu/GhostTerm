-- ============================================================
-- 0019 down: 删除 issue_refresh_token 函数
-- @author Atlas.oi
-- @date 2026-05-04
-- ============================================================

DROP FUNCTION IF EXISTS issue_refresh_token(BIGINT, BYTEA, TIMESTAMPTZ);

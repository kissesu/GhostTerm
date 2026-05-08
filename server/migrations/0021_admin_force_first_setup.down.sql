-- @file 0021_admin_force_first_setup.down.sql
-- @description 0021 的 down 是 best-effort 占位 —— 密码已 wipe，down 不可逆恢复明文。
--              仅恢复 NOT NULL 约束以让 down 后 schema 与 0001 等价（前提：不存在 NULL 行）。
--              如果 production 已有 admin 处于 NULL 状态，down 会因 NOT NULL 校验失败 —— 这是预期：
--              先让运维 reseed admin 密码再 rollback。
-- @author Atlas.oi
-- @date 2026-05-08

BEGIN;

-- 注：明文密码不可逆，密码 wipe 不撤销。
-- 仅恢复 NOT NULL 约束（要求所有 admin 行已有 hash；否则 ALTER 会失败 → 提示运维先 reseed）
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

COMMENT ON COLUMN users.password_hash IS 'bcrypt hash';

COMMIT;

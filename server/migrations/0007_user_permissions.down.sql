-- @file 0007_user_permissions.down.sql
-- @description 回滚 0007 user_permissions schema + 超管硬约束
-- @author Atlas.oi
-- @date 2026-05-02
--
-- 注意：down 仅回滚本迁移引入的对象（trigger / function / 表 / type / index）；
-- 不再恢复 0001_init 写入的旧 permissions / role_permissions 数据，
-- 因为 0001 已不再代表当前业务模型。如需恢复旧数据需手工 re-run 0001 的种子段。

BEGIN;

DROP TRIGGER IF EXISTS prevent_promote_user_with_overrides ON users;
DROP FUNCTION IF EXISTS reject_promote_user_with_overrides();
DROP TRIGGER IF EXISTS prevent_super_admin_role_permission_write ON role_permissions;
DROP TRIGGER IF EXISTS prevent_super_admin_user_permission_write ON user_permissions;
DROP FUNCTION IF EXISTS reject_super_admin_role_permissions();
DROP FUNCTION IF EXISTS reject_super_admin_user_permissions();
DROP TABLE IF EXISTS user_permissions;
DROP TYPE IF EXISTS permission_effect;
DROP INDEX IF EXISTS users_super_admin_unique;

COMMIT;

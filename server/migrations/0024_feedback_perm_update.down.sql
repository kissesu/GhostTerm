-- @file 0024_feedback_perm_update.down.sql
-- @description 回滚 progress:feedback:update perm（删除该 perm 行 + role_permissions
--              CASCADE 同步清理）。
--
-- @author Atlas.oi
-- @date 2026-05-08

BEGIN;

DELETE FROM permissions
WHERE resource = 'progress' AND action = 'feedback' AND scope = 'update';
-- role_permissions 行通过 FK ON DELETE CASCADE 同步清理

COMMIT;

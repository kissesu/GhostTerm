-- @file 0024_feedback_perm_update.up.sql
-- @description 新增 progress:feedback:update 3 段权限码并默认绑定到 dev/客服 角色。
--              配合 finding #16 修复：feedback handler 改走 EffectivePermissionsService
--              （读 user_permissions 表的 grant/deny 覆写），需要独立的 update 权限码
--              才能让超管"deny update 但保留 create"细粒度配置成立。
--
-- 业务背景：
--   - 0007 migration 已 seed `progress:feedback:create` + `progress:feedback:list`
--     两条 3 段 perm；FeedbacksUpdate 历史复用 create 当 update（v1 临时方案，
--     文档化在 feedback.go permFeedbackUpdate 注释）
--   - finding #16 要让 user_permissions deny override 生效后，复用 create 等于
--     "deny create 自动 deny update"，与"细粒度覆写"的设计目标矛盾
--   - 拆出独立 update perm：默认 grant 给 dev (id=2) 与客服 (id=3)，保持原 v1 行为；
--     超管走 *:* 哨兵不依赖具体 perm 行
--
-- 注：本迁移 *不* 删除任何旧 perm（0007 已 TRUNCATE 干净，无 2 段历史遗留）。
--
-- @author Atlas.oi
-- @date 2026-05-08

BEGIN;

-- 1. 新增 perm 行；ON CONFLICT 兼容多次重跑（虽然 migration 框架不允许重跑同 version，
--    保留是为本地手动 seed 场景）
INSERT INTO permissions (resource, action, scope) VALUES
    ('progress', 'feedback', 'update')
ON CONFLICT (resource, action, scope) DO NOTHING;

-- 2. dev (id=2) 默认拥有 update（与 0007 的 dev grant 集合保持"进度模块全开 - delete"语义）
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 2, id FROM permissions
    WHERE resource = 'progress' AND action = 'feedback' AND scope = 'update'
ON CONFLICT DO NOTHING;

-- 3. 客服 (id=3) 默认拥有 update（0007 的客服 grant = progress 全部）
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 3, id FROM permissions
    WHERE resource = 'progress' AND action = 'feedback' AND scope = 'update'
ON CONFLICT DO NOTHING;

COMMIT;

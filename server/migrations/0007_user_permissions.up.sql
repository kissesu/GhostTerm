-- @file 0007_user_permissions.up.sql
-- @description 用户级权限管理 - schema + 超管硬约束 + 重置种子
-- @author Atlas.oi
-- @date 2026-05-02
--
-- 注意（实施时与 plan 的差异 - 已与现状校对）：
--   1. plan 假设 5 个 role（id 1..5: super_admin/admin/customer_service/dev/viewer），
--      实际 DB 仅 3 个：1=超管 / 2=开发 / 3=客服（见 0001_init.up.sql 第 404-407 行）。
--      因此 role_permissions 重新种子仅写 role_id=2(开发) 与 role_id=3(客服)，
--      不做 admin / viewer 的占位插入。
--   2. plan 假设需 ALTER TABLE 加 users.token_version；实际该列已在 0001_init 中存在
--      （BIGINT NOT NULL DEFAULT 0），故本迁移不再添加。
--   3. permission 集合按 plan §6 的新模型（nav/progress/users/permissions 命名空间）
--      整体替换旧的 (project/customer/feedback/...) 集合。这是决策 #9 的"清场重置"。

BEGIN;

-- =========================================================
-- 1. 清场重置（决策 #9）
-- 旧权限表（0001 init 写入的 (project/customer/...)+(*,*,all) 集合）整体作废，
-- 由本迁移按新语义模型 (nav/progress/users/permissions) 重新种子。
-- CASCADE 同时清掉 role_permissions 上的所有引用。
-- =========================================================

TRUNCATE TABLE role_permissions, permissions RESTART IDENTITY CASCADE;

-- =========================================================
-- 2. 超管唯一性硬约束（决策 #0.5 / DB 层）
-- 全表至多一行 role_id=1，避免再次出现"两个超管"导致权限模型不一致。
-- 用部分唯一索引（partial unique index）实现，仅在 role_id=1 行上生效。
-- =========================================================

CREATE UNIQUE INDEX users_super_admin_unique
    ON users (role_id) WHERE role_id = 1;

-- =========================================================
-- 3. user_permissions 表（grant/deny 双向，决策 #1）
-- effect=grant 表示给该用户额外加一条权限；
-- effect=deny  表示在该用户身上把某条权限"扣回"（覆盖角色继承）。
-- created_by 记录是哪个管理员配置的覆写，便于审计。
-- =========================================================

CREATE TYPE permission_effect AS ENUM ('grant', 'deny');

CREATE TABLE user_permissions (
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id  BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    effect         permission_effect NOT NULL,
    created_by     BIGINT NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission_id)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);

-- =========================================================
-- 4. 超管 user_permissions 拦截 trigger
-- 超管不应受任何 user_permissions 覆写影响（永远全权）；
-- 任何指向 role_id=1 用户的写入都立即拒绝，错误码 23514（check_violation）。
-- =========================================================

CREATE OR REPLACE FUNCTION reject_super_admin_user_permissions()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT role_id FROM users WHERE id = NEW.user_id) = 1 THEN
        RAISE EXCEPTION 'super_admin_immutable: user_permissions cannot target super_admin user'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_super_admin_user_permission_write
    BEFORE INSERT OR UPDATE ON user_permissions
    FOR EACH ROW EXECUTE FUNCTION reject_super_admin_user_permissions();

-- =========================================================
-- 5. 超管 role_permissions 拦截 trigger
-- 超管角色（role_id=1）不写入 role_permissions（应用层用 wildcard 处理）；
-- 物理上拒绝任何针对 role_id=1 的写入，避免数据漂移。
-- =========================================================

CREATE OR REPLACE FUNCTION reject_super_admin_role_permissions()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role_id = 1 THEN
        RAISE EXCEPTION 'super_admin_immutable: role_permissions cannot target super_admin role'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_super_admin_role_permission_write
    BEFORE INSERT OR UPDATE ON role_permissions
    FOR EACH ROW EXECUTE FUNCTION reject_super_admin_role_permissions();

-- =========================================================
-- 6. 种子全部 permissions（plan §6 新模型）
-- 命名空间：
--   nav         - 顶级 tab 可见性门控
--   progress    - 进度模块的资源动作
--   users       - 用户管理
--   permissions - 权限管理本身
-- =========================================================

INSERT INTO permissions (resource, action, scope) VALUES
    ('nav', 'view', 'work'),
    ('nav', 'view', 'progress'),
    ('nav', 'view', 'atlas'),
    ('progress', 'project', 'list'),
    ('progress', 'project', 'create'),
    ('progress', 'project', 'edit'),
    ('progress', 'project', 'delete'),
    ('progress', 'feedback', 'create'),
    ('progress', 'feedback', 'list'),
    ('progress', 'payment', 'create'),
    ('progress', 'payment', 'list'),
    ('progress', 'thesis', 'upload'),
    ('progress', 'thesis', 'list'),
    ('progress', 'file', 'upload'),
    ('progress', 'file', 'list'),
    ('progress', 'event', 'trigger'),
    ('progress', 'quote', 'change'),
    ('users', 'list', 'all'),
    ('users', 'create', 'all'),
    ('users', 'edit', 'all'),
    ('users', 'delete', 'all'),
    ('permissions', 'role', 'manage'),
    ('permissions', 'user_override', 'manage');

-- =========================================================
-- 7. 默认 role grants（重新种子）
--
-- 实际 roles 表只有 3 行：1=超管 / 2=开发 / 3=客服（见 0001_init 注释）。
-- plan 中描述的 admin (id=2) / viewer (id=5) 在当前环境不存在，跳过。
--   - 超管 (id=1)：trigger 拒收，应用层用 wildcard 视图返回全权
--   - 开发 (id=2)：进度模块全部 + 客户列表（dev 不删 project）
--   - 客服 (id=3)：进度模块全部 + 客户列表
-- =========================================================

-- 开发 (id=2)：可看 work / progress 两个 tab；
-- progress 全部动作除 project.delete 外；
-- 可读用户列表（指派 holder 时需要）
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 2, id FROM permissions
    WHERE (resource = 'nav' AND scope IN ('work', 'progress'))
       OR (resource = 'progress' AND NOT (resource = 'progress' AND action = 'project' AND scope = 'delete'))
       OR (resource = 'users' AND action = 'list');

-- 客服 (id=3)：可看 work / progress 两个 tab；
-- progress 全部动作（含 delete，因为客服是项目主对接人）；
-- 可读用户列表
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 3, id FROM permissions
    WHERE (resource = 'nav' AND scope IN ('work', 'progress'))
       OR (resource = 'progress')
       OR (resource = 'users' AND action = 'list');

-- 8. 超管提升前置防护：禁止把已有 user_permissions 的用户升为超管（决策 #0.5 三层防护 DB 兜底）
CREATE OR REPLACE FUNCTION reject_promote_user_with_overrides()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role_id = 1 AND (OLD.role_id IS DISTINCT FROM 1) THEN
        IF EXISTS (SELECT 1 FROM user_permissions WHERE user_id = NEW.id) THEN
            RAISE EXCEPTION 'super_admin_immutable: cannot promote user with existing user_permissions; remove overrides first'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_promote_user_with_overrides
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION reject_promote_user_with_overrides();

COMMIT;

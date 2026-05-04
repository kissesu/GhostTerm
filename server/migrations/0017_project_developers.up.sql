-- ============================================================
-- 0017_project_developers.up.sql
-- @file 项目-开发对接关系表 + 重写 projects RLS（按角色三档过滤）
-- @description
--   业务需求 2026-05-03：
--     - 超管 (role_id=1) 看到/操作所有项目
--     - 客服 (role_id=3) 只看到/操作自己创建的项目（projects.created_by = self）
--     - 开发 (role_id=2) 只看到/操作自己对接的项目（project_developers EXISTS）
--
--   覆盖范围：
--     1. 新表 project_developers（多对多：项目 ↔ 开发）
--        - 用于 RLS 子查询判定开发可见性
--        - 配 RLS（超管全开；progress_app 业务连接通过应用层校验创建者权限）
--     2. 重写 projects 4 条 RLS policy（DROP + CREATE）：
--        projects_select / projects_insert / projects_update / projects_delete
--        旧策略 is_admin() OR is_member(id) 让"任何 project_member"都能看到，
--        新策略按 role_id 走三档分支
--     3. is_member() helper 保持不变 —— 子资源（project_files / feedbacks 等）的
--        RLS 仍依赖 project_members 表，service 层在 Create 时把指派的 dev
--        加入 project_members(role='dev') 即可让子资源 RLS 自动放行
--
--   迁移注意：
--     - DROP POLICY 必须在 CREATE 同名 POLICY 前执行（PG 不支持 OR REPLACE）
--     - 现有 project_members 数据保留：未指派的 dev 不会再被新 INSERT 加入，
--       但已存在的旧关联仍生效（不会破坏历史数据可见性，业务侧可手工清理）
-- @author Atlas.oi
-- @date 2026-05-03
-- ============================================================

-- =========================================================
-- 1. 新表 project_developers
-- =========================================================

CREATE TABLE IF NOT EXISTS project_developers (
    project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_developers_user_idx ON project_developers(user_id);

COMMENT ON TABLE project_developers IS
    '项目 ↔ 开发人员多对多。开发只能看到自己对接的项目；该表是 projects RLS 的判据来源。';

-- =========================================================
-- 2. project_developers 启用 RLS（保持与 progress_app 业务连接一致）
-- 业务侧已在 service 层校验"仅 admin/cs 可创建项目并指派开发"，
-- 这里给 progress_app 全开（USING/CHECK = true），由应用层兜底
-- =========================================================

ALTER TABLE project_developers ENABLE  ROW LEVEL SECURITY;
ALTER TABLE project_developers FORCE   ROW LEVEL SECURITY;

CREATE POLICY pd_select ON project_developers FOR SELECT USING (true);
CREATE POLICY pd_insert ON project_developers FOR INSERT WITH CHECK (true);
CREATE POLICY pd_delete ON project_developers FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_developers TO progress_app;

-- =========================================================
-- 3. 重写 projects RLS policy（DROP + CREATE 4 条）
-- 旧逻辑：is_admin() OR is_member(id)
-- 新逻辑：admin 全开 / cs 创建者本人 / dev 通过 project_developers
-- =========================================================

-- 角色 ID 注：1=超管, 2=开发, 3=客服（与 0001 init seed 一致）

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT
    USING (
        is_admin()
        OR (current_role_id() = 3 AND created_by = current_user_id())
        OR (current_role_id() = 2 AND EXISTS (
            SELECT 1 FROM project_developers pd
            WHERE pd.project_id = projects.id AND pd.user_id = current_user_id()
        ))
    );

DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT
    -- 任何登录用户可通过 INSERT WITH CHECK；service 层校验角色（仅 admin/cs）
    WITH CHECK (current_user_id() IS NOT NULL);

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects FOR UPDATE
    USING (
        is_admin()
        OR (current_role_id() = 3 AND created_by = current_user_id())
        OR (current_role_id() = 2 AND EXISTS (
            SELECT 1 FROM project_developers pd
            WHERE pd.project_id = projects.id AND pd.user_id = current_user_id()
        ))
    )
    WITH CHECK (
        is_admin()
        OR (current_role_id() = 3 AND created_by = current_user_id())
        OR (current_role_id() = 2 AND EXISTS (
            SELECT 1 FROM project_developers pd
            WHERE pd.project_id = projects.id AND pd.user_id = current_user_id()
        ))
    );

DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects FOR DELETE
    USING (is_admin());

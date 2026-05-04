-- ============================================================
-- 0017_project_developers.down.sql
-- @file 回滚 0017：删除 project_developers 表 + 还原 projects RLS（is_member 模式）
-- @author Atlas.oi
-- @date 2026-05-03
-- ============================================================

-- =========================================================
-- 1. 还原 projects RLS policy 为 0002 版本（is_admin() OR is_member(id)）
-- =========================================================

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT
    USING (is_admin() OR is_member(id));

DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT
    WITH CHECK (current_user_id() IS NOT NULL);

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects FOR UPDATE
    USING (is_admin() OR is_member(id))
    WITH CHECK (is_admin() OR is_member(id));

DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects FOR DELETE
    USING (is_admin());

-- =========================================================
-- 2. 删除 project_developers
-- =========================================================

DROP POLICY IF EXISTS pd_delete ON project_developers;
DROP POLICY IF EXISTS pd_insert ON project_developers;
DROP POLICY IF EXISTS pd_select ON project_developers;

DROP INDEX IF EXISTS project_developers_user_idx;
DROP TABLE IF EXISTS project_developers;

-- ============================================================
-- 0025_payments_insert_rls.down.sql
-- @file 0025_payments_insert_rls.down.sql
-- @description 回滚到 0002_rls.up.sql 中 payments_insert 原策略。
-- @author Atlas.oi
-- @date 2026-05-08
-- ============================================================

DROP POLICY IF EXISTS payments_insert ON payments;

CREATE POLICY payments_insert ON payments FOR INSERT
    WITH CHECK (
        is_admin() OR (
            is_member(project_id)
            AND (direction = 'customer_in' OR related_user_id IS NOT NULL)
        )
    );

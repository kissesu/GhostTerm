-- ============================================================
-- 0025_payments_insert_rls.up.sql
-- @file 0025_payments_insert_rls.up.sql
-- @description payments INSERT policy 收紧，禁非 admin 写 dev_settlement
--              （安全审计 finding #17：项目成员可设 related_user_id 给同事制造虚假结算）
--
--              旧策略（0002_rls.up.sql L172-178）：
--                is_admin() OR (is_member(project_id)
--                  AND (direction='customer_in' OR related_user_id IS NOT NULL))
--              漏洞：开发 A 可写 direction='dev_settlement' + related_user_id=B（同事），
--                  伪造给 B 一笔结算流水；策略既不要求 related_user_id = current_user_id()，
--                  也不要求 dev_settlement 仅 admin 可走。
--
--              新策略：
--                - admin 可写任何 direction
--                - 普通成员仅可写 direction='customer_in'（客户入账）
--                - direction='dev_settlement' 仅 admin 可写（防虚假结算）
--                - 未来若加新 direction 默认拒（仅 admin 可走）
-- @author Atlas.oi
-- @date 2026-05-08
-- ============================================================

DROP POLICY IF EXISTS payments_insert ON payments;

CREATE POLICY payments_insert ON payments FOR INSERT WITH CHECK (
    is_admin()
    OR (is_member(project_id) AND direction = 'customer_in')
    -- direction = 'dev_settlement' 仅 admin 可写（防项目成员给同事制造虚假结算）
    -- 未来新增的 direction 默认仅 admin 可走，避免再次出现类似漏洞
);

COMMENT ON POLICY payments_insert ON payments IS
'非 admin 仅可写 customer_in（客户入账）；dev_settlement 等其它 direction 仅 admin 可写。Finding #17 收紧。';

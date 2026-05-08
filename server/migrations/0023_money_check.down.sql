-- @file 0023_money_check.down.sql
-- @description 回滚 finding #9 金额负数防御 DB CHECK 约束
-- @author Atlas.oi
-- @date 2026-05-08

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_current_quote_nonneg;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_after_sales_total_nonneg;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_original_quote_nonneg;
ALTER TABLE quote_change_logs DROP CONSTRAINT IF EXISTS quote_change_logs_delta_signed_by_type;

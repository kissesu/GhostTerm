-- @file 0027_security_audit_log.down.sql
-- @description 回滚 finding #20 安全审计表。trigger / 索引随表 DROP 自动清除，
--              trigger function 必须显式 DROP（独立 namespace）。
-- @author Atlas.oi
-- @date 2026-05-08

DROP TABLE IF EXISTS security_audit_log;
DROP FUNCTION IF EXISTS security_audit_log_block_app_writes();

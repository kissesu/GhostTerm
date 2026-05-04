-- @file 0014_payment_attachments.down.sql
-- @description 回滚 0014：删除 payment_attachments 表 + 索引 + RLS policies（CASCADE 自动清理）。
-- @author Atlas.oi
-- @date 2026-05-03

DROP TABLE IF EXISTS payment_attachments CASCADE;

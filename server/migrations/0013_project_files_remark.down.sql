-- @file 0013_project_files_remark.down.sql
-- @description 回滚 0013：删除 project_files.remark 字段。
-- @author Atlas.oi
-- @date 2026-05-03

ALTER TABLE project_files DROP COLUMN IF EXISTS remark;

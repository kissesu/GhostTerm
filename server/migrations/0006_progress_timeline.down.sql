-- @file 0006_progress_timeline.down.sql
-- @description 回滚 0006：删 VIEW、删 added_by 列；性能索引保留（非破坏性）
-- @author Atlas.oi
-- @date 2026-05-01

BEGIN;

DROP VIEW IF EXISTS project_activity_view;

DROP INDEX IF EXISTS idx_project_files_added_by;

ALTER TABLE project_files DROP COLUMN IF EXISTS added_by;

COMMIT;

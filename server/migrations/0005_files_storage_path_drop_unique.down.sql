-- @file: 0005_files_storage_path_drop_unique.down.sql
-- @description: 回滚 0005：先 dedup（保留每 storage_path 最早 id）再恢复 UNIQUE
--                注意：dedup 会删除较新 file 行；project_files 等 FK 引用旧 file_id 不受影响，
--                若新 file_id 被引用则 ALTER 会失败，需手工处理
-- @author: Atlas.oi
-- @date: 2026-05-01

DROP INDEX IF EXISTS idx_files_storage_path;

DELETE FROM files
WHERE id NOT IN (
  SELECT MIN(id) FROM files GROUP BY storage_path
);

ALTER TABLE files
  ADD CONSTRAINT files_storage_path_key UNIQUE (storage_path);

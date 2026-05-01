-- @file: 0005_files_storage_path_drop_unique.up.sql
-- @description: 删除 files.storage_path 唯一约束以允许多 file 行共享同一磁盘路径（同内容文件多次上传）
--                file_service 第 463 行已对磁盘层做 stat 去重，DB 层 UNIQUE 反而让重复上传抛 500
--                改为普通索引保查询性能；cleanup 时按 reference count 决定是否删磁盘文件
-- @author: Atlas.oi
-- @date: 2026-05-01

ALTER TABLE files
  DROP CONSTRAINT IF EXISTS files_storage_path_key;

CREATE INDEX IF NOT EXISTS idx_files_storage_path
  ON files(storage_path);

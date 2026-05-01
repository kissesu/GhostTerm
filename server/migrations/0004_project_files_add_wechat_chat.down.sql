-- @file: 0004_project_files_add_wechat_chat.down.sql
-- @description: 回滚 0004：删除 wechat_chat 行后缩回原 CHECK
-- @author: Atlas.oi
-- @date: 2026-05-01

DELETE FROM project_files WHERE category = 'wechat_chat';

ALTER TABLE project_files
  DROP CONSTRAINT IF EXISTS project_files_category_check;

ALTER TABLE project_files
  ADD CONSTRAINT project_files_category_check
  CHECK (category IN ('sample_doc', 'source_code'));

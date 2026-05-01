-- @file: 0004_project_files_add_wechat_chat.up.sql
-- @description: 扩展 project_files.category 接受 wechat_chat（微信聊天记录截图）
-- @author: Atlas.oi
-- @date: 2026-05-01

ALTER TABLE project_files
  DROP CONSTRAINT IF EXISTS project_files_category_check;

ALTER TABLE project_files
  ADD CONSTRAINT project_files_category_check
  CHECK (category IN ('sample_doc', 'source_code', 'wechat_chat'));

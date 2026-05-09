-- @file 0028_projects_name_length.down.sql
-- @description 撤销 0028：移除 projects.name 长度 CHECK 约束。
-- @author Atlas.oi
-- @date 2026-05-09

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_name_length_check;

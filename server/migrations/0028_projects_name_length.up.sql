-- @file 0028_projects_name_length.up.sql
-- @description 给 projects.name 加 CHECK 约束：1-50 字符（按 Unicode 字符数 char_length）。
--              与前端 zod.max(50) + 后端 utf8.RuneCountInString 三层防御一致。
--              char_length 数码点（汉字 BMP=1，emoji 多数=1），与 utf8.RuneCountInString 语义匹配。
-- @author Atlas.oi
-- @date 2026-05-09

ALTER TABLE projects
  ADD CONSTRAINT projects_name_length_check
  CHECK (char_length(name) BETWEEN 1 AND 50);

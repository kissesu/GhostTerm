-- ============================================================
-- 0001_init.down.sql
-- @file 进度模块 v1 初始 schema 回滚
-- @description
--   严格按 0001_init.up.sql 的反向拓扑顺序 DROP；
--   所有表用 CASCADE 一次性带走依赖（FK / VIEW / 索引等）。
--   ENUM 类型在表 DROP 之后再 DROP（避免"还有列在引用"错误）。
--   角色 progress_app / progress_rls_definer 不在此处删除：
--     - 它们由部署 runbook 一次性创建，跨迁移持久存在
--     - 业务 down 不应破坏部署级身份
--     - 若需删除请由 runbook 显式 DROP ROLE
-- @author Atlas.oi
-- @date 2026-04-29
-- ============================================================

-- 视图（必须先于 payments 删除）
DROP VIEW  IF EXISTS dev_earnings_view CASCADE;

-- 通知 + WS ticket
DROP TABLE IF EXISTS ws_tickets CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TYPE  IF EXISTS notification_type;

-- 状态变更日志
DROP TABLE IF EXISTS status_change_logs CASCADE;

-- 报价变更日志
DROP TABLE IF EXISTS quote_change_logs CASCADE;
DROP TYPE  IF EXISTS quote_change_type;

-- 财务
DROP TABLE IF EXISTS payments CASCADE;
DROP TYPE  IF EXISTS payment_direction;

-- 反馈
DROP TABLE IF EXISTS feedback_attachments CASCADE;
DROP TABLE IF EXISTS feedbacks CASCADE;
DROP TYPE  IF EXISTS feedback_status;
DROP TYPE  IF EXISTS feedback_source;

-- 项目成员
DROP TABLE IF EXISTS project_members CASCADE;
DROP TYPE  IF EXISTS project_member_role;

-- 论文版本 + 项目附件
DROP TABLE IF EXISTS thesis_versions CASCADE;
DROP TABLE IF EXISTS project_files CASCADE;

-- 项目主表
DROP TABLE IF EXISTS projects CASCADE;
DROP TYPE  IF EXISTS thesis_level;
DROP TYPE  IF EXISTS project_priority;
DROP TYPE  IF EXISTS project_status;

-- 文件
DROP TABLE IF EXISTS files CASCADE;

-- 客户
DROP TABLE IF EXISTS customers CASCADE;

-- 用户体系
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

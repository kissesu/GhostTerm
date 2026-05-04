-- @file 0013_project_files_remark.up.sql
-- @description project_files 表新增 remark 字段（用户上传源码 / 参考样稿时附带的说明）。
--
--              业务背景（用户反馈 2026-05-03）：
--                "论文版本、源码 tab 新增备注入口... schema 是否需要新增备注字段"
--                论文版本表 thesis_versions 已有 remark；源码 / 参考样稿走 project_files
--                之前只有 (file_id, category) 两个字段无法承载用户输入的版本说明 / 备注。
--
--              字段约束：
--                - TEXT NULL（与 thesis_versions.remark 对齐：可选，便于历史数据兼容）
--                - 不加长度上限：业务上备注通常 1-2 句话，DB 不卡；前端 UI 卡 ≤500 字符即可
--
-- @author Atlas.oi
-- @date 2026-05-03

ALTER TABLE project_files ADD COLUMN IF NOT EXISTS remark TEXT NULL;
COMMENT ON COLUMN project_files.remark IS '附加备注：源码上传说明 / 版本号 / 参考样稿描述等。用户反馈 2026-05-03 新增。';

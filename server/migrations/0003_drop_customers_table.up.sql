-- ============================================================
-- 0003_drop_customers_table.up.sql
-- @file 客户从独立资源降级为项目字段
-- @description
--   用户需求修正 2026-04-30：
--     "客户在整个进度功能模块中只是项目中的一个字段"
--   所以：
--     1. projects 增加 customer_label TEXT NOT NULL 字段
--     2. 把 customers.name_wechat（+ remark 拼接）数据迁入 projects.customer_label
--     3. 移除 projects.customer_id FK + 列
--     4. DROP customers 表
--     5. 清理 permissions/role_permissions 中所有 customer:* 项
-- @author Atlas.oi
-- @date 2026-04-30
-- ============================================================

-- 1) 给 projects 加 customer_label，先 nullable 以便回填
ALTER TABLE projects ADD COLUMN customer_label TEXT;

-- 2) 从现有 customers 表迁移数据：把 name_wechat (+ remark 拼接) 写入对应项目
UPDATE projects p
SET customer_label = c.name_wechat || COALESCE('（' || c.remark || '）', '')
FROM customers c
WHERE p.customer_id = c.id;

-- 3) 兜底：customer_id 但 customers 行已被删的项目（理论无）写占位
UPDATE projects SET customer_label = '未知客户' WHERE customer_label IS NULL;

-- 4) 改 NOT NULL
ALTER TABLE projects ALTER COLUMN customer_label SET NOT NULL;

-- 5) 先删除 customers 表（CASCADE 处理依赖：projects.customer_id FK、
--    customers_select RLS policy 引用 projects.customer_id 等）
--    注意：必须先删 customers，再删 projects.customer_id；
--    否则 RLS policy customers_select 内 WHERE p.customer_id = customers.id
--    依赖该列，DROP COLUMN 会报 "other objects depend on it"
DROP TABLE customers CASCADE;

-- 6) 现在 projects.customer_id 的 FK 已被 CASCADE 一起 drop（FK 跟着 customers 走）；
--    再独立 drop 列即可
ALTER TABLE projects DROP COLUMN customer_id;

-- 7) 清理 permissions/role_permissions 中所有 customer:* 项
DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE resource = 'customer'
);
DELETE FROM permissions WHERE resource = 'customer';

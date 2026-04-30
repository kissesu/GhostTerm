-- ============================================================
-- 0003_drop_customers_table.down.sql
-- @file 客户字段降级的最小回滚骨架（不可数据级回滚）
-- @description
--   用户需求修正 2026-04-30 后此 migration 不可逆（customers 表数据已丢失）。
--   down 仅做最小骨架便于回滚到此 migration 之前的 schema 形状；
--   实际生产环境若想数据回滚需手动恢复 customers 表 + 数据。
-- @author Atlas.oi
-- @date 2026-04-30
-- ============================================================

-- 重建 customers 表骨架（FK / 索引 / RLS policy 不重建，由后续手动同步）
CREATE TABLE customers (
    id           BIGSERIAL PRIMARY KEY,
    name_wechat  TEXT NOT NULL,
    remark       TEXT,
    created_by   BIGINT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- projects 字段切回（先加 customer_id 列；customer_label drop NOT NULL → drop column）
ALTER TABLE projects ADD COLUMN customer_id BIGINT;
ALTER TABLE projects ALTER COLUMN customer_label DROP NOT NULL;
ALTER TABLE projects DROP COLUMN customer_label;

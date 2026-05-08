-- @file 0023_money_check.up.sql
-- @description finding #9 金额负数防御兜底层 —— DB CHECK 约束
--
--               业务背景：OpenAPI Money pattern 历史允许负数（^-?\d+\.\d{2}$），
--               让攻击者可以在请求体里传 delta=-9999.99，让 current_quote / after_sales_total
--               倒减，篡改对账总账。
--
--               三层防御：
--                 1. DB CHECK（本 migration） —— 应用层失守时的最后一道墙
--                 2. service 层 validateQuoteInput / validateCreateInput —— 业务校验
--                 3. OAS schema PositiveMoney pattern —— 客户端拦截
--
--               实际表名（与 0001 init 对齐）：
--                 - projects.original_quote / current_quote / after_sales_total（NUMERIC(12,2)）
--                 - quote_change_logs.delta（NUMERIC(12,2)）+ change_type 列（不是 kind）
--
--               quote_change_logs.delta 约束的特殊性：
--                 - change_type='append' / 'after_sales' → delta > 0（业务上必须是正向追加）
--                 - change_type='modify' → delta 可正可负（让利场景下 service 计算的 delta = newQuote - oldQuote 可能为负）
--
-- @author Atlas.oi
-- @date 2026-05-08

-- ============================================================
-- projects 金额三列：≥0
-- ============================================================

ALTER TABLE projects
    ADD CONSTRAINT projects_current_quote_nonneg
        CHECK (current_quote >= 0);

ALTER TABLE projects
    ADD CONSTRAINT projects_after_sales_total_nonneg
        CHECK (after_sales_total >= 0);

ALTER TABLE projects
    ADD CONSTRAINT projects_original_quote_nonneg
        CHECK (original_quote >= 0);

-- ============================================================
-- quote_change_logs.delta：append/after_sales 必须 >0；modify 不限符号
-- ============================================================

ALTER TABLE quote_change_logs
    ADD CONSTRAINT quote_change_logs_delta_signed_by_type
        CHECK (
            (change_type IN ('append', 'after_sales') AND delta > 0)
            OR change_type = 'modify'
        );

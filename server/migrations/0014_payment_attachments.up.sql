-- @file 0014_payment_attachments.up.sql
-- @description payment_attachments 关联表（mirror feedback_attachments 设计）：
--              结算 / 收款录入时支持挂多个截图凭证文件。
--
--              业务背景（用户反馈 2026-05-03）：
--                "结算弹窗没有上传截图的入口"
--                payments 表已有单字段 screenshot_id（仅 dev_settlement 必填），
--                但只能挂一张截图；客户付款（customer_in）也常需要多张转账记录截图。
--                参照 feedback_attachments 的"多对多"设计：(payment_id, file_id) 联合主键。
--
--              与 payments.screenshot_id 共存策略：
--                - 老字段 screenshot_id 保留（migration 0001 固化），dev_settlement 仍写
--                - 新表 payment_attachments 是"补充凭证"通道，customer_in / dev_settlement 都可用
--                - 前端展示：先看 payment_attachments 数组（多张），为空再回退 screenshot_id
--                - 后续若彻底迁移可单独写 migration 把老 screenshot_id 数据转入新表
--
--              RLS 策略：通过父表 payments 的可见性间接判定（payments_select 已有 dev_settlement
--              本人可见、customer_in 项目成员可见的精细控制；attachment 只跟随 payment 可见）。
--
-- @author Atlas.oi
-- @date 2026-05-03

CREATE TABLE IF NOT EXISTS payment_attachments (
  payment_id  BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  file_id     BIGINT NOT NULL REFERENCES files(id)    ON DELETE RESTRICT,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (payment_id, file_id)
);

CREATE INDEX IF NOT EXISTS payment_attachments_file_idx ON payment_attachments(file_id);

COMMENT ON TABLE payment_attachments IS 'mirror feedback_attachments：结算 / 收款凭证截图（多张）关联表。用户反馈 2026-05-03 新增。';

-- ====== RLS：通过父 payments 行间接判定 ======
ALTER TABLE payment_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attachments FORCE  ROW LEVEL SECURITY;

-- SELECT：与父 payment 行可见性一致
CREATE POLICY payment_attachments_select ON payment_attachments FOR SELECT
    USING (
        is_admin() OR EXISTS (
            SELECT 1 FROM payments p
            WHERE p.id = payment_id
              AND (
                  (p.direction = 'customer_in'    AND is_member(p.project_id))
                  OR (p.direction = 'dev_settlement' AND p.related_user_id = current_user_id())
              )
        )
    );

-- INSERT：与父 payments_insert 一致（is_member 或 admin 可写）
CREATE POLICY payment_attachments_insert ON payment_attachments FOR INSERT
    WITH CHECK (
        is_admin() OR EXISTS (
            SELECT 1 FROM payments p
            WHERE p.id = payment_id AND is_member(p.project_id)
        )
    );

-- DELETE：仅 admin（v1 收款记录不可逆，附件也不应单独删除）
CREATE POLICY payment_attachments_delete ON payment_attachments FOR DELETE
    USING (is_admin());

GRANT SELECT, INSERT, DELETE ON payment_attachments TO progress_app;

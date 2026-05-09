-- ============================================================
-- 0029_cipher_key_version: 给加密列添加 key 版本标记（finding L7 follow-up）
--
-- 问题背景：
--   PR-10 finding #4 列级加密落地（feedbacks.content / payments.remark）后，密文仅
--   带 v2 格式标记字节 0x02，但没有"用哪把 key 加密"的版本号。未来若需要轮换主密钥
--   （例如运维担心 GT_DATA_KEY 已泄露 / 周期性轮换合规要求 / 主密钥强度升级），
--   服务端解密时无法判断哪行密文用旧 key、哪行用新 key —— 必须一次性把全表重新加密
--   (downtime 巨大且容易出错)。
--
-- 修复策略：
--   1. 给 feedbacks 加 content_key_version SMALLINT NOT NULL DEFAULT 1
--   2. 给 payments  加 remark_key_version  SMALLINT NOT NULL DEFAULT 1
--   3. 现仅 v=1 一把 key（与现有数据兼容；DEFAULT 1 让历史行无需 backfill）
--   4. 未来加 v=2 时：cipher_service 内 keyByVersion map 扩一个键；
--      Encrypt 默认用 currentKeyVersion=2 写新行；旧 v=1 行解密走 v1 路径仍可读。
--      需要全表重加密时分批 SELECT WHERE *_key_version=1 → 解 → 用 v=2 重写。
--
-- 设计取舍：
--   - 不加 INDEX：典型查询永远按 id / project_id 过滤，key_version 不进 WHERE；
--     将来分批 backfill 临时跑 SELECT * WHERE key_version=1 也仅一次性，索引收益小。
--   - SMALLINT (2 字节) 而非 INTEGER：版本号 0~32767 远超实际需要，节省每行 2 字节。
--   - DEFAULT 1 + NOT NULL：让 INSERT 不传该列也能写；防止应用层漏传写出 NULL 数据。
--
-- @author Atlas.oi
-- @date 2026-05-09
-- ============================================================

ALTER TABLE feedbacks
    ADD COLUMN content_key_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE payments
    ADD COLUMN remark_key_version SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN feedbacks.content_key_version IS
'feedbacks.content 加密用的主密钥版本号（finding L7）。当前所有数据 v=1；未来轮换时新数据写 v=2，service 按本列选 key。';

COMMENT ON COLUMN payments.remark_key_version IS
'payments.remark 加密用的主密钥版本号（finding L7）。当前所有数据 v=1；未来轮换时新数据写 v=2，service 按本列选 key。';

-- @file 0026_pgcrypto_init.down.sql
-- @description 0026 不可逆 down —— BYTEA 密文无主密钥转不回明文，仅占位。
--
--              业务背景：
--              - down 真正"还原"需要 application 层主密钥逐行解密，application 层
--                migration 工具不持有此密钥；强制让 down 不可执行（避免误降级丢数据）
--              - 应急回滚通过：从 backup 恢复到 0025 状态 + 重跑 0026 之前的 schema
--
-- @author Atlas.oi
-- @date 2026-05-08

SELECT 1;

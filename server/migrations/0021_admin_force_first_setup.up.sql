-- @file 0021_admin_force_first_setup.up.sql
-- @description finding #18：admin 首次启动强制重设密码
--              修复"公开仓库 + 默认 admin/admin123 + 5 人自用易遗忘改密"风险。
--              步骤：
--                1. 放开 users.password_hash NOT NULL，让"未设置密码"可以入库
--                2. 仅匹配 0001 seed 的精确 hash，把对应 admin 行的 password_hash 置 NULL
--                   并 bump token_version 让任何已签发的 admin token 立刻失效
--                3. 添加 column 注释提示 NULL 语义
--              安全语义：UPDATE 仅匹配 0001 init 写入的精确 hash；
--                       已被运维改过密码的 admin 不会被命中（精确 string 匹配）。
--              首次设置流程：admin 用户尝试登录 → auth_service.Login 检测 NULL hash
--                          → 返 ErrPasswordNotSet → 前端提示"联系运维 reseed"。
-- @author Atlas.oi
-- @date 2026-05-08

BEGIN;

-- 1. password_hash 改为可空（NULL = 未设置 / 等待首次设置）
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. 仅对 0001 init 写入的默认 admin 生效；用户已自行改密的 hash 不匹配 → 不影响
UPDATE users
SET password_hash = NULL,
    token_version = token_version + 1,
    updated_at    = NOW()
WHERE username = 'admin'
  AND password_hash = '$2a$12$/EKvylTUcANTdRurd6WUSeH3R2aN2rol81pqZDwdXLbmPZWtNXmP2';

-- 3. 列注释说明新语义
COMMENT ON COLUMN users.password_hash IS
    'bcrypt hash（cost 12+）；NULL 表示尚未设置密码，登录时返 ErrPasswordNotSet（finding #18 / migration 0021）';

COMMIT;

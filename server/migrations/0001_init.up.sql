-- ============================================================
-- 0001_init.up.sql
-- @file 进度模块 v1 初始 schema（DDL + 预置数据 + 初始 GRANT）
-- @description
--   覆盖范围：
--     1. 数据库角色 progress_app / progress_rls_definer（C1 + part4 NC4）
--     2. 全部业务表 + ENUM（C1 拓扑顺序：roles → users → ...）
--     3. 预置 3 角色（超管/开发/客服）+ permissions + role_permissions
--     4. 初始 GRANT（progress_app 业务运行时；progress_rls_definer 仅 SECURITY DEFINER 函数 owner）
--   严格遵循：
--     - C1：roles 必须先于 users 创建（避免 FK 失败）
--     - C7 部署 runbook：progress_admin 跑迁移；progress_app NOBYPASSRLS 业务连接；
--       progress_rls_definer NOLOGIN BYPASSRLS 仅作 SECURITY DEFINER 函数 owner
-- @author Atlas.oi
-- @date 2026-04-29
-- ============================================================

-- =========================================================
-- 1. 数据库角色（必须先创建，后续 GRANT 才能引用）
-- progress_app           : 业务运行时使用，受 RLS 约束
-- progress_rls_definer   : SECURITY DEFINER 函数 owner，BYPASSRLS 但 NOLOGIN
-- 密码由部署 runbook (docker-compose secret) 通过 ALTER ROLE 注入，
-- 这里只创建角色本身。如已存在则跳过（DO 块容错）。
-- =========================================================

DO $$
BEGIN
    -- progress_app：受 RLS 约束的业务连接 role
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'progress_app') THEN
        CREATE ROLE progress_app LOGIN NOBYPASSRLS;
    END IF;

    -- progress_rls_definer：SECURITY DEFINER 函数专用 owner
    -- BYPASSRLS 让函数体内可跨 RLS 写入；NOLOGIN 防止业务直接连接
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'progress_rls_definer') THEN
        CREATE ROLE progress_rls_definer NOLOGIN BYPASSRLS;
    END IF;
END
$$;

-- =========================================================
-- 2. 角色 / 权限 / 用户体系
-- 拓扑顺序：roles（无依赖） → permissions → role_permissions
--           → users（依赖 roles） → refresh_tokens（依赖 users）
-- =========================================================

-- 系统预置角色（id 由代码硬编码：1=超管 / 2=开发 / 3=客服）
CREATE TABLE roles (
    id          BIGINT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 资源级权限：(resource, action, scope) 三元组
CREATE TABLE permissions (
    id          BIGSERIAL PRIMARY KEY,
    resource    TEXT NOT NULL,
    action      TEXT NOT NULL,
    scope       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resource, action, scope)
);

-- 角色 → 权限 多对多
CREATE TABLE role_permissions (
    role_id        BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id  BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 用户表（C1 关键：在 roles 之后创建，FK role_id → roles.id 才能成立）
CREATE TABLE users (
    id             BIGSERIAL PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    display_name   TEXT NOT NULL,
    role_id        BIGINT NOT NULL REFERENCES roles(id),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    -- W2: 短期 access + refresh 配套；token_version 用于"全局踢下线"
    token_version  BIGINT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_role ON users(role_id);

-- W2: refresh token 持久化（hash 入库；明文仅存于客户端）
CREATE TABLE refresh_tokens (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    BYTEA NOT NULL UNIQUE,
    user_agent    TEXT,
    client_ip     INET,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id)    WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- =========================================================
-- 3. 客户表（依赖 users，因为 created_by FK）
-- =========================================================

CREATE TABLE customers (
    id           BIGSERIAL PRIMARY KEY,
    name_wechat  TEXT NOT NULL,
    remark       TEXT,
    created_by   BIGINT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customers_created_by ON customers(created_by);

-- =========================================================
-- 4. 项目相关 ENUM + 文件表 + 项目主表
-- 注：files 必须在 projects 之前（projects 引用 files.id 作为文档关联列）
-- =========================================================

-- 项目状态机（spec §6 / spec §6.1 状态枚举）
CREATE TYPE project_status AS ENUM (
    'dealing',     -- 正在洽谈
    'quoting',     -- 正在报价
    'developing',  -- 进入开发
    'confirming',  -- 客户确认中
    'delivered',   -- 已交付
    'paid',        -- 已结算
    'archived',    -- 已归档
    'after_sales', -- 售后中
    'cancelled'    -- 已取消
);

-- 项目优先级
CREATE TYPE project_priority AS ENUM ('urgent', 'normal');

-- 论文等级
CREATE TYPE thesis_level AS ENUM ('bachelor', 'master', 'doctor');

-- 文件元数据（实际存储路径由后端控制；客户端仅看 uuid + filename）
CREATE TABLE files (
    id            BIGSERIAL PRIMARY KEY,
    uuid          UUID NOT NULL UNIQUE,
    filename      TEXT NOT NULL,                  -- 原始文件名（仅展示）
    size_bytes    BIGINT NOT NULL,
    mime_type     TEXT NOT NULL,                  -- 服务端 sniff 结果（C5：禁信任客户端 Content-Type）
    storage_path  TEXT NOT NULL UNIQUE,           -- 服务端绝对路径，仅 UUID（C5）
    uploaded_by   BIGINT NOT NULL REFERENCES users(id),
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 项目主表（聚合根）
CREATE TABLE projects (
    id                BIGSERIAL PRIMARY KEY,
    name              TEXT NOT NULL,
    customer_id       BIGINT NOT NULL REFERENCES customers(id),
    description       TEXT NOT NULL,
    priority          project_priority NOT NULL DEFAULT 'normal',
    thesis_level      thesis_level,
    subject           TEXT,

    status            project_status NOT NULL DEFAULT 'dealing',
    holder_role_id    BIGINT REFERENCES roles(id),
    holder_user_id    BIGINT REFERENCES users(id),

    deadline          TIMESTAMPTZ NOT NULL,

    -- 状态进入时间戳（spec §6 状态转换记录）
    dealing_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quoting_at        TIMESTAMPTZ,
    dev_started_at    TIMESTAMPTZ,
    confirming_at     TIMESTAMPTZ,
    delivered_at      TIMESTAMPTZ,
    paid_at           TIMESTAMPTZ,
    archived_at       TIMESTAMPTZ,
    after_sales_at    TIMESTAMPTZ,
    cancelled_at      TIMESTAMPTZ,

    -- W4: 金额改为 NUMERIC(12,2)，Go 侧用 decimal/字符串避免浮点误差
    original_quote    NUMERIC(12,2) NOT NULL DEFAULT 0,
    current_quote     NUMERIC(12,2) NOT NULL DEFAULT 0,
    after_sales_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_received    NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- 项目独立文档字段（开题报告 / 任务书 / 格式规范文档）
    opening_doc_id      BIGINT REFERENCES files(id),
    assignment_doc_id   BIGINT REFERENCES files(id),
    format_spec_doc_id  BIGINT REFERENCES files(id),

    -- W5: 论文版本计数器（advisory lock 配合，避免并发上传时 version_no 冲突）
    thesis_version_counter INTEGER NOT NULL DEFAULT 0,

    created_by        BIGINT NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_status      ON projects(status);
CREATE INDEX idx_projects_created_by  ON projects(created_by);
CREATE INDEX idx_projects_holder      ON projects(holder_user_id);
CREATE INDEX idx_projects_deadline    ON projects(deadline);

-- 项目附件（多对多，分类：sample_doc 参考样稿 / source_code 源码）
CREATE TABLE project_files (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id     BIGINT NOT NULL REFERENCES files(id),
    category    TEXT NOT NULL CHECK (category IN ('sample_doc', 'source_code')),
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_project_files_project ON project_files(project_id, category);

-- 论文版本（不可覆盖：每次上传 version_no 单调递增）
CREATE TABLE thesis_versions (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id     BIGINT NOT NULL REFERENCES files(id),
    version_no  INTEGER NOT NULL,
    remark      TEXT,
    uploaded_by BIGINT NOT NULL REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, version_no)
);

-- =========================================================
-- 5. C2 项目成员关系（资源级权限 + RLS 基石）
-- 谁能看/操作某项目：必须在 project_members 中
--   owner  = 客服创建者
--   dev    = 被指派开发
--   viewer = 超管 / 订阅者
-- =========================================================

CREATE TYPE project_member_role AS ENUM ('owner', 'dev', 'viewer');

CREATE TABLE project_members (
    project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        project_member_role NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members(user_id);

-- =========================================================
-- 6. 反馈系统
-- =========================================================

CREATE TYPE feedback_source AS ENUM ('phone', 'wechat', 'email', 'meeting', 'other');
CREATE TYPE feedback_status AS ENUM ('pending', 'done');

CREATE TABLE feedbacks (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    source        feedback_source NOT NULL DEFAULT 'wechat',
    status        feedback_status NOT NULL DEFAULT 'pending',
    recorded_by   BIGINT NOT NULL REFERENCES users(id),
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_feedbacks_project ON feedbacks(project_id, recorded_at DESC);

CREATE TABLE feedback_attachments (
    id           BIGSERIAL PRIMARY KEY,
    feedback_id  BIGINT NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    file_id      BIGINT NOT NULL REFERENCES files(id)
);

-- =========================================================
-- 7. 财务（收款 / 结算）
-- =========================================================

CREATE TYPE payment_direction AS ENUM ('customer_in', 'dev_settlement');

CREATE TABLE payments (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES projects(id),
    direction       payment_direction NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    paid_at         TIMESTAMPTZ NOT NULL,
    related_user_id BIGINT REFERENCES users(id),     -- dev_settlement 必填
    screenshot_id   BIGINT REFERENCES files(id),     -- dev_settlement 必填
    remark          TEXT NOT NULL,
    recorded_by     BIGINT NOT NULL REFERENCES users(id),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 业务约束：开发结算必须有 related_user_id + screenshot_id
    CONSTRAINT chk_settlement_required_fields CHECK (
        direction = 'customer_in'
        OR (related_user_id IS NOT NULL AND screenshot_id IS NOT NULL)
    )
);
CREATE INDEX idx_payments_project ON payments(project_id);
CREATE INDEX idx_payments_user    ON payments(related_user_id) WHERE direction = 'dev_settlement';

-- =========================================================
-- 8. 报价变更日志
-- =========================================================

CREATE TYPE quote_change_type AS ENUM ('append', 'modify', 'after_sales');

CREATE TABLE quote_change_logs (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    change_type  quote_change_type NOT NULL,
    delta        NUMERIC(12,2) NOT NULL,
    old_quote    NUMERIC(12,2) NOT NULL,
    new_quote    NUMERIC(12,2) NOT NULL,
    reason       TEXT NOT NULL,
    phase        project_status NOT NULL,
    changed_by   BIGINT NOT NULL REFERENCES users(id),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quote_changes_project ON quote_change_logs(project_id, changed_at DESC);

-- =========================================================
-- 9. 状态变更日志（C4：完整快照含 role + user）
-- =========================================================

CREATE TABLE status_change_logs (
    id                   BIGSERIAL PRIMARY KEY,
    project_id           BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_code           TEXT NOT NULL,           -- E1..E13（业务事件代号）
    event_name           TEXT NOT NULL,
    from_status          project_status,
    to_status            project_status NOT NULL,
    -- C4: 同时记录 role + user，E13 撤销 cancel 时可精确还原 holder
    from_holder_role_id  BIGINT REFERENCES roles(id),
    to_holder_role_id    BIGINT REFERENCES roles(id),
    from_holder_user_id  BIGINT REFERENCES users(id),
    to_holder_user_id    BIGINT REFERENCES users(id),
    remark               TEXT NOT NULL,
    triggered_by         BIGINT NOT NULL REFERENCES users(id),
    triggered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_status_changes_project ON status_change_logs(project_id, triggered_at);
-- E13 撤销 cancel 时按 E12 时间倒序查找最近一次取消事件，做部分索引加速
CREATE INDEX idx_status_changes_cancel  ON status_change_logs(project_id, triggered_at DESC)
    WHERE event_code = 'E12';

-- =========================================================
-- 10. 通知 + WebSocket ticket
-- =========================================================

CREATE TYPE notification_type AS ENUM (
    'ball_passed',           -- 球传给我
    'deadline_approaching',  -- 截止临近
    'overdue',               -- 已超期
    'new_feedback',          -- 新反馈
    'settlement_received',   -- 结算到账
    'project_terminated'     -- 项目终止
);

CREATE TABLE notifications (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         notification_type NOT NULL,
    project_id   BIGINT REFERENCES projects(id),
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    -- W3: outbox 模式，delivered_at IS NULL = 待 WS 推送
    delivered_at TIMESTAMPTZ,
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at      TIMESTAMPTZ
);
CREATE INDEX idx_notifications_user   ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_outbox ON notifications(user_id, created_at) WHERE delivered_at IS NULL;

-- WS 握手 ticket（短期一次性，HMAC 后入库）
CREATE TABLE ws_tickets (
    id          BIGSERIAL PRIMARY KEY,
    ticket_hash BYTEA NOT NULL UNIQUE,           -- HMAC-SHA256(ticket_secret, raw)
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     BIGINT NOT NULL REFERENCES roles(id),
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,            -- 通常 issued_at + 60s
    used_at     TIMESTAMPTZ
);
CREATE INDEX idx_ws_tickets_expires ON ws_tickets(expires_at) WHERE used_at IS NULL;

-- =========================================================
-- 11. 视图：开发结算汇总（C2 改为 SECURITY BARRIER VIEW，配合 0002 RLS 启用）
-- 此处先用普通 VIEW 创建，0002 中用 CREATE OR REPLACE 改为 security_barrier
-- 之所以不一步到位：security_barrier 需要 is_admin/current_user_id 函数，那些函数定义在 0002
-- =========================================================

CREATE VIEW dev_earnings_view AS
SELECT
    p.related_user_id           AS user_id,
    p.project_id,
    prj.name                    AS project_name,
    SUM(p.amount)               AS total_earned,
    COUNT(*)                    AS settlement_count,
    MAX(p.paid_at)              AS last_paid_at
FROM payments p
JOIN projects prj ON p.project_id = prj.id
WHERE p.direction = 'dev_settlement'
GROUP BY p.related_user_id, p.project_id, prj.name;

-- =========================================================
-- 12. 预置数据：3 个系统角色
-- =========================================================

INSERT INTO roles (id, name, description, is_system) VALUES
    (1, '超管', '系统管理员，所有权限',  TRUE),
    (2, '开发', '论文撰写人员',          TRUE),
    (3, '客服', '客户对接 + 项目录入',   TRUE);

-- 重置序列：roles.id 是手指定 BIGINT，不需 sequence；users/permissions 等 BIGSERIAL 已自动管理

-- =========================================================
-- 13. 预置 permissions（C2 简化版：scope 仅 member / all）
--   - member：必须在 project_members 中（由 RLS 强制）
--   - all   ：所有项目可见（仅超管）
-- 注：created_by_self / created_by_role:N 已被 RLS 取代，不再需要
-- =========================================================

INSERT INTO permissions (resource, action, scope) VALUES
    -- 客服可访问的 endpoint
    ('project',  'read',   'member'),
    ('project',  'create', 'all'),
    ('project',  'update', 'member'),
    ('customer', 'read',   'member'),
    ('customer', 'create', 'all'),
    ('feedback', 'read',   'member'),
    ('feedback', 'create', 'member'),
    ('payment',  'read',   'member'),
    ('payment',  'create', 'member'),
    ('file',     'read',   'member'),
    ('file',     'upload', 'all'),
    -- 超管全权限通配
    ('*', '*', 'all');

-- =========================================================
-- 14. 预置 role_permissions：角色 ↔ 权限绑定
-- =========================================================

-- 超管：通配 ('*','*','all')
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 1, id FROM permissions
    WHERE (resource, action, scope) = ('*', '*', 'all');

-- 客服：项目创建 + 自己 member 项目读写 + 反馈 / 财务 / 文件读写
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 3, id FROM permissions WHERE (resource, action, scope) IN (
        ('project',  'read',   'member'),
        ('project',  'create', 'all'),
        ('project',  'update', 'member'),
        ('customer', 'read',   'member'),
        ('customer', 'create', 'all'),
        ('feedback', 'read',   'member'),
        ('feedback', 'create', 'member'),
        ('payment',  'read',   'member'),
        ('payment',  'create', 'member'),
        ('file',     'read',   'member'),
        ('file',     'upload', 'all')
    );

-- 开发：被指派项目 member 读写 + 反馈 / 文件
INSERT INTO role_permissions (role_id, permission_id)
    SELECT 2, id FROM permissions WHERE (resource, action, scope) IN (
        ('project',  'read',   'member'),
        ('project',  'update', 'member'),
        ('feedback', 'read',   'member'),
        ('feedback', 'create', 'member'),
        ('payment',  'read',   'member'),
        ('file',     'read',   'member'),
        ('file',     'upload', 'all')
    );

-- =========================================================
-- 15. 初始 GRANT：progress_app 业务运行时权限
-- 仅 SELECT/INSERT/UPDATE/DELETE，不给 DDL；
-- 资源细粒度由 RLS 策略和 SECURITY DEFINER 函数控制。
-- 注：refresh_tokens 与 notifications 的 INSERT/UPDATE 跨用户写入由 0002 中的
--     SECURITY DEFINER 函数承担（其 owner = progress_rls_definer）。
-- 注：W20 之后 ws_tickets 不授予 UPDATE（消费仅由 consume_ws_ticket 函数完成）。
-- =========================================================

-- 默认对所有未来 schema 内对象 GRANT 一份给 progress_app（避免新增表后忘记授权）
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO progress_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO progress_app;

-- 为已存在表显式授予（默认权限只对未来对象生效）
GRANT SELECT, INSERT, UPDATE, DELETE ON
    roles, permissions, role_permissions, users, refresh_tokens,
    customers, files, projects, project_files, thesis_versions,
    project_members, feedbacks, feedback_attachments,
    payments, quote_change_logs, status_change_logs,
    notifications
    TO progress_app;

-- ws_tickets：业务直接 INSERT（issue ticket）+ DELETE（cleanup cron）+ SELECT
-- UPDATE 不授予，由 SECURITY DEFINER consume_ws_ticket 函数承担（W20）
GRANT SELECT, INSERT, DELETE ON ws_tickets TO progress_app;

-- 视图
GRANT SELECT ON dev_earnings_view TO progress_app;

-- 序列（BIGSERIAL 默认创建的 sequence）
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO progress_app;

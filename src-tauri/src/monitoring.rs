// @file: monitoring.rs
// @description: GlitchTip (Sentry 协议兼容) 错误监控初始化 + Tauri Rust 端 panic 自动转发
//               方案 B 明文 http :38090 起步（5 人 alpha）；后续切方案 A TLS 时改 https + 自定义 transport
//               PII 全关 (send_default_pii=false)；release 字段从 CARGO_PKG_VERSION 编译期注入
//               set/clear_sentry_user_cmd 让前端 invoke 把当前登录账号同步到 Rust 进程级 scope，
//               Rust panic 上报也自带账号身份（与前端 webview SDK 一致）
// @author: Atlas.oi
// @date: 2026-05-09

/// GlitchTip DSN（公开 key 设计，不算 secret，硬编码入 git；切环境时改这一行）
const SENTRY_DSN: &str = "http://d37cfb92a0e04b9681598cfce0567b1e@103.236.85.144:38090/1";

/// 初始化 Sentry / GlitchTip 客户端 + 安装 panic hook
///
/// 业务流程：
/// 1. sentry::init 注册全局 transport + panic hook（feature = "panic" 自动挂载）
/// 2. 返回的 ClientInitGuard 必须由调用方持有到进程退出，drop 时 flush 队列中未发送的 event
/// 3. release 字段读 CARGO_PKG_VERSION（编译期常量），保证 SDK 上报与发版版本一致
///
/// @returns sentry::ClientInitGuard — 必须 hold 在 lib.rs::run() scope 内，否则 events 丢失
#[must_use]
pub fn init() -> sentry::ClientInitGuard {
    sentry::init((
        SENTRY_DSN,
        sentry::ClientOptions {
            release: Some(format!("ghostterm@{}", env!("CARGO_PKG_VERSION")).into()),
            // PII 全关：不发用户 IP / cookie / 默认敏感字段，符合方案 B 明文 http 安全约束
            send_default_pii: false,
            // 错误事件 100% 上报；性能 trace 1% 采样降低 atlas 压力
            sample_rate: 1.0,
            traces_sample_rate: 0.01,
            // 自动挂 backtrace 让 panic 上报含 Rust 调用栈
            attach_stacktrace: true,
            ..Default::default()
        },
    ))
}

/// 把当前登录账号身份写入 Sentry/GlitchTip 进程级 scope。
///
/// 业务流程：
/// 1. 前端 webview Sentry SDK 在 login/loadMe 后调 setSentryUser
/// 2. setSentryUser 同时 invoke 此 command 让 Rust 端 scope 也带上账号
/// 3. 后续任何 Rust panic / sentry::capture_* 自动带 user
///
/// role 作为 tag（user.role）而非 user 自定义字段，方便 GlitchTip 后台
/// 直接按角色过滤 issue 列表
#[tauri::command]
pub fn set_sentry_user_cmd(id: i64, username: String, role: String) {
    sentry::configure_scope(|scope| {
        scope.set_user(Some(sentry::User {
            id: Some(id.to_string()),
            username: Some(username),
            ..Default::default()
        }));
        scope.set_tag("user.role", role);
    });
}

/// 清除 Sentry/GlitchTip user scope（登出 / 401 强退时调）。
///
/// 让退出后的报错不再绑老用户身份，避免上报误归属。
#[tauri::command]
pub fn clear_sentry_user_cmd() {
    sentry::configure_scope(|scope| {
        scope.set_user(None);
        scope.remove_tag("user.role");
    });
}

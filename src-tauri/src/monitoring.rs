// @file: monitoring.rs
// @description: GlitchTip (Sentry 协议兼容) 错误监控初始化 + Tauri Rust 端 panic 自动转发
//               方案 B 明文 http :38090 起步（5 人 alpha）；后续切方案 A TLS 时改 https + 自定义 transport
//               PII 全关 (send_default_pii=false)；release 字段从 CARGO_PKG_VERSION 编译期注入
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

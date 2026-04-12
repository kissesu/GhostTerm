// @file: pty_manager/mod.rs
// @description: PTY 管理模块 - 负责伪终端的创建、销毁、数据传输（通过 WebSocket）
//               以及安全 token 认证体系
// @author: Atlas.oi
// @date: 2026-04-12

pub mod ws_server;
pub mod bridge;
pub mod auth;

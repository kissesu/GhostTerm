// @file: pty_manager/mod.rs
// @description: PTY 管理模块 - 负责伪终端的创建、销毁、尺寸调整和重连
//               全局维护 PTY 状态表，每个 PTY 对应一个 WebSocket server
//               PTY 数据通过 WebSocket 二进制帧传输给 xterm.js（不用 Tauri Events）
// @author: Atlas.oi
// @date: 2026-04-13

pub mod ws_server;
pub mod bridge;
pub mod auth;

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};

use crate::pty_manager::auth::AuthToken;
use crate::pty_manager::ws_server::WsServer;

// ============================================
// 全局 PTY 状态注册表
// 用 Arc<Mutex<HashMap>> 保证多线程安全，tokio task 可跨线程访问
// ============================================
lazy_static::lazy_static! {
    static ref PTY_REGISTRY: Arc<Mutex<HashMap<String, PtyState>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// PTY 运行时状态 - 保存 PTY 进程和认证信息
pub struct PtyState {
    /// PTY master 端（可读写，与子进程通信）
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    /// 持久化保存 PTY writer；portable-pty writer 只能获取一次，且 drop 会发送 EOF
    pub writer: Arc<StdMutex<Box<dyn std::io::Write + Send>>>,
    /// PTY 子进程句柄
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    /// 当前有效的认证 token
    pub token: AuthToken,
    /// WebSocket server 监听端口
    pub ws_port: u16,
    /// 当前 PTY 尺寸
    pub size: PtySize,
    /// 当前活跃 WebSocket 连接数
    pub active_connections: usize,
}

/// PTY 创建结果 - 返回给前端的连接信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyInfo {
    /// PTY 唯一标识符
    pub pty_id: String,
    /// WebSocket server 端口（连接到 ws://127.0.0.1:{ws_port}）
    pub ws_port: u16,
    /// 一次性认证 token（通过 ?token=xxx query param 传递）
    pub ws_token: String,
}

/// 生成唯一的 PTY ID（8字节随机 hex）
fn gen_pty_id() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..8).map(|_| rng.random::<u8>()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 生成新 token 并返回 token 值（用于重连场景）
fn gen_token_value() -> AuthToken {
    AuthToken::new()
}

fn fallback_shell() -> &'static str {
    if cfg!(target_os = "windows") {
        "cmd.exe"
    } else if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/bash"
    }
}

fn resolve_default_shell_from_env(shell_env: Option<String>) -> String {
    shell_env
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| fallback_shell().to_string())
}

/// 启动 PTY 进程并创建 WebSocket server
///
/// 业务逻辑：
/// 1. 绑定 WebSocket server（操作系统分配随机端口）
/// 2. 用 portable-pty 创建 PTY，启动 shell 子进程
/// 3. 注册到全局状态表
/// 4. 启动 WebSocket 接收循环（在独立 tokio task 中）
///
/// 注意：env 参数预留给 PBI-2，当前实现使用默认环境变量
pub async fn spawn_pty(
    shell: &str,
    cwd: &str,
    env: HashMap<String, String>,
) -> Result<PtyInfo, String> {
    eprintln!("[pty_manager] spawn_pty shell={} cwd={}", shell, cwd);
    // ============================================
    // 第一步：绑定 WebSocket server
    // 获取操作系统分配的随机端口
    // ============================================
    let ws_server = WsServer::bind()
        .await
        .map_err(|e| format!("WebSocket server 绑定失败: {}", e))?;
    let ws_port = ws_server.port;

    // ============================================
    // 第二步：创建 PTY 和启动 shell 子进程
    // ============================================
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY 创建失败: {}", e))?;

    // 构建 shell 命令
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    // 注入额外环境变量
    for (k, v) in &env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Shell 启动失败: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("PTY writer 获取失败: {}", e))?;

    // ============================================
    // 第三步：生成 PTY ID 和认证 token，注册到全局状态表
    // ============================================
    let pty_id = gen_pty_id();
    let token = gen_token_value();
    let ws_token = token.value.clone();

    let state = PtyState {
        master: pair.master,
        writer: Arc::new(StdMutex::new(writer)),
        child,
        token,
        ws_port,
        size: PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        },
        active_connections: 0,
    };

    {
        let mut registry = PTY_REGISTRY.lock().await;
        registry.insert(pty_id.clone(), state);
    }

    // ============================================
    // 第四步：启动 WebSocket 接受循环
    // 在独立 tokio task 中等待 xterm.js 连接
    // ============================================
    let pty_id_clone = pty_id.clone();
    tokio::spawn(async move {
        accept_ws_connections(ws_server, pty_id_clone).await;
    });

    Ok(PtyInfo {
        pty_id,
        ws_port,
        ws_token,
    })
}

/// WebSocket 连接接受循环
///
/// 等待 xterm.js 的 WebSocket 连接，验证 token 后启动 PTY ↔ WS 桥接
async fn accept_ws_connections(server: WsServer, pty_id: String) {
    use tokio_tungstenite::accept_hdr_async;
    use tokio_tungstenite::tungstenite::handshake::server::{Callback, ErrorResponse, Request, Response};

    loop {
        // 接受 TCP 连接
        let tcp_stream = match server.listener.accept().await {
            Ok((stream, addr)) => {
                eprintln!("[pty_manager] 收到 WebSocket TCP 连接 pty_id={} addr={}", pty_id, addr);
                stream
            }
            Err(_) => break,
        };

        // 验证 token（在握手阶段提取和验证）
        let pty_id = pty_id.clone();

        // 提取 URI 用于 token 验证
        let mut extracted_token = String::new();
        let extracted_token_ref = &mut extracted_token;

        struct TokenExtractor<'a> {
            token: &'a mut String,
        }

        impl<'a> Callback for TokenExtractor<'a> {
            fn on_request(
                self,
                request: &Request,
                response: Response,
            ) -> Result<Response, ErrorResponse> {
                if let Some(query) = request.uri().query() {
                    let uri_with_query = format!("/?{}", query);
                    if let Some(t) = ws_server::extract_token_from_uri(&uri_with_query) {
                        *self.token = t;
                    }
                }
                Ok(response)
            }
        }

        let callback = TokenExtractor { token: extracted_token_ref };

        let ws_stream = match accept_hdr_async(tcp_stream, callback).await {
            Ok(ws) => ws,
            Err(err) => {
                eprintln!("[pty_manager] WebSocket 握手失败 pty_id={} err={}", pty_id, err);
                continue;
            }
        };

        // 验证 token
        let token_valid = {
            let mut registry = PTY_REGISTRY.lock().await;
            if let Some(state) = registry.get_mut(&pty_id) {
                state.token.validate(&extracted_token)
            } else {
                false
            }
        };

        if !token_valid {
            // token 无效，关闭连接
            eprintln!(
                "[pty_manager] token 校验失败 pty_id={} token_preview={}",
                pty_id,
                extracted_token.chars().take(8).collect::<String>()
            );
            continue;
        }

        eprintln!(
            "[pty_manager] token 校验成功 pty_id={} token_preview={}",
            pty_id,
            extracted_token.chars().take(8).collect::<String>()
        );

        {
            let mut registry = PTY_REGISTRY.lock().await;
            if let Some(state) = registry.get_mut(&pty_id) {
                state.active_connections += 1;
            }
        }

        // 启动 PTY ↔ WebSocket 桥接
        let (output_tx, output_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
        let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        // 启动 PTY 读取任务（master -> WebSocket）
        {
            let registry = PTY_REGISTRY.lock().await;
            if let Some(state) = registry.get(&pty_id) {
                // 获取 PTY reader（portable-pty 使用同步 IO，在 spawn_blocking 中运行）
                let reader = state.master.try_clone_reader().ok();
                drop(registry);

                if let Some(mut reader) = reader {
                    let output_tx_clone = output_tx.clone();
                    tokio::task::spawn_blocking(move || {
                        let mut buf = vec![0u8; 4096];
                        loop {
                            match reader.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    let data = buf[..n].to_vec();
                                    if output_tx_clone.blocking_send(data).is_err() {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    });
                }
            }
        }

        // 启动 PTY 写入任务（WebSocket -> master）
        {
            let pty_id_write = pty_id.clone();
            let writer = {
                let registry = PTY_REGISTRY.lock().await;
                registry
                    .get(&pty_id_write)
                    .map(|state| Arc::clone(&state.writer))
            };

            if let Some(writer) = writer {
                tokio::spawn(async move {
                    while let Some(data) = input_rx.recv().await {
                        eprintln!(
                            "[pty_manager] 收到终端输入帧 pty_id={} bytes={}",
                            pty_id_write,
                            data.len()
                        );
                        let writer = Arc::clone(&writer);
                        let pty_id_for_write = pty_id_write.clone();
                        let write_result = tokio::task::spawn_blocking(move || {
                            let mut writer = writer
                                .lock()
                                .map_err(|_| format!("PTY writer 锁已中毒 pty_id={}", pty_id_for_write))?;
                            writer
                                .write_all(&data)
                                .map_err(|err| format!("写入 PTY stdin 失败 pty_id={} err={}", pty_id_for_write, err))?;
                            writer
                                .flush()
                                .map_err(|err| format!("flush PTY stdin 失败 pty_id={} err={}", pty_id_for_write, err))?;
                            Ok::<(), String>(())
                        })
                        .await;

                        match write_result {
                            Ok(Ok(())) => {}
                            Ok(Err(err)) => {
                                eprintln!("[pty_manager] {}", err);
                                break;
                            }
                            Err(err) => {
                                eprintln!(
                                    "[pty_manager] PTY writer 阻塞任务失败 pty_id={} err={}",
                                    pty_id_write,
                                    err
                                );
                                break;
                            }
                        }
                        eprintln!("[pty_manager] 写入 PTY stdin 成功 pty_id={}", pty_id_write);
                    }
                });
            } else {
                eprintln!("[pty_manager] 获取 PTY writer 失败 pty_id={}", pty_id_write);
            }
        }

        // 启动 WebSocket 桥接
        eprintln!("[pty_manager] 启动 PTY ↔ WebSocket 桥接 pty_id={}", pty_id);
        let pty_id_bridge = pty_id.clone();
        tokio::spawn(async move {
            bridge::run_bridge(ws_stream, output_rx, input_tx).await;

            let should_schedule_cleanup = {
                let mut registry = PTY_REGISTRY.lock().await;
                if let Some(state) = registry.get_mut(&pty_id_bridge) {
                    if state.active_connections > 0 {
                        state.active_connections -= 1;
                    }
                    state.active_connections == 0
                } else {
                    false
                }
            };

            if !should_schedule_cleanup {
                return;
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let mut registry = PTY_REGISTRY.lock().await;
            if let Some(state) = registry.get_mut(&pty_id_bridge) {
                if state.active_connections == 0 {
                    eprintln!(
                        "[pty_manager] WebSocket 已断开超过 5 秒，自动回收 PTY pty_id={}",
                        pty_id_bridge
                    );
                    let _ = state.child.kill();
                    registry.remove(&pty_id_bridge);
                }
            }
        });
    }
}

/// 关闭并销毁指定 PTY
pub async fn kill_pty(pty_id: &str) -> Result<(), String> {
    let mut registry = PTY_REGISTRY.lock().await;
    if let Some(mut state) = registry.remove(pty_id) {
        state.child.kill().map_err(|e| format!("kill PTY 失败: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY {} 不存在", pty_id))
    }
}

/// 调整 PTY 窗口尺寸
pub async fn resize_pty(pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let mut registry = PTY_REGISTRY.lock().await;
    if let Some(state) = registry.get_mut(pty_id) {
        let new_size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        state
            .master
            .resize(new_size)
            .map_err(|e| format!("resize PTY 失败: {}", e))?;
        state.size = new_size;
        Ok(())
    } else {
        Err(format!("PTY {} 不存在", pty_id))
    }
}

/// 为已存在的 PTY 签发新的认证 token（重连场景）
///
/// 旧 token 在此调用后失效，前端用新 token 建立 WebSocket 连接
pub async fn reconnect_pty(pty_id: &str) -> Result<PtyInfo, String> {
    let mut registry = PTY_REGISTRY.lock().await;
    if let Some(state) = registry.get_mut(pty_id) {
        // 签发新 token，旧 token 自动失效（被替换）
        let new_token = gen_token_value();
        let ws_token = new_token.value.clone();
        let ws_port = state.ws_port;
        state.token = new_token;
        Ok(PtyInfo {
            pty_id: pty_id.to_string(),
            ws_port,
            ws_token,
        })
    } else {
        Err(format!("PTY {} 不存在", pty_id))
    }
}

#[tauri::command]
pub async fn get_default_shell_cmd() -> Result<String, String> {
    Ok(resolve_default_shell_from_env(std::env::var("SHELL").ok()))
}

// ============================================
// Tauri Command 包装函数
// 注意：这里只标注 #[tauri::command]，实际注册在 lib.rs 合并时完成
// HashMap<String, String> 不被 Tauri serialization 直接支持，改用 Vec<(String,String)>
// ============================================

/// Tauri Command：启动 PTY
///
/// 强制注入终端类型环境变量：
/// - TERM=xterm-256color：Tauri GUI 进程不继承用户 shell 环境，若不设置程序会降级到无色输出
/// - COLORTERM=truecolor：声明支持 24-bit 真彩色，Claude Code 等程序据此启用全色渲染
#[tauri::command]
pub async fn spawn_pty_cmd(shell: String, cwd: String) -> Result<PtyInfo, String> {
    let mut env = HashMap::new();
    env.insert("TERM".to_string(), "xterm-256color".to_string());
    env.insert("COLORTERM".to_string(), "truecolor".to_string());
    spawn_pty(&shell, &cwd, env).await
}

/// Tauri Command：关闭 PTY
#[tauri::command]
pub async fn kill_pty_cmd(pty_id: String) -> Result<(), String> {
    kill_pty(&pty_id).await
}

/// Tauri Command：调整 PTY 尺寸
#[tauri::command]
pub async fn resize_pty_cmd(pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    resize_pty(&pty_id, cols, rows).await
}

/// Tauri Command：重连 PTY（签发新 token）
#[tauri::command]
pub async fn reconnect_pty_cmd(pty_id: String) -> Result<PtyInfo, String> {
    reconnect_pty(&pty_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::time::Duration;
    use tokio_tungstenite::connect_async;

    /// 测试 PTY ID 生成格式
    #[test]
    fn test_gen_pty_id_format() {
        let id = gen_pty_id();
        // 8字节 -> 16 hex 字符
        assert_eq!(id.len(), 16);
        // 只包含 hex 字符
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// 测试 PTY ID 唯一性
    #[test]
    fn test_gen_pty_id_unique() {
        let ids: Vec<String> = (0..10).map(|_| gen_pty_id()).collect();
        // 10 个 ID 应全部不同
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 10);
    }

    /// 测试 spawn_pty 成功路径（需要系统有 shell）
    #[tokio::test]
    async fn test_spawn_pty_success() {
        let shell = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            "/bin/sh"
        } else {
            "cmd.exe"
        };

        let result = spawn_pty(shell, std::env::temp_dir().to_str().unwrap_or("/tmp"), HashMap::new()).await;
        assert!(result.is_ok(), "spawn_pty 应成功: {:?}", result.err());

        let info = result.unwrap();
        // pty_id 长度正确
        assert_eq!(info.pty_id.len(), 16);
        // ws_port 非零
        assert!(info.ws_port > 0);
        // ws_token 为 64 字符 hex
        assert_eq!(info.ws_token.len(), 64);

        // 验证子进程存活（注册表中存在）
        let registry = PTY_REGISTRY.lock().await;
        assert!(registry.contains_key(&info.pty_id), "PTY 应在注册表中");
        drop(registry);

        // 清理
        let _ = kill_pty(&info.pty_id).await;
    }

    /// 测试 kill_pty 正确销毁 PTY
    #[tokio::test]
    async fn test_kill_pty() {
        let shell = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            "/bin/sh"
        } else {
            "cmd.exe"
        };

        let info = spawn_pty(shell, std::env::temp_dir().to_str().unwrap_or("/tmp"), HashMap::new())
            .await
            .expect("spawn_pty 失败");
        let pty_id = info.pty_id.clone();

        // kill 应成功
        let kill_result = kill_pty(&pty_id).await;
        assert!(kill_result.is_ok(), "kill_pty 应成功");

        // kill 后注册表中不应有此 PTY
        let registry = PTY_REGISTRY.lock().await;
        assert!(!registry.contains_key(&pty_id), "kill 后 PTY 应从注册表移除");
    }

    /// 测试 kill 不存在的 PTY 返回错误
    #[tokio::test]
    async fn test_kill_nonexistent_pty() {
        let result = kill_pty("nonexistent_id_0000").await;
        assert!(result.is_err(), "kill 不存在的 PTY 应返回错误");
    }

    /// 测试 resize_pty 更新 PTY 尺寸
    #[tokio::test]
    async fn test_resize_pty() {
        let shell = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            "/bin/sh"
        } else {
            "cmd.exe"
        };

        let info = spawn_pty(shell, std::env::temp_dir().to_str().unwrap_or("/tmp"), HashMap::new())
            .await
            .expect("spawn_pty 失败");

        // resize 应成功
        let resize_result = resize_pty(&info.pty_id, 120, 40).await;
        assert!(resize_result.is_ok(), "resize_pty 应成功: {:?}", resize_result.err());

        // 验证尺寸已更新
        let registry = PTY_REGISTRY.lock().await;
        let state = registry.get(&info.pty_id).unwrap();
        assert_eq!(state.size.cols, 120);
        assert_eq!(state.size.rows, 40);
        drop(registry);

        let _ = kill_pty(&info.pty_id).await;
    }

    /// 测试 reconnect_pty 签发新 token
    #[tokio::test]
    async fn test_reconnect_pty_new_token() {
        let shell = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            "/bin/sh"
        } else {
            "cmd.exe"
        };

        let info = spawn_pty(shell, std::env::temp_dir().to_str().unwrap_or("/tmp"), HashMap::new())
            .await
            .expect("spawn_pty 失败");
        let old_token = info.ws_token.clone();

        // reconnect 应返回新 token
        let new_info = reconnect_pty(&info.pty_id).await.expect("reconnect_pty 失败");
        assert_ne!(new_info.ws_token, old_token, "reconnect 应签发新 token");
        assert_eq!(new_info.ws_port, info.ws_port, "端口不变");
        assert_eq!(new_info.pty_id, info.pty_id, "pty_id 不变");

        let _ = kill_pty(&info.pty_id).await;
    }

    /// 验证 PTY writer 能把命令真正写入 shell，并从 reader 读到输出
    #[tokio::test]
    async fn test_spawned_pty_accepts_stdin_and_produces_stdout() {
        let shell = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            "/bin/sh"
        } else {
            "cmd.exe"
        };

        let info = spawn_pty(shell, std::env::temp_dir().to_str().unwrap_or("/tmp"), HashMap::new())
            .await
            .expect("spawn_pty 失败");

        let (mut reader, writer) = {
            let registry = PTY_REGISTRY.lock().await;
            let state = registry.get(&info.pty_id).expect("PTY 应存在于注册表");
            let reader = state.master.try_clone_reader().expect("应能克隆 PTY reader");
            let writer = Arc::clone(&state.writer);
            (reader, writer)
        };

        {
            let mut writer = writer.lock().expect("应能锁定 PTY writer");
            writer
                .write_all(b"printf 'ghostterm-stdin-ok\\n'\n")
                .expect("写入 PTY stdin 应成功");
            writer.flush().expect("flush PTY stdin 应成功");
        }

        let read_result = tokio::task::spawn_blocking(move || {
            let mut buf = vec![0u8; 4096];
            let mut output = Vec::new();
            let deadline = std::time::Instant::now() + Duration::from_secs(3);

            while std::time::Instant::now() < deadline {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        output.extend_from_slice(&buf[..n]);
                        if output.windows(b"ghostterm-stdin-ok".len()).any(|w| w == b"ghostterm-stdin-ok") {
                            return Ok::<Vec<u8>, String>(output);
                        }
                    }
                    Err(err) => return Err(format!("读取 PTY 输出失败: {}", err)),
                }
            }

            Err(format!(
                "超时未读到预期输出，当前输出={}",
                String::from_utf8_lossy(&output)
            ))
        })
        .await
        .expect("PTY reader 任务应完成");

        let output = read_result.expect("应能从 PTY 读到命令输出");
        let output_text = String::from_utf8_lossy(&output);
        assert!(
            output_text.contains("ghostterm-stdin-ok"),
            "PTY 输出应包含写入命令结果，实际输出={}",
            output_text
        );

        let _ = kill_pty(&info.pty_id).await;
    }

    /// 已建立的活跃 WebSocket 连接不应在 5 秒定时器到期后把 PTY 误杀
    #[tokio::test]
    async fn test_active_websocket_connection_should_keep_pty_alive() {
        let shell = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            "/bin/sh"
        } else {
            "cmd.exe"
        };

        let info = spawn_pty(shell, std::env::temp_dir().to_str().unwrap_or("/tmp"), HashMap::new())
            .await
            .expect("spawn_pty 失败");

        let ws_url = format!("ws://127.0.0.1:{}/?token={}", info.ws_port, info.ws_token);
        let (mut ws_stream, _) = connect_async(&ws_url)
            .await
            .expect("应能建立 WebSocket 连接");

        tokio::time::sleep(Duration::from_secs(6)).await;

        let registry = PTY_REGISTRY.lock().await;
        assert!(
            registry.contains_key(&info.pty_id),
            "活跃 WebSocket 连接期间，PTY 不应被 5 秒定时器移除"
        );
        drop(registry);

        let _ = ws_stream.close(None).await;
        let _ = kill_pty(&info.pty_id).await;
    }

    #[test]
    fn test_resolve_default_shell_from_env_uses_env_value() {
        let shell = resolve_default_shell_from_env(Some("/opt/homebrew/bin/fish".to_string()));
        assert_eq!(shell, "/opt/homebrew/bin/fish");
    }

    #[test]
    fn test_resolve_default_shell_from_env_falls_back_when_empty() {
        let shell = resolve_default_shell_from_env(Some("   ".to_string()));
        assert_eq!(shell, fallback_shell());
    }

    #[tokio::test]
    async fn test_get_default_shell_cmd_returns_non_empty_shell() {
        let shell = get_default_shell_cmd().await.expect("获取默认 shell 应成功");
        assert!(!shell.trim().is_empty());
    }
}

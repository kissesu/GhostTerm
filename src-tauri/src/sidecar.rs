// @file: sidecar.rs
// @description: GhostTerm thesis sidecar 生命周期管理 + NDJSON 通信
//               常驻 worker：首次 invoke 时 spawn，app 退出时 kill
//               错误处理（spec Section 7）：不自动 restart / retry；错误直接抛给前端
// @author: Atlas.oi
// @date: 2026-04-17

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

pub struct SidecarState {
    pub inner: AsyncMutex<Option<SidecarInner>>,
}

pub struct SidecarInner {
    pub child: CommandChild,
    pub pending: Arc<AsyncMutex<HashMap<String, oneshot::Sender<Value>>>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self { inner: AsyncMutex::new(None) }
    }
}

/// 确保 sidecar 已 spawn，首次调用时启动进程并挂起事件消费任务
async fn ensure_spawned(
    app: &AppHandle,
    state: &State<'_, SidecarState>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Ok(());
    }

    // ============================================
    // 第一步：spawn sidecar 进程
    // sidecar() 参数为 tauri.conf.json externalBin 中声明的名称（不含 triple 后缀）
    // ============================================
    let (mut rx, child) = app
        .shell()
        .sidecar("ghostterm-thesis")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    // ============================================
    // 第二步：建立 pending map，用于 request-id → oneshot channel 映射
    // invoke 写入 pending，事件消费任务匹配 id 后发送响应
    // ============================================
    let pending: Arc<AsyncMutex<HashMap<String, oneshot::Sender<Value>>>> =
        Arc::new(AsyncMutex::new(HashMap::new()));

    // ============================================
    // 第三步：启动后台事件消费任务
    // 持续读取 stdout NDJSON 行，按 id 路由到对应 oneshot channel
    // sidecar 退出时（Terminated）任务自行结束
    // ============================================
    let pending_clone = pending.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    // stdout 按换行分割，每行是一个独立 JSON 对象
                    for raw in text.split('\n').filter(|s| !s.is_empty()) {
                        if let Ok(resp) = serde_json::from_str::<Value>(raw) {
                            let id = resp
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let mut pmap = pending_clone.lock().await;
                            if let Some(tx) = pmap.remove(&id) {
                                let _ = tx.send(resp);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    // sidecar 的 stderr 日志直接转发到 Rust 侧 stderr，方便调试
                    eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(p) => {
                    eprintln!("[sidecar] terminated: {:?}", p);
                    break;
                }
                _ => {}
            }
        }
    });

    *guard = Some(SidecarInner { child, pending });
    Ok(())
}

/// 向 sidecar 发送 NDJSON 请求并等待响应
///
/// 业务逻辑：
/// 1. 确保进程已 spawn（lazy init）
/// 2. 注册 oneshot channel 到 pending map
/// 3. 将 payload 序列化为 NDJSON 写入 stdin
/// 4. 等待后台任务通过 oneshot channel 返回响应
#[tauri::command]
pub async fn tools_sidecar_invoke(
    app: AppHandle,
    state: State<'_, SidecarState>,
    payload: Value,
) -> Result<Value, String> {
    ensure_spawned(&app, &state).await?;

    // payload 必须携带 id 字段，用于响应路由
    let req_id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("payload missing 'id'")?
        .to_string();

    let (tx, rx) = oneshot::channel::<Value>();

    {
        let mut guard = state.inner.lock().await;
        let inner = guard.as_mut().ok_or("sidecar not running")?;

        // 先注册 channel，再写 stdin，避免响应早于注册的竞态
        inner.pending.lock().await.insert(req_id.clone(), tx);

        let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let mut data = line.into_bytes();
        data.push(b'\n');
        inner
            .child
            .write(&data)
            .map_err(|e| format!("write stdin failed: {e}"))?;
    }

    rx.await
        .map_err(|_| "sidecar closed before response".to_string())
}

/// 强制重启 sidecar（kill 旧进程后重新 spawn）
///
/// 用于前端检测到 sidecar 不响应时的手动恢复操作
/// 不做自动重试，始终暴露错误给调用方
#[tauri::command]
pub async fn tools_sidecar_restart(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<(), String> {
    {
        let mut guard = state.inner.lock().await;
        if let Some(inner) = guard.take() {
            // 尽力 kill，忽略失败（进程可能已自行退出）
            let _ = inner.child.kill();
        }
    }
    ensure_spawned(&app, &state).await
}

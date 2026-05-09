/**
 * @file sse_client.rs
 * @description SSE 流式客户端：reqwest streaming + bytes_stream
 *              帧识别（事件 vs 心跳）→ tauri emit
 *              漏帧 / 服务端重启 / 重连 → emit 'app://need-reload'
 *              spec v3.5 §7
 * @author Atlas.oi
 * @date 2026-05-09
 */

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use rand::Rng;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::http_proxy::get_or_init_client;

// log 0.4 宏 — warn!/info! 写到 tauri 日志管道
use log::{info, warn};

// 服务端推送的业务事件信封，Rust 端只取 id 做单调递增检测，完整 JSON 透传前端
#[derive(Deserialize)]
struct EventEnvelope {
    id: i64,
    #[serde(rename = "type")]
    _type: String,
    // flatten 吃掉其余字段，不在结构体里逐一声明
    #[serde(flatten)]
    _rest: serde_json::Value,
}

// 心跳帧 data 字段结构，只需 latestId
#[derive(Deserialize)]
struct Heartbeat {
    #[serde(rename = "latestId")]
    latest_id: i64,
}

// 票据接口响应
#[derive(Deserialize)]
struct TicketResp {
    ticket: String,
}

/// Tauri Command：前端调用后立即返回，后台 spawn 长连接循环
#[tauri::command]
pub async fn subscribe_events_cmd(
    app: AppHandle,
    base_url: String,
    access_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        run_subscription(app, base_url, access_token).await;
    });
    Ok(())
}

/// 主重连循环：每次断开后重新申请 ticket 再连
async fn run_subscription(app: AppHandle, base_url: String, access_token: String) {
    // last_event_id 跨重连轮次保持，用于心跳比对
    let last_event_id = AtomicI64::new(0);
    // 退避区间 1s → 2s → 4s → 8s（上限），每次成功断开后重置
    let mut backoff_ms: u64 = 1000;

    loop {
        // ============================================
        // 第一步：申请一次性 ticket（有效期 30s）
        // ============================================
        let ticket = match issue_ticket(&base_url, &access_token).await {
            Ok(t) => t,
            Err(e) => {
                warn!("sse: issue_ticket failed: {e}; retry in {backoff_ms}ms");
                tokio::time::sleep(Duration::from_millis(jitter(backoff_ms))).await;
                backoff_ms = (backoff_ms * 2).min(8000);
                continue;
            }
        };

        // ============================================
        // 第二步：连接 SSE 流，阻塞直到流关闭或出错
        // ============================================
        match stream_events(&app, &base_url, &ticket, &last_event_id).await {
            Ok(()) => {
                // 服务端正常关连接 → 前端走 reloadVisibleData 兜底
                let _ = app.emit("app://need-reload", ());
                // 正常关闭退避重置，快速重连
                backoff_ms = 1000;
            }
            Err(e) => {
                warn!("sse: stream_events failed: {e}; retry in {backoff_ms}ms");
                tokio::time::sleep(Duration::from_millis(jitter(backoff_ms))).await;
                backoff_ms = (backoff_ms * 2).min(8000);
            }
        }
    }
}

/// 向 progress-server 申请 SSE 连接票据
async fn issue_ticket(base_url: &str, access_token: &str) -> Result<String, String> {
    let client = get_or_init_client()?;
    let resp = client
        .post(format!("{}/api/ws/ticket", base_url))
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| format!("post ticket: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ticket http {}", resp.status()));
    }

    let tr: TicketResp = resp.json().await.map_err(|e| format!("ticket json: {e}"))?;
    Ok(tr.ticket)
}

/// 连接 SSE 端点，解析帧，触发 emit；流正常结束返回 Ok(())，网络/解析错误返回 Err
async fn stream_events(
    app: &AppHandle,
    base_url: &str,
    ticket: &str,
    last_event_id: &AtomicI64,
) -> Result<(), String> {
    let client = get_or_init_client()?;
    // ticket 已是 base64url，urlencoding 做百分比编码防止特殊字符
    let url = format!(
        "{}/api/events?ticket={}",
        base_url,
        urlencoding::encode(ticket)
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("get events: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("events http {}", resp.status()));
    }

    let mut stream = resp.bytes_stream();
    // buf 积累跨 chunk 的不完整帧
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e: reqwest::Error| format!("stream chunk: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // SSE 协议：双换行 \n\n 作为帧边界
        while let Some(idx) = buf.find("\n\n") {
            let frame = buf[..idx].to_string();
            buf = buf[idx + 2..].to_string();
            handle_frame(app, &frame, last_event_id);
        }
    }
    Ok(())
}

/// 解析单帧：心跳帧做漏帧检测；业务帧更新 last_event_id 并 emit 给前端
fn handle_frame(app: &AppHandle, frame: &str, last_event_id: &AtomicI64) {
    // 心跳帧以 "event: heartbeat" 行开头
    if frame.starts_with("event: heartbeat") {
        if let Some(data_line) = frame.lines().find(|l| l.starts_with("data: ")) {
            let json_str = &data_line["data: ".len()..];
            if let Ok(hb) = serde_json::from_str::<Heartbeat>(json_str) {
                let local = last_event_id.load(Ordering::Relaxed);
                // latestId != local 的两种情况都需要前端全量刷新：
                //   大于 local → 中间漏帧
                //   小于 local → 服务端重启 counter 归零
                if hb.latest_id != local {
                    info!(
                        "sse heartbeat mismatch local={local} remote={}; emit need-reload",
                        hb.latest_id
                    );
                    let _ = app.emit("app://need-reload", ());
                }
            }
        }
        return;
    }

    // 普通业务事件帧：找 "data: " 行
    if let Some(data_line) = frame.lines().find(|l| l.starts_with("data: ")) {
        let json_str = &data_line["data: ".len()..];
        if let Ok(evt) = serde_json::from_str::<EventEnvelope>(json_str) {
            // fetch_max 保证 last_event_id 单调递增，防乱序误触 need-reload
            last_event_id.fetch_max(evt.id, Ordering::Relaxed);
            // 完整 envelope JSON 透传给前端，前端按 type 路由
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str) {
                let _ = app.emit("app://event", value);
            }
        }
    }
}

/// 在 backoff_ms 基础上加 0–899ms 随机抖动，防止多客户端同时重连雪崩
fn jitter(ms: u64) -> u64 {
    let j: u64 = rand::rng().random_range(0..900);
    ms + j
}

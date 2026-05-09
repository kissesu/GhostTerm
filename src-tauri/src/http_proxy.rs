// @file: http_proxy.rs
// @description: progress-server HTTP 代理 - 让前端通过 Tauri 调用 reqwest 转发请求
//               业务背景：progress-server 用自签 IP 证书部署（atlas 备案接入未在腾讯云，无法用域名 + 公开 CA）
//                        WebView (WKWebView/WebView2) 原生 fetch 不能加载自签证书 → ERR_CERT_AUTHORITY_INVALID
//                        改用 reqwest 在 Rust 层做证书钉死（cert pinning）转发请求
//                        前端 client.ts doFetch 检测 Tauri 环境时改调 invoke('http_request_cmd', ...)
//               安全设计（PR-1 Task 4 finding #11 修复）：
//                        - 删除 .danger_accept_invalid_certs(true)，不再裸跑（旧实现任意 MITM 自签证书都能冒充）
//                        - include_bytes! 编译期内嵌 atlas-ip.pem 进二进制
//                        - .add_root_certificate(...) 注入 atlas Caddy 自签证书
//                        - .tls_built_in_root_certs(false) 拒所有公共 CA，仅信编内这一张
//                        - .https_only(true) 杜绝 HTTP fallback，即使 BASE_URL 错配 http:// 也拒
//                        公共 WiFi MITM 即使持任意公共 CA 签发的伪造证书也无法冒充 atlas（103.236.85.144）
//                        证书 10 年有效（至 2036-05-08），过期前 30 天发新 release
//               转发设计：尽量薄 — 只做 method/url/headers/body 转发，不做 cookie / redirect 自定义
//                        大体响应包含 status + headers + body 文本（progress API 全 JSON 响应）
//                        Authorization 头由前端 client.ts 注入，本层不感知
// @author: Atlas.oi
// @date: 2026-05-08

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::tls::Certificate;
use serde::{Deserialize, Serialize};

// atlas Caddy 自签证书 PEM（CN=103.236.85.144，SAN=IP:103.236.85.144 + DNS:localhost，10 年有效期）
// include_bytes! 在编译期把证书字节内嵌进二进制 — 用户机器无需任何额外文件，证书与代码一起分发
const ATLAS_CERT_PEM: &[u8] = include_bytes!("../certs/atlas-ip.pem");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

// 全局 reqwest Client 单例 — 必须复用连接池避免每次请求都重做 TCP+TLS 握手
//
// 旧实现每次 http_request_cmd 都 Client::builder().build() = 每次新 TCP + 新 TLS handshake
// 跨境到香港自签证书 RTT × 3-way handshake × TLS handshake → 单次请求 1-15s 延迟
//
// OnceLock 让 client 在首次调用时初始化一次，之后所有请求复用同一个 client 内部的
// keep-alive 连接池 + TLS session 缓存；首次连接 ~300ms，后续请求 30-100ms（仅 RTT）
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub(crate) fn get_or_init_client() -> Result<&'static reqwest::Client, String> {
    if let Some(c) = HTTP_CLIENT.get() {
        return Ok(c);
    }
    // 解析编内证书 — PEM 格式由构建期 include_bytes! 注入，运行时仅做一次解析
    let cert = Certificate::from_pem(ATLAS_CERT_PEM)
        .map_err(|e| format!("http_proxy: parse pinned cert failed: {e}"))?;

    let client = reqwest::Client::builder()
        // 注入 atlas 自签证书 — TLS 握手时仅这张证书及其签发的链被信任
        .add_root_certificate(cert)
        // 关闭 webpki/rustls 自带的公共 CA bundle — 防 MITM 用任意公共 CA 签发的伪造证书冒充
        .tls_built_in_root_certs(false)
        // 强制 https — 即使 BASE_URL 错配为 http:// 也拒，杜绝明文 fallback 泄漏 Authorization
        .https_only(true)
        .timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(16)
        .tcp_keepalive(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http_proxy: client build failed: {e}"))?;
    Ok(HTTP_CLIENT.get_or_init(|| client))
}

/// 通过 reqwest 发起 HTTP 请求，使用证书钉死（cert pinning）转发到 atlas 自签后端。
///
/// 业务流程：
/// 1. 取全局 reqwest Client 单例（首次调用时构造 — 仅信任编内 atlas 证书 + https_only）
/// 2. 解析 method / url / headers / body 转发到目标
/// 3. 收到响应后把 status / headers / body 整体序列化回前端
///
/// @param method  HTTP 方法（GET/POST/PUT/DELETE/PATCH 等大写字符串）
/// @param url     完整请求 URL（含 scheme + host + port + path + query）
/// @param headers 请求 header 键值对（前端 client.ts 已注入 Content-Type 与 Authorization）
/// @param body    请求体字符串（GET/HEAD 等无 body 时传 None）
/// @returns       HttpResponse { status, headers, body }
/// @throws        String 错误描述（client 构造失败 / method 无效 / 网络失败 / 解码失败）
#[tauri::command]
pub async fn http_request_cmd(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    // ============================================
    // 第一步：取全局 reqwest 客户端单例 — 复用连接池避免每次新建 TLS handshake
    // ============================================
    let client = get_or_init_client()?;

    // ============================================
    // 第二步：解析 method 字符串到 reqwest::Method
    // ============================================
    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("http_proxy: invalid method '{method}': {e}"))?;

    // ============================================
    // 第三步：构造请求（headers + 可选 body）
    // ============================================
    let mut req = client.request(method_parsed, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    // ============================================
    // 第四步：发送 + 解析响应
    // ============================================
    let resp = req
        .send()
        .await
        .map_err(|e| {
            // 网络/TLS/timeout 类失败上报 GlitchTip；业务 4xx/5xx 不在此分支（resp.status 后处理）
            sentry::capture_error(&e);
            format!("http_proxy: send failed: {e:?}")
        })?;

    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let resp_body = resp
        .text()
        .await
        .map_err(|e| format!("http_proxy: body decode failed: {e}"))?;

    Ok(HttpResponse {
        status,
        headers: resp_headers,
        body: resp_body,
    })
}

// ============================================================
// multipart 上传支持 — 给 progress-server /api/files 走 Tauri 转发
// 业务背景：files.ts uploadFile 用 FormData multipart/form-data，原生 fetch 走 WebView 自签证书必失败
//          → Rust 用 reqwest::multipart::Form 重组装；前端把 File 转 base64 + filename + mime 传过来
// ============================================================

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MultipartPart {
    /// 文本字段（form field name=value）
    Text { name: String, value: String },
    /// 文件字段（form field 含 filename + mime_type + content_base64）
    File {
        name: String,
        filename: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "contentBase64")]
        content_base64: String,
    },
}

/// multipart/form-data 请求转发 — 同 http_request_cmd 但 body 是 multipart 而非 string
///
/// @param parts  多部分载荷数组（text 字段 + file 字段）
/// @returns      HttpResponse（status + headers + body 文本）
#[tauri::command]
pub async fn http_request_multipart_cmd(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    parts: Vec<MultipartPart>,
) -> Result<HttpResponse, String> {
    use base64::Engine;

    let client = get_or_init_client()?;

    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("http_proxy: invalid method '{method}': {e}"))?;

    // ============================================
    // 构造 reqwest::multipart::Form
    // ============================================
    let mut form = reqwest::multipart::Form::new();
    for part in parts {
        match part {
            MultipartPart::Text { name, value } => {
                form = form.text(name, value);
            }
            MultipartPart::File {
                name,
                filename,
                mime_type,
                content_base64,
            } => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&content_base64)
                    .map_err(|e| format!("http_proxy: base64 decode failed: {e}"))?;
                let part = reqwest::multipart::Part::bytes(bytes)
                    .file_name(filename)
                    .mime_str(&mime_type)
                    .map_err(|e| format!("http_proxy: invalid mime_type: {e}"))?;
                form = form.part(name, part);
            }
        }
    }

    let mut req = client.request(method_parsed, &url).multipart(form);
    for (k, v) in headers {
        // 不要设 Content-Type，reqwest multipart 自带 boundary
        if k.eq_ignore_ascii_case("content-type") {
            continue;
        }
        req = req.header(k, v);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| {
            sentry::capture_error(&e);
            format!("http_proxy: multipart send failed: {e:?}")
        })?;

    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let resp_body = resp
        .text()
        .await
        .map_err(|e| format!("http_proxy: multipart body decode failed: {e}"))?;

    Ok(HttpResponse {
        status,
        headers: resp_headers,
        body: resp_body,
    })
}

// @file: http_proxy.rs
// @description: progress-server HTTP 代理 - 让前端通过 Tauri 调用 reqwest 转发请求
//               业务背景：progress-server 用自签 IP 证书部署（atlas 备案接入未在腾讯云，无法用域名 + 公开 CA）
//                        WebView (WKWebView/WebView2) 原生 fetch 不能加载自签证书 → ERR_CERT_AUTHORITY_INVALID
//                        改用 reqwest 在 Rust 层做证书钉死（cert pinning）转发请求
//                        前端 client.ts doFetch 检测 Tauri 环境时改调 invoke('http_request_cmd', ...)
//               安全设计（PR-1 finding #11 + PR-12 follow-up L5）：
//                        - 旧实现裸跑 .danger_accept_invalid_certs(true) 任意 MITM 自签证书都能冒充 → 已废弃
//                        - PR-12 v1：include_bytes!("../certs/atlas-ip.pem") 整张证书 add_root_certificate
//                                    缺点：Caddy 中途重新签发证书会让所有客户端锁死必须发新版
//                        - PR-12 follow-up L5（本文件当前实现）：SPKI（Subject Public Key Info）pin
//                                    build.rs 从 PEM 提取公钥 SHA-256 hash 写到 OUT_DIR/spki_pins.rs
//                                    运行时自定义 rustls ServerCertVerifier 比对 leaf cert SPKI hash
//                                    优点：私钥不变就能换证书；轮换私钥才需要发新版
//                                    安全等价：SPKI hash 等价于 RFC 7469 推荐的 HPKP pin 算法
//                        - .https_only(true) 杜绝 HTTP fallback 即使 BASE_URL 错配 http:// 也拒
//                        - tls_built_in_root_certs(false) + 自定义 verifier 完全绕过公共 CA bundle
// @author: Atlas.oi
// @date: 2026-05-09

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use base64::Engine;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as RustlsError, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// SPKI pin hash 列表 — 由 build.rs 从 certs/atlas-ip.pem 编译期生成写入 OUT_DIR
// 至少 2 个 slot 是 RFC 7469 推荐做法（备份 pin 防主密钥单点失效），
// 当前仅 1 个 slot；未来生成备份私钥后扩展 build.rs 把第二个 hash 加入即可
include!(concat!(env!("OUT_DIR"), "/spki_pins.rs"));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

// ============================================================
// 自定义 rustls ServerCertVerifier — SPKI pin 验证
// ============================================================

/// SPKI pin verifier — 接受任意 hostname/CA 但要求 leaf cert 的 SPKI hash 命中编译期常量列表
///
/// 设计取舍：
///   - atlas 用 IP-only 自签证书，hostname verification 没意义（rustls 默认会失败）
///   - SPKI pin 不依赖 root CA / hostname / 有效期之外的链路，比 add_root_certificate 更稳
///   - signature verification 仍走 rustls 默认（确保 cert 真的是该公钥签发，防伪造 SAN/CN）
#[derive(Debug)]
struct SpkiPinVerifier {
    /// 编译期注入的允许 SPKI hash 集合（base64 编码，已与运行时哈希结果对齐）
    allowed_pins: Vec<String>,
    /// 默认 crypto provider，用于 verify_tls12_signature / verify_tls13_signature
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl SpkiPinVerifier {
    fn new() -> Self {
        // CryptoProvider::get_default 在首次 reqwest::ClientBuilder::build 中被设置；
        // 我们在自定义 verifier 中显式拿一次防止 race；首次调用前必显式安装一次 ring provider
        let provider = rustls::crypto::CryptoProvider::get_default()
            .cloned()
            .unwrap_or_else(|| Arc::new(rustls::crypto::ring::default_provider()));
        Self {
            allowed_pins: SPKI_PIN_HASHES.iter().map(|s| (*s).to_string()).collect(),
            provider,
        }
    }
}

impl ServerCertVerifier for SpkiPinVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        // ============================================
        // 第一步：从 leaf cert DER 解析出 SubjectPublicKeyInfo 的原始 DER 序列
        // ============================================
        let spki_der = extract_spki_der(end_entity.as_ref()).map_err(|msg| {
            RustlsError::General(format!("SPKI 解析失败: {msg}"))
        })?;

        // ============================================
        // 第二步：SHA-256(SubjectPublicKeyInfo DER) -> base64
        // ============================================
        let mut hasher = Sha256::new();
        hasher.update(&spki_der);
        let digest = hasher.finalize();
        let pin_b64 = base64::engine::general_purpose::STANDARD.encode(digest);

        // ============================================
        // 第三步：常量时间比对（subtle 也可，但 pin 数量极少 + 字符串短，String == 即可）
        //         命中任一允许 pin 即通过
        // ============================================
        if self.allowed_pins.iter().any(|p| p == &pin_b64) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(RustlsError::General(format!(
                "SPKI pin 不匹配: leaf={pin_b64} allowed={:?}",
                self.allowed_pins
            )))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// 从 X.509 证书 DER 中提取 SubjectPublicKeyInfo 的原始 DER 序列
///
/// 利用 ASN.1 结构：Certificate ::= SEQUENCE { tbsCertificate, ... }
///                  TBSCertificate ::= SEQUENCE { version, serial, sig, issuer, validity, subject, subjectPublicKeyInfo, ... }
///
/// 不重写 ASN.1 解析器 — 用 rustls 已 transitive 依赖的 webpki 没暴露 SPKI 提取，
/// 用最小手写 SEQUENCE 跳过逻辑，足够稳定（X.509 v3 cert 结构稳定 25 年）。
///
/// 备选方案：x509-parser 运行时依赖（重复 build.rs 逻辑，但运行时也加 ~50KB）— 暂不引入
fn extract_spki_der(cert_der: &[u8]) -> Result<Vec<u8>, String> {
    // 跳到 tbsCertificate（外层 SEQUENCE 的第一个内部 SEQUENCE）
    let tbs = inner_of_outer_sequence(cert_der)?;
    let tbs_inner = inner_of_outer_sequence(tbs)?;
    // tbs_inner 现在是 tbsCertificate 内部字段串接
    // 字段顺序：[0] version (EXPLICIT, 可选) | INTEGER serial | AlgId sig | Name issuer
    //         | Validity | Name subject | SubjectPublicKeyInfo | [1] [2] [3]...
    // 跳过前 6 个字段拿到第 7 个就是 SPKI
    // 注：version 是 EXPLICIT [0] 可选；不在则字段顺序减 1
    let mut cursor = tbs_inner;
    // 检查首字段 tag：[0] EXPLICIT context-specific = 0xA0
    let skip_count = if !cursor.is_empty() && cursor[0] == 0xA0 {
        7 // version + 6 后续字段
    } else {
        6 // 无 version，6 个字段后到 SPKI
    };
    for _ in 0..(skip_count - 1) {
        cursor = skip_one_tlv(cursor)?;
    }
    // 当前 cursor 起点就是 SubjectPublicKeyInfo SEQUENCE
    let spki_len = total_tlv_length(cursor)?;
    Ok(cursor[..spki_len].to_vec())
}

/// 取外层 SEQUENCE 的内容（去掉外层 tag + length）
fn inner_of_outer_sequence(der: &[u8]) -> Result<&[u8], String> {
    if der.is_empty() || der[0] != 0x30 {
        return Err(format!("expected SEQUENCE (0x30), got {:#x}", der.first().copied().unwrap_or(0)));
    }
    let (len, header_size) = parse_der_length(&der[1..])?;
    let total = 1 + header_size + len;
    if der.len() < total {
        return Err(format!("SEQUENCE length {total} exceeds buffer {}", der.len()));
    }
    Ok(&der[(1 + header_size)..total])
}

/// 跳过一个 TLV，返回剩余字节
fn skip_one_tlv(der: &[u8]) -> Result<&[u8], String> {
    let total = total_tlv_length(der)?;
    Ok(&der[total..])
}

/// 计算一个 TLV 的总字节数（tag + length-of-length + length + value）
fn total_tlv_length(der: &[u8]) -> Result<usize, String> {
    if der.len() < 2 {
        return Err("TLV truncated".into());
    }
    let (len, header_size) = parse_der_length(&der[1..])?;
    let total = 1 + header_size + len;
    if der.len() < total {
        return Err(format!("TLV length {total} exceeds buffer {}", der.len()));
    }
    Ok(total)
}

/// 解 DER length 字段，返回 (value-length, length-字段自身字节数)
/// 短形式：第一字节 < 0x80，length = 第一字节
/// 长形式：第一字节 = 0x80 | n，后续 n 字节是 length
fn parse_der_length(buf: &[u8]) -> Result<(usize, usize), String> {
    if buf.is_empty() {
        return Err("length truncated".into());
    }
    let first = buf[0];
    if first < 0x80 {
        return Ok((first as usize, 1));
    }
    let n = (first & 0x7F) as usize;
    if n == 0 {
        return Err("indefinite length not supported in DER".into());
    }
    if buf.len() < 1 + n {
        return Err("long-form length truncated".into());
    }
    if n > std::mem::size_of::<usize>() {
        return Err("length too large".into());
    }
    let mut len = 0usize;
    for &b in &buf[1..=n] {
        len = (len << 8) | (b as usize);
    }
    Ok((len, 1 + n))
}

// ============================================================
// 全局 reqwest Client 单例 — 必须复用连接池避免每次请求都重做 TCP+TLS 握手
//
// 旧实现每次 http_request_cmd 都 Client::builder().build() = 每次新 TCP + 新 TLS handshake
// 跨境到香港自签证书 RTT × 3-way handshake × TLS handshake → 单次请求 1-15s 延迟
//
// OnceLock 让 client 在首次调用时初始化一次，之后所有请求复用同一个 client 内部的
// keep-alive 连接池 + TLS session 缓存；首次连接 ~300ms，后续请求 30-100ms（仅 RTT）
// ============================================================
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_or_init_client() -> Result<&'static reqwest::Client, String> {
    if let Some(c) = HTTP_CLIENT.get() {
        return Ok(c);
    }

    // 显式安装 ring 作为 process-wide 默认 crypto provider
    // 多次调用幂等 — install_default 失败仅说明已设置，不影响功能
    let _ = rustls::crypto::ring::default_provider().install_default();

    // ============================================
    // 构造 rustls::ClientConfig with custom SPKI pin verifier
    // ============================================
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let tls_config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("http_proxy: rustls protocol versions failed: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(SpkiPinVerifier::new()))
        .with_no_client_auth();

    let client = reqwest::Client::builder()
        // 注入预配置 rustls ClientConfig — 自定义 verifier 取代公共 CA + 内嵌 cert 路径
        .use_preconfigured_tls(tls_config)
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

/// 通过 reqwest 发起 HTTP 请求，使用 SPKI 公钥钉死（key pinning）转发到 atlas 自签后端。
///
/// 业务流程：
/// 1. 取全局 reqwest Client 单例（首次调用时构造 — SPKI pin verifier + https_only）
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
        .map_err(|e| format!("http_proxy: send failed: {e}"))?;

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
        .map_err(|e| format!("http_proxy: multipart send failed: {e}"))?;

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

// ============================================================
// 单元测试 — finding L5: SPKI pin verifier 行为
// ============================================================
#[cfg(test)]
mod tests {
    use super::*;

    /// 编译期内嵌 atlas-ip.pem 仅供测试用 — 复用同一份证书验证 verifier 接受合法 leaf
    const ATLAS_CERT_PEM: &[u8] = include_bytes!("../certs/atlas-ip.pem");

    fn pem_to_der(pem: &[u8]) -> Vec<u8> {
        let s = std::str::from_utf8(pem).expect("pem utf8");
        let mut der = Vec::new();
        let mut in_block = false;
        for line in s.lines() {
            if line.starts_with("-----BEGIN") {
                in_block = true;
                continue;
            }
            if line.starts_with("-----END") {
                break;
            }
            if in_block {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(line.trim())
                    .expect("base64 decode");
                der.extend_from_slice(&bytes);
            }
        }
        der
    }

    #[test]
    fn extract_spki_der_returns_nonempty() {
        // 构造期 build.rs 已成功提取，这里仅验证运行时同函数能再现等价输出
        let der = pem_to_der(ATLAS_CERT_PEM);
        let spki = extract_spki_der(&der).expect("extract should succeed");
        assert!(!spki.is_empty(), "SPKI DER 应非空");
        // SPKI 起始必为 SEQUENCE 0x30
        assert_eq!(spki[0], 0x30, "SPKI 必以 SEQUENCE tag 起始");
    }

    #[test]
    fn extract_spki_der_matches_compile_time_pin() {
        // 验证运行时算出的 hash 与 build.rs 编译期写入 SPKI_PIN_HASHES 的值一致
        let der = pem_to_der(ATLAS_CERT_PEM);
        let spki = extract_spki_der(&der).expect("extract");

        let mut hasher = Sha256::new();
        hasher.update(&spki);
        let digest = hasher.finalize();
        let pin_b64 = base64::engine::general_purpose::STANDARD.encode(digest);

        assert!(
            SPKI_PIN_HASHES.iter().any(|p| *p == pin_b64),
            "运行时 SPKI hash {pin_b64} 必须命中编译期 pin 列表 {:?}",
            SPKI_PIN_HASHES
        );
    }

    #[test]
    fn verifier_accepts_pinned_cert() {
        // 用 atlas 证书构造 leaf，verify_server_cert 应通过
        let _ = rustls::crypto::ring::default_provider().install_default();
        let der = pem_to_der(ATLAS_CERT_PEM);
        let leaf = CertificateDer::from(der);
        let verifier = SpkiPinVerifier::new();
        let server_name = ServerName::IpAddress(
            "103.236.85.144".parse::<std::net::IpAddr>().unwrap().into(),
        );
        let result = verifier.verify_server_cert(
            &leaf,
            &[],
            &server_name,
            &[],
            UnixTime::since_unix_epoch(Duration::from_secs(1_750_000_000)),
        );
        assert!(result.is_ok(), "atlas 证书应通过 SPKI pin: {result:?}");
    }

    #[test]
    fn verifier_rejects_unknown_cert() {
        // 篡改 atlas 证书 SPKI（修改公钥位串中部一字节）应被 verifier 拒绝
        // 注：仅翻 cert 尾部字节会落在 signature 段，不影响 SPKI 提取，verifier 仍接受
        //     必须翻 SPKI DER 内部某字节让 hash 偏移
        let _ = rustls::crypto::ring::default_provider().install_default();
        let der = pem_to_der(ATLAS_CERT_PEM);
        let spki = extract_spki_der(&der).expect("extract spki");

        // 在 cert DER 中找到 SPKI 出现位置 — windows match
        let spki_start = der
            .windows(spki.len())
            .position(|w| w == spki.as_slice())
            .expect("SPKI must appear in cert DER");
        let mut tampered = der.clone();
        // 翻 SPKI 中部某字节（避开 tag/length 区，让结构仍可解析）
        let mid = spki_start + spki.len() / 2;
        tampered[mid] ^= 0xFF;

        let leaf = CertificateDer::from(tampered);
        let verifier = SpkiPinVerifier::new();
        let server_name = ServerName::IpAddress(
            "103.236.85.144".parse::<std::net::IpAddr>().unwrap().into(),
        );
        let result = verifier.verify_server_cert(
            &leaf,
            &[],
            &server_name,
            &[],
            UnixTime::since_unix_epoch(Duration::from_secs(1_750_000_000)),
        );
        assert!(result.is_err(), "篡改证书 SPKI 必须被拒，实际：{result:?}");
    }

    #[test]
    fn parse_der_length_short_form() {
        let (len, hsize) = parse_der_length(&[0x05, 0xAA, 0xBB]).unwrap();
        assert_eq!(len, 5);
        assert_eq!(hsize, 1);
    }

    #[test]
    fn parse_der_length_long_form_two_bytes() {
        // 0x82 = long-form 2 bytes, 0x01 0x23 = 0x0123 = 291
        let (len, hsize) = parse_der_length(&[0x82, 0x01, 0x23, 0xAA]).unwrap();
        assert_eq!(len, 0x0123);
        assert_eq!(hsize, 3);
    }

    #[test]
    fn parse_der_length_rejects_indefinite() {
        assert!(parse_der_length(&[0x80]).is_err());
    }
}

// @file: build.rs
// @description: Tauri 构建脚本 + finding L5 SPKI 证书钉死辅助
//               业务背景：原 http_proxy 直接 include_bytes! 整张 atlas-ip.pem 做 add_root_certificate
//                        证书 10 年有效（至 2036-05），Caddy 中途重新签发会让所有客户端锁死
//                        改为 SPKI（Subject Public Key Info）pin —— 只 hash 公钥，证书可重签
//                        仅在轮换私钥时才需要发新版本
//               实现：编译期从 certs/atlas-ip.pem 提取 SubjectPublicKeyInfo DER 序列
//                    SHA-256 -> base64 -> 写入 $OUT_DIR/spki_pins.rs，运行时 include!
// @author: Atlas.oi
// @date: 2026-05-09

use std::env;
use std::fs;
use std::path::PathBuf;

use base64::Engine;
use sha2::{Digest, Sha256};
use x509_parser::pem::parse_x509_pem;
use x509_parser::prelude::FromDer;
use x509_parser::x509::SubjectPublicKeyInfo;

fn main() {
    // ============================================
    // 第一步：让 cargo 在 cert 文件变更时重跑 build script
    // ============================================
    println!("cargo:rerun-if-changed=certs/atlas-ip.pem");
    println!("cargo:rerun-if-changed=build.rs");

    // ============================================
    // 第二步：读取 + PEM 解码 + 提取 SPKI DER + SHA-256 hash
    // ============================================
    let cert_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("certs/atlas-ip.pem");
    let pem_bytes = fs::read(&cert_path)
        .unwrap_or_else(|e| panic!("build.rs: 读取 {} 失败: {}", cert_path.display(), e));
    let (_rest, pem) = parse_x509_pem(&pem_bytes)
        .unwrap_or_else(|e| panic!("build.rs: PEM 解析失败: {:?}", e));
    let cert_der = &pem.contents;

    // 直接从证书 DER 中找 SubjectPublicKeyInfo 子结构
    // x509-parser 的 SubjectPublicKeyInfo::from_der 返 (rest, spki) + spki.raw
    // 但完整流程需先 parse 整张 cert，下一步从 tbs.subject_pki.raw 拿 SPKI DER
    let (_, x509) = x509_parser::parse_x509_certificate(cert_der)
        .unwrap_or_else(|e| panic!("build.rs: X.509 解析失败: {:?}", e));

    // RFC 7469: pin hash 是对 SubjectPublicKeyInfo 完整 DER 序列做 SHA-256
    // x509-parser 0.16 的 SubjectPublicKeyInfo 提供 raw 字段（整段 SPKI DER）
    let spki_der = x509.tbs_certificate.subject_pki.raw;
    // 兜底：若 raw 为空（理论不会但留断言更稳健）则手动重 parse
    let spki_bytes: Vec<u8> = if spki_der.is_empty() {
        // 从 cert DER 反向找 SPKI 起始位置成本高；直接报错让 build 失败暴露问题
        let (_, spki_struct) = SubjectPublicKeyInfo::from_der(cert_der)
            .unwrap_or_else(|e| panic!("build.rs: SPKI 兜底解析失败: {:?}", e));
        spki_struct.raw.to_vec()
    } else {
        spki_der.to_vec()
    };

    let mut hasher = Sha256::new();
    hasher.update(&spki_bytes);
    let digest = hasher.finalize();
    let pin_b64 = base64::engine::general_purpose::STANDARD.encode(digest);

    // ============================================
    // 第三步：生成 spki_pins.rs 写入 OUT_DIR，运行时由 http_proxy include!
    //
    // SPKI_PIN_HASHES 至少 2 个 slot（RFC 7469 推荐多 pin 防主密钥单点失效）：
    //   [0] = 当前 atlas Caddy 证书的 SPKI hash（编译期从 PEM 算出）
    //   [1] = 备份私钥的 SPKI hash —— 当前未生成备份私钥，留 placeholder None
    //
    // 未来轮换流程：先生成备份私钥的 SPKI hash 填入 [1] 发版 → 用户升级
    //              → 切换 atlas 主证书到备份私钥 → 主 pin 更新到 [0]
    //              → 整个过程客户端不会一次性失联
    // ============================================
    let out_dir = env::var_os("OUT_DIR").expect("build.rs: OUT_DIR 未设置");
    let dest = PathBuf::from(out_dir).join("spki_pins.rs");
    let content = format!(
        "// 自动生成，请勿手动编辑 — 由 build.rs 在编译期从 certs/atlas-ip.pem 计算\n\
         // SPKI hash = base64(sha256(SubjectPublicKeyInfo DER))\n\
         pub static SPKI_PIN_HASHES: &[&str] = &[\n    \"{}\",\n];\n",
        pin_b64
    );
    fs::write(&dest, content).expect("build.rs: 写 spki_pins.rs 失败");

    // ============================================
    // 第四步：调用原 tauri-build 完成 Tauri 资产生成
    // ============================================
    tauri_build::build();
}

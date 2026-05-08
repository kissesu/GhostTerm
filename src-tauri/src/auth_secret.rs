// @file: auth_secret.rs
// @description: refreshToken 系统 keychain 存储（finding #12 纵深防御）
//               把原本写在 webview localStorage 的 progress_refresh_token 迁到 OS keychain：
//                 - macOS: Keychain Services
//                 - Windows: Credential Manager
//                 - Linux: Secret Service (libsecret)
//               即使前端被 XSS 绕过 CSP + DOMPurify，webview JS 也无法访问 OS keychain，
//               仅能通过 Tauri IPC 调用受 capability 守护的 set/get/delete 三个 command。
// @author: Atlas.oi
// @date: 2026-05-08

use keyring::Entry;

// ============================================
// keyring 命名空间
// SERVICE 用反向域名风格隔离应用级凭证；ACCOUNT 标识 token 类型
// 同应用未来加 access_token 等其他凭证只需新增 ACCOUNT 常量
// ============================================
const SERVICE: &str = "com.atlas.ghostterm";
const ACCOUNT: &str = "refresh_token";

/// 把 refreshToken 写入系统 keychain（覆盖式）
///
/// 调用场景：登录成功 / refresh 拿到新 token 后由前端 invoke
#[tauri::command]
pub fn set_refresh_token_cmd(token: String) -> Result<(), String> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("keyring entry create: {e}"))?
        .set_password(&token)
        .map_err(|e| format!("keyring set: {e}"))
}

/// 读取 keychain 里的 refreshToken
///
/// 返回 Ok(None) 表示从未写入或已被删除（未登录），不视为错误；
/// 仅在 keychain 不可用 / 用户拒绝授权等真实异常时返回 Err。
#[tauri::command]
pub fn get_refresh_token_cmd() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keyring entry create: {e}"))?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get: {e}")),
    }
}

/// 删除 keychain 里的 refreshToken
///
/// 幂等：条目已不存在不视为错误。登出 / refresh 失败 / 强制清空登录态时调用。
#[tauri::command]
pub fn delete_refresh_token_cmd() -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keyring entry create: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================
    // 集成测试需要真实 keychain（macOS 会弹授权 dialog / Linux 需 D-Bus session bus）
    // 不能在 CI / subagent 后台进程跑，只能 controller 本机手动跑：
    //   cargo test --manifest-path src-tauri/Cargo.toml -- --ignored auth_secret
    // ============================================

    #[test]
    #[ignore = "需要真实 keychain 访问，本机手动跑：cargo test -- --ignored auth_secret"]
    fn test_set_get_roundtrip() {
        let token = "test_refresh_token_unique_xyz_12345";
        set_refresh_token_cmd(token.to_string()).unwrap();
        let got = get_refresh_token_cmd().unwrap();
        assert_eq!(got, Some(token.to_string()));
        delete_refresh_token_cmd().unwrap();
    }

    #[test]
    #[ignore = "需要真实 keychain 访问"]
    fn test_delete_idempotent() {
        // 删两次：第二次走 NoEntry 分支必须不报错
        delete_refresh_token_cmd().unwrap();
        delete_refresh_token_cmd().unwrap();
    }
}

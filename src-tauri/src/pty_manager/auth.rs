// @file: pty_manager/auth.rs
// @description: WebSocket token 安全认证 - 一次性 token，30s TTL，防止未授权连接
//               token 首次握手成功后立即失效，连接断开后 5s 无重连则自动 kill PTY
// @author: Atlas.oi
// @date: 2026-04-13

use rand::Rng;
use std::time::Instant;

/// WebSocket 认证 token
///
/// 安全模型：
/// - 32 字节随机 hex 字符串
/// - 30s TTL：超时后拒绝新连接
/// - 一次性使用：首次握手成功后 used = true，再次使用拒绝
pub struct AuthToken {
    pub value: String,
    pub created_at: Instant,
    /// 是否已被使用（首次握手消耗后设为 true）
    pub used: bool,
}

impl AuthToken {
    /// 生成新的认证 token
    ///
    /// 用 rand crate 生成 32 字节随机数据，编码为 64 字符 hex 字符串
    pub fn new() -> Self {
        let mut rng = rand::rng();
        let bytes: Vec<u8> = (0..32).map(|_| rng.random::<u8>()).collect();
        let value = bytes.iter().map(|b| format!("{:02x}", b)).collect();
        AuthToken {
            value,
            created_at: Instant::now(),
            used: false,
        }
    }

    /// 验证 token 是否有效
    ///
    /// 检查条件：
    /// 1. token 值匹配
    /// 2. 未超过 30s TTL
    /// 3. 未被使用过
    pub fn validate(&mut self, token: &str) -> bool {
        // token 值必须匹配
        if self.value != token {
            return false;
        }
        // 30s TTL 检查
        if self.created_at.elapsed().as_secs() > 30 {
            return false;
        }
        // 一次性使用检查
        if self.used {
            return false;
        }
        // 消耗 token
        self.used = true;
        true
    }

    /// 检查 token 是否已过期（仅检查 TTL，不修改状态）
    pub fn is_expired(&self) -> bool {
        self.created_at.elapsed().as_secs() > 30
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_generation() {
        let token = AuthToken::new();
        // 32 字节 -> 64 hex 字符
        assert_eq!(token.value.len(), 64);
        // 初始状态未使用
        assert!(!token.used);
        // 刚创建不过期
        assert!(!token.is_expired());
    }

    #[test]
    fn test_token_validation_correct() {
        let mut token = AuthToken::new();
        let value = token.value.clone();
        // 首次验证应成功
        assert!(token.validate(&value));
        // 验证后 used = true
        assert!(token.used);
    }

    #[test]
    fn test_token_single_use() {
        let mut token = AuthToken::new();
        let value = token.value.clone();
        // 首次使用成功
        assert!(token.validate(&value));
        // 再次使用失败（一次性 token）
        assert!(!token.validate(&value));
    }

    #[test]
    fn test_token_wrong_value() {
        let mut token = AuthToken::new();
        // 错误 token 值拒绝
        assert!(!token.validate("wrong_token_value"));
        // 使用状态不变
        assert!(!token.used);
    }

    #[test]
    fn test_token_ttl_expired() {
        let mut token = AuthToken::new();
        // 模拟过期：手动修改 created_at 到 31s 前
        token.created_at = Instant::now() - std::time::Duration::from_secs(31);
        let value = token.value.clone();
        // 过期后验证失败
        assert!(!token.validate(&value));
        assert!(token.is_expired());
    }

    #[test]
    fn test_two_tokens_unique() {
        let t1 = AuthToken::new();
        let t2 = AuthToken::new();
        // 两次生成的 token 值应不同
        assert_ne!(t1.value, t2.value);
    }
}

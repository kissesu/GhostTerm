// @file: pty_manager/ws_server.rs
// @description: WebSocket 服务器 - 监听本地端口，为 PTY 数据流提供传输通道
//               xterm.js AttachAddon 通过此 WebSocket 收发 PTY 二进制数据
//               绑定 127.0.0.1:0 由操作系统分配随机端口，避免端口冲突
// @author: Atlas.oi
// @date: 2026-04-13

use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

/// WebSocket 服务器实例
///
/// 持有 TcpListener 以及对应的端口号。
/// 实际 PTY 数据中转由 bridge.rs 完成。
pub struct WsServer {
    /// 实际绑定的端口（操作系统分配）
    pub port: u16,
    /// TCP 监听器，等待 WebSocket 握手
    pub listener: TcpListener,
}

/// WebSocket 服务器配置
pub struct WsServerConfig {
    /// 认证 token，握手时通过 query param ?token=xxx 验证
    pub token: String,
    /// 接收到有效连接后的通知通道
    pub connected_tx: mpsc::Sender<()>,
}

impl WsServer {
    /// 绑定到 127.0.0.1:0（由操作系统分配随机端口）
    ///
    /// 只绑定本地回环地址，防止外部网络访问 PTY
    pub async fn bind() -> Result<Self, std::io::Error> {
        // 绑定 127.0.0.1:0，操作系统自动分配可用端口
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        Ok(WsServer { port, listener })
    }

    /// 获取实际绑定地址
    pub fn local_addr(&self) -> Result<SocketAddr, std::io::Error> {
        self.listener.local_addr()
    }
}

/// 从 WebSocket 握手 URL 提取 token query 参数
///
/// 支持路径格式：ws://127.0.0.1:PORT/?token=VALUE 或 /?token=VALUE
pub fn extract_token_from_uri(uri: &str) -> Option<String> {
    // 解析 query string 部分
    let query = if let Some(pos) = uri.find('?') {
        &uri[pos + 1..]
    } else {
        return None;
    };

    // 遍历 key=value 对，找到 token 参数
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
            if key == "token" {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_binds_random_port() {
        // 绑定应成功
        let server = WsServer::bind().await.expect("绑定失败");
        // 端口应为非零值（操作系统分配）
        assert!(server.port > 0);
        // 应绑定在本地回环地址
        let addr = server.local_addr().unwrap();
        assert_eq!(addr.ip().to_string(), "127.0.0.1");
    }

    #[tokio::test]
    async fn test_multiple_servers_get_different_ports() {
        // 每次绑定应得到不同端口
        let s1 = WsServer::bind().await.expect("绑定1失败");
        let s2 = WsServer::bind().await.expect("绑定2失败");
        assert_ne!(s1.port, s2.port);
    }

    #[test]
    fn test_extract_token_valid() {
        let uri = "/?token=abc123def456";
        let token = extract_token_from_uri(uri);
        assert_eq!(token, Some("abc123def456".to_string()));
    }

    #[test]
    fn test_extract_token_with_other_params() {
        let uri = "/?session=xyz&token=mytoken&other=value";
        let token = extract_token_from_uri(uri);
        assert_eq!(token, Some("mytoken".to_string()));
    }

    #[test]
    fn test_extract_token_missing() {
        let uri = "/?session=xyz";
        let token = extract_token_from_uri(uri);
        assert_eq!(token, None);
    }

    #[test]
    fn test_extract_token_no_query() {
        let uri = "/";
        let token = extract_token_from_uri(uri);
        assert_eq!(token, None);
    }
}

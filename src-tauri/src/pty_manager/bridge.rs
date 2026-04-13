// @file: pty_manager/bridge.rs
// @description: PTY ↔ WebSocket 桥接 - 将 PTY stdout 转发到 WebSocket，
//               将 WebSocket 接收的数据写入 PTY stdin，全程使用二进制帧
// @author: Atlas.oi
// @date: 2026-04-13

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

/// PTY -> WebSocket 方向的数据通道
///
/// bridge_pty_to_ws 从 PTY stdout 读取数据后通过此 channel 发送给 WS 发送任务
pub type PtyOutputTx = mpsc::Sender<Vec<u8>>;
pub type PtyOutputRx = mpsc::Receiver<Vec<u8>>;

/// WebSocket -> PTY 方向的数据通道
pub type PtyInputTx = mpsc::Sender<Vec<u8>>;
pub type PtyInputRx = mpsc::Receiver<Vec<u8>>;

/// 创建 PTY ↔ WebSocket 数据桥接
///
/// 启动两个 tokio 任务：
/// 1. PTY stdout -> WebSocket：从 pty_output_rx 接收 PTY 输出，通过 WebSocket 二进制帧发送
/// 2. WebSocket -> PTY stdin：从 WebSocket 接收二进制帧，通过 pty_input_tx 写入 PTY
///
/// 任意一侧关闭后，两个任务都应停止（通过 channel 自动传播关闭信号）
pub async fn run_bridge<S>(
    ws_stream: WebSocketStream<S>,
    mut pty_output_rx: PtyOutputRx,
    pty_input_tx: PtyInputTx,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();

    // ============================================
    // 任务1：PTY stdout -> WebSocket
    // 从 channel 读取 PTY 输出，通过 WebSocket 二进制帧发送给 xterm.js
    // ============================================
    let pty_to_ws = tokio::spawn(async move {
        while let Some(data) = pty_output_rx.recv().await {
            if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                // WebSocket 连接关闭，停止转发
                break;
            }
        }
    });

    // ============================================
    // 任务2：WebSocket -> PTY stdin
    // 从 WebSocket 接收二进制帧（键盘输入），写入 PTY stdin
    // ============================================
    let ws_to_pty = tokio::spawn(async move {
        while let Some(msg) = ws_stream_rx.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if pty_input_tx.send(data.to_vec()).await.is_err() {
                        // PTY 已关闭，停止接收
                        break;
                    }
                }
                Ok(Message::Text(text)) => {
                    // xterm.js 也可能发送文本帧，转为字节后处理
                    if pty_input_tx.send(text.into_bytes()).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => {
                    // 连接关闭或错误，退出循环
                    break;
                }
                _ => {
                    // Ping/Pong 等控制帧忽略
                }
            }
        }
    });

    // 等待任意一侧关闭
    tokio::select! {
        _ = pty_to_ws => {},
        _ = ws_to_pty => {},
    }
}

/// PTY 读取器 - 从 PTY master 异步读取数据并发送到 channel
///
/// 在独立 tokio 任务中运行，持续读取 PTY 输出直到 PTY 关闭
pub async fn run_pty_reader<R>(mut pty_reader: R, output_tx: PtyOutputTx)
where
    R: AsyncReadExt + Unpin + Send + 'static,
{
    let mut buf = vec![0u8; 4096];
    loop {
        match pty_reader.read(&mut buf).await {
            Ok(0) => break, // PTY 已关闭（EOF）
            Ok(n) => {
                let data = buf[..n].to_vec();
                if output_tx.send(data).await.is_err() {
                    // 接收方已关闭
                    break;
                }
            }
            Err(_) => break, // 读取错误
        }
    }
}

/// PTY 写入器 - 从 channel 接收数据并写入 PTY master stdin
pub async fn run_pty_writer<W>(mut pty_writer: W, mut input_rx: PtyInputRx)
where
    W: AsyncWriteExt + Unpin + Send + 'static,
{
    while let Some(data) = input_rx.recv().await {
        if pty_writer.write_all(&data).await.is_err() {
            break; // PTY 已关闭
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;
    use tokio_tungstenite::WebSocketStream;
    use tokio_tungstenite::tungstenite::protocol::Role;

    /// 验证 PTY 写入器从 channel 正确接收数据
    #[tokio::test]
    async fn test_pty_writer_receives_data() {
        let (writer, mut reader) = duplex(1024);
        let (tx, rx) = mpsc::channel::<Vec<u8>>(16);

        tokio::spawn(run_pty_writer(writer, rx));

        let test_data = b"hello pty\n".to_vec();
        tx.send(test_data.clone()).await.unwrap();
        // 关闭发送方，让写入器退出
        drop(tx);

        let mut buf = vec![0u8; 32];
        let n = reader.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"hello pty\n");
    }

    /// 验证 PTY 读取器从 reader 正确读取数据并发送到 channel
    #[tokio::test]
    async fn test_pty_reader_sends_data() {
        let (mut writer, reader) = duplex(1024);
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(16);

        tokio::spawn(run_pty_reader(reader, tx));

        let test_data = b"output from pty\n".to_vec();
        writer.write_all(&test_data).await.unwrap();
        drop(writer); // 关闭触发 EOF

        let received = rx.recv().await.unwrap();
        assert_eq!(received, test_data);
    }

    /// 验证二进制帧正确传输（channel 层面）
    #[tokio::test]
    async fn test_binary_channel_roundtrip() {
        let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(16);
        let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(16);

        // 模拟 PTY 输出
        let binary_data = vec![0x1b, 0x5b, 0x33, 0x32, 0x6d]; // ANSI 颜色序列
        output_tx.send(binary_data.clone()).await.unwrap();

        let received = output_rx.recv().await.unwrap();
        assert_eq!(received, binary_data);

        // 模拟键盘输入
        let input_data = b"ls -la\r".to_vec();
        input_tx.send(input_data.clone()).await.unwrap();

        let received_input = input_rx.recv().await.unwrap();
        assert_eq!(received_input, input_data);
    }
}

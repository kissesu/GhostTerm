// @file: fs_backend/watcher.rs
// @description: 文件系统监听器 - 使用 notify 7 监听项目目录变化。
//               实现 100ms debounce 合并重复事件，排除 .git/node_modules 路径，
//               通过 Tauri AppHandle.emit 将 FsEvent 推送给前端。
// @author: Atlas.oi
// @date: 2026-04-13

use crate::types::FsEvent;
use lazy_static::lazy_static;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

// ============================================
// 全局 watcher 句柄：保存当前活跃的 RecommendedWatcher
// 使用 Mutex<Option<...>> 确保线程安全
// ============================================
lazy_static! {
    static ref WATCHER_HANDLE: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);
}

// debounce 窗口：100ms 内同一文件的重复事件合并为一次
// 这是常见的文本编辑器保存行为触发的多次写入事件合并阈值
const DEBOUNCE_MS: u64 = 100;

/// 判断路径是否应被排除（.git 或 node_modules）
///
/// 路径字符串包含这两个目录名的文件不推送给前端，
/// 避免 Git 操作和 npm install 期间的海量事件刷屏
fn should_exclude(path: &str) -> bool {
    path.contains("/.git/") || path.contains("/.git")
        || path.ends_with("/.git")
        || path.contains("/node_modules/") || path.contains("/node_modules")
        || path.ends_with("/node_modules")
}

/// 启动文件系统监听
///
/// 业务逻辑：
/// 1. 创建 mpsc channel 接收 notify 事件
/// 2. 创建 RecommendedWatcher，保存到全局句柄（先停止旧的）
/// 3. 启动后台线程处理事件：debounce + 排除规则 + 类型区分
/// 4. 通过 AppHandle.emit 推送 FsEvent 给前端
pub fn start_watching(path: &str, app_handle: tauri::AppHandle) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();

    // 创建 watcher，使用默认推荐配置（polling fallback 已内置）
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("创建 watcher 失败: {}", e))?;

    // 递归监听整个项目目录
    watcher
        .watch(Path::new(path), RecursiveMode::Recursive)
        .map_err(|e| format!("监听路径失败 {}: {}", path, e))?;

    // 保存 watcher 句柄（替换旧的）
    {
        let mut handle = WATCHER_HANDLE
            .lock()
            .map_err(|_| "watcher 锁错误".to_string())?;
        *handle = Some(watcher);
    }

    // 启动后台线程处理事件
    // 使用独立线程避免阻塞 Tauri 主线程
    thread::spawn(move || {
        // debounce 状态：记录各路径最后一次触发时间和事件类型
        let mut debounce_map: HashMap<String, (Instant, FsEvent)> = HashMap::new();

        loop {
            // 使用 recv_timeout 轮询：既能收新事件，也能定期刷新超时的 debounce 项
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Ok(event)) => {
                    // 处理来自 notify 的事件
                    handle_notify_event(event, &mut debounce_map);
                }
                Ok(Err(e)) => {
                    eprintln!("[watcher] notify 错误: {}", e);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // channel 断开，说明 watcher 已停止，退出线程
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // 超时：检查 debounce_map 中是否有已到期的事件需要推送
                }
            }

            // 刷新 debounce：将超过 100ms 的事件推送出去
            flush_debounce(&mut debounce_map, &app_handle);
        }
    });

    Ok(())
}

/// 处理单个 notify 事件，写入 debounce 缓冲区
///
/// 同一路径的新事件会覆盖旧事件（保留最新事件类型）
fn handle_notify_event(
    event: notify::Event,
    debounce_map: &mut HashMap<String, (Instant, FsEvent)>,
) {
    let now = Instant::now();

    // 提取事件涉及的路径列表
    let paths = event.paths;

    match event.kind {
        // ============================================
        // Create 事件：新文件/目录创建
        // ============================================
        EventKind::Create(_) => {
            if let Some(path) = paths.first() {
                let path_str = path.to_string_lossy().to_string();
                if !should_exclude(&path_str) {
                    debounce_map.insert(
                        path_str.clone(),
                        (now, FsEvent::Created { path: path_str }),
                    );
                }
            }
        }

        // ============================================
        // Modify 事件：文件内容修改（包含 Rename 子类型）
        // notify 在某些 OS 上通过 Modify(Rename) 报告重命名
        // ============================================
        EventKind::Modify(modify_kind) => {
            match modify_kind {
                notify::event::ModifyKind::Name(_) => {
                    // 重命名事件：paths[0] = 旧路径, paths[1] = 新路径
                    // 但某些平台只有一条路径，对此情况降级为 modified
                    if paths.len() >= 2 {
                        let old_path = paths[0].to_string_lossy().to_string();
                        let new_path = paths[1].to_string_lossy().to_string();
                        if !should_exclude(&old_path) && !should_exclude(&new_path) {
                            // 使用旧路径作为 debounce key，避免同一重命名操作重复触发
                            debounce_map.insert(
                                format!("rename:{}:{}", old_path, new_path),
                                (now, FsEvent::Renamed { old_path, new_path }),
                            );
                        }
                    } else if let Some(path) = paths.first() {
                        let path_str = path.to_string_lossy().to_string();
                        if !should_exclude(&path_str) {
                            debounce_map.insert(
                                path_str.clone(),
                                (now, FsEvent::Modified { path: path_str }),
                            );
                        }
                    }
                }
                _ => {
                    // 普通内容修改
                    if let Some(path) = paths.first() {
                        let path_str = path.to_string_lossy().to_string();
                        if !should_exclude(&path_str) {
                            debounce_map.insert(
                                path_str.clone(),
                                (now, FsEvent::Modified { path: path_str }),
                            );
                        }
                    }
                }
            }
        }

        // ============================================
        // Remove 事件：文件/目录被删除
        // ============================================
        EventKind::Remove(_) => {
            if let Some(path) = paths.first() {
                let path_str = path.to_string_lossy().to_string();
                if !should_exclude(&path_str) {
                    debounce_map.insert(
                        path_str.clone(),
                        (now, FsEvent::Deleted { path: path_str }),
                    );
                }
            }
        }

        // ============================================
        // Access 和 Other 事件：不关心，忽略
        // ============================================
        _ => {}
    }
}

/// 将 debounce 缓冲区中超过 100ms 的事件推送给前端
///
/// 超过 DEBOUNCE_MS 的事件认为已"稳定"，可以推送
fn flush_debounce(
    debounce_map: &mut HashMap<String, (Instant, FsEvent)>,
    app_handle: &tauri::AppHandle,
) {
    let threshold = Duration::from_millis(DEBOUNCE_MS);
    let now = Instant::now();

    // 收集已超时的 key，避免边遍历边修改
    let ready_keys: Vec<String> = debounce_map
        .iter()
        .filter(|(_, (ts, _))| now.duration_since(*ts) >= threshold)
        .map(|(k, _)| k.clone())
        .collect();

    for key in ready_keys {
        if let Some((_, fs_event)) = debounce_map.remove(&key) {
            // 通过 Tauri Event 系统推送给前端
            // Tauri 2 API：app_handle.emit(event_name, payload)
            if let Err(e) = app_handle.emit("fs:event", &fs_event) {
                eprintln!("[watcher] 推送事件失败: {}", e);
            }
        }
    }
}

/// 停止文件系统监听
///
/// 清空全局 watcher 句柄，notify 会自动停止 channel，后台线程也随之退出
pub fn stop_watching() -> Result<(), String> {
    let mut handle = WATCHER_HANDLE
        .lock()
        .map_err(|_| "watcher 锁错误".to_string())?;
    *handle = None;
    Ok(())
}

// ============================================
// Tauri Command 封装
// ============================================

/// Tauri Command: 启动文件系统监听
#[tauri::command]
pub fn start_watching_cmd(app: tauri::AppHandle, path: String) -> Result<(), String> {
    start_watching(&path, app)
}

/// Tauri Command: 停止文件系统监听
#[tauri::command]
pub fn stop_watching_cmd() -> Result<(), String> {
    stop_watching()
}

// ============================================
// 单元测试
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;
    use tempfile::tempdir;

    /// 测试排除规则：.git 目录下的路径应被排除
    #[test]
    fn test_should_exclude_git() {
        assert!(should_exclude("/proj/.git/config"));
        assert!(should_exclude("/proj/.git"));
        assert!(should_exclude("/proj/.git/FETCH_HEAD"));
    }

    /// 测试排除规则：node_modules 下的路径应被排除
    #[test]
    fn test_should_exclude_node_modules() {
        assert!(should_exclude("/proj/node_modules/react/index.js"));
        assert!(should_exclude("/proj/node_modules"));
    }

    /// 测试排除规则：正常路径不应被排除
    #[test]
    fn test_should_not_exclude_normal_paths() {
        assert!(!should_exclude("/proj/src/main.rs"));
        assert!(!should_exclude("/proj/Cargo.toml"));
        assert!(!should_exclude("/proj/src/components/App.tsx"));
    }

    /// 测试 debounce：100ms 内多次修改同一文件只触发一次
    #[test]
    fn test_debounce_merges_rapid_events() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");

        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut debounce_map: HashMap<String, (Instant, FsEvent)> = HashMap::new();

        // 模拟 3 次快速修改事件（同一路径）
        let path_str = file_path.to_string_lossy().to_string();
        for _ in 0..3 {
            let event = notify::Event {
                kind: EventKind::Modify(notify::event::ModifyKind::Data(
                    notify::event::DataChange::Content,
                )),
                paths: vec![file_path.clone()],
                attrs: Default::default(),
            };
            handle_notify_event(event, &mut debounce_map);
        }

        // debounce_map 中同一路径只有一条记录
        assert_eq!(debounce_map.len(), 1, "100ms 内多次修改应合并为一条");
        assert!(debounce_map.contains_key(&path_str));

        drop(tx);
        drop(rx);
    }

    /// 测试排除：.git 路径下的事件不进入 debounce_map
    #[test]
    fn test_git_path_excluded_from_debounce() {
        let mut debounce_map: HashMap<String, (Instant, FsEvent)> = HashMap::new();

        let git_path = std::path::PathBuf::from("/proj/.git/COMMIT_EDITMSG");
        let event = notify::Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Content,
            )),
            paths: vec![git_path],
            attrs: Default::default(),
        };

        handle_notify_event(event, &mut debounce_map);

        // .git 路径不应进入缓冲区
        assert_eq!(debounce_map.len(), 0, ".git 路径下的事件不应进入 debounce_map");
    }

    /// 测试事件类型区分：Create 事件应生成 FsEvent::Created
    #[test]
    fn test_create_event_generates_created_fsevent() {
        let mut debounce_map: HashMap<String, (Instant, FsEvent)> = HashMap::new();
        let path = std::path::PathBuf::from("/proj/src/new_file.rs");

        let event = notify::Event {
            kind: EventKind::Create(notify::event::CreateKind::File),
            paths: vec![path.clone()],
            attrs: Default::default(),
        };

        handle_notify_event(event, &mut debounce_map);

        let path_str = path.to_string_lossy().to_string();
        let entry = debounce_map.get(&path_str).unwrap();
        match &entry.1 {
            FsEvent::Created { path: p } => assert_eq!(p, &path_str),
            other => panic!("期望 Created，得到 {:?}", other),
        }
    }

    /// 测试事件类型区分：Remove 事件应生成 FsEvent::Deleted
    #[test]
    fn test_remove_event_generates_deleted_fsevent() {
        let mut debounce_map: HashMap<String, (Instant, FsEvent)> = HashMap::new();
        let path = std::path::PathBuf::from("/proj/src/old_file.rs");

        let event = notify::Event {
            kind: EventKind::Remove(notify::event::RemoveKind::File),
            paths: vec![path.clone()],
            attrs: Default::default(),
        };

        handle_notify_event(event, &mut debounce_map);

        let path_str = path.to_string_lossy().to_string();
        let entry = debounce_map.get(&path_str).unwrap();
        match &entry.1 {
            FsEvent::Deleted { path: p } => assert_eq!(p, &path_str),
            other => panic!("期望 Deleted，得到 {:?}", other),
        }
    }

    /// 测试事件类型区分：Modify(Name) 双路径应生成 FsEvent::Renamed
    #[test]
    fn test_rename_event_generates_renamed_fsevent() {
        let mut debounce_map: HashMap<String, (Instant, FsEvent)> = HashMap::new();
        let old_path = std::path::PathBuf::from("/proj/src/old.rs");
        let new_path = std::path::PathBuf::from("/proj/src/new.rs");

        let event = notify::Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Name(
                notify::event::RenameMode::Both,
            )),
            paths: vec![old_path.clone(), new_path.clone()],
            attrs: Default::default(),
        };

        handle_notify_event(event, &mut debounce_map);

        // rename 的 debounce key 形如 "rename:old:new"
        assert_eq!(debounce_map.len(), 1);
        let (_, fs_event) = debounce_map.values().next().unwrap();
        match fs_event {
            FsEvent::Renamed { old_path: op, new_path: np } => {
                assert_eq!(op, &old_path.to_string_lossy().to_string());
                assert_eq!(np, &new_path.to_string_lossy().to_string());
            }
            other => panic!("期望 Renamed，得到 {:?}", other),
        }
    }

    /// 测试写文件后 watcher 能检测到事件（集成测试）
    #[test]
    fn test_watcher_detects_file_write() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("watch_test.txt");

        // 创建 channel 手动验证事件
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(tx).unwrap();
        watcher
            .watch(dir.path(), RecursiveMode::Recursive)
            .unwrap();

        // 写入文件触发事件
        fs::write(&file, "initial content").unwrap();

        // 等待事件（最多 2 秒）
        let received = rx.recv_timeout(Duration::from_secs(2));
        assert!(
            received.is_ok(),
            "写文件后应收到文件系统事件"
        );
    }

    /// 测试 stop_watching 不 panic
    #[test]
    fn test_stop_watching_ok() {
        let result = stop_watching();
        assert!(result.is_ok());
    }
}

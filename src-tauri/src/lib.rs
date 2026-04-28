// @file: lib.rs
// @description: GhostTerm Tauri 应用入口 - 注册所有 Tauri Commands 并初始化插件
//               阶段 2.5 合并后，所有 PBI-1/2/3 Commands 在此集中注册
// @author: Atlas.oi
// @date: 2026-04-13

use std::sync::Mutex;

// ============================================
// 模块声明
// ============================================
pub mod types;
pub mod pty_manager;
pub mod fs_backend;
pub mod git_backend;
pub mod project_manager;

// PBI-1 Commands
use pty_manager::{spawn_pty_cmd, kill_pty_cmd, resize_pty_cmd, reconnect_pty_cmd, get_default_shell_cmd};

// PBI-2 Commands
use fs_backend::{read_file_cmd, write_file_cmd, list_dir_cmd, create_entry_cmd, delete_entry_cmd, rename_entry_cmd, read_image_bytes_cmd, search_files_cmd};

// PBI-4 Commands - 文件系统实时监听
use fs_backend::{start_watching_cmd, stop_watching_cmd};

// PBI-3 Commands
use project_manager::{list_recent_projects_cmd, open_project_cmd, close_project_cmd, remove_project_cmd, clone_repository_cmd,
                      get_editor_session_cmd, save_editor_session_cmd};

// PBI-5 Commands - Git 操作
use git_backend::{git_status_cmd, git_stage_cmd, git_unstage_cmd, git_diff_cmd,
                  git_current_branch_cmd, worktree_switch_cmd};
use git_backend::worktree::{worktree_list_cmd, worktree_add_cmd, worktree_remove_cmd};

// ============================================
// "打开方式"启动时暂存的文件路径队列
// 用于解决 Rust 拿到路径时前端 WebView 尚未就绪的时序问题：
//   macOS: RunEvent::Opened 在 setup 之后，但可能早于 WebView DOMContentLoaded
//   Windows: setup 中读 CLI 参数，此时前端必然未就绪
// 前端 mount 后调用 get_startup_files_cmd 主动拉取并清空队列
// ============================================
pub struct PendingFiles(pub Mutex<Vec<String>>);

/// 前端 mount 后调用，获取并清空通过"打开方式"传入的文件路径列表
#[tauri::command]
fn get_startup_files_cmd(state: tauri::State<PendingFiles>) -> Vec<String> {
    let mut queue = state.0.lock().unwrap();
    std::mem::take(&mut *queue)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 文件对话框 - 用于项目选择器"打开文件夹"功能
        .plugin(tauri_plugin_dialog::init())
        // 在线自动更新 - 启动时检测 GitHub Releases，引导用户安装新版本
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 进程管理 - 更新安装完成后重启应用
        .plugin(tauri_plugin_process::init())
        // E2E 测试支持（PBI-6 使用）
        .plugin(tauri_plugin_webdriver_automation::init())
        // 注册"打开方式"文件队列状态
        .manage(PendingFiles(Mutex::new(Vec::new())))
        // ============================================
        // macOS: 禁用 WKWebView 弹性滚动 + 设置深色背景
        // 通过原生 NSScrollView API 设置 scrollElasticity = None
        // CSS overscroll-behavior 在 WKWebView 上不可靠（wry#557、tauri#4309）
        // ============================================
        .setup(|app| {
            use tauri::Manager;

            // ============================================
            // Windows: 通过"打开方式"启动时，文件路径以 CLI 参数传入
            // args[0] 是可执行文件自身路径，args[1] 起才是用户传入的文件
            // 过滤掉不存在或非文件的路径，只保留合法的文件路径
            // ============================================
            #[cfg(target_os = "windows")]
            {
                let file_args: Vec<String> = std::env::args()
                    .skip(1)
                    .filter(|arg| {
                        let p = std::path::Path::new(arg);
                        p.exists() && p.is_file()
                    })
                    .collect();

                if !file_args.is_empty() {
                    let state = app.state::<PendingFiles>();
                    let mut queue = state.0.lock().unwrap();
                    queue.extend(file_args);
                }
            }

            if let Some(win) = app.get_webview_window("main") {
                // 设置窗口深色背景（消除 webview 与窗口之间的白色间隙）
                use tauri::window::Color;
                let _ = win.set_background_color(Some(Color(26, 27, 38, 255))); // #1a1b26

                // ============================================
                // macOS: NSWindow 原生 API 消除标题栏留白
                // titlebarAppearsTransparent: 标题栏完全透明，WebView 内容延伸到窗口边缘
                // titleVisibility: 隐藏标题文字（配合 hiddenTitle: true）
                // movableByWindowBackground: 禁用窗口背景拖拽（由 data-tauri-drag-region 管理）
                // 参考 Supremum: https://github.com/HybridTalentComputing/Supremum
                // ============================================
                #[cfg(target_os = "macos")]
                {
                    use objc::runtime::{Object, YES, NO};
                    use objc::msg_send;
                    use objc::sel;
                    use objc::sel_impl;

                    if let Ok(ns_win) = win.ns_window() {
                        let ns_win = ns_win as *mut Object;
                        unsafe {
                            // 标题栏透明化 — 消除标题栏区域的半透明渲染层
                            let _: () = msg_send![ns_win, setTitlebarAppearsTransparent: YES];
                            // 隐藏标题文字（NSWindowTitleHidden = 1）
                            let _: () = msg_send![ns_win, setTitleVisibility: 1i64];
                            // 禁止通过窗口背景拖拽 — 交由 data-tauri-drag-region 管理
                            let _: () = msg_send![ns_win, setMovableByWindowBackground: NO];
                        }
                    }
                }

                // ============================================
                // Windows：关闭原生窗口装饰（标题栏 + 按钮）
                // titleBarStyle: "Overlay" 仅对 macOS 生效；
                // Windows 需要显式禁用原生装饰，否则原生标题栏与前端
                // WindowControls 会同时显示，造成双标题栏问题。
                // 窗口边框/阴影由 WebView2 框架自行处理。
                // ============================================
                #[cfg(target_os = "windows")]
                {
                    let _ = win.set_decorations(false);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PBI-1: PTY 管理
            spawn_pty_cmd,
            kill_pty_cmd,
            resize_pty_cmd,
            reconnect_pty_cmd,
            get_default_shell_cmd,
            // PBI-2: 文件系统操作
            read_file_cmd,
            write_file_cmd,
            list_dir_cmd,
            create_entry_cmd,
            delete_entry_cmd,
            rename_entry_cmd,
            read_image_bytes_cmd,
            search_files_cmd,
            // PBI-3: 项目管理
            list_recent_projects_cmd,
            open_project_cmd,
            close_project_cmd,
            remove_project_cmd,
            clone_repository_cmd,
            // Task 8: 编辑器会话持久化
            get_editor_session_cmd,
            save_editor_session_cmd,
            // PBI-4: 文件系统实时监听
            start_watching_cmd,
            stop_watching_cmd,
            // PBI-5: Git 操作
            git_status_cmd,
            git_stage_cmd,
            git_unstage_cmd,
            git_diff_cmd,
            git_current_branch_cmd,
            worktree_list_cmd,
            worktree_add_cmd,
            worktree_remove_cmd,
            worktree_switch_cmd,
            // 打开方式：获取启动时传入的文件路径
            get_startup_files_cmd,
        ])
        // ============================================
        // 改用 build().run() 以便在 RunEvent 回调中处理 macOS"打开方式"事件
        // RunEvent::Opened 在 macOS 上接收 kAEOpenDocuments Apple Event，
        // 文件路径以 file:// URL 形式传入；
        // 应用已运行时（如用户在 Finder 中再次"打开方式"）也会触发此事件，
        // 此时直接 emit 给前端即可，无需经过 PendingFiles 队列
        // ============================================
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                use tauri::{Emitter, Manager};

                let file_paths: Vec<String> = urls
                    .iter()
                    .filter(|u| u.scheme() == "file")
                    .filter_map(|u| u.to_file_path().ok())
                    .filter(|p| p.is_file())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();

                // 同时存入队列（应对前端尚未就绪的情形）
                {
                    let state = app_handle.state::<PendingFiles>();
                    let mut queue = state.0.lock().unwrap();
                    for path in &file_paths {
                        // 避免重复推入（应用已运行时 emit 直达，队列仅兜底）
                        if !queue.contains(path) {
                            queue.push(path.clone());
                        }
                    }
                }

                // 直接 emit 给已就绪的前端（应用已在运行的常见场景）
                for path in &file_paths {
                    app_handle.emit("ghostterm:open-with-file", path).ok();
                }
            }
        });
}

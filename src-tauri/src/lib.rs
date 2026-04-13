// @file: lib.rs
// @description: GhostTerm Tauri 应用入口 - 注册所有 Tauri Commands 并初始化插件
//               阶段 2.5 合并后，所有 PBI-1/2/3 Commands 在此集中注册
// @author: Atlas.oi
// @date: 2026-04-13

// ============================================
// 模块声明
// ============================================
pub mod types;
pub mod pty_manager;
pub mod fs_backend;
pub mod git_backend;
pub mod project_manager;

// PBI-1 Commands
use pty_manager::{spawn_pty_cmd, kill_pty_cmd, resize_pty_cmd, reconnect_pty_cmd};

// PBI-2 Commands
use fs_backend::{read_file_cmd, write_file_cmd, list_dir_cmd, create_entry_cmd, delete_entry_cmd, rename_entry_cmd};

// PBI-4 Commands - 文件系统实时监听
use fs_backend::{start_watching_cmd, stop_watching_cmd};

// PBI-3 Commands
use project_manager::{list_recent_projects_cmd, open_project_cmd, close_project_cmd};

// PBI-5 Commands - Git 操作
use git_backend::{git_status_cmd, git_stage_cmd, git_unstage_cmd, git_diff_cmd,
                  git_current_branch_cmd, worktree_switch_cmd};
use git_backend::worktree::{worktree_list_cmd, worktree_add_cmd, worktree_remove_cmd};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 文件对话框 - 用于项目选择器"打开文件夹"功能
        .plugin(tauri_plugin_dialog::init())
        // E2E 测试支持（PBI-6 使用）
        .plugin(tauri_plugin_webdriver_automation::init())
        // ============================================
        // macOS: 禁用 WKWebView 弹性滚动 + 设置深色背景
        // 通过原生 NSScrollView API 设置 scrollElasticity = None
        // CSS overscroll-behavior 在 WKWebView 上不可靠（wry#557、tauri#4309）
        // ============================================
        .setup(|app| {
            // 设置窗口深色背景（消除 webview 与窗口之间的白色间隙）
            // 参考 Supremum：使用 Tauri 原生 API set_background_color
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                use tauri::window::Color;
                let _ = win.set_background_color(Some(Color(26, 27, 38, 255))); // #1a1b26
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PBI-1: PTY 管理
            spawn_pty_cmd,
            kill_pty_cmd,
            resize_pty_cmd,
            reconnect_pty_cmd,
            // PBI-2: 文件系统操作
            read_file_cmd,
            write_file_cmd,
            list_dir_cmd,
            create_entry_cmd,
            delete_entry_cmd,
            rename_entry_cmd,
            // PBI-3: 项目管理
            list_recent_projects_cmd,
            open_project_cmd,
            close_project_cmd,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

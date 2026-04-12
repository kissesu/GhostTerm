// @file: lib.rs
// @description: GhostTerm Tauri 应用入口 - 注册所有 Tauri Commands 并初始化插件
//               各功能模块通过 mod 声明引入，Commands 在各模块实现后在此集中注册
// @author: Atlas.oi
// @date: 2026-04-12

// ============================================
// 模块声明
// ============================================
pub mod types;
pub mod pty_manager;
pub mod fs_backend;
pub mod git_backend;
pub mod project_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // E2E 测试支持（PBI-6 使用），始终启用
        .plugin(tauri_plugin_webdriver_automation::init())
        // PBI-1 完成后在此注册 PTY Commands (spawn_pty, kill_pty, resize_pty, reconnect_pty)
        // PBI-2 完成后在此注册 FS Commands (read_file, write_file, list_dir, create/delete/rename_entry)
        // PBI-3 完成后在此注册 Project Commands (list_recent_projects, open_project, close_project)
        // PBI-5 完成后在此注册 Git Commands (git_status, git_stage, git_unstage, git_diff, worktree_*)
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

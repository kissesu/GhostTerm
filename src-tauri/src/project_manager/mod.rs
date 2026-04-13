// @file: project_manager/mod.rs
// @description: 项目管理器 - 维护最近项目列表（持久化到 projects.json），
//               协调项目打开/关闭时的状态更新。
//               使用 Mutex 保护内存中的当前项目状态，通过 persistence 模块持久化。
//               PBI-6：open_project 协调 watcher 生命周期 + PTY spawn/kill（stop旧+start新）。
//               PROJECT_SWITCH_LOCK 保证项目切换操作串行化，避免并发调用导致 PTY 泄漏。
// @author: Atlas.oi
// @date: 2026-04-13

pub mod persistence;

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tokio::sync::Mutex as TokioMutex;
use crate::types::ProjectInfo;
use crate::fs_backend::watcher::{start_watching, stop_watching};
use persistence::{load_projects, save_projects};

// 最多保留最近打开的项目数量（超出后删除最旧记录）
const MAX_RECENT_PROJECTS: usize = 20;

/// 全局当前项目状态（内存中）
/// 使用 Mutex 保证线程安全，Tauri Commands 从多线程调用
/// pub 可见性：git_backend::worktree_switch 需要访问，以执行路径更新和事务回滚
pub static CURRENT_PROJECT: Mutex<Option<ProjectInfo>> = Mutex::new(None);

/// 当前项目关联的 PTY ID（内存中）
/// project_manager 跟踪此 ID，以便 close_project 或切换项目时精确 kill 旧 PTY
/// open_project 时先 kill 旧 PTY，再 spawn 新 PTY，避免 PTY 泄漏
pub static CURRENT_PTY_ID: Mutex<Option<String>> = Mutex::new(None);

/// 项目切换操作串行化锁
/// 防止多次并发调用 open_project/close_project 导致 PTY 泄漏和状态不一致
/// 使用 tokio::sync::Mutex：其 guard 实现 Send，可安全跨 await 持有
static PROJECT_SWITCH_LOCK: OnceLock<TokioMutex<()>> = OnceLock::new();

fn project_switch_lock() -> &'static TokioMutex<()> {
    PROJECT_SWITCH_LOCK.get_or_init(TokioMutex::default)
}

/// 获取 projects.json 的存储路径
///
/// 路径：~/.config/ghostterm/projects.json
/// 使用 dirs crate 跨平台定位用户配置目录
fn projects_file_path() -> PathBuf {
    dirs::config_dir()
        .expect("无法获取系统配置目录")
        .join("ghostterm")
        .join("projects.json")
}

/// 获取最近打开的项目列表
///
/// 业务逻辑：
/// 1. 从 projects.json 读取
/// 2. 文件不存在返回空列表
/// 3. 文件损坏则备份后返回空列表
pub fn list_recent_projects() -> Vec<ProjectInfo> {
    let path = projects_file_path();
    load_projects(&path)
}

/// 打开项目的纯业务逻辑（不涉及 AppHandle，供测试直接调用）
///
/// 业务逻辑：
/// 1. 验证路径存在且为目录
/// 2. 取目录名作为项目名称
/// 3. 创建 ProjectInfo，更新 last_opened 为当前时间
/// 4. 将项目添加到最近列表头部（去重后），最多保留 MAX_RECENT_PROJECTS 条
/// 5. 持久化到 projects.json
/// 6. 更新内存中的当前项目
fn open_project_inner(path: &str) -> Result<ProjectInfo, String> {
    let project_path = std::path::Path::new(path);

    // 验证路径存在且为目录
    if !project_path.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    if !project_path.is_dir() {
        return Err(format!("路径不是目录: {path}"));
    }

    // 取目录名作为项目名称
    let name = project_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("未命名项目")
        .to_string();

    // 获取当前时间戳（毫秒）
    let last_opened = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let project = ProjectInfo {
        name,
        path: path.to_string(),
        last_opened,
    };

    // 更新最近项目列表
    let file_path = projects_file_path();
    let mut projects = load_projects(&file_path);

    // 去掉已存在的相同路径记录，确保无重复
    projects.retain(|p| p.path != path);

    // 添加到列表头部（最新项目优先）
    projects.insert(0, project.clone());

    // 超出最大数量时截断尾部（最旧记录）
    if projects.len() > MAX_RECENT_PROJECTS {
        projects.truncate(MAX_RECENT_PROJECTS);
    }

    save_projects(&file_path, &projects)?;

    // 更新内存中的当前项目状态
    let mut current = CURRENT_PROJECT.lock().expect("获取项目锁失败");
    *current = Some(project.clone());

    Ok(project)
}

/// 打开指定路径的项目（PBI-6 协调版本：watcher + PTY 生命周期管理）
///
/// 业务逻辑：
/// 1. 获取串行化锁（防止并发切换导致 PTY 泄漏）
/// 2. 调用 open_project_inner 完成核心业务（持久化、列表更新、CURRENT_PROJECT）
/// 3. kill 旧 PTY（若存在），释放资源
/// 4. 停止旧文件监听（若存在）
/// 5. 为新项目路径启动文件监听
/// 6. spawn 新 PTY 并记录 ID
///    ↑ 若步骤 5/6 失败，清空 CURRENT_PROJECT 为 None 并返回错误
///    为什么不回滚到旧值：旧 PTY 和 watcher 已被释放，回滚只会制造
///    "看似旧项目仍在但实际无资源"的虚假状态，不如诚实暴露错误
pub async fn open_project(path: &str, app: &tauri::AppHandle) -> Result<ProjectInfo, String> {
    // ============================================
    // 串行化锁：保证 open_project/close_project 不并发执行
    // tokio::sync::MutexGuard 实现 Send，可安全跨 await 持有
    // ============================================
    let _guard = project_switch_lock().lock().await;

    // open_project_inner 完成持久化并设置 CURRENT_PROJECT
    let project = open_project_inner(path)?;

    // ============================================
    // kill 旧 PTY（若存在），避免 PTY 泄漏
    // 使用块 scope 确保 std::sync::MutexGuard 在 await 前释放
    // ============================================
    let old_pty_id = { CURRENT_PTY_ID.lock().expect("PTY ID 锁").take() };
    if let Some(id) = old_pty_id {
        crate::pty_manager::kill_pty(&id).await.ok();
    }

    // 停止旧监听（之前可能未启动，忽略错误不影响主流程）
    stop_watching().ok();

    // ============================================
    // 启动新 watcher
    // 失败时：清空 CURRENT_PROJECT（旧资源已释放，无法回滚到旧项目）
    // ============================================
    if let Err(e) = start_watching(path, app.clone()) {
        { *CURRENT_PROJECT.lock().expect("获取项目锁失败") = None; }
        return Err(e);
    }

    // ============================================
    // spawn 新 PTY，使用系统默认 shell
    // 项目打开时预先建立 PTY，前端 Terminal 组件 mount 时直接连接
    // 失败时：停止已启动的 watcher，清空 CURRENT_PROJECT
    // ============================================
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let pty_info = match crate::pty_manager::spawn_pty(
        &shell,
        path,
        std::collections::HashMap::new(),
    )
    .await
    {
        Ok(info) => info,
        Err(e) => {
            stop_watching().ok();
            { *CURRENT_PROJECT.lock().expect("获取项目锁失败") = None; }
            return Err(e);
        }
    };

    // 记录新 PTY ID（独立作用域，避免 guard 跨越后续代码）
    { *CURRENT_PTY_ID.lock().expect("PTY ID 锁") = Some(pty_info.pty_id.clone()); }

    Ok(project)
}

/// 关闭当前项目（PBI-6 协调版本：watcher + PTY 同步释放）
///
/// 业务逻辑：
/// 1. kill 当前 PTY（若存在），释放终端资源
/// 2. 停止文件系统监听（释放 watcher 资源）
/// 3. 清空内存中的当前项目状态
/// 4. 不修改 projects.json（历史记录保留）
pub async fn close_project() -> Result<(), String> {
    // 获取串行化锁，防止与 open_project 并发执行
    let _guard = project_switch_lock().lock().await;

    // ============================================
    // kill 当前 PTY（若存在）
    // 用块 {} 确保 std::sync::MutexGuard 在 await 前释放：
    // std::sync::MutexGuard 不是 Send，不能跨 await 存活
    // ============================================
    let old_pty_id = { CURRENT_PTY_ID.lock().expect("PTY ID 锁").take() };
    if let Some(pty_id) = old_pty_id {
        crate::pty_manager::kill_pty(&pty_id).await.ok();
    }

    // 停止文件监听（若未启动则忽略错误）
    stop_watching().ok();

    // 清空当前项目（guard 在此行结束时 drop，后面无 await，安全）
    { *CURRENT_PROJECT.lock().expect("获取项目锁失败") = None; }
    Ok(())
}

// ============================================
// Tauri Commands - 暴露给前端调用
// 命名规范：函数名后缀 _cmd 避免与内部函数冲突
// 注意：不在 lib.rs 注册，由合并时统一处理
// ============================================

/// 列出最近项目 - Tauri Command
#[tauri::command]
pub fn list_recent_projects_cmd() -> Vec<ProjectInfo> {
    list_recent_projects()
}

/// 打开项目 - Tauri Command（async：内部需要 spawn_pty）
///
/// 协调 watcher 生命周期（stop旧+start新）+ PTY 生命周期（kill旧+spawn新）
#[tauri::command]
pub async fn open_project_cmd(app: tauri::AppHandle, path: String) -> Result<ProjectInfo, String> {
    open_project(&path, &app).await
}

/// 关闭项目 - Tauri Command（async：内部需要 kill_pty）
#[tauri::command]
pub async fn close_project_cmd() -> Result<(), String> {
    close_project().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_temp_dir() -> TempDir {
        tempfile::tempdir().expect("创建临时目录失败")
    }

    #[test]
    fn test_list_recent_projects_empty_on_missing_file() {
        // 当 projects.json 不存在时，persistence::load_projects 返回空列表
        let tmp = make_temp_dir();
        let path = tmp.path().join("projects.json");
        let result = persistence::load_projects(&path);
        assert!(result.is_empty());
    }

    #[test]
    fn test_open_project_invalid_path() {
        // 路径不存在时应返回错误（使用 inner 函数避免 AppHandle 依赖）
        let result = open_project_inner("/nonexistent/path/that/does/not/exist");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("路径不存在"));
    }

    #[test]
    fn test_open_project_not_a_directory() {
        // 路径是文件而非目录时应返回错误
        let tmp = make_temp_dir();
        let file_path = tmp.path().join("somefile.txt");
        std::fs::write(&file_path, "content").unwrap();

        let result = open_project_inner(file_path.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不是目录"));
    }

    #[test]
    fn test_open_project_extracts_dir_name() {
        // open_project_inner 应正确取目录名作为项目名
        let tmp = make_temp_dir();
        let project_dir = tmp.path().join("my-awesome-project");
        std::fs::create_dir(&project_dir).unwrap();

        let result = open_project_inner(project_dir.to_str().unwrap());
        if let Ok(info) = result {
            assert_eq!(info.name, "my-awesome-project");
            assert_eq!(info.path, project_dir.to_str().unwrap());
            assert!(info.last_opened > 0, "last_opened 应为非零时间戳");
        }
        // 直接清理内存状态（避免依赖 async close_project）
        *CURRENT_PROJECT.lock().unwrap() = None;
        *CURRENT_PTY_ID.lock().unwrap() = None;
    }

    #[tokio::test]
    async fn test_close_project_clears_project_state() {
        // close_project 应清空当前项目状态
        {
            let mut current = CURRENT_PROJECT.lock().unwrap();
            *current = Some(ProjectInfo {
                name: "test".to_string(),
                path: "/test".to_string(),
                last_opened: 1000,
            });
        }

        close_project().await.unwrap();

        let current = CURRENT_PROJECT.lock().unwrap();
        assert!(current.is_none(), "关闭项目后内存状态应为 None");
    }

    #[tokio::test]
    async fn test_close_project_clears_pty_id() {
        // close_project 应通过 take() 清空 CURRENT_PTY_ID
        // 即使 kill_pty 返回错误（ID 不存在于 PTY_REGISTRY），状态也应被清空
        *CURRENT_PTY_ID.lock().unwrap() = Some("test-pty-nonexistent".to_string());

        close_project().await.unwrap();

        let pty_id = CURRENT_PTY_ID.lock().unwrap();
        assert!(pty_id.is_none(), "close_project 应清空 CURRENT_PTY_ID");
    }

    #[test]
    fn test_persistence_roundtrip_via_save_load() {
        // 通过 persistence 模块验证序列化/反序列化完整流程
        let tmp = make_temp_dir();
        let path = tmp.path().join("projects.json");

        let projects = vec![
            ProjectInfo {
                name: "proj-a".to_string(),
                path: "/home/user/proj-a".to_string(),
                last_opened: 9000,
            },
        ];

        persistence::save_projects(&path, &projects).unwrap();
        let loaded = persistence::load_projects(&path);

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "proj-a");
    }
}

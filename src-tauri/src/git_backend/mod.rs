// @file: git_backend/mod.rs
// @description: Git 后端 - 提供 git status、暂存/取消暂存、diff、分支查询，
//               以及 Worktree 的创建/删除/切换功能（基于 git2 库）
// @author: Atlas.oi
// @date: 2026-04-13

pub mod worktree;

use crate::types::StatusEntry;
use git2::{Repository, StatusOptions};

/// 获取 Git 仓库状态
///
/// 业务逻辑：
/// 1. 尝试打开 git 仓库
/// 2. 查询工作区所有文件状态
/// 3. 区分 staged（暂存区）与 unstaged（工作区）变更
/// 4. 非 git 目录返回空列表（项目可能未初始化 git）
pub fn git_status(repo_path: &str) -> Result<Vec<StatusEntry>, String> {
    // 路径不是 git 仓库时返回空列表，非错误状态
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("获取 git 状态失败: {}", e))?;

    let mut entries: Vec<StatusEntry> = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }

        let status = entry.status();

        // 解析暂存区状态（INDEX_* 前缀）
        let staged: Option<String> = if status.is_index_new() {
            Some("A".to_string())
        } else if status.is_index_modified() {
            Some("M".to_string())
        } else if status.is_index_deleted() {
            Some("D".to_string())
        } else if status.is_index_renamed() {
            Some("R".to_string())
        } else {
            None
        };

        // 解析工作区状态（WT_* 前缀）
        let unstaged: Option<String> = if status.is_wt_new() {
            Some("?".to_string())
        } else if status.is_wt_modified() {
            Some("M".to_string())
        } else if status.is_wt_deleted() {
            Some("D".to_string())
        } else if status.is_wt_renamed() {
            Some("R".to_string())
        } else {
            None
        };

        // 至少有一种状态才记录
        if staged.is_some() || unstaged.is_some() {
            entries.push(StatusEntry {
                path,
                staged,
                unstaged,
            });
        }
    }

    Ok(entries)
}

/// 将指定文件添加到暂存区
///
/// 业务逻辑：
/// 1. 打开 git 仓库
/// 2. 获取 index（暂存区）
/// 3. 添加文件路径
/// 4. 写入 index 使变更持久化
pub fn git_stage(repo_path: &str, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("打开 git 仓库失败: {}", e))?;

    let mut index = repo
        .index()
        .map_err(|e| format!("获取 index 失败: {}", e))?;

    // 添加相对路径（git2 要求使用相对于仓库根目录的路径）
    index
        .add_path(std::path::Path::new(file_path))
        .map_err(|e| format!("暂存文件失败 {}: {}", file_path, e))?;

    index
        .write()
        .map_err(|e| format!("写入 index 失败: {}", e))?;

    Ok(())
}

/// 从暂存区撤销指定文件（恢复到 HEAD 状态）
///
/// 业务逻辑：
/// 1. 打开 git 仓库
/// 2. 获取 HEAD commit 的 tree entry
/// 3. 将 index 中该文件恢复为 HEAD 版本（相当于 git reset HEAD <file>）
/// 4. 如果 HEAD 不存在（初始仓库），直接从 index 删除该条目
pub fn git_unstage(repo_path: &str, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("打开 git 仓库失败: {}", e))?;

    let mut index = repo
        .index()
        .map_err(|e| format!("获取 index 失败: {}", e))?;

    // 尝试获取 HEAD，如果不存在（空仓库首次提交前）则从 index 直接删除
    match repo.head() {
        Ok(head_ref) => {
            let head_commit = head_ref
                .peel_to_commit()
                .map_err(|e| format!("获取 HEAD commit 失败: {}", e))?;

            let head_tree = head_commit
                .tree()
                .map_err(|e| format!("获取 HEAD tree 失败: {}", e))?;

            // 查找该文件在 HEAD 中是否存在
            match head_tree.get_path(std::path::Path::new(file_path)) {
                Ok(tree_entry) => {
                    // 文件在 HEAD 中存在，将 index 恢复到 HEAD 版本
                    let obj = tree_entry
                        .to_object(&repo)
                        .map_err(|e| format!("获取 tree 对象失败: {}", e))?;

                    let file_size = obj
                        .as_blob()
                        .map(|b| b.size() as u32)
                        .unwrap_or(0);

                    let entry = git2::IndexEntry {
                        ctime: git2::IndexTime::new(0, 0),
                        mtime: git2::IndexTime::new(0, 0),
                        dev: 0,
                        ino: 0,
                        mode: tree_entry.filemode() as u32,
                        uid: 0,
                        gid: 0,
                        file_size,
                        id: tree_entry.id(),
                        flags: 0,
                        flags_extended: 0,
                        path: file_path.as_bytes().to_vec(),
                    };
                    index
                        .add(&entry)
                        .map_err(|e| format!("恢复 index 条目失败: {}", e))?;
                }
                Err(_) => {
                    // 文件在 HEAD 中不存在（新建文件），直接从 index 删除
                    index
                        .remove_path(std::path::Path::new(file_path))
                        .map_err(|e| format!("从 index 删除失败: {}", e))?;
                }
            }
        }
        Err(_) => {
            // HEAD 不存在（空仓库），直接从 index 删除
            index
                .remove_path(std::path::Path::new(file_path))
                .map_err(|e| format!("从 index 删除失败: {}", e))?;
        }
    }

    index
        .write()
        .map_err(|e| format!("写入 index 失败: {}", e))?;

    Ok(())
}

/// 获取文件的 diff 文本
///
/// 业务逻辑：
/// 1. 打开 git 仓库
/// 2. 先获取 unstaged diff（工作区 vs index）
/// 3. 如果 unstaged 为空，获取 staged diff（index vs HEAD）
/// 4. 使用 git2::Patch 逐块拼接 diff 文本
pub fn git_diff(repo_path: &str, file_path: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("打开 git 仓库失败: {}", e))?;

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(file_path);
    // recurse_untracked_dirs 仅用于 status；diff 无需配置

    // 先尝试 unstaged diff（工作区 vs index）
    let unstaged_diff = repo
        .diff_index_to_workdir(None, Some(&mut diff_opts))
        .map_err(|e| format!("获取 unstaged diff 失败: {}", e))?;

    let unstaged_count = unstaged_diff.deltas().count();

    if unstaged_count > 0 {
        // 有 unstaged 变更，用 print 回调收集文本
        let mut patch_text = String::new();
        unstaged_diff
            .print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
                let content = std::str::from_utf8(line.content()).unwrap_or("");
                patch_text.push_str(content);
                true
            })
            .map_err(|e| format!("生成 diff patch 失败: {}", e))?;
        return Ok(patch_text);
    }

    // 无 unstaged，尝试 staged diff（index vs HEAD）
    // 注意：head_ref 的生命周期需要 commit/tree 在同一作用域内才不报错
    let patch_text = if let Ok(head_ref) = repo.head() {
        if let Ok(head_commit) = head_ref.peel_to_commit() {
            if let Ok(head_tree) = head_commit.tree() {
                let staged_diff = repo
                    .diff_tree_to_index(Some(&head_tree), None, Some(&mut diff_opts))
                    .map_err(|e| format!("获取 staged diff 失败: {}", e))?;

                let mut text = String::new();
                staged_diff
                    .print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
                        let content = std::str::from_utf8(line.content()).unwrap_or("");
                        text.push_str(content);
                        true
                    })
                    .map_err(|e| format!("生成 staged diff patch 失败: {}", e))?;
                text
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    Ok(patch_text)
}

/// 获取当前 Git 分支名
///
/// 业务逻辑：
/// 1. 打开 git 仓库
/// 2. 获取 HEAD 引用
/// 3. 分支状态 → 返回分支名；detached HEAD → 返回 commit hash 前 8 位
/// 4. 非 git 目录 → 返回空字符串
pub fn git_current_branch(repo_path: &str) -> Result<String, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        // 非 git 目录不报错，返回空字符串
        Err(_) => return Ok(String::new()),
    };

    // 用局部变量绑定，避免临时值生命周期问题（Rust E0597）
    let head_result = repo.head();
    let result = match head_result {
        Ok(ref head) => {
            if head.is_branch() {
                // 正常分支：返回分支短名称
                head.shorthand()
                    .unwrap_or("unknown")
                    .to_string()
            } else {
                // detached HEAD：返回 commit hash 前 8 位
                if let Ok(commit) = head.peel_to_commit() {
                    let hash = format!("{}", commit.id());
                    hash[..8.min(hash.len())].to_string()
                } else {
                    "HEAD".to_string()
                }
            }
        }
        Err(_) => String::new(),
    };
    Ok(result)
}

/// 切换工作目录到指定 Worktree（事务性）
///
/// 业务逻辑（事务性，失败时回滚）：
/// 1. 读取旧的当前项目路径
/// 2. 停止旧目录的文件系统监听
/// 3. 更新 CURRENT_PROJECT 状态为新路径
/// 4. 启动新目录的文件系统监听
/// 5. 如果步骤 4 失败 → 回滚：恢复旧路径 + 重新启动旧目录监听
pub fn worktree_switch(app: tauri::AppHandle, new_cwd: &str) -> Result<(), String> {
    use crate::fs_backend::watcher::{start_watching, stop_watching};
    use crate::project_manager::CURRENT_PROJECT;

    // 记录旧路径（用于回滚）
    let old_path = {
        let guard = CURRENT_PROJECT
            .lock()
            .map_err(|_| "获取项目锁失败".to_string())?;
        guard.as_ref().map(|p| p.path.clone())
    };

    // 停止旧目录的监听
    stop_watching().map_err(|e| format!("停止文件监听失败: {}", e))?;

    // 更新内存中的当前项目路径
    {
        let mut guard = CURRENT_PROJECT
            .lock()
            .map_err(|_| "获取项目锁失败".to_string())?;

        if let Some(ref mut project) = *guard {
            project.path = new_cwd.to_string();
        }
    }

    // 启动新目录的监听（失败时回滚）
    match start_watching(new_cwd, app.clone()) {
        Ok(()) => Ok(()),
        Err(e) => {
            // 回滚：恢复旧路径
            {
                let mut guard = CURRENT_PROJECT
                    .lock()
                    .map_err(|_| "回滚时获取项目锁失败".to_string())?;

                if let Some(ref mut project) = *guard {
                    if let Some(ref old) = old_path {
                        project.path = old.clone();
                    }
                }
            }

            // 恢复旧目录的监听
            if let Some(ref old) = old_path {
                let _ = start_watching(old, app);
            }

            Err(format!("切换 worktree 失败，已回滚: {}", e))
        }
    }
}

// ============================================
// Tauri Commands
// ============================================

/// Tauri Command: 获取 Git 状态
#[tauri::command]
pub fn git_status_cmd(repo_path: String) -> Result<Vec<StatusEntry>, String> {
    git_status(&repo_path)
}

/// Tauri Command: 暂存文件
#[tauri::command]
pub fn git_stage_cmd(repo_path: String, file_path: String) -> Result<(), String> {
    git_stage(&repo_path, &file_path)
}

/// Tauri Command: 取消暂存文件
#[tauri::command]
pub fn git_unstage_cmd(repo_path: String, file_path: String) -> Result<(), String> {
    git_unstage(&repo_path, &file_path)
}

/// Tauri Command: 获取文件 diff
#[tauri::command]
pub fn git_diff_cmd(repo_path: String, file_path: String) -> Result<String, String> {
    git_diff(&repo_path, &file_path)
}

/// Tauri Command: 获取当前分支名
#[tauri::command]
pub fn git_current_branch_cmd(repo_path: String) -> Result<String, String> {
    git_current_branch(&repo_path)
}

/// Tauri Command: 切换 Worktree（异步，需要 AppHandle）
#[tauri::command]
pub async fn worktree_switch_cmd(app: tauri::AppHandle, new_cwd: String) -> Result<(), String> {
    worktree_switch(app, &new_cwd)
}

// ============================================
// 单元测试
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    /// 创建一个带初始化提交的临时 git 仓库
    fn setup_git_repo() -> TempDir {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let path = dir.path();

        // 初始化仓库
        Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(path)
            .output()
            .expect("git init 失败");

        // 配置用户信息（测试环境可能无全局 git 配置）
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .expect("git config email 失败");

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .expect("git config name 失败");

        // 创建初始提交（避免 HEAD 不存在）
        let readme = path.join("README.md");
        std::fs::write(&readme, "# Test Repo").expect("创建 README 失败");

        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .expect("git add 失败");

        Command::new("git")
            .args(["commit", "-m", "初始提交"])
            .current_dir(path)
            .output()
            .expect("git commit 失败");

        dir
    }

    /// 测试 5.1：非 git 目录返回空列表
    #[test]
    fn test_git_status_non_git_dir_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let result = git_status(dir.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty(), "非 git 目录应返回空列表");
    }

    /// 测试 5.1：修改文件后 status 返回 modified（unstaged）
    #[test]
    fn test_git_status_modified_file_appears() {
        let dir = setup_git_repo();
        let path = dir.path();

        // 修改已提交的文件
        std::fs::write(path.join("README.md"), "# Modified").unwrap();

        let result = git_status(path.to_str().unwrap()).unwrap();
        let modified = result.iter().find(|e| e.path == "README.md");
        assert!(modified.is_some(), "修改文件后应出现在 status 中");
        let entry = modified.unwrap();
        assert_eq!(entry.unstaged.as_deref(), Some("M"), "应标记为 unstaged M");
    }

    /// 测试 5.1：新建文件返回 untracked（?）
    #[test]
    fn test_git_status_new_file_appears() {
        let dir = setup_git_repo();
        let path = dir.path();

        std::fs::write(path.join("new_file.txt"), "content").unwrap();

        let result = git_status(path.to_str().unwrap()).unwrap();
        let new_file = result.iter().find(|e| e.path == "new_file.txt");
        assert!(new_file.is_some(), "新建文件应出现在 status 中");
        let entry = new_file.unwrap();
        assert_eq!(entry.unstaged.as_deref(), Some("?"), "未跟踪文件应标记为 ?");
    }

    /// 测试 5.2：stage 后文件进入 staged 状态
    #[test]
    fn test_git_stage_file_becomes_staged() {
        let dir = setup_git_repo();
        let path = dir.path();

        // 新建文件
        std::fs::write(path.join("staged.txt"), "content").unwrap();

        // 暂存文件
        git_stage(path.to_str().unwrap(), "staged.txt").unwrap();

        // 检查状态
        let result = git_status(path.to_str().unwrap()).unwrap();
        let entry = result.iter().find(|e| e.path == "staged.txt");
        assert!(entry.is_some(), "暂存后文件应出现在 status 中");
        let entry = entry.unwrap();
        assert_eq!(entry.staged.as_deref(), Some("A"), "暂存后应标记为 staged A");
    }

    /// 测试 5.2：unstage 后文件回到 unstaged 状态
    #[test]
    fn test_git_unstage_file_returns_to_unstaged() {
        let dir = setup_git_repo();
        let path = dir.path();

        // 新建文件并暂存
        std::fs::write(path.join("unstage_test.txt"), "content").unwrap();
        git_stage(path.to_str().unwrap(), "unstage_test.txt").unwrap();

        // 验证已暂存
        let before = git_status(path.to_str().unwrap()).unwrap();
        let staged_entry = before.iter().find(|e| e.path == "unstage_test.txt").unwrap();
        assert_eq!(staged_entry.staged.as_deref(), Some("A"));

        // 取消暂存
        git_unstage(path.to_str().unwrap(), "unstage_test.txt").unwrap();

        // 验证回到 unstaged
        let after = git_status(path.to_str().unwrap()).unwrap();
        let entry = after.iter().find(|e| e.path == "unstage_test.txt");
        if let Some(e) = entry {
            // 文件应不再有 staged 状态
            assert!(e.staged.is_none(), "取消暂存后不应有 staged 标记");
        }
        // 文件可能不再出现（已从 index 移除），这也是正确的
    }

    /// 测试 5.3：修改文件后 diff 非空
    #[test]
    fn test_git_diff_modified_file_non_empty() {
        let dir = setup_git_repo();
        let path = dir.path();

        // 修改文件
        std::fs::write(path.join("README.md"), "# Modified Content").unwrap();

        let diff = git_diff(path.to_str().unwrap(), "README.md").unwrap();
        assert!(!diff.is_empty(), "修改文件后 diff 应非空");
        assert!(diff.contains("README.md") || diff.contains("Modified"), "diff 应包含变更内容");
    }

    /// 测试 5.4：正常分支返回分支名
    #[test]
    fn test_git_current_branch_returns_branch_name() {
        let dir = setup_git_repo();
        let path = dir.path();

        let branch = git_current_branch(path.to_str().unwrap()).unwrap();
        assert!(!branch.is_empty(), "应返回分支名");
        // git init -b main 创建的仓库应返回 "main"
        assert_eq!(branch, "main");
    }

    /// 测试 5.4：非 git 目录返回空字符串
    #[test]
    fn test_git_current_branch_non_git_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let branch = git_current_branch(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(branch, "", "非 git 目录应返回空字符串");
    }
}

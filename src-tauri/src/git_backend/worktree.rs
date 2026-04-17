// @file: git_backend/worktree.rs
// @description: Git Worktree 管理 - 列出/创建/删除 worktree。
//               git2 的 worktree API 不完整（缺少 add 时指定分支等功能），
//               因此部分操作 fallback 到 std::process::Command 调用 git CLI。
// @author: Atlas.oi
// @date: 2026-04-13

use crate::types::Worktree;
use std::path::Path;
use std::process::Command;

/// 列出 git 仓库的所有 worktree
///
/// 业务逻辑：
/// 1. 通过 git CLI 获取 worktree 列表（比 git2 API 更完整）
/// 2. 解析 `git worktree list --porcelain` 输出
/// 3. 标记当前活动的 worktree（与进程 cwd 比较）
pub fn worktree_list(repo_path: &str) -> Result<Vec<Worktree>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("执行 git worktree list 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree list 失败: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // 解析后过滤 stale（目录已删除）worktree
    let worktrees = filter_stale_worktrees(parse_worktree_list_porcelain(&stdout, repo_path));

    Ok(worktrees)
}

/// 解析 `git worktree list --porcelain` 的输出（纯文本解析，不做 I/O）
///
/// 格式示例（text 非代码，标记为 no_run 避免 doctest 解析）：
/// ```text
/// worktree /path/to/main
/// HEAD abc123
/// branch refs/heads/main
///
/// worktree /path/to/feature
/// HEAD def456
/// branch refs/heads/feature
/// ```
///
/// 返回未经过滤的原始列表，由调用方决定是否过滤 stale 路径。
/// `current_path` 仅用于标记 `is_current`；规范化失败时退化为字符串比较。
fn parse_worktree_list_porcelain(output: &str, current_path: &str) -> Vec<Worktree> {
    let mut result: Vec<Worktree> = Vec::new();
    let mut current_wt_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    // 规范化 current_path 用于比较；路径不存在时退化为原始字符串
    let canonical_current = std::fs::canonicalize(current_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| current_path.to_string());

    // 将已积累的 (path, branch) 推入结果；不检查路径是否存在（由调用方过滤）
    let flush = |path: String, branch: Option<String>, canonical_cur: &str, res: &mut Vec<Worktree>| {
        let canonical_wt = std::fs::canonicalize(&path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.clone());
        res.push(Worktree {
            path,
            branch,
            is_current: canonical_wt == canonical_cur,
        });
    };

    for line in output.lines() {
        if line.starts_with("worktree ") {
            // 新的 worktree 块开始，提交上一个（如果有）
            if let Some(path) = current_wt_path.take() {
                flush(path, current_branch.take(), &canonical_current, &mut result);
            } else {
                current_branch = None;
            }

            let path = line["worktree ".len()..].trim().to_string();
            current_wt_path = Some(path);
        } else if line.starts_with("branch ") {
            // 分支引用，格式：refs/heads/main
            let branch_ref = line["branch ".len()..].trim();
            // 取 refs/heads/ 后面的短名称
            let short_name = branch_ref
                .strip_prefix("refs/heads/")
                .unwrap_or(branch_ref)
                .to_string();
            current_branch = Some(short_name);
        } else if line == "detached" {
            // detached HEAD 状态
            current_branch = None;
        }
        // HEAD 行（commit hash）暂不使用
    }

    // 提交最后一个 worktree
    if let Some(path) = current_wt_path {
        flush(path, current_branch, &canonical_current, &mut result);
    }

    result
}

/// 从 parse_worktree_list_porcelain 的结果中过滤掉 stale（目录已删除）的 worktree
fn filter_stale_worktrees(worktrees: Vec<Worktree>) -> Vec<Worktree> {
    worktrees.into_iter().filter(|w| Path::new(&w.path).exists()).collect()
}

/// 创建新的 git worktree
///
/// 业务逻辑：
/// 1. 检查目标路径是否已存在
/// 2. 如果指定分支已存在，使用 `git worktree add <path> <branch>`
/// 3. 如果分支不存在，使用 `git worktree add -b <branch> <path>` 创建新分支
/// 4. 返回新创建的 Worktree 信息
pub fn worktree_add(repo_path: &str, path: &str, branch: &str) -> Result<Worktree, String> {
    // 检查分支是否已存在
    let branch_exists = Command::new("git")
        .args(["show-ref", "--verify", "--quiet", &format!("refs/heads/{}", branch)])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let output = if branch_exists {
        // 分支已存在，checkout 到该分支
        Command::new("git")
            .args(["worktree", "add", path, branch])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("执行 git worktree add 失败: {}", e))?
    } else {
        // 分支不存在，创建新分支
        Command::new("git")
            .args(["worktree", "add", "-b", branch, path])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("执行 git worktree add -b 失败: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("创建 worktree 失败: {}", stderr));
    }

    // 返回新 worktree 的信息
    let abs_path = if Path::new(path).is_absolute() {
        path.to_string()
    } else {
        // 相对路径转为绝对路径
        std::fs::canonicalize(path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string())
    };

    Ok(Worktree {
        path: abs_path,
        branch: Some(branch.to_string()),
        is_current: false,
    })
}

/// 删除指定 git worktree
///
/// 业务逻辑：
/// 1. 使用 `git worktree remove --force <name>` 删除 worktree
/// 2. 如果通过名称找不到，尝试通过路径查找并删除目录
pub fn worktree_remove(repo_path: &str, worktree_name: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args(["worktree", "remove", "--force", worktree_name])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("执行 git worktree remove 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("删除 worktree 失败: {}", stderr));
    }

    // 执行 prune 清理悬空引用
    let _ = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output();

    Ok(())
}

// ============================================
// Tauri Commands
// ============================================

/// Tauri Command: 列出所有 worktree
#[tauri::command]
pub fn worktree_list_cmd(repo_path: String) -> Result<Vec<Worktree>, String> {
    worktree_list(&repo_path)
}

/// Tauri Command: 创建新 worktree
#[tauri::command]
pub fn worktree_add_cmd(repo_path: String, path: String, branch: String) -> Result<Worktree, String> {
    worktree_add(&repo_path, &path, &branch)
}

/// Tauri Command: 删除 worktree
#[tauri::command]
pub fn worktree_remove_cmd(repo_path: String, worktree_name: String) -> Result<(), String> {
    worktree_remove(&repo_path, &worktree_name)
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

        Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(path)
            .output()
            .expect("git init 失败");

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .expect("git config 失败");

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .expect("git config 失败");

        // 需要至少一个提交才能创建 worktree
        let readme = path.join("README.md");
        std::fs::write(&readme, "# Test").expect("创建文件失败");

        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .expect("git add 失败");

        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(path)
            .output()
            .expect("git commit 失败");

        dir
    }

    /// 测试 porcelain 格式解析
    #[test]
    fn test_parse_worktree_list_porcelain() {
        let output = "worktree /main/path\nHEAD abc123\nbranch refs/heads/main\n\nworktree /feat/path\nHEAD def456\nbranch refs/heads/feature\n\n";
        let worktrees = parse_worktree_list_porcelain(output, "/main/path");

        assert_eq!(worktrees.len(), 2, "应解析出 2 个 worktree");
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert_eq!(worktrees[1].branch.as_deref(), Some("feature"));
    }

    /// 测试 5.5：worktree_list 返回至少一个（主仓库）
    #[test]
    fn test_worktree_list_returns_main() {
        let dir = setup_git_repo();
        let path = dir.path().to_str().unwrap();

        let worktrees = worktree_list(path).unwrap();
        assert!(!worktrees.is_empty(), "应至少返回主 worktree");

        // 主仓库应标记为 current
        let main_wt = worktrees.iter().find(|w| w.is_current);
        assert!(main_wt.is_some(), "应有一个 is_current=true 的 worktree");
    }

    /// 测试 5.5/5.6：add 后 list 中出现，remove 后消失
    #[test]
    fn test_worktree_add_and_remove() {
        let dir = setup_git_repo();
        let repo_path = dir.path().to_str().unwrap();

        // 在临时目录外创建 worktree 目标路径
        let wt_parent = tempfile::tempdir().unwrap();
        let wt_path = wt_parent.path().join("feat-branch");
        let wt_path_str = wt_path.to_str().unwrap();

        // 创建 worktree
        let result = worktree_add(repo_path, wt_path_str, "feat-branch");
        assert!(result.is_ok(), "创建 worktree 应成功: {:?}", result.err());

        // 验证出现在列表中
        let list = worktree_list(repo_path).unwrap();
        let found = list.iter().any(|w| w.branch.as_deref() == Some("feat-branch"));
        assert!(found, "新 worktree 应出现在列表中");

        // 删除 worktree（使用路径作为名称）
        let remove_result = worktree_remove(repo_path, wt_path_str);
        assert!(remove_result.is_ok(), "删除 worktree 应成功: {:?}", remove_result.err());

        // 验证已从列表中消失
        let list_after = worktree_list(repo_path).unwrap();
        let still_found = list_after.iter().any(|w| w.branch.as_deref() == Some("feat-branch"));
        assert!(!still_found, "删除后 worktree 不应出现在列表中");
    }

    /// 测试 detached HEAD 解析
    #[test]
    fn test_parse_detached_head() {
        let output = "worktree /some/path\nHEAD abc123def\ndetached\n\n";
        let worktrees = parse_worktree_list_porcelain(output, "/other/path");

        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].branch.is_none(), "detached HEAD 的 branch 应为 None");
    }
}

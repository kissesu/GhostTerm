// @file: fs_backend/security.rs
// @description: 路径安全检查 - canonicalize 解析符号链接，
//               对敏感系统路径写操作返回需确认标记，防止误操作破坏系统文件
// @author: Atlas.oi
// @date: 2026-04-13

use std::path::Path;

/// 路径检查结果 - 用于写操作前的安全验证
#[derive(Debug, Clone)]
pub struct PathCheckResult {
    /// canonicalize 后的绝对路径（symlink 已解析）
    pub canonical_path: String,
    /// 是否需要用户二次确认（敏感路径）
    pub needs_confirmation: bool,
    /// 需要确认时的原因说明
    pub reason: Option<String>,
}

/// macOS/Linux 系统敏感路径列表 - 误写会导致系统损坏
/// 这些路径通常需要 root 权限，普通用户写入应弹出二次确认
const SENSITIVE_PREFIXES: &[&str] = &[
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/System",   // macOS 系统目录
    "/Library",  // macOS 系统库（部分受保护）
    "/private",  // macOS 对 /etc /tmp /var 的实际存储位置
];

/// 检查写路径安全性
///
/// 业务逻辑：
/// 1. 尝试 canonicalize 解析符号链接和相对路径
/// 2. 若路径不存在（新建文件），则尝试 canonicalize 父目录
/// 3. 检查 canonical 路径是否命中敏感前缀列表
/// 4. 返回检查结果，调用方根据 needs_confirmation 决定是否弹出确认框
///
/// # Errors
/// 若路径及其父目录均无法解析（无效路径），返回 Err
pub fn check_write_path(path: &str) -> Result<PathCheckResult, String> {
    let p = Path::new(path);

    // 尝试 canonicalize：文件存在时直接解析，不存在时解析父目录
    let canonical = if p.exists() {
        p.canonicalize()
            .map_err(|e| format!("无法解析路径 {}: {}", path, e))?
    } else {
        // 文件不存在（新建文件场景），解析父目录后拼接文件名
        let parent = p.parent().unwrap_or(Path::new("."));
        let canonical_parent = if parent == Path::new("") {
            std::env::current_dir()
                .map_err(|e| format!("无法获取当前目录: {}", e))?
        } else if parent.exists() {
            parent.canonicalize()
                .map_err(|e| format!("无法解析父目录 {:?}: {}", parent, e))?
        } else {
            // 父目录也不存在，仍然允许写入（write_file 会自动创建），
            // 无法 canonicalize 时直接使用原始路径做安全检查
            return Ok(PathCheckResult {
                canonical_path: path.to_string(),
                needs_confirmation: is_sensitive_path(path),
                reason: if is_sensitive_path(path) {
                    Some(format!("路径 {} 位于系统敏感目录，确认要写入吗？", path))
                } else {
                    None
                },
            });
        };
        let file_name = p.file_name().ok_or_else(|| format!("路径 {} 没有文件名", path))?;
        canonical_parent.join(file_name)
    };

    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| format!("路径包含非 UTF-8 字符: {:?}", canonical))?
        .to_string();

    let sensitive = is_sensitive_path(&canonical_str);

    Ok(PathCheckResult {
        canonical_path: canonical_str.clone(),
        needs_confirmation: sensitive,
        reason: if sensitive {
            Some(format!("路径 {} 位于系统敏感目录，确认要写入吗？", canonical_str))
        } else {
            None
        },
    })
}

/// 判断路径是否命中敏感前缀
fn is_sensitive_path(path: &str) -> bool {
    SENSITIVE_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_normal_path_no_confirmation() {
        // 临时目录是安全路径，不应触发确认
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        // 创建文件后检查
        fs::write(&file_path, "hello").unwrap();
        let result = check_write_path(file_path.to_str().unwrap()).unwrap();
        assert!(!result.needs_confirmation);
        assert!(result.reason.is_none());
    }

    #[test]
    fn test_new_file_in_existing_dir() {
        // 父目录存在但文件不存在（新建文件场景）
        let dir = tempdir().unwrap();
        let new_file = dir.path().join("new_file.txt");
        let result = check_write_path(new_file.to_str().unwrap()).unwrap();
        assert!(!result.needs_confirmation);
        // canonical 路径应包含文件名
        assert!(result.canonical_path.ends_with("new_file.txt"));
    }

    #[test]
    fn test_sensitive_path_needs_confirmation() {
        // /etc 是敏感路径，应触发确认
        let result = check_write_path("/etc/test_ghostterm.conf").unwrap();
        assert!(result.needs_confirmation);
        assert!(result.reason.is_some());
    }

    #[test]
    fn test_sensitive_prefix_usr() {
        let result = check_write_path("/usr/local/test").unwrap();
        assert!(result.needs_confirmation);
    }

    #[test]
    fn test_sensitive_prefix_bin() {
        let result = check_write_path("/bin/test").unwrap();
        assert!(result.needs_confirmation);
    }

    #[test]
    fn test_sensitive_prefix_system_macos() {
        // macOS /System 目录
        let result = check_write_path("/System/Library/test").unwrap();
        assert!(result.needs_confirmation);
    }

    #[test]
    fn test_symlink_resolves_to_real_path() {
        // 创建临时文件和软链接，验证 symlink 被解析到真实路径
        let dir = tempdir().unwrap();
        let real_file = dir.path().join("real.txt");
        let link_file = dir.path().join("link.txt");
        fs::write(&real_file, "content").unwrap();

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&real_file, &link_file).unwrap();
            let result = check_write_path(link_file.to_str().unwrap()).unwrap();
            // canonical 路径应指向真实文件
            assert!(result.canonical_path.contains("real.txt"));
        }
    }
}

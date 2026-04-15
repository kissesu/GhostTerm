// @file: project_manager/persistence.rs
// @description: 项目列表持久化 - 序列化/反序列化 projects.json，
//               文件损坏时备份为 .corrupt.{timestamp} 并返回空列表，
//               确保任何情况下都能正常启动而不丢失用户配置
// @author: Atlas.oi
// @date: 2026-04-13

use std::path::Path;
use crate::types::ProjectInfo;

fn sanitize_projects(projects: Vec<ProjectInfo>) -> Vec<ProjectInfo> {
    let mut seen_paths = std::collections::HashSet::new();

    projects
        .into_iter()
        .filter(|project| {
            let path = Path::new(&project.path);
            path.exists() && path.is_dir()
        })
        .filter(|project| seen_paths.insert(project.path.clone()))
        .collect()
}

/// 从文件加载项目列表
///
/// 业务逻辑：
/// 1. 文件不存在 → 返回空列表（首次启动正常情况）
/// 2. 文件存在但读取/解析失败 → 备份损坏文件，返回空列表
/// 3. 文件正常 → 返回解析后的项目列表
pub fn load_projects(path: &Path) -> Vec<ProjectInfo> {
    if !path.exists() {
        // 首次启动，文件不存在属于正常情况
        return Vec::new();
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            // 文件读取失败（权限问题等），备份并返回空列表
            eprintln!("[project_manager] 读取 projects.json 失败: {e}");
            backup_corrupt_file(path);
            return Vec::new();
        }
    };

    match serde_json::from_str::<Vec<ProjectInfo>>(&content) {
        Ok(projects) => sanitize_projects(projects),
        Err(e) => {
            // JSON 解析失败，备份损坏文件并返回空列表
            eprintln!("[project_manager] 解析 projects.json 失败: {e}");
            backup_corrupt_file(path);
            Vec::new()
        }
    }
}

/// 将项目列表保存到文件
///
/// 业务逻辑：
/// 1. 确保父目录存在（首次保存时创建 ~/.config/ghostterm/）
/// 2. 序列化为格式化 JSON（方便手动查看和编辑）
/// 3. 原子写入（避免写入中途崩溃导致文件损坏）
pub fn save_projects(path: &Path, projects: &[ProjectInfo]) -> Result<(), String> {
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {e}"))?;
    }

    let content = serde_json::to_string_pretty(projects)
        .map_err(|e| format!("序列化项目列表失败: {e}"))?;

    std::fs::write(path, content)
        .map_err(|e| format!("写入 projects.json 失败: {e}"))
}

/// 将损坏的文件备份为 .corrupt.{timestamp}
///
/// 备份文件名格式：projects.json.corrupt.1713024000000
/// 使用 Unix 时间戳毫秒保证唯一性，便于用户查找和恢复
fn backup_corrupt_file(path: &Path) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let backup_path = path.with_extension(format!("json.corrupt.{timestamp}"));

    if let Err(e) = std::fs::rename(path, &backup_path) {
        eprintln!("[project_manager] 备份损坏文件失败: {e}");
    } else {
        eprintln!(
            "[project_manager] 已将损坏文件备份至: {}",
            backup_path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn make_temp_dir() -> TempDir {
        tempfile::tempdir().expect("创建临时目录失败")
    }

    fn sample_projects(tmp: &TempDir) -> Vec<ProjectInfo> {
        let ghostterm = tmp.path().join("ghostterm");
        let my_app = tmp.path().join("my-app");
        std::fs::create_dir_all(&ghostterm).unwrap();
        std::fs::create_dir_all(&my_app).unwrap();

        vec![
            ProjectInfo {
                name: "ghostterm".to_string(),
                path: ghostterm.to_string_lossy().to_string(),
                last_opened: 1713024000000,
            },
            ProjectInfo {
                name: "my-app".to_string(),
                path: my_app.to_string_lossy().to_string(),
                last_opened: 1713020000000,
            },
        ]
    }

    #[test]
    fn test_load_projects_file_not_exists() {
        // 文件不存在时应返回空列表
        let tmp = make_temp_dir();
        let path = tmp.path().join("projects.json");
        let result = load_projects(&path);
        assert!(result.is_empty(), "文件不存在时应返回空列表");
    }

    #[test]
    fn test_load_projects_empty_array() {
        // 空 JSON 数组应正确解析
        let tmp = make_temp_dir();
        let path = tmp.path().join("projects.json");
        std::fs::write(&path, "[]").unwrap();

        let result = load_projects(&path);
        assert!(result.is_empty(), "空 JSON 数组应返回空列表");
    }

    #[test]
    fn test_load_and_save_roundtrip() {
        // 序列化后再反序列化应得到相同数据
        let tmp = make_temp_dir();
        let path = tmp.path().join("projects.json");
        let projects = sample_projects(&tmp);

        save_projects(&path, &projects).expect("保存失败");
        let loaded = load_projects(&path);

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].name, "ghostterm");
        assert_eq!(loaded[0].path, projects[0].path);
        assert_eq!(loaded[0].last_opened, 1713024000000);
        assert_eq!(loaded[1].name, "my-app");
    }

    #[test]
    fn test_load_projects_corrupt_file_backed_up() {
        // 损坏文件应备份为 .corrupt.{timestamp} 并返回空列表
        let tmp = make_temp_dir();
        let path = tmp.path().join("projects.json");

        // 写入损坏的 JSON
        let mut f = std::fs::File::create(&path).unwrap();
        writeln!(f, "{{not valid json}}").unwrap();
        drop(f);

        let result = load_projects(&path);

        // 返回空列表
        assert!(result.is_empty(), "损坏文件应返回空列表");

        // 原文件已被移走（备份为 .corrupt.xxx）
        assert!(!path.exists(), "原损坏文件应已被移走");

        // 验证备份文件存在
        let backup_exists = std::fs::read_dir(tmp.path())
            .unwrap()
            .any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("corrupt")
            });
        assert!(backup_exists, "应存在备份文件");
    }

    #[test]
    fn test_save_creates_parent_dirs() {
        // save_projects 应自动创建父目录
        let tmp = make_temp_dir();
        let path = tmp.path().join("config").join("ghostterm").join("projects.json");

        let projects = sample_projects(&tmp);
        save_projects(&path, &projects).expect("保存失败");

        assert!(path.exists(), "文件应已被创建");
        let loaded = load_projects(&path);
        assert_eq!(loaded.len(), 2);
    }

    #[test]
    fn test_load_projects_filters_missing_and_duplicate_paths() {
        let tmp = make_temp_dir();
        let valid_project = tmp.path().join("ghostterm");
        std::fs::create_dir_all(&valid_project).unwrap();

        let path = tmp.path().join("projects.json");
        let content = format!(
            r#"[
  {{
    "name": "ghostterm",
    "path": "{}",
    "last_opened": 1713024000000
  }},
  {{
    "name": "ghostterm-duplicate",
    "path": "{}",
    "last_opened": 1713023000000
  }},
  {{
    "name": "missing-project",
    "path": "/definitely/missing/project",
    "last_opened": 1713022000000
  }}
]"#,
            valid_project.display(),
            valid_project.display()
        );
        std::fs::write(&path, content).unwrap();

        let loaded = load_projects(&path);

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].path, valid_project.to_string_lossy());
    }
}

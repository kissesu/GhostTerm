// @file: project_manager/session.rs
// @description: 编辑器会话持久化 - 按项目路径保存/加载上次打开的文件列表
//               存储路径：~/.config/ghostterm/editor_sessions.json
//               格式：{ "/project/path": { "open_file_paths": [...], "active_file_path": "..." } }
// @author: Atlas.oi
// @date: 2026-04-15

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};

/// 进程级文件锁，序列化 save_session 的并发 read-modify-write 操作
static SESSION_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditorSession {
    pub open_file_paths: Vec<String>,
    pub active_file_path: Option<String>,
}

pub fn load_sessions(path: &Path) -> HashMap<String, EditorSession> {
    if !path.exists() {
        return HashMap::new();
    }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => { eprintln!("[session] 读取 editor_sessions.json 失败: {e}"); return HashMap::new(); }
    };
    match serde_json::from_str::<HashMap<String, EditorSession>>(&content) {
        Ok(sessions) => sessions,
        Err(e) => {
            eprintln!("[session] 解析 editor_sessions.json 失败: {e}");
            let backup = path.with_extension("json.corrupt");
            let _ = std::fs::rename(path, backup);
            HashMap::new()
        }
    }
}

pub fn save_sessions(path: &Path, sessions: &HashMap<String, EditorSession>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(sessions).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("写入失败: {e}"))
}

pub fn get_session(path: &Path, project_path: &str) -> EditorSession {
    load_sessions(path).get(project_path).cloned().unwrap_or_default()
}

pub fn save_session(path: &Path, project_path: &str, session: EditorSession) -> Result<(), String> {
    let lock = SESSION_FILE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().map_err(|_| "会话文件锁中毒".to_string())?;
    let mut sessions = load_sessions(path);
    sessions.insert(project_path.to_string(), session);
    save_sessions(path, &sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_path(tmp: &TempDir) -> std::path::PathBuf {
        tmp.path().join("editor_sessions.json")
    }

    #[test]
    fn test_load_sessions_file_not_exists() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load_sessions(&make_path(&tmp)).is_empty());
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = make_path(&tmp);
        let session = EditorSession {
            open_file_paths: vec!["src/main.ts".into(), "src/index.ts".into()],
            active_file_path: Some("src/main.ts".into()),
        };
        save_session(&path, "/my/project", session.clone()).unwrap();
        let loaded = get_session(&path, "/my/project");
        assert_eq!(loaded.open_file_paths, session.open_file_paths);
        assert_eq!(loaded.active_file_path, session.active_file_path);
    }

    #[test]
    fn test_save_session_does_not_affect_other_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let path = make_path(&tmp);
        save_session(&path, "/proj-a", EditorSession { open_file_paths: vec!["a.ts".into()], active_file_path: None }).unwrap();
        save_session(&path, "/proj-b", EditorSession { open_file_paths: vec!["b.ts".into()], active_file_path: Some("b.ts".into()) }).unwrap();
        let sessions = load_sessions(&path);
        assert_eq!(sessions.len(), 2);
        assert!(sessions.contains_key("/proj-a"));
        assert!(sessions.contains_key("/proj-b"));
    }
}

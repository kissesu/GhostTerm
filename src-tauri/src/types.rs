// @file: types.rs
// @description: 跨模块共享类型定义 - 定义前后端通信的数据结构，
//               所有类型实现 Serialize + Deserialize 以支持 Tauri Commands 传输
// @author: Atlas.oi
// @date: 2026-04-12

use serde::{Deserialize, Serialize};

/// 文件系统条目 - 代表目录列表中的单个文件或目录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// 文件/目录名称（不含路径）
    pub name: String,
    /// 完整绝对路径
    pub path: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 文件大小（字节），目录为 None
    pub size: Option<u64>,
    /// 最后修改时间（Unix 时间戳毫秒）
    pub modified: Option<u64>,
}

/// 文件树节点 - 用于构建前端文件树，支持懒加载（children 为 None 表示未展开）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub entry: FileEntry,
    /// 子节点列表，None 表示目录未展开，Some([]) 表示空目录
    pub children: Option<Vec<FileNode>>,
}

/// Git 状态条目 - 代表工作区中单个文件的 Git 状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEntry {
    /// 文件相对路径
    pub path: String,
    /// 已暂存状态（M=修改, A=新增, D=删除, R=重命名, ?=未跟踪）
    pub staged: Option<String>,
    /// 未暂存状态
    pub unstaged: Option<String>,
}

/// Git Worktree 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    /// Worktree 绝对路径
    pub path: String,
    /// 关联分支名（detached HEAD 时为 None）
    pub branch: Option<String>,
    /// 是否为当前活动 worktree
    pub is_current: bool,
}

/// 项目基本信息 - 用于项目列表展示
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    /// 项目名称（取自目录名）
    pub name: String,
    /// 项目根目录绝对路径
    pub path: String,
    /// 最近打开时间（Unix 时间戳毫秒），用于排序
    pub last_opened: u64,
}

/// 完整项目状态 - 包含运行时状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub info: ProjectInfo,
    /// 当前活动的 worktree 路径（未使用 worktree 时等于 info.path）
    pub active_path: String,
}

/// 文件读取结果 - 判别联合类型，区分不同的文件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ReadFileResult {
    /// 正常 UTF-8 文本文件
    #[serde(rename = "text")]
    Text { content: String },
    /// 二进制文件（图片、可执行文件等）
    #[serde(rename = "binary")]
    Binary {
        /// MIME 类型提示，如 "image/png"
        mime_hint: String,
    },
    /// 大文件（超过阈值，如 5MB），以只读模式提示
    #[serde(rename = "large")]
    Large { size: u64 },
    /// 读取错误（权限不足、非 UTF-8 编码等）
    #[serde(rename = "error")]
    Error { message: String },
}

/// 文件系统事件 - Rust watcher 推送给前端的增量更新事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FsEvent {
    #[serde(rename = "created")]
    Created { path: String },
    #[serde(rename = "modified")]
    Modified { path: String },
    #[serde(rename = "deleted")]
    Deleted { path: String },
    #[serde(rename = "renamed")]
    Renamed { old_path: String, new_path: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_file_result_serialization() {
        // 验证判别联合类型正确序列化为带 kind 字段的 JSON
        let text = ReadFileResult::Text {
            content: "hello".to_string(),
        };
        let json = serde_json::to_string(&text).unwrap();
        assert!(json.contains("\"kind\":\"text\""));
        assert!(json.contains("\"content\":\"hello\""));

        let binary = ReadFileResult::Binary {
            mime_hint: "image/png".to_string(),
        };
        let json = serde_json::to_string(&binary).unwrap();
        assert!(json.contains("\"kind\":\"binary\""));
    }

    #[test]
    fn test_fs_event_serialization() {
        let event = FsEvent::Created {
            path: "/tmp/test.txt".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"created\""));
    }
}

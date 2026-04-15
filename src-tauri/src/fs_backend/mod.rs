// @file: fs_backend/mod.rs
// @description: 文件系统后端 - 提供文件读写、目录列表、创建/删除/重命名操作
//               以及基于 notify 的实时文件监听功能
// @author: Atlas.oi
// @date: 2026-04-13

pub mod watcher;
pub mod security;

// 导出 watcher 的 Tauri Commands，供 lib.rs 注册
pub use watcher::{start_watching_cmd, stop_watching_cmd};

use crate::types::{FileEntry, ReadFileResult};
use security::check_write_path;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

// 大文件阈值：5MB，超过此大小不读取内容，返回 large 类型
// 避免一次性加载超大文件导致内存压力
const LARGE_FILE_THRESHOLD: u64 = 5 * 1024 * 1024;

/// 读取文件内容，返回判别联合类型
///
/// 业务逻辑：
/// 1. 检查文件大小，超过 5MB 返回 Large 类型
/// 2. 检测文件是否为二进制（通过 infer 魔数识别）
/// 3. 尝试 UTF-8 解码文本内容
/// 4. 若非 UTF-8，用 chardetng 检测编码，返回带编码名的错误信息
pub fn read_file(path: &str) -> ReadFileResult {
    let p = Path::new(path);

    // 读取文件元数据，错误时返回 error 类型
    let metadata = match fs::metadata(p) {
        Ok(m) => m,
        Err(e) => {
            return ReadFileResult::Error {
                message: format!("无法读取文件 {}: {}", path, e),
            }
        }
    };

    // 第一步：检查文件大小
    let size = metadata.len();
    if size > LARGE_FILE_THRESHOLD {
        return ReadFileResult::Large { size };
    }

    // 第二步：读取原始字节
    let bytes = match fs::read(p) {
        Ok(b) => b,
        Err(e) => {
            return ReadFileResult::Error {
                message: format!("读取文件失败 {}: {}", path, e),
            }
        }
    };

    // 第三步：检测是否为二进制文件（通过 MIME 魔数）
    // infer 同时覆盖二进制（image/png、application/pdf 等）和文本（text/html、text/xml）两类格式。
    // GhostTerm 的 Binary 语义 = "用户无法在编辑器中编辑的文件"；
    // text/* 类型（HTML/XML/SVG 等）的内容仍是可读 UTF-8 文本，应进入普通文本编辑路径。
    if let Some(kind) = infer::get(&bytes) {
        if !kind.mime_type().starts_with("text/") {
            return ReadFileResult::Binary {
                mime_hint: kind.mime_type().to_string(),
            };
        }
        // text/* 类型：跳过 Binary 判断，继续走 UTF-8 解码流程
    }

    // 第四步：尝试 UTF-8 解码
    match String::from_utf8(bytes.clone()) {
        Ok(content) => ReadFileResult::Text { content },
        Err(_) => {
            // UTF-8 解码失败，使用 chardetng 检测实际编码
            // 让用户知道具体编码，决定是否用外部工具转换
            let encoding_name = detect_encoding(&bytes);
            ReadFileResult::Error {
                message: format!(
                    "Detected encoding: {}. File cannot be opened as UTF-8.",
                    encoding_name
                ),
            }
        }
    }
}

/// 用 chardetng 检测字节序列的字符编码
/// 返回编码名称字符串，如 "GBK"、"UTF-16"、"ISO-8859-1" 等
fn detect_encoding(bytes: &[u8]) -> String {
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    let encoding = det.guess(None, true);
    encoding.name().to_string()
}

/// 写入文件内容
///
/// 业务逻辑：
/// 1. 调用 security.rs 检查路径安全性（敏感路径返回需确认标记）
/// 2. 若父目录不存在，自动递归创建
/// 3. 写入内容
///
/// 注意：此函数不处理 needs_confirmation 逻辑（由 Tauri Command 层负责）
/// 但对权限不足等系统错误会正常返回 Err
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    // 路径安全检查 - 获取 canonical 路径
    let check = check_write_path(path)?;

    // 使用 canonical 路径写入（或原始路径，若 canonical 失败）
    let target_path = if check.canonical_path != path {
        check.canonical_path.clone()
    } else {
        path.to_string()
    };

    let p = Path::new(&target_path);

    // 父目录不存在时自动创建
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {:?}: {}", parent, e))?;
        }
    }

    fs::write(p, content.as_bytes())
        .map_err(|e| format!("写入文件失败 {}: {}", target_path, e))
}

/// 判断目录项是否为隐藏文件
///
/// Unix/macOS：文件名以 . 开头即为隐藏
/// Windows：通过 FILE_ATTRIBUTE_HIDDEN (0x2) 文件属性判断，不依赖文件名前缀
#[cfg(target_os = "windows")]
fn is_hidden_entry(entry: &std::fs::DirEntry, _name: &str) -> bool {
    use std::os::windows::fs::MetadataExt;
    // FILE_ATTRIBUTE_HIDDEN = 0x00000002
    entry.metadata()
        .map(|m| m.file_attributes() & 0x2 != 0)
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn is_hidden_entry(_entry: &std::fs::DirEntry, name: &str) -> bool {
    name.starts_with('.')
}

/// 列出目录内容
///
/// 业务逻辑：
/// 1. 读取目录项
/// 2. 根据 show_hidden 过滤隐藏文件（Unix: . 前缀；Windows: HIDDEN 属性）
/// 3. 排序：目录在前，文件在后，各自按名称字母顺序排序
pub fn list_dir(path: &str, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let p = Path::new(path);

    let read_dir = fs::read_dir(p)
        .map_err(|e| format!("无法读取目录 {}: {}", path, e))?;

    let mut entries: Vec<FileEntry> = Vec::new();

    for entry_result in read_dir {
        let entry = entry_result
            .map_err(|e| format!("读取目录项失败: {}", e))?;

        let name = entry.file_name().to_string_lossy().to_string();

        // 过滤隐藏文件：Unix/macOS 用 . 前缀；Windows 用 FILE_ATTRIBUTE_HIDDEN 文件属性
        if !show_hidden && is_hidden_entry(&entry, &name) {
            continue;
        }

        let entry_path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // 无法读取元数据时跳过该项
        };

        let is_dir = metadata.is_dir();
        let size = if is_dir { None } else { Some(metadata.len()) };

        // 获取最后修改时间（Unix 毫秒）
        let modified = metadata.modified().ok().and_then(|t| {
            t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
        });

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            size,
            modified,
        });
    }

    // 排序：目录在前，文件在后；同类型按名称升序
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// 创建文件或目录
///
/// is_dir=true 时递归创建目录（mkdir -p）
/// is_dir=false 时创建空文件（若父目录不存在则先创建）
pub fn create_entry(path: &str, is_dir: bool) -> Result<(), String> {
    let p = Path::new(path);

    if p.exists() {
        return Err(format!("路径已存在: {}", path));
    }

    if is_dir {
        fs::create_dir_all(p)
            .map_err(|e| format!("创建目录失败 {}: {}", path, e))
    } else {
        // 确保父目录存在
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败 {:?}: {}", parent, e))?;
            }
        }
        // 创建空文件
        fs::File::create(p)
            .map(|_| ())
            .map_err(|e| format!("创建文件失败 {}: {}", path, e))
    }
}

/// 删除文件或目录
///
/// 目录递归删除（rm -rf），文件直接删除
pub fn delete_entry(path: &str) -> Result<(), String> {
    let p = Path::new(path);

    if !p.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    if p.is_dir() {
        fs::remove_dir_all(p)
            .map_err(|e| format!("删除目录失败 {}: {}", path, e))
    } else {
        fs::remove_file(p)
            .map_err(|e| format!("删除文件失败 {}: {}", path, e))
    }
}

/// 重命名/移动文件或目录
///
/// 使用 fs::rename，在同一文件系统内为原子操作
/// 跨文件系统时 OS 会返回错误（此场景由调用方处理）
pub fn rename_entry(old_path: &str, new_path: &str) -> Result<(), String> {
    let old = Path::new(old_path);
    let new = Path::new(new_path);

    if !old.exists() {
        return Err(format!("源路径不存在: {}", old_path));
    }

    if new.exists() {
        return Err(format!("目标路径已存在: {}", new_path));
    }

    // 确保目标父目录存在
    if let Some(parent) = new.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目标父目录失败 {:?}: {}", parent, e))?;
        }
    }

    fs::rename(old, new)
        .map_err(|e| format!("重命名失败 {} -> {}: {}", old_path, new_path, e))
}

// ============================================
// Tauri Command 封装层
// 将内部函数包装为 Tauri Command，处理类型转换
// lib.rs 合并时在 invoke_handler 注册这些命令
// ============================================

/// Tauri Command: 读取文件
#[tauri::command]
pub fn read_file_cmd(path: String) -> ReadFileResult {
    read_file(&path)
}

/// Tauri Command: 写入文件
#[tauri::command]
pub fn write_file_cmd(path: String, content: String) -> Result<(), String> {
    write_file(&path, &content)
}

/// Tauri Command: 列出目录
#[tauri::command]
pub fn list_dir_cmd(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    list_dir(&path, show_hidden)
}

/// Tauri Command: 创建文件或目录
#[tauri::command]
pub fn create_entry_cmd(path: String, is_dir: bool) -> Result<(), String> {
    create_entry(&path, is_dir)
}

/// Tauri Command: 删除文件或目录
#[tauri::command]
pub fn delete_entry_cmd(path: String) -> Result<(), String> {
    delete_entry(&path)
}

/// Tauri Command: 重命名文件或目录
#[tauri::command]
pub fn rename_entry_cmd(old_path: String, new_path: String) -> Result<(), String> {
    rename_entry(&old_path, &new_path)
}

/// Tauri Command: 读取文件原始字节并返回 Base64 编码字符串
///
/// 专用于前端图片预览：前端拼接 `data:<mimeHint>;base64,<返回值>` 作为 <img> src
/// 不走 read_file 流程，直接读取字节避免 UTF-8 解码尝试
#[tauri::command]
pub fn read_image_bytes_cmd(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    let bytes = fs::read(&path).map_err(|e| format!("读取图片失败 {}: {}", path, e))?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // ==================== read_file 测试 ====================

    #[test]
    fn test_read_file_text() {
        // text 文件应返回 kind='text' + content
        let dir = tempdir().unwrap();
        let file = dir.path().join("hello.txt");
        fs::write(&file, "hello world").unwrap();

        let result = read_file(file.to_str().unwrap());
        match result {
            ReadFileResult::Text { content } => {
                assert_eq!(content, "hello world");
            }
            other => panic!("期望 Text，得到 {:?}", other),
        }
    }

    #[test]
    fn test_read_file_binary_png() {
        // 写入 PNG 魔数字节，应返回 kind='binary' + mime_hint
        let dir = tempdir().unwrap();
        let file = dir.path().join("image.png");
        // PNG 文件魔数: 89 50 4E 47 0D 0A 1A 0A
        let png_magic: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                                  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52];
        fs::write(&file, png_magic).unwrap();

        let result = read_file(file.to_str().unwrap());
        match result {
            ReadFileResult::Binary { mime_hint } => {
                assert_eq!(mime_hint, "image/png");
            }
            other => panic!("期望 Binary，得到 {:?}", other),
        }
    }

    #[test]
    fn test_read_file_large() {
        // 大文件（> 5MB）应返回 kind='large' + size
        let dir = tempdir().unwrap();
        let file = dir.path().join("large.txt");
        // 创建 6MB 文件
        let data = vec![b'a'; 6 * 1024 * 1024];
        fs::write(&file, &data).unwrap();

        let result = read_file(file.to_str().unwrap());
        match result {
            ReadFileResult::Large { size } => {
                assert!(size > 5 * 1024 * 1024);
            }
            other => panic!("期望 Large，得到 {:?}", other),
        }
    }

    #[test]
    fn test_read_file_permission_error() {
        // 不存在的文件应返回 kind='error'
        let result = read_file("/nonexistent/path/file.txt");
        match result {
            ReadFileResult::Error { message } => {
                assert!(!message.is_empty());
            }
            other => panic!("期望 Error，得到 {:?}", other),
        }
    }

    #[test]
    fn test_read_file_non_utf8_encoding() {
        // GBK 编码文件（含中文的非 UTF-8 文件）应返回 kind='error' + 编码提示
        let dir = tempdir().unwrap();
        let file = dir.path().join("gbk.txt");
        // GBK 编码的 "你好"（非 UTF-8 字节序列）
        let gbk_bytes: &[u8] = &[0xC4, 0xE3, 0xBA, 0xC3]; // GBK "你好"
        fs::write(&file, gbk_bytes).unwrap();

        let result = read_file(file.to_str().unwrap());
        match result {
            ReadFileResult::Error { message } => {
                // 消息应包含 "Detected encoding:" 前缀
                assert!(
                    message.contains("Detected encoding:"),
                    "期望错误消息包含编码信息，实际: {}",
                    message
                );
                assert!(
                    message.contains("File cannot be opened as UTF-8"),
                    "期望错误消息包含 UTF-8 提示，实际: {}",
                    message
                );
            }
            other => panic!("期望 Error，得到 {:?}", other),
        }
    }

    // ==================== write_file 测试 ====================

    #[test]
    fn test_write_file_and_read_back() {
        // 写入内容后读回应一致
        let dir = tempdir().unwrap();
        let file = dir.path().join("output.txt");
        let content = "测试内容\nline2";

        write_file(file.to_str().unwrap(), content).unwrap();

        let read_back = fs::read_to_string(&file).unwrap();
        assert_eq!(read_back, content);
    }

    #[test]
    fn test_write_file_creates_parent_dir() {
        // 父目录不存在时应自动创建
        let dir = tempdir().unwrap();
        let nested = dir.path().join("a").join("b").join("c.txt");

        write_file(nested.to_str().unwrap(), "content").unwrap();
        assert!(nested.exists());
    }

    #[test]
    fn test_write_file_sensitive_path_returns_confirmation_needed() {
        // 敏感路径写操作 - check_write_path 返回 needs_confirmation=true
        // write_file 本身不阻止写入（调用层负责确认），但路径检查会成功返回
        // 注意：在非 root 环境下实际写入 /etc 会失败，但路径检查逻辑是独立的
        let result = security::check_write_path("/etc/ghostterm_test.conf");
        let check = result.unwrap();
        assert!(check.needs_confirmation);
        assert!(check.reason.is_some());
    }

    // ==================== list_dir 测试 ====================

    #[test]
    fn test_list_dir_basic() {
        // 应返回目录内容
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("b.txt"), "").unwrap();
        fs::write(dir.path().join("a.txt"), "").unwrap();
        fs::create_dir(dir.path().join("z_dir")).unwrap();

        let entries = list_dir(dir.path().to_str().unwrap(), false).unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn test_list_dir_sorted_dirs_first() {
        // 目录在前，文件在后，各自按名称排序
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("z_file.txt"), "").unwrap();
        fs::write(dir.path().join("a_file.txt"), "").unwrap();
        fs::create_dir(dir.path().join("m_dir")).unwrap();
        fs::create_dir(dir.path().join("a_dir")).unwrap();

        let entries = list_dir(dir.path().to_str().unwrap(), false).unwrap();
        assert_eq!(entries.len(), 4);
        // 前两项应为目录，且按名称排序
        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert_eq!(entries[0].name, "a_dir");
        assert_eq!(entries[1].name, "m_dir");
        // 后两项为文件，按名称排序
        assert!(!entries[2].is_dir);
        assert_eq!(entries[2].name, "a_file.txt");
        assert_eq!(entries[3].name, "z_file.txt");
    }

    #[test]
    fn test_list_dir_hidden_files_excluded_by_default() {
        // 默认不显示 . 开头的隐藏文件
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("visible.txt"), "").unwrap();
        fs::write(dir.path().join(".hidden"), "").unwrap();

        let entries = list_dir(dir.path().to_str().unwrap(), false).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "visible.txt");
    }

    #[test]
    fn test_list_dir_show_hidden() {
        // show_hidden=true 时显示隐藏文件
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("visible.txt"), "").unwrap();
        fs::write(dir.path().join(".hidden"), "").unwrap();

        let entries = list_dir(dir.path().to_str().unwrap(), true).unwrap();
        assert_eq!(entries.len(), 2);
    }

    // ==================== create/delete/rename 测试 ====================

    #[test]
    fn test_create_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("new.txt");
        create_entry(file.to_str().unwrap(), false).unwrap();
        assert!(file.exists());
        assert!(file.is_file());
    }

    #[test]
    fn test_create_directory() {
        let dir = tempdir().unwrap();
        let new_dir = dir.path().join("sub").join("deep");
        create_entry(new_dir.to_str().unwrap(), true).unwrap();
        assert!(new_dir.exists());
        assert!(new_dir.is_dir());
    }

    #[test]
    fn test_create_entry_already_exists() {
        // 路径已存在应返回错误
        let dir = tempdir().unwrap();
        let file = dir.path().join("exists.txt");
        fs::write(&file, "").unwrap();
        let result = create_entry(file.to_str().unwrap(), false);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("del.txt");
        fs::write(&file, "content").unwrap();
        delete_entry(file.to_str().unwrap()).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn test_delete_directory() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("file.txt"), "").unwrap();
        // 递归删除
        delete_entry(sub.to_str().unwrap()).unwrap();
        assert!(!sub.exists());
    }

    #[test]
    fn test_rename_file() {
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.txt");
        let new = dir.path().join("new.txt");
        fs::write(&old, "data").unwrap();

        rename_entry(old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        assert!(!old.exists());
        assert!(new.exists());
        assert_eq!(fs::read_to_string(&new).unwrap(), "data");
    }

    #[test]
    fn test_rename_updates_path() {
        // 重命名后新路径存在，旧路径不存在
        let dir = tempdir().unwrap();
        let old = dir.path().join("original.txt");
        let new = dir.path().join("renamed.txt");
        fs::write(&old, "hello").unwrap();

        rename_entry(old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        assert!(!old.exists(), "旧路径应不再存在");
        assert!(new.exists(), "新路径应存在");
    }

    #[test]
    fn test_rename_nonexistent_source_fails() {
        let dir = tempdir().unwrap();
        let old = dir.path().join("ghost.txt");
        let new = dir.path().join("target.txt");
        let result = rename_entry(old.to_str().unwrap(), new.to_str().unwrap());
        assert!(result.is_err());
    }
}

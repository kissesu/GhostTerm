// @file: backup_cmd.rs
// @description: 修复前自动备份 + 30 天滚动清理
//               原文件路径经 SHA-256 哈希前 12 位映射到备份子目录，避免路径冲突。
//               备份文件命名：v{n}_{ISO8601}.docx，首次备份生成 meta.json 记录溯源信息。
// @author: Atlas.oi
// @date: 2026-04-18

use chrono::Utc;
use filetime::FileTime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

// 备份保留天数 — 超过此阈值的快照将在启动时自动清理
const BACKUP_RETENTION_DAYS: u64 = 30;

// ============================================
// 进程级文件锁：防止 backup_before_fix 并发调用时
// "读取 max version → 写入 v{n}" 非原子导致 v{n} 重号覆盖
// 参照 project_manager/session.rs 的 OnceLock<Mutex<()>> 模式
// ============================================
static BACKUP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

// ============================================
// 公开数据结构
// ============================================

/// 单个快照的元信息，用于前端列表展示
#[derive(Debug, Serialize, Deserialize)]
pub struct SnapshotInfo {
    /// 快照序号（从 0 开始，每次备份递增）
    pub version: u32,
    /// 快照文件的绝对路径
    pub path: PathBuf,
    /// 快照文件的修改时间（Unix 时间戳，秒）
    pub mtime: u64,
}

/// meta.json 的结构，记录备份目录与原始文件的对应关系
#[derive(Serialize, Deserialize)]
struct BackupMeta {
    /// 原始文件绝对路径
    origin_path: String,
    /// 首次备份时间（ISO 8601）
    first_backed_at: String,
}

// ============================================
// 内部工具函数
// ============================================

/// 计算原文件路径的 SHA-256 哈希前 12 位，用作备份子目录名
/// 避免不同文件映射到同一目录（路径冲突）
fn hash_origin(origin: &Path) -> String {
    let mut h = Sha256::new();
    h.update(origin.to_string_lossy().as_bytes());
    let hex = format!("{:x}", h.finalize());
    hex[..12].to_string()
}

/// 获取指定 origin 文件的备份子目录路径
fn backup_root(bak_dir: &Path, origin: &Path) -> PathBuf {
    bak_dir.join(hash_origin(origin))
}

/// 获取 ghostterm 配置目录（~/.config/ghostterm）
/// 保留 _app 参数为将来切换到 app.path().app_config_dir() 做准备
pub fn ghostterm_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    dirs::config_dir()
        .ok_or_else(|| "无法获取系统配置目录".to_string())
        .map(|d| d.join("ghostterm"))
}

/// 从备份子目录中解析所有已有快照，按 version 升序排列
fn parse_snapshots(dir: &Path) -> Vec<SnapshotInfo> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    // metadata stat 失败的 entry 直接跳过 — 不可降级为 mtime=0
    // 否则 cleanup 会把"读不到 mtime 的快照"当作 1970 年文件立即删除
    // （与 cleanup_old_backups 内层 metadata Err 时 continue 的行为保持一致）
    let mut snapshots: Vec<SnapshotInfo> = Vec::new();
    for e in entries.filter_map(|e| e.ok()) {
        let fname = e.file_name();
        let name = fname.to_string_lossy();
        // 只处理 v{n}_*.docx 格式的文件
        if !name.starts_with('v') || !name.ends_with(".docx") {
            continue;
        }
        // 解析 version 号（v 与第一个 _ 之间的数字）
        let Some(version_str) = name.strip_prefix('v').and_then(|s| s.split('_').next()) else {
            continue;
        };
        let Ok(version) = version_str.parse::<u32>() else {
            continue;
        };

        let path = e.path();
        // 关键：metadata 失败时跳过该 entry，不可 fallback 0
        let modified = match e.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        // duration_since 仅在系统时钟早于 epoch 时 Err，此为真实"无效 mtime"
        // 此时退化为 0 是符合语义的（极端异常场景，非降级）
        let mtime = modified
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        snapshots.push(SnapshotInfo { version, path, mtime });
    }

    // 按 version 升序排列，保证 list 结果一致
    snapshots.sort_by_key(|s| s.version);
    snapshots
}

// ============================================
// 核心公开函数（供测试和 Tauri Command 调用）
// ============================================

/// 在修复操作前备份原文件
///
/// 业务逻辑：
/// 1. 计算备份子目录路径（hash(origin) 前 12 位）
/// 2. 目录不存在时创建，并写入 meta.json（首次才写）
/// 3. 查找现有最大 version，新快照 version = max + 1（首次为 0）
/// 4. 复制原文件到 v{n}_{ISO8601}.docx
///
/// 返回新建快照的绝对路径
pub fn backup_before_fix(origin: &Path, bak_dir: PathBuf) -> Result<PathBuf, String> {
    // ============================================
    // 第零步：进程级文件锁 — 串行化 read-modify-write 防 v{n} 重号
    // 锁覆盖整个备份流程（mkdir → meta → 计算 version → copy）
    // 直至函数返回时 _guard drop 自动释放
    // ============================================
    let lock = BACKUP_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().map_err(|_| "备份锁中毒".to_string())?;

    // ============================================
    // 第一步：确保备份子目录存在
    // ============================================
    let root = backup_root(&bak_dir, origin);
    fs::create_dir_all(&root).map_err(|e| format!("创建备份目录失败: {e}"))?;

    // ============================================
    // 第二步：首次备份时写入 meta.json，记录原始路径和时间
    // ============================================
    let meta_path = root.join("meta.json");
    if !meta_path.exists() {
        let meta = BackupMeta {
            origin_path: origin.to_string_lossy().into_owned(),
            first_backed_at: Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        };
        let json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("meta.json 序列化失败: {e}"))?;
        fs::write(&meta_path, json).map_err(|e| format!("写入 meta.json 失败: {e}"))?;
    }

    // ============================================
    // 第三步：计算新的 version 号
    // 现有快照中最大 version + 1；无快照则从 0 开始
    // ============================================
    let existing = parse_snapshots(&root);
    let next_version = existing.last().map(|s| s.version + 1).unwrap_or(0);

    // ============================================
    // 第四步：构造快照文件名并复制原文件
    // 文件名格式：v{n}_{ISO8601}.docx（连字符替换冒号，兼容 Windows 文件系统）
    // ============================================
    let ts = Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let snap_name = format!("v{next_version}_{ts}.docx");
    let snap_path = root.join(&snap_name);

    fs::copy(origin, &snap_path).map_err(|e| format!("备份文件复制失败: {e}"))?;

    Ok(snap_path)
}

/// 列出指定原文件的所有历史快照（按 version 升序）
pub fn list_snapshots(origin: &Path, bak_dir: &Path) -> Result<Vec<SnapshotInfo>, String> {
    let root = backup_root(bak_dir, origin);
    Ok(parse_snapshots(&root))
}

/// 将原文件恢复至指定 version 的快照内容
///
/// 失败条件：version 不存在时返回 Err
pub fn restore_from_snapshot(origin: &Path, bak_dir: &Path, version: u32) -> Result<(), String> {
    let root = backup_root(bak_dir, origin);
    let snapshots = parse_snapshots(&root);

    let snap = snapshots
        .iter()
        .find(|s| s.version == version)
        .ok_or_else(|| format!("快照 v{version} 不存在"))?;

    fs::copy(&snap.path, origin)
        .map_err(|e| format!("恢复快照 v{version} 失败: {e}"))?;

    Ok(())
}

/// 清理所有 bak_dir 下 mtime 超过 30 天的快照文件
///
/// 遍历 bak_dir 的所有子目录（每个 hash 目录），删除过期的 v*.docx 文件。
/// 返回成功删除的文件数量。
pub fn cleanup_old_backups(bak_dir: &Path) -> Result<u32, String> {
    // 30 天前的时间点作为过期阈值
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(BACKUP_RETENTION_DAYS * 24 * 3600))
        .ok_or_else(|| "时间计算溢出".to_string())?;

    let Ok(hash_dirs) = fs::read_dir(bak_dir) else {
        // bak_dir 不存在时直接返回 0，不视为错误
        return Ok(0);
    };

    let mut deleted = 0u32;

    for hash_entry in hash_dirs.filter_map(|e| e.ok()) {
        if !hash_entry.path().is_dir() {
            continue;
        }

        let Ok(snap_entries) = fs::read_dir(hash_entry.path()) else {
            continue;
        };

        for snap_entry in snap_entries.filter_map(|e| e.ok()) {
            let fname = snap_entry.file_name();
            let name = fname.to_string_lossy();

            // 只处理快照文件，跳过 meta.json
            if !name.starts_with('v') || !name.ends_with(".docx") {
                continue;
            }

            let path = snap_entry.path();
            let mtime = match snap_entry.metadata().and_then(|m| m.modified()) {
                Ok(t) => t,
                Err(_) => continue,
            };

            // mtime 早于 cutoff = 过期，需删除
            // 删除失败时 stderr 日志可见，继续处理下一个文件不中断整体清理流程
            // 全局规则：禁止 silent swallow
            if mtime < cutoff {
                match fs::remove_file(&path) {
                    Ok(_) => deleted += 1,
                    Err(e) => eprintln!("[backup] cleanup 删除失败 {}: {}", path.display(), e),
                }
            }
        }
    }

    Ok(deleted)
}

// ============================================
// Tauri Commands — 前端通过 invoke 调用
// ============================================

/// 备份指定文件到 ~/.config/ghostterm/.bak/
#[tauri::command]
pub async fn backup_create_cmd(origin: String, app: tauri::AppHandle) -> Result<String, String> {
    let bak = ghostterm_dir(&app)?.join(".bak");
    backup_before_fix(Path::new(&origin), bak)
        .map(|p| p.to_string_lossy().into_owned())
}

/// 将文件恢复至指定版本的快照
#[tauri::command]
pub async fn backup_restore_cmd(
    origin: String,
    version: u32,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let bak = ghostterm_dir(&app)?.join(".bak");
    restore_from_snapshot(Path::new(&origin), &bak, version)
}

/// 列出指定文件的所有历史快照
#[tauri::command]
pub async fn backup_list_cmd(
    origin: String,
    app: tauri::AppHandle,
) -> Result<Vec<SnapshotInfo>, String> {
    let bak = ghostterm_dir(&app)?.join(".bak");
    list_snapshots(Path::new(&origin), &bak)
}

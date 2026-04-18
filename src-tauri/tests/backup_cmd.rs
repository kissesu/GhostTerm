// @file: tests/backup_cmd.rs
// @description: backup_cmd 集成测试 - 验证备份创建、版本追加、快照恢复、30天清理全链路
// @author: Atlas.oi
// @date: 2026-04-18

use ghostterm_lib::backup_cmd::{backup_before_fix, cleanup_old_backups, list_snapshots, restore_from_snapshot};
use filetime::{set_file_mtime, FileTime};
use std::fs;
use std::time::{Duration, SystemTime};
use tempfile::TempDir;

/// 创建测试用的 .docx 文件（内容任意，测试只关心字节是否被正确保存/恢复）
fn make_docx(dir: &std::path::Path, name: &str, content: &[u8]) -> std::path::PathBuf {
    let path = dir.join(name);
    fs::write(&path, content).unwrap();
    path
}

// ============================================
// 测试 1: 首次备份创建 v0
// ============================================
#[test]
fn test_backup_first_creates_v0() {
    let tmp = TempDir::new().unwrap();
    let bak_dir = tmp.path().join("bak");
    let origin = make_docx(tmp.path(), "thesis.docx", b"original content");

    let snapshot = backup_before_fix(&origin, bak_dir.clone()).unwrap();

    // 快照文件应存在
    assert!(snapshot.exists(), "v0 快照文件应被创建");
    // 文件名应以 v0_ 开头
    let fname = snapshot.file_name().unwrap().to_string_lossy();
    assert!(fname.starts_with("v0_"), "首次快照文件名应以 v0_ 开头，实际: {fname}");
    // 内容应与原文件一致
    let saved = fs::read(&snapshot).unwrap();
    assert_eq!(saved, b"original content");
}

// ============================================
// 测试 2: 再次备份追加 v1，v0 不被覆盖
// ============================================
#[test]
fn test_backup_second_appends_v1() {
    let tmp = TempDir::new().unwrap();
    let bak_dir = tmp.path().join("bak");
    let origin = make_docx(tmp.path(), "thesis.docx", b"version A");

    let v0 = backup_before_fix(&origin, bak_dir.clone()).unwrap();

    // 修改原文件内容，模拟用户编辑后再次备份
    fs::write(&origin, b"version B").unwrap();
    let v1 = backup_before_fix(&origin, bak_dir.clone()).unwrap();

    // v0 和 v1 路径不同
    assert_ne!(v0, v1, "两次备份应产生不同路径");

    // v0 内容不变
    let v0_content = fs::read(&v0).unwrap();
    assert_eq!(v0_content, b"version A", "v0 内容不应被覆盖");

    // v1 包含新内容
    let v1_content = fs::read(&v1).unwrap();
    assert_eq!(v1_content, b"version B");

    // list_snapshots 应返回 2 条，按 version 升序
    let snapshots = list_snapshots(&origin, &bak_dir).unwrap();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(snapshots[0].version, 0);
    assert_eq!(snapshots[1].version, 1);
}

// ============================================
// 测试 3: restore_from_snapshot 恢复 v0 内容
// ============================================
#[test]
fn test_restore_from_v0() {
    let tmp = TempDir::new().unwrap();
    let bak_dir = tmp.path().join("bak");
    let origin = make_docx(tmp.path(), "thesis.docx", b"original");

    // 备份 v0
    backup_before_fix(&origin, bak_dir.clone()).unwrap();

    // 修改原文件（模拟工具修改后出问题）
    fs::write(&origin, b"corrupted by tool").unwrap();

    // 恢复 v0
    restore_from_snapshot(&origin, &bak_dir, 0).unwrap();

    // 原文件应恢复为 v0 内容
    let restored = fs::read(&origin).unwrap();
    assert_eq!(restored, b"original", "恢复后原文件内容应回到 v0");
}

// ============================================
// 测试 4: cleanup_old_backups 删除 mtime > 30 天，保留 < 30 天
// ============================================
#[test]
fn test_cleanup_removes_old_keeps_recent() {
    let tmp = TempDir::new().unwrap();
    let bak_dir = tmp.path().join("bak");

    // 创建两个不同 origin 的备份（通过不同文件名触发不同 hash 子目录）
    let origin_a = make_docx(tmp.path(), "thesis_a.docx", b"aaa");
    let origin_b = make_docx(tmp.path(), "thesis_b.docx", b"bbb");

    let snap_a = backup_before_fix(&origin_a, bak_dir.clone()).unwrap();
    let snap_b = backup_before_fix(&origin_b, bak_dir.clone()).unwrap();

    // 将 snap_a 的 mtime 篡改为 31 天前（应被清理）
    let old_time = SystemTime::now() - Duration::from_secs(31 * 24 * 3600);
    set_file_mtime(&snap_a, FileTime::from_system_time(old_time)).unwrap();

    // snap_b 保留现在的 mtime（应被保留）

    let deleted_count = cleanup_old_backups(&bak_dir).unwrap();

    assert_eq!(deleted_count, 1, "应删除 1 个过期快照");
    assert!(!snap_a.exists(), "超过 30 天的快照应被删除");
    assert!(snap_b.exists(), "30 天内的快照应被保留");
}

// ============================================
// 测试 5: list_snapshots 返回 version 升序排列
// ============================================
#[test]
fn test_list_snapshots_ordered() {
    let tmp = TempDir::new().unwrap();
    let bak_dir = tmp.path().join("bak");
    let origin = make_docx(tmp.path(), "thesis.docx", b"v0");

    // 连续备份 3 次
    for i in 0..3u8 {
        fs::write(&origin, [i]).unwrap();
        backup_before_fix(&origin, bak_dir.clone()).unwrap();
    }

    let snapshots = list_snapshots(&origin, &bak_dir).unwrap();
    assert_eq!(snapshots.len(), 3);

    // 验证 version 严格升序
    for (i, snap) in snapshots.iter().enumerate() {
        assert_eq!(snap.version, i as u32, "snapshots 应按 version 升序排列");
    }
}

// ============================================
// 测试 6: restore 不存在的 version 返回 Err
// ============================================
#[test]
fn test_restore_nonexistent_version_returns_err() {
    let tmp = TempDir::new().unwrap();
    let bak_dir = tmp.path().join("bak");
    let origin = make_docx(tmp.path(), "thesis.docx", b"data");

    backup_before_fix(&origin, bak_dir.clone()).unwrap();

    let result = restore_from_snapshot(&origin, &bak_dir, 99);
    assert!(result.is_err(), "恢复不存在的 version 应返回 Err");
}

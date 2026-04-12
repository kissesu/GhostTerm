// @file: fs_backend/mod.rs
// @description: 文件系统后端 - 提供文件读写、目录列表、创建/删除/重命名操作
//               以及基于 notify 的实时文件监听功能
// @author: Atlas.oi
// @date: 2026-04-12

pub mod watcher;
pub mod security;

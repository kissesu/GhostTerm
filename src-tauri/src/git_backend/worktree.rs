// @file: git_backend/worktree.rs
// @description: Git Worktree 管理 - 创建/删除/切换 worktree，
//               切换时协调 fs watcher 重启和 PTY respawn（事务性操作）
//               注意：git2 worktree API 不完整，可能需要 fallback 到 git CLI
// @author: Atlas.oi
// @date: 2026-04-12

// 占位模块，PBI-5 实现

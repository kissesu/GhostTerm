// @file: project_manager/mod.rs
// @description: 项目管理器 - 维护最近项目列表（持久化到 projects.json），
//               协调项目打开/关闭时的 watcher 启停和 PTY spawn/kill
// @author: Atlas.oi
// @date: 2026-04-12

pub mod persistence;

/**
 * @file builtinTemplate.ts
 * @description 内置 GB/T 7714 模板的共享常量；与 Rust 端 src-tauri/src/template_cmd.rs:19 BUILTIN_ID 必须严格一致。
 *              修改此值时必须同步更新：
 *                1. src-tauri/src/template_cmd.rs::BUILTIN_ID
 *                2. src-tauri/templates/_builtin-gbt7714-v2.json 文件名
 *                3. 本文件
 *              三处任一漏改 → v 错配 → "无法删除自定义模板" 类静默 bug
 * @author Atlas.oi
 * @date 2026-04-28
 */

/** 内置模板 ID（与 Rust 端 BUILTIN_ID 同步，{id}.json 是文件名） */
export const BUILTIN_TEMPLATE_ID = '_builtin-gbt7714-v2';

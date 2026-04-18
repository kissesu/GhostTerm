// @file: template_cmd.rs
// @description: 模板 CRUD 命令 + 内置 GB/T 7714-2015 模板保障机制
//               模板存储路径：~/.config/ghostterm/templates/
//               内置模板用 include_str! 编译时嵌入，删除后自动重建（ensure_builtin）。
//               write 类操作（save/delete/import/restore_builtin）由 TEMPLATE_LOCK 串行保护。
// @author: Atlas.oi
// @date: 2026-04-18

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// 编译时嵌入内置模板（路径相对 src/template_cmd.rs）
// 确保 src-tauri/templates/_builtin-gbt7714.json 存在
const BUILTIN_JSON: &str = include_str!("../templates/_builtin-gbt7714.json");

// 内置模板的固定 id，delete 时以此识别并触发自动重建
const BUILTIN_ID: &str = "_builtin-gbt7714";

// ============================================
// 进程级写操作锁：防止 save/delete/import/restore_builtin 并发竞争
// 参照 backup_cmd.rs 的 OnceLock<Mutex<()>> 模式
// ============================================
static TEMPLATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn template_lock() -> &'static Mutex<()> {
    TEMPLATE_LOCK.get_or_init(|| Mutex::new(()))
}

// ============================================
// 公开数据结构
// ============================================

/// 模板来源信息
/// 区分内置模板（builtin）、用户手动创建（user）和从 docx 抽取（extracted）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSource {
    /// 类型标识："builtin" | "user" | "extracted"
    #[serde(rename = "type")]
    pub source_type: String,
    /// 原始 docx 文件路径（仅 extracted 类型有值）
    pub origin_docx: Option<String>,
    /// 从 docx 抽取的时间戳（仅 extracted 类型有值）
    pub extracted_at: Option<String>,
}

/// 模板 JSON 完整结构（spec Section 4）
/// rules 字段透传给 sidecar，不在 Rust 端解析具体规则内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateJson {
    /// schema 版本号，用于未来迁移检测
    pub schema_version: u32,
    /// 模板唯一 id，文件名为 {id}.json
    pub id: String,
    /// 用户可读的模板名称
    pub name: String,
    /// 模板来源信息
    pub source: TemplateSource,
    /// 最后更新时间（ISO 8601）
    pub updated_at: String,
    /// 规则集合，透传给 sidecar，不在 Rust 端做结构校验
    pub rules: serde_json::Value,
}

// ============================================
// 内部工具函数
// ============================================

/// 获取模板存储目录 (~/.config/ghostterm/templates/)
fn templates_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::backup_cmd::ghostterm_dir(app).map(|d| d.join("templates"))
}

// ============================================
// 核心 lib 函数（不依赖 AppHandle，供集成测试直接调用）
// ============================================

/// 确保内置模板文件存在于指定目录
/// 仅在文件不存在时写入（不覆盖用户已修改的版本）
pub fn ensure_builtin_in_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建模板目录失败: {e}"))?;
    let builtin_path = dir.join(format!("{BUILTIN_ID}.json"));
    if !builtin_path.exists() {
        fs::write(&builtin_path, BUILTIN_JSON).map_err(|e| format!("写入内置模板失败: {e}"))?;
    }
    Ok(())
}

/// 列出指定目录下所有模板（*.json 文件均视为模板）
pub fn list_templates(dir: &Path) -> Result<Vec<TemplateJson>, String> {
    // 目录不存在时返回空列表，不视为错误
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("读取模板目录失败: {e}"))?;
    let mut templates = Vec::new();

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        // 只处理 .json 文件
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[template] 读取 {} 失败: {e}", path.display());
                continue;
            }
        };
        match serde_json::from_str::<TemplateJson>(&content) {
            Ok(tpl) => templates.push(tpl),
            Err(e) => {
                eprintln!("[template] 解析 {} 失败: {e}", path.display());
            }
        }
    }

    // 按 id 排序保证列表顺序一致（内置排前）
    templates.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(templates)
}

/// 读取单个模板
pub fn get_template(dir: &Path, id: &str) -> Result<TemplateJson, String> {
    let path = dir.join(format!("{id}.json"));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取模板 {id} 失败: {e}"))?;
    serde_json::from_str::<TemplateJson>(&content)
        .map_err(|e| format!("解析模板 {id} 失败: {e}"))
}

/// 写入/覆盖模板到目录（id 对应文件名）
pub fn save_template(dir: &Path, tpl: TemplateJson) -> Result<(), String> {
    // write 操作加锁，防止并发覆盖
    let _guard = template_lock().lock().map_err(|_| "模板锁中毒".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建模板目录失败: {e}"))?;
    let path = dir.join(format!("{}.json", tpl.id));
    let content = serde_json::to_string_pretty(&tpl)
        .map_err(|e| format!("序列化模板失败: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("写入模板 {} 失败: {e}", tpl.id))
}

/// 删除模板；若删除的是内置模板，自动重建
pub fn delete_template(dir: &Path, id: &str) -> Result<(), String> {
    let _guard = template_lock().lock().map_err(|_| "模板锁中毒".to_string())?;
    let path = dir.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除模板 {id} 失败: {e}"))?;
    }
    // 删除内置模板后立即重建，保证始终可用
    if id == BUILTIN_ID {
        fs::write(dir.join(format!("{BUILTIN_ID}.json")), BUILTIN_JSON)
            .map_err(|e| format!("重建内置模板失败: {e}"))?;
    }
    Ok(())
}

/// 从外部 JSON 文件导入模板，生成新 id（避免与现有模板冲突）
/// 新 id 格式：{原id}-imported-{Unix毫秒时间戳}
pub fn import_template(dir: &Path, json_path: &str) -> Result<TemplateJson, String> {
    let _guard = template_lock().lock().map_err(|_| "模板锁中毒".to_string())?;
    let content = fs::read_to_string(json_path)
        .map_err(|e| format!("读取导入文件失败: {e}"))?;
    let mut tpl: TemplateJson = serde_json::from_str(&content)
        .map_err(|e| format!("解析导入文件失败: {e}"))?;

    // 生成新 id 避免冲突
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    tpl.id = format!("{}-imported-{}", tpl.id, ts);

    let dest = dir.join(format!("{}.json", tpl.id));
    let out = serde_json::to_string_pretty(&tpl)
        .map_err(|e| format!("序列化导入模板失败: {e}"))?;
    fs::write(&dest, out).map_err(|e| format!("写入导入模板失败: {e}"))?;

    Ok(tpl)
}

/// 导出模板到用户指定路径
pub fn export_template(dir: &Path, id: &str, dest_path: &str) -> Result<(), String> {
    let tpl = get_template(dir, id)?;
    let content = serde_json::to_string_pretty(&tpl)
        .map_err(|e| format!("序列化模板失败: {e}"))?;
    fs::write(dest_path, content).map_err(|e| format!("导出模板到 {dest_path} 失败: {e}"))
}

/// 覆盖写入内置模板，重置为硬编码默认值（用户可手动触发）
pub fn restore_builtin_in_dir(dir: &Path) -> Result<(), String> {
    let _guard = template_lock().lock().map_err(|_| "模板锁中毒".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建模板目录失败: {e}"))?;
    let path = dir.join(format!("{BUILTIN_ID}.json"));
    fs::write(&path, BUILTIN_JSON).map_err(|e| format!("重置内置模板失败: {e}"))
}

// ============================================
// 启动时保障函数（供 lib.rs setup 调用）
// ============================================

/// 启动时确保内置模板存在（通过 AppHandle 解析路径）
pub fn ensure_builtin(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = templates_dir(app)?;
    ensure_builtin_in_dir(&dir)
}

// ============================================
// Tauri Commands — thin wrapper，前端通过 invoke 调用
// ============================================

/// 列出所有模板（含内置）
#[tauri::command]
pub async fn template_list_cmd(app: tauri::AppHandle) -> Result<Vec<TemplateJson>, String> {
    list_templates(&templates_dir(&app)?)
}

/// 读取单个模板
#[tauri::command]
pub async fn template_get_cmd(id: String, app: tauri::AppHandle) -> Result<TemplateJson, String> {
    get_template(&templates_dir(&app)?, &id)
}

/// 写入/覆盖模板
#[tauri::command]
pub async fn template_save_cmd(
    template: TemplateJson,
    app: tauri::AppHandle,
) -> Result<(), String> {
    save_template(&templates_dir(&app)?, template)
}

/// 删除模板；删除内置时自动重建
#[tauri::command]
pub async fn template_delete_cmd(id: String, app: tauri::AppHandle) -> Result<(), String> {
    delete_template(&templates_dir(&app)?, &id)
}

/// 从外部 JSON 文件导入模板（生成新 id 避免冲突）
#[tauri::command]
pub async fn template_import_cmd(
    json_path: String,
    app: tauri::AppHandle,
) -> Result<TemplateJson, String> {
    import_template(&templates_dir(&app)?, &json_path)
}

/// 导出模板到用户指定路径
#[tauri::command]
pub async fn template_export_cmd(
    id: String,
    dest_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    export_template(&templates_dir(&app)?, &id, &dest_path)
}

/// 覆盖内置模板为硬编码默认值（重置用户对内置模板的修改）
#[tauri::command]
pub async fn template_restore_builtin_cmd(app: tauri::AppHandle) -> Result<(), String> {
    restore_builtin_in_dir(&templates_dir(&app)?)
}

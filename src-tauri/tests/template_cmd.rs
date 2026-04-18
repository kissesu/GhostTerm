// @file: tests/template_cmd.rs
// @description: template_cmd 集成测试 - 验证模板 CRUD、内置模板保障、import/export 全链路
// @author: Atlas.oi
// @date: 2026-04-18

use ghostterm_lib::template_cmd::{
    delete_template, ensure_builtin_in_dir, export_template, get_template, import_template,
    list_templates, save_template, TemplateJson, TemplateSource,
};
use serde_json::json;
use std::fs;
use tempfile::TempDir;

/// 构造一个最小的 TemplateJson 用于测试
fn make_template(id: &str, name: &str) -> TemplateJson {
    TemplateJson {
        schema_version: 1,
        id: id.to_string(),
        name: name.to_string(),
        source: TemplateSource {
            source_type: "user".to_string(),
            origin_docx: None,
            extracted_at: None,
        },
        updated_at: "2026-04-18T00:00:00Z".to_string(),
        rules: json!({ "font.body": { "enabled": true, "value": {"family": "宋体", "size_pt": 12} } }),
    }
}

// ============================================
// 测试 1: 空目录调用 ensure_builtin_in_dir → 内置文件被创建
// ============================================
#[test]
fn test_ensure_builtin_creates_file() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();

    ensure_builtin_in_dir(&dir).unwrap();

    let builtin_path = dir.join("_builtin-gbt7714.json");
    assert!(builtin_path.exists(), "内置模板文件应被创建");

    // 验证内容可被解析为 TemplateJson
    let content = fs::read_to_string(&builtin_path).unwrap();
    let parsed: TemplateJson = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed.id, "_builtin-gbt7714");
    assert_eq!(parsed.schema_version, 1);

    // 验证 11 条规则
    let rules = parsed.rules.as_object().unwrap();
    assert_eq!(rules.len(), 11, "内置模板应包含 11 条规则，实际: {}", rules.len());
}

// ============================================
// 测试 2: save 一条自定义模板 → list 能看到（含内置，共 2 条）
// ============================================
#[test]
fn test_save_then_list() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();

    // 确保内置已存在
    ensure_builtin_in_dir(&dir).unwrap();

    // 保存一条用户模板
    let tpl = make_template("my-template", "我的模板");
    save_template(&dir, tpl).unwrap();

    let list = list_templates(&dir).unwrap();
    // 应含 2 条：内置 + 用户模板
    assert_eq!(list.len(), 2, "应有 2 条模板，实际: {}", list.len());

    let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
    assert!(ids.contains(&"_builtin-gbt7714"), "列表应含内置模板");
    assert!(ids.contains(&"my-template"), "列表应含用户模板");
}

// ============================================
// 测试 3: delete _builtin-gbt7714 → 文件消失，ensure_builtin 后立即重建
// ============================================
#[test]
fn test_delete_builtin_auto_rebuilds() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();

    ensure_builtin_in_dir(&dir).unwrap();
    let builtin_path = dir.join("_builtin-gbt7714.json");
    assert!(builtin_path.exists());

    // delete 内置模板（delete_template 在删内置时自动调 ensure_builtin_in_dir）
    delete_template(&dir, "_builtin-gbt7714").unwrap();

    // 文件应自动重建（delete_template 对内置 id 会自动 ensure）
    assert!(builtin_path.exists(), "删除内置模板后应自动重建");
}

// ============================================
// 测试 4: import 外部 JSON → 生成新 id 含 "-imported-"
// ============================================
#[test]
fn test_import_generates_new_id() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();
    ensure_builtin_in_dir(&dir).unwrap();

    // 准备一个外部 JSON 文件
    let src_tpl = make_template("external-tpl", "外部模板");
    let src_path = tmp.path().join("external.json");
    let src_content = serde_json::to_string_pretty(&src_tpl).unwrap();
    fs::write(&src_path, &src_content).unwrap();

    // import
    let imported = import_template(&dir, src_path.to_str().unwrap()).unwrap();

    // id 应含 "-imported-"
    assert!(
        imported.id.contains("-imported-"),
        "import 生成的 id 应含 '-imported-'，实际: {}",
        imported.id
    );
    assert!(
        imported.id.starts_with("external-tpl-imported-"),
        "import id 前缀应为原 id，实际: {}",
        imported.id
    );

    // 文件应存在于 dir
    let imported_path = dir.join(format!("{}.json", imported.id));
    assert!(imported_path.exists(), "import 后文件应存在于模板目录");
}

// ============================================
// 测试 5: export → 目标路径有文件
// ============================================
#[test]
fn test_export_writes_to_dest() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();
    ensure_builtin_in_dir(&dir).unwrap();

    // 保存一条模板
    let tpl = make_template("export-me", "导出测试模板");
    save_template(&dir, tpl).unwrap();

    // export 到临时路径
    let dest = tmp.path().join("output.json");
    export_template(&dir, "export-me", dest.to_str().unwrap()).unwrap();

    assert!(dest.exists(), "export 后目标路径应有文件");

    // 验证内容可读
    let content = fs::read_to_string(&dest).unwrap();
    let parsed: TemplateJson = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed.id, "export-me");
}

// ============================================
// 测试 6: get_template 拒绝 path traversal id
// ============================================
#[test]
fn test_get_template_rejects_path_traversal() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();

    // 各种 traversal 形式都应被拒绝
    assert!(get_template(&dir, "../../etc/passwd").is_err(), "../ 应被拒绝");
    assert!(get_template(&dir, "..\\..\\windows\\system32").is_err(), "..\\ 应被拒绝");
    assert!(get_template(&dir, "sub/dir/template").is_err(), "/ 应被拒绝");
    assert!(get_template(&dir, "").is_err(), "空 id 应被拒绝");
}

// ============================================
// 测试 7: save_template 拒绝非法 id
// ============================================
#[test]
fn test_save_template_rejects_invalid_id() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();

    let bad = make_template("../malicious", "恶意模板");
    let result = save_template(&dir, bad);
    assert!(result.is_err(), "save 含 .. 的 id 应失败");

    // 验证未写入文件（防御实际生效）
    let leaked = tmp.path().parent().unwrap().join("malicious.json");
    assert!(!leaked.exists(), "非法 id 不应导致跳出目录写入");
}

// ============================================
// 测试 8: import 缺 schema_version / source / updated_at 的精简 JSON
//   → serde defaults 补全，id/name 保留，schema_version 默认 1
// ============================================
#[test]
fn test_import_without_optional_fields_uses_defaults() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().to_path_buf();
    ensure_builtin_in_dir(&dir).unwrap();

    // 仅含必填字段 id / name / rules，省略 schema_version / source / updated_at
    let minimal_json = r#"{
        "id": "minimal-tpl",
        "name": "精简模板",
        "rules": { "font.body": { "enabled": true, "value": { "family": "宋体", "size_pt": 12 } } }
    }"#;

    let src_path = tmp.path().join("minimal.json");
    fs::write(&src_path, minimal_json).unwrap();

    // import 应成功，不因缺 schema_version 而报错
    let imported = import_template(&dir, src_path.to_str().unwrap())
        .expect("import 缺 schema_version/source/updated_at 的 JSON 应成功");

    // schema_version 应默认为 1
    assert_eq!(imported.schema_version, 1, "schema_version 应默认 1");
    // source.type 应默认为 "imported"
    assert_eq!(imported.source.source_type, "imported", "source.type 应默认 imported");
    // updated_at 不为空（由 default_now() 填充）
    assert!(!imported.updated_at.is_empty(), "updated_at 不应为空");
    // id 含 "minimal-tpl-imported-"
    assert!(
        imported.id.starts_with("minimal-tpl-imported-"),
        "import id 前缀应为原 id，实际: {}",
        imported.id
    );
}

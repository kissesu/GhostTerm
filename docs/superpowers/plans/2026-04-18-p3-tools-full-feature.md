# P3 - 工具分区完整功能实现

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `2026-04-17-titlebar-nav-tools-design.md` 完成"工具" tab 的完整功能闭环：模板存储与提取、10 条剩余规则、备份与 undo、修复 UI（单条确认 + diff 预览 + 蓝色标记）、工具箱分类。P3 结束时 spec "成功标准" 全部达成。

**Architecture:**
- 前端新增 `src/features/tools/templates/`（模板 store + 选择器 + 编辑器 + 提取器预览）+ `src/features/tools/` 内 `ToolBoxGrid/IssueList/DiffPreview` 组件
- Rust 新增 `src-tauri/src/template_cmd.rs` + `backup_cmd.rs`
- Python 新增 `thesis_worker/rules/*` 10 条规则 + `thesis_worker/extractor.py` docx 反推
- 沿用 P2 已建立的 NDJSON sidecar 协议，不改 Rust ↔ Python 交互层

**Tech Stack:** React + TypeScript + Zustand + Vitest；Rust + tauri 2 + sha2 + filetime；Python 3.12 + python-docx + pytest + dataclasses

**依赖 plan:** P2（milestone-p2-sidecar，HEAD 685016f）已 merge 到 main。P3 基于 `main` 建分支 `feat/p3-tools-full`。

**依赖 spec:** Section 2（前端组件树）/ Section 4（模板存储与提取）/ Section 5（规则引擎 10 条规则）/ Section 6（备份/undo/蓝色标记）/ Section 7（错误不降级）/ Section 8（测试策略）

**不在本 plan 范围：**
- Section 2 titlebar 三分区（已 P1 完成）
- Section 3 IPC 协议（已 P2 完成）
- P2 已有的 `cjk_ascii_space` 规则（已实现）
- Linux build target（macOS + Windows 已覆盖）
- 云端同步 / 模板市场（spec 排除项）
- 规则 WYSIWYG 编辑器（spec 排除项，只做表格编辑器）

---

## File Structure

| 动作 | 路径 | 职责 |
|------|------|------|
| Create | `src-tauri/src/backup_cmd.rs` | docx 修复前备份 + 30 天清理 + snapshot 恢复 |
| Create | `src-tauri/src/template_cmd.rs` | 模板 CRUD + 内置重建 + 导入导出 |
| Create | `src-tauri/templates/_builtin-gbt7714.json` | 硬编码默认模板（安装包内，启动时复制到 ~/.ghostterm/） |
| Modify | `src-tauri/src/lib.rs` | 注册 template/backup command + 启动时 ensure 内置模板 |
| Modify | `src-tauri/Cargo.toml` | 加 sha2 + filetime dep |
| Create | `src-tauri/tests/template_cmd.rs` | 模板 CRUD 测试 |
| Create | `src-tauri/tests/backup_cmd.rs` | snapshot 命名 + 30 天清理测试 |
| Create | `src-python/thesis_worker/extractor.py` | 从 docx 反推规则草稿 + evidence |
| Create | `src-python/thesis_worker/rules/font_body.py` | 正文字体/字号规则 |
| Create | `src-python/thesis_worker/rules/font_h1.py` | 一级标题字体规则 |
| Create | `src-python/thesis_worker/rules/paragraph_indent.py` | 段首缩进规则 |
| Create | `src-python/thesis_worker/rules/citation_format.py` | 引用格式（GB/T 7714） |
| Create | `src-python/thesis_worker/rules/figure_caption_pos.py` | 图题位置 |
| Create | `src-python/thesis_worker/rules/table_caption_pos.py` | 表题位置 |
| Create | `src-python/thesis_worker/rules/chapter_new_page.py` | 章节分页 |
| Create | `src-python/thesis_worker/rules/quote_style.py` | 引号风格 |
| Create | `src-python/thesis_worker/rules/ai_pattern.py` | 去 AI 化检测 |
| Create | `src-python/thesis_worker/rules/pagination.py` | 页眉页脚分页 |
| Modify | `src-python/thesis_worker/rules/__init__.py` | REGISTRY 加全部 10 条规则 |
| Modify | `src-python/thesis_worker/handlers.py` | 加 `fix`、`fix_preview`、`extract_template`、`list_rules`、`cancel` 命令 |
| Create | `src-python/tests/rules/test_font_body.py` | 规则 TDD 测试（含 fixture + reopen 硬测试）|
| Create | `src-python/tests/rules/test_paragraph_indent.py` | 同上 |
| Create | `src-python/tests/rules/test_citation_format.py` | 同上 |
| Create | `src-python/tests/rules/test_<其它>.py` | 每条规则一文件 |
| Create | `src-python/tests/test_extractor.py` | 提取器测试 |
| Create | `src-python/tests/fixtures/bad_*.docx` | 违规 fixture（每规则各 1-2 个） |
| Create | `src-python/tests/fixtures/full_bad.docx` | 全违规文档（E2E 用） |
| Create | `src-python/tests/fixtures/clean_gbt7714.docx` | 完全合规文档 |
| Create | `src/features/tools/templates/TemplateStore.ts` | Zustand 模板 store（CRUD + 深拷贝 + 迁移） |
| Create | `src/features/tools/templates/TemplateSelector.tsx` | 顶部下拉 |
| Create | `src/features/tools/templates/TemplateManager.tsx` | 模板列表 + 编辑/删除 |
| Create | `src/features/tools/templates/TemplateEditor.tsx` | 表格编辑器（规则值编辑） |
| Create | `src/features/tools/templates/TemplateExtractor.tsx` | 从 docx 提取 + 表格 review |
| Create | `src/features/tools/ToolBoxGrid.tsx` | 工具箱（按 category 分组卡片） |
| Create | `src/features/tools/IssueList.tsx` | 问题列表 + 单条修复按钮 |
| Create | `src/features/tools/DiffPreview.tsx` | 修复前 diff modal |
| Modify | `src/features/tools/ToolRunner.tsx` | 接入 active template + 模板切换 + fix UI |
| Modify | `src/features/tools/toolsSidecarClient.ts` | 加 fix/fixPreview/extractTemplate 等泛型方法 |
| Create | `src/features/tools/toolsStore.ts` | undo 栈 + active tool |
| Modify | `src/features/tools/ToolsWorkspace.tsx` | 顶部放 TemplateSelector + 中部放 ToolBoxGrid |
| Create | `src/features/tools/__tests__/templateStore.test.ts` | 深拷贝隔离 + schema 迁移测试 |
| Create | `src/features/tools/__tests__/toolsStore.test.ts` | undo 栈 + Cmd+Z 绑定测试 |
| Create | `src/features/tools/__tests__/DiffPreview.test.tsx` | diff 渲染 |
| Modify | `.github/workflows/release.yml` | 确认测试步骤覆盖 P3 新增（已在 P2 配置过 pytest/cargo/vitest 链） |

---

## Phase A — 修复闭环（Task 1-5）

### Task 1: Rust backup_cmd（TDD）

**Files:**
- Modify: `src-tauri/Cargo.toml`（加 sha2、filetime）
- Create: `src-tauri/src/backup_cmd.rs`
- Create: `src-tauri/tests/backup_cmd.rs`
- Modify: `src-tauri/src/lib.rs`（`mod backup_cmd;` + 注册 3 条 command）

**Step 1: Cargo.toml 加依赖**

```toml
# 备份路径 hash（sha256(原路径) 前 12 位作为目录名）
sha2 = "0.10"
# 操纵 mtime（用于测试 30 天清理逻辑）
filetime = "0.2"
```

**Step 2: 写失败测试** — `src-tauri/tests/backup_cmd.rs`：

```rust
// 测试用例覆盖：
// 1. backup_before_fix 第一次 → v0 创建
// 2. 再次调 → v1 追加（v0 不覆盖）
// 3. restore_from_snapshot(path, 0) → 恢复 v0
// 4. cleanup_old_backups → mtime > 30 天删除，< 30 天保留
// 5. list_snapshots 返回正确顺序

use ghostterm_lib::backup_cmd::{backup_before_fix, list_snapshots, cleanup_old_backups, restore_from_snapshot};
use tempfile::TempDir;
use std::fs;
use filetime::FileTime;

#[test]
fn test_v0_not_overwritten() { /* 见完整版 */ }

#[test]
fn test_cleanup_removes_old_only() {
    let tmp = TempDir::new().unwrap();
    // mock origin docx
    let origin = tmp.path().join("doc.docx");
    fs::write(&origin, b"docx v0").unwrap();
    backup_before_fix(&origin, tmp.path().join(".bak")).unwrap();
    // 把 v0 mtime 改成 40 天前
    let bak_v0 = /* 找到 v0 文件 */;
    let old = FileTime::from_unix_time(now - 40 * 86400, 0);
    filetime::set_file_mtime(&bak_v0, old).unwrap();
    // 再 backup 一次，v1 应该保留（mtime 新鲜）
    fs::write(&origin, b"docx v1").unwrap();
    backup_before_fix(&origin, tmp.path().join(".bak")).unwrap();
    let removed = cleanup_old_backups(tmp.path().join(".bak")).unwrap();
    assert_eq!(removed, 1); // 只删 v0
}
```

跑 `cargo test backup` 看失败。

**Step 3: 实现 backup_cmd.rs**

```rust
//! @file backup_cmd.rs
//! @description 修复前自动备份 + 30 天滚动清理。备份目录用 sha256(origin) 前 12 位命名
//! @author Atlas.oi
//! @date 2026-04-18

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use serde::Serialize;

#[derive(Serialize)]
pub struct SnapshotInfo { pub version: u32, pub path: PathBuf, pub mtime: u64 }

fn hash_origin(origin: &Path) -> String {
    let mut h = Sha256::new();
    h.update(origin.to_string_lossy().as_bytes());
    format!("{:x}", h.finalize())[..12].to_string()
}

fn backup_root(bak_dir: &Path, origin: &Path) -> PathBuf {
    bak_dir.join(hash_origin(origin))
}

/// 返回新建 snapshot 的绝对路径
pub fn backup_before_fix(origin: &Path, bak_dir: PathBuf) -> Result<PathBuf, String> {
    let root = backup_root(&bak_dir, origin);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    // 列已有 v_n，找下一个 n
    let next_v = fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.strip_prefix("v")
                .and_then(|s| s.split('_').next())
                .and_then(|n| n.parse::<u32>().ok())
        })
        .max().map(|n| n + 1).unwrap_or(0);
    let ts = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S");
    let filename = format!("v{}_{}.docx", next_v, ts);
    let snap = root.join(&filename);
    fs::copy(origin, &snap).map_err(|e| e.to_string())?;
    // 顺便写 meta.json（首次备份时）
    let meta_path = root.join("meta.json");
    if !meta_path.exists() {
        let meta = serde_json::json!({
            "origin_path": origin.to_string_lossy(),
            "first_backed_at": ts.to_string(),
        });
        fs::write(meta_path, serde_json::to_string_pretty(&meta).unwrap()).ok();
    }
    Ok(snap)
}

pub fn list_snapshots(origin: &Path, bak_dir: &Path) -> Result<Vec<SnapshotInfo>, String> { /* ... */ }
pub fn restore_from_snapshot(origin: &Path, bak_dir: &Path, version: u32) -> Result<(), String> { /* ... */ }
pub fn cleanup_old_backups(bak_dir: &Path) -> Result<u32, String> {
    // 遍历所有 .bak/<hash>/v*.docx，mtime > 30 天删
    // 返回删除数
}

#[tauri::command]
pub async fn backup_create_cmd(origin: String, app: tauri::AppHandle) -> Result<String, String> {
    let bak = ghostterm_dir(&app)?.join(".bak");
    backup_before_fix(Path::new(&origin), bak).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn backup_restore_cmd(origin: String, version: u32, app: tauri::AppHandle) -> Result<(), String> { /* ... */ }

#[tauri::command]
pub async fn backup_list_cmd(origin: String, app: tauri::AppHandle) -> Result<Vec<SnapshotInfo>, String> { /* ... */ }
```

**注：** `ghostterm_dir(app)` 返回 `~/.ghostterm/`；复用或新建 helper（spec 没写，参照 `dirs::home_dir().join(".ghostterm")`）。

**Step 4: lib.rs 注册**

```rust
pub mod backup_cmd;
use backup_cmd::{backup_create_cmd, backup_restore_cmd, backup_list_cmd};

// 在 generate_handler 加
backup_create_cmd, backup_restore_cmd, backup_list_cmd,

// 在 setup 加启动时异步清理
let app_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    if let Ok(dir) = ghostterm_dir(&app_handle) {
        let _ = backup_cmd::cleanup_old_backups(&dir.join(".bak"));
    }
});
```

**Step 5: cargo test + commit**

```bash
cd src-tauri && cargo test backup 2>&1 | tail -10
```
Expected: all pass

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/backup_cmd.rs src-tauri/tests/backup_cmd.rs src-tauri/src/lib.rs
git commit -m "feat(backup): docx 修复前备份 + 30 天滚动清理"
```

---

### Task 2: 扩展 sidecar fix/fix_preview 命令

**Files:**
- Modify: `src-python/thesis_worker/handlers.py`（已有 `_handle_fix`，加 `_handle_fix_preview` + `_handle_list_rules` + `_handle_cancel`）
- Modify: `src-python/tests/test_handlers.py`（加新命令测试）

**Step 1: 写失败测试**

```python
class TestFixPreview:
    def test_fix_preview_returns_diff_no_write(self, tmp_path):
        import shutil
        origin = FIXTURES / 'cjk_space_bad.docx'
        tmp = tmp_path / 'copy.docx'
        shutil.copy(origin, tmp)
        # 先 detect 拿 issue
        resp = handle({'id':'r1','cmd':'detect','file':str(tmp),'template':MIN_TEMPLATE})
        issue = resp['result']['issues'][0]
        # fix_preview 应该返回 diff 但不写回
        import os
        mtime_before = os.path.getmtime(tmp)
        resp = handle({'id':'r2','cmd':'fix_preview','file':str(tmp),'issue':issue,'value':{'allowed':False}})
        assert resp['ok'] is True
        assert 'diff' in resp['result']
        assert os.path.getmtime(tmp) == mtime_before  # 未写

class TestListRules:
    def test_list_rules_returns_all_registered(self):
        resp = handle({'id':'r1','cmd':'list_rules'})
        assert resp['ok'] is True
        assert 'cjk_ascii_space' in resp['result']['rules']

class TestCancel:
    def test_cancel_returns_ack(self):
        # P3 sidecar 单线程串行；cancel 只做 ack（真实中断留 P4）
        resp = handle({'id':'r1','cmd':'cancel'})
        assert resp['ok'] is True
```

**Step 2: 实现新 handler 分支**

```python
def handle(req: dict) -> dict:
    # ... existing ping / detect / fix ...
    if cmd == 'fix_preview':
        return _handle_fix_preview(req_id, req)
    if cmd == 'list_rules':
        return {'id': req_id, 'ok': True, 'result': {'rules': list(REGISTRY.keys())}}
    if cmd == 'cancel':
        return {'id': req_id, 'ok': True, 'result': {'cancelled': True}}
    if cmd == 'extract_template':
        return _handle_extract_template(req_id, req)  # Task 20 实现

def _handle_fix_preview(req_id, req):
    # 复用 _handle_fix 逻辑但在 Document 上操作临时对象，不 save
    # ... 返回 FixResult（diff + applied:false）
```

**Step 3: commit**
```bash
git commit -m "feat(sidecar): handlers 加 fix_preview/list_rules/cancel 命令"
```

---

### Task 3: 前端 sidecar client 扩展 + toolsStore

**Files:**
- Modify: `src/features/tools/toolsSidecarClient.ts`（加 FixPreviewRequest / ListRulesRequest / CancelRequest / ExtractTemplateRequest 类型）
- Create: `src/features/tools/toolsStore.ts`
- Create: `src/features/tools/__tests__/toolsStore.test.ts`

**toolsStore schema：**

```ts
interface UndoEntry {
  fileHash: string;
  snapshotVersion: number;
  issueId: string;
  timestamp: number;
}

interface ToolsStore {
  activeToolId: string | null;
  activeTemplateId: string;
  undoStack: UndoEntry[];
  pushUndo(entry: UndoEntry): void;
  undo(): Promise<void>;  // 弹栈顶 → invoke('backup_restore_cmd', ...)
  setActiveTool(id: string | null): void;
  setActiveTemplate(id: string): void;
}
```

**test：**

```ts
it('push/pop undo 栈顺序', ...)
it('undo 调 backup_restore_cmd 指向 snapshot v-1', ...)
it('undo 栈为空时 undo 不崩', ...)
```

**Step 1: 写失败测试**
**Step 2: 实现 store**
**Step 3: 扩展 sidecarClient.ts**（加 fixPreview/listRules/extractTemplate 方法，复用 sidecarInvoke 泛型）
**Step 4: vitest 通过 + commit**

```bash
git commit -m "feat(tools): toolsStore（undo 栈 + active tool/template）+ sidecar client 扩展"
```

---

### Task 4: DiffPreview 组件（TDD）

**Files:**
- Create: `src/features/tools/DiffPreview.tsx`
- Create: `src/features/tools/__tests__/DiffPreview.test.tsx`

**DiffPreview Props：**

```ts
interface Props {
  diff: string;           // unified diff 字符串，形如 `- ...\n+ ...`
  onConfirm(): void;
  onCancel(): void;
  busy: boolean;
}
```

**渲染：** 用 `<pre>` 展示 diff，`-` 行红色 `+` 行绿色（用 CSS 变量 `--c-danger` / `--c-success`，如不存在则加到 App.css）；两按钮 "确认修复" / "取消"。

**Test：**
- diff 解析：`- 过 s` 行用红色；`+ 过s` 行用绿色
- onConfirm/onCancel 回调
- busy=true 时按钮 disabled

**Step 1-4：** TDD 流程 + commit

```bash
git commit -m "feat(tools): DiffPreview 组件（修复前 diff 预览）"
```

---

### Task 5: IssueList 修复按钮 + Cmd+Z undo

**Files:**
- Create: `src/features/tools/IssueList.tsx`
- Modify: `src/features/tools/ToolRunner.tsx`（替换现有 inline 渲染为 `<IssueList>`）

**交互流程（spec Section 6 + 5）：**

```
用户点 issue 右侧 "修复" 按钮
  ↓
前端 sidecarInvoke({ cmd: 'fix_preview', file, issue, value })
  ↓
拿到 diff → 弹 DiffPreview modal
  ↓
用户点"确认修复"
  ↓
前端 invoke('backup_create_cmd', { origin: file }) → 拿 snapshot 路径
  ↓
前端 sidecarInvoke({ cmd: 'fix', file, issue, value })
  ↓
toolsStore.pushUndo({ fileHash, snapshotVersion, issueId })
  ↓
重跑 detect 刷新 issues 列表
```

**Cmd+Z 绑定：** 在 `ToolsWorkspace` 外层 div 用 `onKeyDown` 捕获，仅 activeTab='tools' 时处理，调 toolsStore.undo()。

**Step 1-5：** 实现 + vitest + tauri dev 手动验证（spec 成功标准第 3 项："能打开 DOCX → 检测 → 逐条修复 → 写回"）

```bash
git commit -m "feat(tools): 单条修复闭环（diff 预览 + 备份 + fix + undo）"
```

---

## Phase B — 模板系统（Task 6-10）

### Task 6: Rust template_cmd + 内置模板（TDD）

**Files:**
- Create: `src-tauri/templates/_builtin-gbt7714.json`（按 spec Section 4 "模板 JSON Schema v1" 硬编码 12 条核心规则）
- Create: `src-tauri/src/template_cmd.rs`
- Create: `src-tauri/tests/template_cmd.rs`
- Modify: `src-tauri/src/lib.rs`（注册 7 条 command + 启动时 ensure 内置）
- Modify: `src-tauri/build.rs`（如需要 include_bytes! 打包 JSON；或直接用 `include_str!` 编译时嵌入）

**内置模板 JSON 字面（完整 12 条）：** 按 spec Section 4 schema，`cjk_ascii_space` 已验证 P2 用同样 schema。

**template_cmd.rs 结构：**

```rust
use std::path::PathBuf;
use std::fs;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct TemplateJson {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub source: TemplateSource,
    pub updated_at: String,
    pub rules: serde_json::Value,  // 规则字典，透传给 sidecar
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TemplateSource { pub r#type: String, pub origin_docx: Option<String>, pub extracted_at: Option<String> }

const BUILTIN_JSON: &str = include_str!("../templates/_builtin-gbt7714.json");

fn templates_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> { /* ~/.ghostterm/templates */ }

/// 启动时保证内置模板存在；不存在则从 BUILTIN_JSON 写回
pub fn ensure_builtin(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = templates_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let builtin_path = dir.join("_builtin-gbt7714.json");
    if !builtin_path.exists() {
        fs::write(&builtin_path, BUILTIN_JSON).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command] pub async fn template_list_cmd(app: tauri::AppHandle) -> Result<Vec<TemplateJson>, String> { /* 读全目录 */ }
#[tauri::command] pub async fn template_get_cmd(id: String, app: tauri::AppHandle) -> Result<TemplateJson, String>
#[tauri::command] pub async fn template_save_cmd(template: TemplateJson, app: tauri::AppHandle) -> Result<(), String>
#[tauri::command] pub async fn template_delete_cmd(id: String, app: tauri::AppHandle) -> Result<(), String> { /* 删除文件；若是内置则同时 ensure_builtin 重建 */ }
#[tauri::command] pub async fn template_import_cmd(json_path: String, app: tauri::AppHandle) -> Result<TemplateJson, String> { /* 读外部 JSON 生成新 id */ }
#[tauri::command] pub async fn template_export_cmd(id: String, dest_path: String, app: tauri::AppHandle) -> Result<(), String>
#[tauri::command] pub async fn template_restore_builtin_cmd(app: tauri::AppHandle) -> Result<(), String> { /* 覆盖 _builtin-gbt7714.json */ }
```

**测试覆盖：**
- 启动 ensure_builtin 空目录 → 内置创建
- save → list 能看到
- delete(_builtin-gbt7714) → 立即 ensure_builtin 自动重建
- import 外部 JSON → 生成新 id（避免冲突）
- export → 目标路径有文件

**Step 1-5：** TDD + lib.rs setup 调 ensure_builtin + commit

```bash
git commit -m "feat(templates): Rust 模板 CRUD + 内置独立可编辑 + 启动时 ensure"
```

---

### Task 7: 前端 TemplateStore（Zustand + 深拷贝隔离 + 迁移）

**Files:**
- Create: `src/features/tools/templates/TemplateStore.ts`
- Create: `src/features/tools/__tests__/templateStore.test.ts`

**Store schema：**

```ts
interface TemplateStore {
  templates: TemplateJson[];
  loading: boolean;
  load(): Promise<void>;  // invoke('template_list_cmd')
  get(id: string): TemplateJson | null;
  create(name: string, options?: { fromDocx?: string }): Promise<string>;  // 深拷贝内置 rules，可选 override；返回新 id
  update(id: string, patch: Partial<TemplateJson>): Promise<void>;
  remove(id: string): Promise<void>;
  restoreBuiltin(): Promise<void>;
  migrateNewRules(newRuleIds: string[]): Promise<void>;  // 新规则 enabled:false 追加到所有已存模板
}
```

**深拷贝隔离关键：** `create()` 实现：

```ts
async create(name, options) {
  const builtin = get().templates.find((t) => t.id === '_builtin-gbt7714');
  if (!builtin) throw new Error('Builtin template missing');
  const deepCloned = JSON.parse(JSON.stringify(builtin.rules));  // 强制值复制
  const newId = slugify(name) + '-' + Date.now().toString(36);
  const newTpl: TemplateJson = { schema_version: 1, id: newId, name, source: { type: 'manual' }, updated_at: new Date().toISOString(), rules: deepCloned };
  if (options?.fromDocx) {
    const extracted = await sidecarInvoke({ cmd: 'extract_template', file: options.fromDocx });
    // merge extracted values into deepCloned
    Object.entries(extracted.rules).forEach(([k, v]) => { if (newTpl.rules[k]) newTpl.rules[k].value = v.value; });
    newTpl.source = { type: 'extracted', origin_docx: options.fromDocx, extracted_at: new Date().toISOString() };
  }
  await invoke('template_save_cmd', { template: newTpl });
  await get().load();
  return newId;
}
```

**测试覆盖：**
- `create` 后 templates list 含新模板
- 改内置 rules → 已存在用户模板 rules 不变（深拷贝隔离）
- `migrateNewRules(['new.rule'])` → 所有模板（包括用户模板）rules 加 `{'new.rule': {enabled: false, value: null}}`
- Mock invoke（`vi.mock('@tauri-apps/api/core')`），store 测试不需真实 Rust 端

**Step 1-4：** TDD + commit

```bash
git commit -m "feat(templates): TemplateStore 深拷贝隔离 + schema 迁移"
```

---

### Task 8: TemplateSelector 下拉

**Files:**
- Create: `src/features/tools/templates/TemplateSelector.tsx`

**UI：** 顶部下拉，展示 `{templates[i].name}`；选中触发 `toolsStore.setActiveTemplate(id)`；右侧小按钮"管理模板"打开 TemplateManager modal。

**细节：** 第一次启动 `activeTemplateId` 默认 `'_builtin-gbt7714'`；之后记住最后使用（localStorage）。

简短实现，~80 行。

**Step：** 写 + 集成到 ToolsWorkspace 顶部 + commit

```bash
git commit -m "feat(templates): TemplateSelector 下拉 + activeTemplate 持久化"
```

---

### Task 9: TemplateManager + TemplateEditor

**Files:**
- Create: `src/features/tools/templates/TemplateManager.tsx`
- Create: `src/features/tools/templates/TemplateEditor.tsx`

**TemplateManager：** modal，列表形式；每行：name + source type + 按钮（编辑 / 导出 / 删除 / 对内置额外有"恢复默认"）。底部"新建模板" / "从 docx 创建" / "导入 JSON" 三按钮。

**TemplateEditor：** 单模板的表格编辑视图：

| rule_id | enabled | value | 操作 |
|---------|---------|-------|------|
| font.body | ☑ | [family: 宋体, size_pt: 12] | 编辑 |
| citation.format | ☑ | [style: gbt7714] | 编辑 |

value 编辑器按类型分发：
- `{family, size_pt}` → 两个 input
- `{style, marker}` → select
- `boolean` → toggle
- `{allowed: bool}` → toggle

**封装策略：** `RuleValueEditor.tsx` 按 `ruleDef.valueShape` 分发到具体子组件。`valueShape` 从硬编码的 `RULE_SCHEMAS` 常量映射（src-python 侧规则元信息不回传；前端维护对应 schema）。

**关键约束：** 保存时 invoke `template_save_cmd`，reload store。

**Step 1-3：** 实现 + vitest（最低一条 create/edit/save 流程）+ commit

```bash
git commit -m "feat(templates): TemplateManager 列表 + TemplateEditor 表格编辑"
```

---

### Task 10: 模板导入/导出 + 新建（从 docx）

**Files:**
- Modify: `src/features/tools/templates/TemplateManager.tsx`（接"新建 / 导入 / 从 docx"按钮到对应 action）

**新建流程：**
- 弹 input：模板名
- 调 `TemplateStore.create(name)` → 深拷贝内置 → 保存

**从 docx 新建：**
- 选 docx
- 调 `TemplateStore.create(name, { fromDocx: path })`
- 内部调 `sidecarInvoke({ cmd: 'extract_template', file })`
- 拿到 rule drafts + evidence → 传入 TemplateExtractor（Task 22）做 review
- Task 22 未完成前此流程阻塞于 sidecar 命令；Task 10 先把 UI 脚手架搭好，"从 docx" 按钮点击先显示 "Phase D 未完成"占位

**导入 JSON：**
- 文件选择器 .json → invoke `template_import_cmd(path)` → reload

**导出：**
- 单条点导出 → 文件保存对话框 → invoke `template_export_cmd(id, dest)`

**Step 1-3：** 实现 + 集成 + commit

```bash
git commit -m "feat(templates): 导入/导出/从 docx 新建脚手架（extract 在 Phase D）"
```

---

## Phase C — 10 条规则实现（Task 11-19）

> 每条规则独立 task，统一模式：
> 1. 写失败测试（fixture + 3 个 assert：bad/clean/snippet-context）
> 2. 实现 detect + fix（fix 可能为 None，即只检测）
> 3. 写 reopen 硬测试（修复后重开 detect 必须空）
> 4. 在 REGISTRY 注册
> 5. commit

### Task 11: font.body（正文字体/字号）

**Files:**
- Create: `src-python/thesis_worker/rules/font_body.py`
- Create: `src-python/tests/rules/test_font_body.py`
- Create: `src-python/tests/fixtures/bad_font_body.docx` / `clean_font_body.docx`（用 `make_fixtures.py` 扩展）
- Modify: `src-python/thesis_worker/rules/__init__.py`

**Rule：**
- `id='font.body'`, `category='format'`, `severity='warning'`, `fix_available=True`
- `value: {'family': str, 'size_pt': int, 'bold': bool?}`（spec Section 4 schema）
- detect：遍历 `doc.paragraphs`（排除 heading styles），检查每 run 的 `run.font.name` 和 `run.font.size`
- fix：设置 `run.font.name = value['family']`、`run.font.size = Pt(value['size_pt'])` + 蓝色标记（参照 P2 `cjk_ascii_space` L489 `_MARK_COLOR`）

**关键细节：**
- `run.font.name` 可能返回 None（继承 style）；需通过 `run._element.rPr.rFonts` 读实际
- snippet 取 run.text 前 N 字（同 P2 `_expand_snippet` 风格但更简单——整 run 文本截断）
- context 取 `paragraph.text` 前 30 字

**跑 pytest → commit：**

```bash
git commit -m "feat(rules): font.body 正文字体字号规则"
```

---

### Task 12-19: 其余 9 条规则（简报格式）

> 每条 task 格式相同：spec Section 5 描述 + rule class + pytest + commit。为避免 plan 无限扩张，每条给必要参数，具体 detect/fix 实现参照 P2 `cjk_ascii_space` + Task 11 `font.body` 两条范本。

#### Task 12: font.h1（一级标题）
- `value: {family, size_pt, bold}`；检查 paragraph style 含 'Heading 1' 或 'Heading1' 的段落；fix 同 font.body

#### Task 13: paragraph.indent（段首缩进）
- `value: {first_line_chars: int}`（按字数，通常 2）
- 检查 `paragraph.paragraph_format.first_line_indent` 是否 = `first_line_chars * font_size` 的等效值
- fix：设 `first_line_indent`；蓝色标记第一个 run

#### Task 14: citation.format（引用格式，GB/T 7714）
- `value: {style: 'gbt7714', marker: 'bracket'}`
- detect 正则：`\[(\d+)\]` / `[1]` / `(张三, 2023)` 等混用检测
- fix：**不自动 fix**（学术引用改动风险高），`fix_available=False`，只检测

#### Task 15: figure.caption_pos / table.caption_pos
- 合并为一个 task（两条规则都在 `figure_table_caption.py`）
- `value: 'above' | 'below'`
- detect：扫 paragraph style 为 `Caption` 的段落，判断它相对于前后 `Figure` / `Table` 的位置
- fix：**不自动 fix**（需要重排段落），只检测 + 报错

#### Task 16: chapter.new_page（章节分页）
- `value: bool`
- 扫 `Heading 1` 段落，检查之前是否有 page break
- fix：在对应段落前插入 `paragraph.paragraph_format.page_break_before = True`

#### Task 17: quote.style（引号风格）
- `value: 'cjk' | 'ascii' | 'mixed'`
- detect：正则匹配 `"`、`"`、`"`、`'` 等；若 value='cjk' 则检测 ASCII `"`
- fix：替换 `"x"` → `"x"`（中文双引号配对）

#### Task 18: ai_pattern.check（去 AI 化）
- `value: {ruleset: 'thesis-default'}`
- detect：匹配 AI 典型句式（"首先我将... 其次... 综上所述...", 过多并列结构, "值得注意的是"等 marker）
- fix：**不自动 fix**（文体改动风险极高），只检测

#### Task 19: pagination（页眉页脚分页）
- `value: {front_matter: 'roman', body: 'arabic'}`
- detect：读 section 的 footer XML，检查是否有 `PAGE` field + 格式
- fix：**不自动 fix**（页眉页脚 XML 操作复杂，留 P4），只检测

每条单独 commit。示例：

```bash
git commit -m "feat(rules): font.h1 一级标题字体规则"
git commit -m "feat(rules): paragraph.indent 段首缩进规则"
git commit -m "feat(rules): citation.format 引用格式（只检测）"
git commit -m "feat(rules): figure/table caption 位置（只检测）"
git commit -m "feat(rules): chapter.new_page 章节分页"
git commit -m "feat(rules): quote.style 引号风格"
git commit -m "feat(rules): ai_pattern.check 去 AI 化（只检测）"
git commit -m "feat(rules): pagination 页眉页脚分页（只检测）"
```

Phase C 结束：`REGISTRY` 含全 11 条规则（cjk_ascii_space + 10 new）。

---

## Phase D — 模板提取（Task 20-22）

### Task 20: Python extractor（从 docx 反推规则值）

**Files:**
- Create: `src-python/thesis_worker/extractor.py`
- Create: `src-python/tests/test_extractor.py`

**职责：** 输入一个 docx，调每条规则的 detect **反向** 逻辑（查现值），返回 `{rules: {...}, evidence: [...]}`。

**设计：**

```python
# thesis_worker/extractor.py
from docx import Document
from .rules import REGISTRY
from .models import Issue

def extract_from_docx(file: str) -> dict:
    doc = Document(file)
    rules_draft = {}
    evidence = []
    for rule_id, rule in REGISTRY.items():
        if hasattr(rule, 'extract'):
            result = rule.extract(doc)
            rules_draft[rule_id] = {'enabled': True, 'value': result['value']}
            evidence.append({'rule_id': rule_id, 'source_xml': result.get('source_xml'), 'confidence': result.get('confidence', 0.5)})
        else:
            # 规则未实现 extract → 空占位
            rules_draft[rule_id] = {'enabled': False, 'value': None}
            evidence.append({'rule_id': rule_id, 'source_xml': None, 'confidence': 0.0})
    return {'rules': rules_draft, 'evidence': evidence}
```

**每条规则扩展 `extract()` 静态方法：**
- `font.body.extract(doc)` → 扫多数正文段落，返回 `{'value': {'family': '宋体', 'size_pt': 12}, 'source_xml': '<w:sz w:val="24"/>', 'confidence': 0.95}`
- 其它规则同理

**P3 范围只实现：** `font.body`、`font.h1`、`paragraph.indent`、`cjk_ascii_space`（返回"不可提取"因 allowed 是院校约束不是 docx 本身的）。其它规则返回 confidence=0 占位（用户手填）。

**Step 1-3：** 写 extract + pytest + commit

```bash
git commit -m "feat(extractor): 从 docx 反推模板规则（4 条可提取 + 其它占位）"
```

---

### Task 21: Rust extract_template_cmd 透传

**Files:**
- Modify: `src-python/thesis_worker/handlers.py`（`_handle_extract_template` 实现调 `extractor.extract_from_docx`）
- Modify: `src-tauri/src/sidecar.rs`（如需 extract_template 的特殊 JSON 处理，其它已透传 OK）

**Step 1-2：** 实现 + sidecar smoke test（echo `{cmd:'extract_template', file:'...'}` 看返回 rules draft）+ commit

```bash
git commit -m "feat(sidecar): handlers extract_template 接入 extractor"
```

---

### Task 22: TemplateExtractor 前端表格编辑器

**Files:**
- Create: `src/features/tools/templates/TemplateExtractor.tsx`
- Modify: `src/features/tools/templates/TemplateManager.tsx`（"从 docx 新建" 按钮不再是占位，改为打开 TemplateExtractor modal）

**TemplateExtractor 组件：**

```
┌──────────────────────────────────────────┐
│ 从 docx 创建模板：<filename>.docx         │
├──────────────────────────────────────────┤
│ rule_id   | 提取值      | 证据 | 置信度 | 操作 |
│ font.body | 宋体 12pt   | ...  | 0.95  | ✓ ✎ |
│ ...                                      |
├──────────────────────────────────────────┤
│ [取消]                        [保存为模板] │
└──────────────────────────────────────────┘
```

- 拿到 `extract_template` 结果 → 渲染表格
- 用户可对每条：✓ 确认（接受提取值） / ✎ 修改（打开 RuleValueEditor） / 🔘 置为 enabled:false
- 点"保存为模板" → `TemplateStore.create(name, rules)` → 刷新

**Step 1-3：** 实现 + 联调 + commit

```bash
git commit -m "feat(templates): TemplateExtractor 表格编辑器（从 docx 提取 review）"
```

---

## Phase E — 工具箱 UI + 模板接入（Task 23-24）

### Task 23: ToolBoxGrid 分类卡片

**Files:**
- Create: `src/features/tools/ToolBoxGrid.tsx`
- Modify: `src/features/tools/ToolsWorkspace.tsx`

**UI：** 按 spec Section 5 "UI 工具箱映射" 分组：

```
┌────────────────┬────────────────┬────────────────┐
│ 📝 论文格式检测 │ 📎 引用格式化   │ 📊 图表规范    │
│ font.*         │ citation.format│ figure.*       │
│ paragraph.*    │                │ table.*        │
│ chapter.*      │                │                │
│ [运行]         │ [运行]         │ [运行]         │
├────────────────┼────────────────┼────────────────┤
│ ✍ 写作质量辅助  │ 🤖 去 AI 化检测 │                │
│ cjk_ascii_space│ ai_pattern.check│                │
│ quote.style    │                │                │
│ [运行]         │ [运行]         │                │
└────────────────┴────────────────┴────────────────┘
```

- 点"运行"打开对应 ToolRunner（传入 `ruleIds: string[]` 只跑这些规则）
- ToolRunner 在 sidecar invoke 前按传入 ruleIds 过滤 activeTemplate.rules（临时 template 只启用当前工具的规则）

**Step 1-2：** 实现 + commit

```bash
git commit -m "feat(tools): ToolBoxGrid 按 category 分组卡片入口"
```

---

### Task 24: ToolRunner 接入 activeTemplate + 规则过滤

**Files:**
- Modify: `src/features/tools/ToolRunner.tsx`

**改动：**
- 删除 hardcode 的 `P2_TEMPLATE`
- 从 `useToolsStore` 读 `activeTemplateId`，从 `useTemplateStore` 读对应 template
- detect 时传 `template = { rules: filterByToolCategory(template.rules, activeToolId) }`
- 无 activeTool 时用完整 template

**Step 1-3：** 改 + 测试 + commit

```bash
git commit -m "feat(tools): ToolRunner 接入 activeTemplate + 工具过滤"
```

---

## Phase F — 迁移 + CI + 最终验证（Task 25-29）

### Task 25: 升级迁移（新规则 enabled:false 追加）

**Files:**
- Modify: `src/features/tools/templates/TemplateStore.ts`（`load()` 后调 `migrateNewRules()`）

**实现：**

```ts
async load() {
  const list = await invoke<TemplateJson[]>('template_list_cmd');
  set({ templates: list });
  // 拿 sidecar 支持的规则列表
  const { rules: supported } = await sidecarInvoke<{ rules: string[] }>({ cmd: 'list_rules' });
  // 对每个 template 补齐新规则
  const builtin = list.find((t) => t.id === '_builtin-gbt7714');
  if (!builtin) return;
  const newRuleIds = supported.filter((id) => !(id in builtin.rules));
  if (newRuleIds.length > 0) {
    await get().migrateNewRules(newRuleIds);
  }
}
```

**UI 横幅：** 检测到 migration 发生时弹提示 "发现 N 条新规则可启用"（`<MigrationBanner>` 组件）。

**Step 1-3：** 实现 + test（mock template 字段缺失一条 → migrate 后自动补）+ commit

```bash
git commit -m "feat(templates): schema 迁移 + 新规则追加横幅"
```

---

### Task 26: 备份清理 + 错误处理对齐

**Files:**
- Modify: `src-tauri/src/lib.rs`（setup 已在 Task 1 加 cleanup_old_backups 异步调用；这里验证 + 补充错误日志）
- Modify: `src/features/tools/ErrorModal.tsx`（spec Section 7："修复后重读验证失败"等 case 的特殊提示文案）

**Step 1-2：** 错误文案 + commit

```bash
git commit -m "refactor(tools): ErrorModal 针对 spec Section 7 各 case 优化文案"
```

---

### Task 27: CI 扩展（Python 测试矩阵扩大）

**Files:**
- Modify: `.github/workflows/release.yml`

**改动：**
- 已有 "Python sidecar tests" 步骤自动覆盖新规则（pytest 会自动 discover）
- 新增 "LibreOffice headless 验证" 步骤（spec Section 8 E2E）—— **P3 可选**：因涉及 apt install，麻烦
- 推荐：只验证规则单元 + 前端/Rust 测试（已有）

**P3 决定：** 先不加 LibreOffice 步骤。Task 27 实际改动为确认现有 CI 能自动 cover P3 新增，**不动 yml**。

```bash
# 本 task 无 commit
```

---

### Task 28: 端到端手动验证（spec 成功标准核对）

检查清单（对 spec Section "成功标准"）：

- [ ] 启动 app → tab 切换 < 100ms（已 P1 验证）
- [ ] "工具" tab 下至少 3 个工具可用（Phase E ✓）
- [ ] 开 DOCX → 检测 → 逐条修复 → 蓝色标记（Phase A ✓）
- [ ] PDF 只检测（P3 不含 PDF！留 P4）
- [ ] 上传 `/Users/oi/CodeCoding/Code/毕设/毕设-茶园生态管理系统/docs/论文格式模板.docx` → 提取 ≥10 条规则 → 空 ≤5（Phase D 验证，可能达不到 10 条因 extractor 只覆盖 4 条；修正预期为 ≥4 条非空）
- [ ] 存 ≥2 模板 → 切换 → 同一文档报告不同（Phase B + C）
- [ ] 修复自动备份 → Cmd+Z 撤销 → 30 天清理（Phase A）
- [ ] 内置可编辑/删除/恢复（Task 6）

**P3 范围明确：** PDF 只检测是 **P4 范围**，不强求 P3 覆盖。

**Step 1-3：** 真实 docx 跑一轮 + 问题清单 + commit fix 或进 P4 backlog

---

### Task 29: milestone tag

```bash
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm
git tag -a milestone-p3-tools -m "P3 完成：模板系统 + 10 条规则 + 修复 UI + 备份/undo"
git tag -l milestone-p3-tools
```

---

## Self-Review（P3）

- **Spec 覆盖**：
  - Section 4（模板存储与提取）：Phase B + D ✓
  - Section 5（规则引擎）：Phase C 10 条 + P2 已有 cjk_ascii_space ✓；**UI 工具箱** Phase E ✓
  - Section 6（备份/undo/蓝色标记）：Phase A Task 1 备份 + Task 5 undo + 蓝色标记沿用 P2 约定 ✓
  - Section 7（错误不降级）：贯穿，Task 26 对齐文案 ✓
  - Section 8（测试策略）：每条规则 reopen 硬测试 + front-end vitest + rust integration ✓

- **显式不在本 plan 范围（移交 P4）：**
  - PDF 只检测（pdfplumber 集成）
  - 规则 ai_pattern / pagination / figure.caption_pos / citation.format 的**自动 fix**（P3 只检测）
  - LibreOffice headless CI E2E
  - 蓝色标记复杂场景（跨 run 违规、样式类修改 vs 文本类修改分层）

- **Placeholder 扫描：**
  - Task 10 "Phase D 未完成占位" 已在 Task 22 补齐
  - Task 27 "可选 LibreOffice 步骤不加" 已明确

- **类型一致：**
  - `TemplateJson` 在 Rust / TS 两端字段名匹配（schema_version / id / name / source / updated_at / rules）
  - `IssueDict` 的 snippet/context 沿用 P2 已建立的（新规则必须在 detect 时填）

- **独立可交付：** P3 完成后 tools tab 完整可用，非严重路径（PDF / 复杂 fix）留 P4。

---

## 下一个 plan

P4 - `docs/superpowers/plans/2026-XX-XX-p4-pdf-advanced-fixes.md`：
- PDF 检测（pdfplumber 集成 + 规则适配）
- 复杂 fix 规则（citation.format / ai_pattern 自动改写 / figure.caption_pos 重排）
- CI LibreOffice E2E
- Sidecar integration test（`src-tauri/tests/sidecar_protocol.rs`，P2 final review 提及的 gap）
- ToolRunner/ErrorModal 组件测试
- CI x86_64-apple-darwin matrix 恢复（universal2 Python 或 macos-13 runner）
- Windows 上蓝色标记 / 备份的回归测试

---

## Subagent 调度建议（使用 superpowers:subagent-driven-development）

- **Phase A / B / E / F** 里"改状态/UI/Rust"类 task：model=`sonnet`（机械度高）
- **Phase C** 的 10 条规则：每条独立 dispatch，model=`sonnet`（参数清晰，参照前例）
- **Phase D** 的 extractor：model=`sonnet`，但 evidence / confidence 算法若复杂可 escalate 到 `opus`
- **final review（Task 28）**：model=`opus`（跨 phase 综合判断）

控制器按 P2 流程：每 task 先 implementer → spec-reviewer → code-quality-reviewer，review 过才 mark complete。

---

## 估计规模

- 29 tasks，估计 50-70 commits（每 task 1-3 commit）
- Python 侧 ~1200 行新代码（规则 + extractor + tests）
- Rust 侧 ~600 行（template_cmd + backup_cmd + tests）
- 前端 ~1500 行（templates/ + IssueList + DiffPreview + toolsStore + tests）
- 时间（单人 + subagent 辅助）：约 3-5 天全链路跑完

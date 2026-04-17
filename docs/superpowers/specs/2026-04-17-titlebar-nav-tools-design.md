# GhostTerm 标题栏三分区导航 + 论文检测修复工具

**Date**: 2026-04-17
**Status**: Design approved, pending plan
**Owner**: Atlas.oi

## 概述

### 目标
在 GhostTerm 标题栏加入 **项目 / 工具 / 进度** 三分区顶层 Tab 导航。把 `/thesis` skill 的规则型论文检测与修复能力独立封装到"工具"分区，脱离大模型依赖，使用 Python sidecar 保障 DOCX 修改质量。

### 范围
- 三分区 Tab 架构（含 macOS + Windows 统一布局）
- "工具" 分区：DOCX 检测 + 逐条修复（in-place 写回，蓝色标记），PDF 只检测
- 配置模板：全局存储，支持从 DOCX 自动提取规则
- "进度" 分区：仅占位，暂不实现功能

### 排除项
- DOC 老格式、MD、纯文本
- PDF 任何写入
- DOCX 说明性文字 NLP 解析
- 规则 WYSIWYG 编辑器
- 蓝色标记的 GhostTerm 内审核面板
- 规则严重度分级（UI 行为差异）
- 云端同步 / 模板市场
- 大模型生成/改写
- Tab 切换快捷键
- Tab 上次激活 localStorage 持久化

---

## 1. 架构总览

### 三进程分层

```
┌────────────────────────────────────────────────┐
│ 前端 React/TS (主进程 WebView)                 │
│  - TitleBarNav (三 tab 路由)                   │
│  - ProjectWorkspace (现有，包装成 Tab 子树)    │
│  - ToolsWorkspace (新)                         │
│  - ProgressWorkspace (新占位)                  │
└───────────────────┬────────────────────────────┘
                    │ Tauri invoke
┌───────────────────▼────────────────────────────┐
│ Rust 命令层                                    │
│  - tools_cmd.rs    → 启停 sidecar / JSON 路由  │
│  - template_cmd.rs → ~/.ghostterm/templates/   │
│  - backup_cmd.rs   → 备份 + 30 天清理          │
└───────────────────┬────────────────────────────┘
                    │ stdin/stdout NDJSON 协议
┌───────────────────▼────────────────────────────┐
│ Python sidecar (ghostterm-thesis, PyInstaller) │
│  - python-docx    → docx 读写                  │
│  - pdfplumber     → PDF 只读                   │
│  - rules/         → 规则注册表 (detect + fix)  │
│  - extractor/     → 模板提取 (从 docx 反推)    │
└────────────────────────────────────────────────┘
```

### 职责划分
- **前端**：UI、交互、状态管理（Zustand），不碰 docx
- **Rust**：安全边界（文件系统权限、sidecar 生命周期、备份）
- **Python**：所有 docx 读写 + 规则逻辑（检测和修复同一 codebase）

### Sidecar 生命周期
常驻 worker 模式——用户首次进入"工具" tab 时 Rust spawn sidecar，常驻到 app 退出；不是每次操作 spawn/kill。

### 数据边界
docx 文件路径由前端传（绝对路径），Rust 验证路径合法后下发给 sidecar；sidecar 只返回"操作结果 JSON"（issues / diff / status），不返回原始 docx 内容。

---

## 2. 前端组件与 Tab 路由

### 组件树

```
App
├── WindowTitleBar（现有，改造）
│   ├── BrandCluster       ← 跨平台左对齐（icon + "GhostTerm" 同行）
│   ├── flex spacer
│   ├── TabNav             ← 新增：项目 / 工具 / 进度
│   ├── SettingsButton
│   └── Win32Controls      ← 仅 Windows（- ▢ ✕）
│
└── WorkspaceRouter        ← 新增：三子树并存
    ├── <ProjectWorkspace>   style={display: activeTab==='project' ? 'flex' : 'none'}
    ├── <ToolsWorkspace>     style={display: activeTab==='tools' ? 'flex' : 'none'}
    └── <ProgressWorkspace>  style={display: activeTab==='progress' ? 'flex' : 'none'}
```

### Title Bar 跨平台布局

**统一规则**：品牌左对齐（icon + name 同行）+ flex spacer + 三 tab 右对齐紧邻设置齿轮。macOS 红黄绿控件最左，Windows `- ▢ ✕` 最右。

```
macOS:   🔴🟡🟢 │ 👻 GhostTerm ────────────── [项目] 工具 进度 │ ⚙
Windows:          👻 GhostTerm ────────────── [项目] 工具 进度 │ ⚙ │ - ▢ ✕
```

### 状态管理

`src/shared/stores/tabStore.ts`（Zustand）

```ts
interface TabState {
  activeTab: 'project' | 'tools' | 'progress';
  setActive(tab: TabState['activeTab']): void;
}
```

- **不持久化**到 localStorage，每次启动默认回 `'project'`
- 三 Workspace 常驻 DOM，非激活的 `display:none` 保活（参照 `feedback_xterm_display_none`）
- **不加快捷键**（不绑 Cmd+1/2/3）

### 新 feature 目录

```
src/features/tools/
  ToolsWorkspace.tsx          ← 容器
  ToolBoxGrid.tsx             ← 工具箱列表
  ToolRunner.tsx              ← 选文件 + 运行 + 结果
  IssueList.tsx               ← 逐条问题 + 修复按钮
  DiffPreview.tsx             ← 修复前 diff
  templates/
    TemplateStore.ts          ← 模板 CRUD
    TemplateSelector.tsx      ← 顶部下拉
    TemplateExtractor.tsx     ← 上传 docx → 表格编辑器预览
  toolsStore.ts               ← active tool / active template / undo stack

src/features/progress/
  ProgressWorkspace.tsx       ← "敬请期待"占位
```

### Tab 视觉
- 未激活：`color: var(--c-fg-muted)`
- 激活：`color: var(--c-accent)` + `border-bottom: 2px solid var(--c-accent)`
- hover：`color: var(--c-fg)`
- 过渡：140ms ease-out（匹配 `--dur-base`）

---

## 3. Python Sidecar 协议（IPC）

### 生命周期
- Rust 用 `tauri_plugin_shell::Command::new_sidecar("ghostterm-thesis")` 启动
- 首次进入"工具" tab spawn；app 退出 SIGTERM
- 常驻 worker 避免冷启动延迟
- 监听 `child.stdout.lines()` + `child.stderr.lines()`；stderr 仅日志不进业务

### 协议：NDJSON（行分隔 JSON）
每条消息一行 JSON，换行分隔。

**请求（Tauri → sidecar）**
```json
{"id":"req-7","cmd":"detect","file":"/path/x.docx","template_id":"sjtu-2024"}
{"id":"req-8","cmd":"fix","file":"/path/x.docx","issue_id":"cite-3","template_id":"sjtu-2024"}
{"id":"req-9","cmd":"extract_template","file":"/path/template.docx"}
```

**响应（sidecar → Tauri）**
```json
{"id":"req-7","ok":true,"result":{"issues":[...]}}
{"id":"req-7","ok":false,"error":"file not found","code":"ENOENT"}
```

### 命令集

| cmd | 作用 |
|-----|------|
| `detect` | 按 template 跑所有启用规则，返回 issues |
| `fix` | 按单个 issue_id 修复（写回 docx） |
| `fix_preview` | 只返回 diff 不写回 |
| `extract_template` | 从 docx 反推规则草稿 |
| `list_rules` | 返回当前 template 下所有规则清单 |
| `cancel` | 取消进行中的请求（用户点"取消"） |

### 并发
Sidecar 单线程按 id 顺序处理；前端 `await invoke` 自然串行。

---

## 4. 配置模板存储与提取

### 存储位置

```
~/.ghostterm/
  templates/
    _builtin-gbt7714.json    ← 内置默认（12 条核心规则，下划线前缀）
    sjtu-2024.json           ← 用户上传/创建
    tsinghua-master.json
  .bak/                      ← 修复前备份（docx 副本）
  logs/                      ← sidecar stderr
```

### 模板 JSON Schema v1

```json
{
  "schema_version": 1,
  "id": "sjtu-2024",
  "name": "上海交大 2024 本科",
  "source": {
    "type": "extracted",
    "origin_docx": "~/Desktop/论文格式模板.docx",
    "extracted_at": "2026-04-17T10:00:00Z"
  },
  "updated_at": "2026-04-17T11:20:00Z",
  "rules": {
    "font.body":           { "enabled": true, "value": {"family":"宋体","size_pt":12} },
    "font.h1":             { "enabled": true, "value": {"family":"黑体","size_pt":16,"bold":true} },
    "paragraph.indent":    { "enabled": true, "value": {"first_line_chars":2} },
    "citation.format":     { "enabled": true, "value": {"style":"gbt7714","marker":"bracket"} },
    "figure.caption_pos":  { "enabled": true, "value": "below" },
    "table.caption_pos":   { "enabled": true, "value": "above" },
    "cjk_ascii_space":     { "enabled": true, "value": {"allowed": false} },
    "chapter.new_page":    { "enabled": true, "value": true },
    "quote.style":         { "enabled": true, "value": "cjk" },
    "ai_pattern.check":    { "enabled": true, "value": {"ruleset":"thesis-default"} },
    "pagination":          { "enabled": true, "value": {"front_matter":"roman","body":"arabic"} }
  }
}
```

扁平点号 key 便于增减和表单渲染；`schema_version` 支持未来迁移。

### 内置模板（独立 CRUD + 可编辑）

**重要**：内置模板不是"只读原型"，而是**可编辑的默认起点 + 所有新模板的基础规则来源**。

| 操作 | 行为 |
|------|------|
| Read | `get_template('_builtin-gbt7714')` 和其它模板等价 |
| Update | 用户可在"模板管理"直接编辑内置规则 |
| Delete | 允许删除；启动检测缺失 → 自动重建硬编码默认；也提供"恢复默认"按钮 |
| Restore | 把内置模板重置为硬编码默认（确认 dialog） |

### 新模板创建（深拷贝 + 隔离）

```
用户点"新建模板"
  ↓
后端 clone_builtin_rules()：深拷贝当前内置的 rules（值拷贝非引用）
  ↓
新模板 = { id:<新>, name:<用户填>, rules:<深拷贝>, source.type: manual | extracted }
  ↓
如果同时上传了 docx：extract 值 override 对应 rule；未提取的保留基础值
  ↓
用户在表格编辑器 review / 编辑 / 保存
```

**关键隔离保证**：
- 内置模板 rules 改动**不影响**已存在的用户模板（它们各有独立副本）
- 用户模板 rules 改动**不影响**内置模板
- 隔离在存储层自然实现（每个模板独立 JSON 文件）

### 升级时 Schema 迁移

App 升级后若内置模板硬编码默认多了新规则：
- **新规则以 `{enabled: false}` 追加到所有已存在用户模板**
- UI 顶栏提示"N 条新规则可启用"
- 用户自主决定启用

### 模板 CRUD 命令（Rust `template_cmd.rs`）

| command | 作用 |
|---------|------|
| `list_templates()` | 列全部（含 builtin） |
| `get_template(id)` | 读单个 |
| `save_template(json)` | 写/覆盖 |
| `delete_template(id)` | 删（内置删后自动重建） |
| `import_template(path)` | 外部 JSON → 复制，生成新 id |
| `export_template(id, path)` | 导出到用户指定路径 |
| `extract_from_docx(path)` | 调 sidecar → 返回 rule draft（未保存） |
| `restore_builtin()` | 把内置模板重置为硬编码默认 |

### 提取预览（表格编辑器）

Python `extract_template` 返回：
```json
{
  "rules": {...},
  "evidence": [
    {"rule_id":"font.body","source_xml":"<w:rPr>...","confidence":0.95},
    {"rule_id":"citation.format","source_xml":null,"confidence":0.0}
  ]
}
```

前端 `TemplateExtractor.tsx` 表格：
| rule_id | 提取值 | 证据片段 | 置信度 | 操作 |
|---------|--------|---------|--------|------|
| font.body | 宋体 12pt | `<w:sz w:val="24"/>` | 0.95 | ✓ 确认 / ✎ 修改 |
| citation.format | 未检出 | — | 0.0 | 🔘 手填 |

---

## 5. 规则引擎与分类

### Python 规则抽象

```python
@dataclass
class Rule:
    id: str                              # 扁平 key 'font.body' 等
    category: str                        # 'format'|'citation'|'structure'|'writing'|'ai'
    severity: str                        # 'blocker'|'warning'|'info'（仅展示排序）
    detect: Callable[[Document, Value], list[Issue]]
    fix: Callable[[Document, Issue, Value], FixResult] | None

@dataclass
class Issue:
    rule_id: str
    loc: Location                        # {para:int, run:int, page:int?}
    message: str
    current: Any
    expected: Any
    fix_available: bool
    evidence_xml: str | None

@dataclass
class FixResult:
    diff: str                            # 可读 unified diff
    xml_changed: list[str]
```

### 规则注册表

```python
# thesis_worker/rules/__init__.py
REGISTRY: dict[str, Rule] = {
    'font.body':          FontBodyRule,
    'font.h1':            FontH1Rule,
    'paragraph.indent':   ParagraphIndentRule,
    'citation.format':    CitationFormatRule,
    'figure.caption_pos': FigureCaptionPosRule,
    'table.caption_pos':  TableCaptionPosRule,
    'cjk_ascii_space':    CjkAsciiSpaceRule,
    'chapter.new_page':   ChapterNewPageRule,
    'quote.style':        QuoteStyleRule,
    'ai_pattern.check':   AiPatternRule,
    'pagination':         PaginationRule,
}
```

### UI 工具箱映射

| UI 工具 | category | 示例 rule_id |
|---------|----------|--------------|
| 论文格式检测 | `format` | font.*、paragraph.*、chapter.*、pagination |
| 引用格式化 | `citation` | citation.format |
| 图表规范 | `structure` | figure.*、table.* |
| 写作质量辅助 | `writing` | cjk_ascii_space、quote.style |
| 去 AI 化检测 | `ai` | ai_pattern.check |

### Detect/Fix 流程

**Detect**（触发方式：**逐工具手动**）：
```
sidecar 收 {cmd:detect, file, template_id}
  → 加载 template.json → rules 字典
  → Document = python_docx.Document(file)
  → 迭代启用的 rules，收集 issues
  → 返回 {issues: [...]}
```

**Fix**（每次单个 issue）：
```
sidecar 收 {cmd:fix, file, issue_id, template_id}
  → Rust 先做 backup_cmd 写 snapshot
  → 打开 docx → 找 issue.loc 节点
  → rule.fix(doc, issue, expected)
  → 改动的 run 追加 <w:color w:val="0070C0"/> 蓝色标记
  → doc.save(file)
  → 返回 {diff, applied: true}
```

### 规则文件组织

```
src-python/thesis_worker/rules/
  font_body.py              ← 单规则单文件
  citation_format.py
  cjk_ascii_space.py
  ...
  tests/
    test_font_body.py       ← 配 fixture docx
    ...
```

---

## 6. 备份、Undo、蓝色标记

### 备份目录结构

```
~/.ghostterm/.bak/
  <hash>/                      ← sha256(原路径) 前 12 位
    meta.json                  ← {origin_path, first_backed_at, last_modified}
    v0_original_2026-04-17T10-00.docx
    v1_2026-04-17T10-15.docx
    v2_2026-04-17T10-22.docx
```

### Rust `backup_cmd.rs`

```rust
backup_before_fix(origin_path) -> Result<Snapshot>
  // <hash>/v0 不存在则 copy origin → v0；否则写 v{n+1}
restore_from_snapshot(origin_path, version) -> Result<()>
list_snapshots(origin_path) -> Vec<SnapshotInfo>
cleanup_old_backups() -> u32
  // 扫描 .bak/**/*.docx，mtime > 30 天删除；v0 也按 mtime 判断
```

**清理时机**：app 启动异步跑一次，不阻塞 UI。

### Undo 栈（前端 toolsStore）

```ts
interface UndoEntry {
  fileHash: string;
  snapshotVersion: number;
  issueId: string;
  timestamp: number;
}

interface ToolsStore {
  undoStack: UndoEntry[];
  pushUndo(entry): void;
  undo(): Promise<void>;     // 弹栈顶 → restore_from_snapshot(v-1)
}
```

`Cmd+Z`（macOS）/ `Ctrl+Z`（Windows）只在"工具" tab 内绑定；跨 tab 不生效（"项目" tab 的 Cmd+Z 仍归 CodeMirror）。

### 蓝色标记

Python sidecar 写入被修改的 run：追加 `<w:rPr><w:color w:val="0070C0"/></w:rPr>`（Office "蓝色, 个性色 1"）：
- 文本类修改（替换字符、补/删空格）：改动 run 整体变蓝
- 样式类修改（改字体字号）：被改样式的 run 变蓝 + 应用新样式
- Word 打开可一眼看出"改了哪些"；手动改回黑色表示"已 review"（GhostTerm 不管理 review 状态）

### 边界情况
原文件在 .bak 外被用户手动编辑（比如直接在 Word 里改了）→ snapshot hash 失效 → undo 时 UI 提示"检测到文件已被外部修改，恢复可能覆盖您的改动，继续？"

---

## 7. 错误处理（不降级，暴露即修）

### 总原则
- 任何异常 → **直接向上抛到 UI**
- 不自动 retry / restart / skip / fallback
- 保留证据（snapshot、traceback、stderr）不清理
- 用户可见错误，由用户决策下一步

### Sidecar 进程层面

| 失败 | 处理 |
|------|------|
| Sidecar 启动失败（二进制缺失/权限不足） | Rust 返回 `SidecarStartError`（含 stderr + 期望路径 + arch）→ UI modal + 工具 tab 头部红 banner；**不进入 tool UI**；"查看日志" + "复制错误"按钮 |
| Sidecar 运行时 panic（stdout 流断开） | **不自动 kill+restart**；panic 堆栈返回 UI modal；当前请求失败；用户点"重启 sidecar"才 spawn 新进程 |
| 无响应（hang） | **不做 ping 自动检测**；用户点"取消" → kill sidecar，报 kill 结果 |
| 大请求长时（50MB docx 超 60s） | UI 显示"仍在运行" + "取消"按钮；取消 → 发 `cancel` 消息；不响应则 kill |

### 文件层面

| 情况 | 行为 |
|------|------|
| ENOENT（不存在/被移走） | UI modal 显示完整错误 + 路径 |
| EPERM（权限不足/Word 锁定） | UI modal：`无法写入 {path}，可能被 Word 打开或无权限`；**不自动重试** |
| PARSE_ERROR（docx 损坏） | UI modal 显示完整 Python traceback + 出错 XML 片段 |
| Windows 被 Word 锁定 | PermissionError → EPERM，同上 |

### 修复层面

| 情况 | 行为 |
|------|------|
| `fix` 执行中异常 | **不回滚 snapshot**（保留证据）；origin 不写入；UI modal 显示 traceback + rule_id + snapshot 路径；用户决策 |
| 修复后重读验证失败 | **不自动回滚**；UI modal："修复后文件验证失败" + traceback + "从 v{n-1} 手动恢复"按钮 |
| Undo 时 snapshot 缺失（30 天清理） | UI 报 `snapshot v{n} not found at <path>`；**不隐瞒** |

### 规则层面

| 情况 | 行为 |
|------|------|
| 单条规则 detect 抛异常 | **整批检测中止**（不跳过其它规则）；UI modal：rule_id + 完整 traceback |
| 规则返回 Issue schema 不合法 | 抛出，UI 报 schema 错误细节 |

### Python runtime 层面

| 情况 | 行为 |
|------|------|
| 安装包 sidecar 二进制缺失 | 工具 tab 红 banner：明确缺失文件**绝对路径** + 原因；不用"安装异常请重下"含糊话术 |
| 二进制架构不匹配 | Rust 启动 SIGKILL → UI 显示 `file <binary>` 输出 + 期望架构 |

### 日志 + UI
- `~/.ghostterm/logs/thesis-worker.log`：append only，**不自动轮转、不自动清**
- 错误 modal 必有**"复制完整错误信息"**按钮
- 关键错误必须 modal（不能只 toast）

---

## 8. 测试策略

### 四层测试金字塔

```
┌────────────────────────────────────────┐
│ E2E（少量，高信心）                    │
│   真实 docx 端到端：打开→检测→修复→验证│
├────────────────────────────────────────┤
│ 集成（Rust ↔ Python）                 │
│   Rust 启 sidecar + JSON 协议往返     │
├────────────────────────────────────────┤
│ 单元（大量，快）                      │
│   前端 TS (Vitest)                    │
│   Rust (cargo test)                   │
│   Python (pytest)                     │
└────────────────────────────────────────┘
```

### 前端（Vitest）
- `tabStore.test.ts`：active tab 切换 / 启动默认回"项目" / 三子树保活
- `TemplateStore.test.ts`：CRUD / 深拷贝隔离 / 内置独立 / schema 迁移（新规则 enabled:false 追加）
- `toolsStore.test.ts`：undo 栈 push/pop / Cmd+Z 只在 tools tab 生效
- `DiffPreview.test.tsx`：diff 渲染
- Mock Tauri invoke（`vi.mock('@tauri-apps/api/core')`）

### Rust（cargo test）
- `backup_cmd`：snapshot 命名 / v0 不覆盖 / 30 天清理（用 `filetime` 操纵 mtime）
- `template_cmd`：读写 JSON / 内置缺失自动重建 / 路径安全
- `sidecar_cmd`：mock sidecar 脚本验证 JSON 协议 + 错误传播

### Python（pytest）

```
src-python/tests/
  fixtures/
    normal.docx
    bad_font_body.docx
    bad_citation.docx
    bad_figure_caption.docx
    cjk_space.docx
    full_bad.docx         ← 含所有违规，E2E 用
  rules/
    test_font_body.py     ← detect + fix + reopen verify
    ...
  test_extractor.py
```

**每条规则必备测试模式**：
```python
def test_fix_reopen():
    # 修复后重开 docx 验证可读 + 规则重跑无 issue
    with tempfile.copy(original) as f:
        RULE.fix(Document(f), issue, expected)
        reopened = Document(f)
        assert RULE.detect(reopened, expected) == []
```

**"修复后重开验证"是硬测试**，防止写回破坏 docx 结构。

### E2E
启动 app → tools tab → 上传 `full_bad.docx` → 检测 → 修复全 issues → 下载修复后文件 → python-docx 校验规则全通过 + LibreOffice headless 在 CI 验证打开正常。

### CI 集成（扩展 `.github/workflows/release.yml`）

```yaml
- name: Python tests
  run: cd src-python && uv run pytest
- name: Rust tests
  run: cd src-tauri && cargo test
- name: Frontend tests
  run: pnpm test -- --run
```

三套全绿才进打包阶段。

### 覆盖率目标
- Python 规则：单规则 100% fix+detect 测试（含有违规/无违规/边界），修复后重开必测
- 前端：关键 store/组件 ≥ 80%
- Rust：核心 cmd 100%

---

## 成功标准

- Title 栏三 tab 点击切换 < 100ms；当前 tab 高亮；切换时终端 PTY / 编辑器 session 保活
- "工具" tab 下至少"引用格式化 / 论文格式检测 / 写作质量"三个工具可用
- 能打开 DOCX → 检测 → 逐条修复 → 写回（修改处蓝色标记）
- PDF 能打开并出检测报告（只读）
- 上传 `/Users/oi/CodeCoding/Code/毕设/毕设-茶园生态管理系统/docs/论文格式模板.docx` → 预览表自动填 ≥10 条规则，剩 ≤5 空项
- 存 ≥2 个不同院校模板 → 下拉切换 → 对同一论文检测得到不同报告
- 修复 docx → 自动备份到 `.bak/`；Cmd+Z 可撤销；30 天后自动清理
- 内置模板可独立编辑、删除、恢复默认，不影响用户已创建的模板

---

## 关键决策记录

| 决策 | 选择 | 依据 |
|------|------|------|
| 切换形态 | Tab 式主区整体替换 | 顶层 mode 清晰 |
| 跨平台 title bar | 品牌左 + tabs 右紧邻设置（两平台一致） | 用户心智统一 |
| 工作流 | 工具箱式 | 规则型检测天然按工具分类 |
| 修复交互 | 逐条确认 + diff 预览 | 学术文档最安全 |
| 文件来源 | 独立文件选择器 | 论文不一定在项目目录内 |
| 支持格式 | DOCX + PDF（PDF 只读） | 论文主流；PDF 结构限制 |
| 写回安全 | 自动备份 + undo 栈 + 蓝色标记 | 可回退 + 视觉识别 |
| 备份存留 | 滚动 30 天 | 安全与磁盘占用平衡 |
| 触发方式 | 逐工具触发 | 用户自主 |
| 模板存储 | 全局 `~/.ghostterm/templates/*.json` | 跨项目复用 |
| 内置模板 | 可编辑 + 独立 CRUD + 新模板深拷贝其 rules | 用户完全掌控，副本隔离 |
| 升级新规则 | 以 `enabled:false` 追加到已有用户模板 | 发现性 + 自主性 |
| 提取策略 | 自动 + 证据 + 表格编辑器预览确认 | 用户可控兼顾便利 |
| 默认内置规则 | 12 条最小核心 | 零配置即用 |
| 中英空格 | **不能有空格** | 院校特定要求 |
| 技术栈 | 方案 3 纯 Python sidecar（PyInstaller 打包） | 修复质量硬约束；JS docx 修改生态不成熟 |
| IPC 协议 | NDJSON over stdio | 简单够用 |
| Sidecar | 常驻 worker，单进程串行 | 避免冷启动延迟 |
| 快捷键 | **不加** tab 切换快捷键 | 避免和编辑器/终端冲突 |
| 启动默认 | 每次回"项目"，不持久化上次 | 预期行为一致 |
| 错误处理 | 不降级，直接抛出 + modal + 保留证据 | 项目 CLAUDE.md 核心原则 |
| Python runtime | PyInstaller 打包嵌入式 | 用户零依赖安装 |

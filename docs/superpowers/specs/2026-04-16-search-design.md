# GhostTerm 项目内全文搜索 — 设计文档

**日期**: 2026-04-16  
**状态**: 待实现  
**作者**: Atlas.oi

---

## 1. 背景与目标

GhostTerm 目前缺少在激活项目中搜索代码或文本的能力。本功能实现一个类 VS Code 全局搜索的弹窗，支持文件内容全文搜索和文件名搜索，搜索范围严格限定于当前激活项目。

**核心目标**：用户在项目名旁点击搜索图标 → 弹窗打开 → 输入关键词 → 点击结果 → 编辑器打开对应文件并跳到匹配行。

---

## 2. 需求摘要

### 功能需求

| 编号 | 需求 |
|------|------|
| F1 | 入口：激活项目名旁显示搜索图标，仅在有激活项目时可点击 |
| F2 | 弹窗：居中大弹窗，背景模糊遮罩，Esc 关闭 |
| F3 | 双模式 Tab：内容搜索（F）/ 文件名搜索（P） |
| F4 | 搜索选项：大小写敏感（Aa）、全词匹配（ab）、正则（.*） |
| F5 | 结果区（上半）：按文件分组，显示行号 + 行内容，关键词高亮 |
| F6 | 预览区（下半）：选中结果时显示文件 ±5 行上下文，高亮匹配行 |
| F7 | 文件过滤：右下角 glob 输入框（如 `*.ts`），空值 = 不过滤 |
| F8 | 键盘：↑↓ 在结果间导航，↵ 打开文件跳到匹配行，Esc 关闭 |
| F9 | 搜索范围：仅当前激活项目，自动尊重 .gitignore |
| F10 | 结果点击/回车：编辑器打开文件并滚动到匹配行（居中显示） |

### 排除项

- 跨项目搜索
- 搜索替换（replace）
- 二进制文件搜索

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────┐
│  入口层                                              │
│  ProjectListItem.tsx — 项目名旁加搜索 icon           │
├─────────────────────────────────────────────────────┤
│  UI 层                                              │
│  src/features/search/                               │
│    SearchModal.tsx（弹窗根组件）                     │
│    SearchResults.tsx（结果列表，按文件分组）          │
│    SearchPreview.tsx（预览面板）                     │
├─────────────────────────────────────────────────────┤
│  状态层                                              │
│  src/features/search/searchStore.ts（新建）          │
│  src/features/editor/editorStore.ts（扩展行号跳转）  │
│  src/features/editor/Editor.tsx（扩展 scrollToLine） │
├─────────────────────────────────────────────────────┤
│  Rust 后端                                          │
│  src-tauri/src/fs_backend/search.rs（新建）          │
│  search_files_cmd：ignore crate 遍历 + regex 匹配   │
└─────────────────────────────────────────────────────┘
```

**数据流**：

```
用户输入
  → searchStore.setQuery()
  → 300ms 防抖
  → invoke('search_files_cmd', params)
  → Rust: WalkBuilder 遍历 + regex 逐行匹配
  → Vec<SearchFileResult>
  → 渲染 ResultsPane
  → 用户选中某行
  → editorStore.openFile(absPath, lineNumber)
  → Editor.tsx: view.dispatch scrollToLine
```

---

## 4. Rust 后端

### 4.1 新文件：`src-tauri/src/fs_backend/search.rs`

**依赖（新增到 Cargo.toml）**：
```toml
ignore = "0.4"
regex = "1"
```

**类型定义**：

```rust
#[derive(serde::Serialize)]
pub struct SearchMatch {
    pub line_number: u32,     // 1-based
    pub line_content: String, // 完整行文本
    pub column_start: u32,    // 匹配起始列（0-based）
    pub column_end: u32,      // 匹配结束列（exclusive）
}

#[derive(serde::Serialize)]
pub struct SearchFileResult {
    pub file_path: String,    // 相对 root_path 的路径（UI 显示用）
    pub abs_path: String,     // 绝对路径（传给 openFile）
    pub matches: Vec<SearchMatch>,
}

#[derive(serde::Deserialize)]
pub struct SearchParams {
    pub root_path: String,
    pub query: String,
    pub mode: String,              // "content" | "filename"
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    pub file_glob: Option<String>, // e.g. "*.ts"
}
```

**内容搜索流程**：
1. 用 `ignore::WalkBuilder::new(&root_path)` 构建遍历器，自动读取 `.gitignore`
2. 若 `file_glob` 非空，通过 `OverrideBuilder` 添加 glob 过滤规则
3. 根据选项构建 `regex::Regex`（或退化为 `str::contains`）
4. 每个文件：读取为 UTF-8 字符串（失败则跳过），逐行扫描，收集匹配行
5. 只返回有至少一条匹配的文件

**文件名搜索流程**：
同样遍历，仅对文件名 / 相对路径字符串做匹配，不读取文件内容，速度极快。

**Tauri Command 注册**：

```rust
#[tauri::command]
pub fn search_files_cmd(params: SearchParams) -> Result<Vec<SearchFileResult>, String>
```

在 `lib.rs` 的 `invoke_handler` 中注册，并在 `fs_backend/mod.rs` 中 `pub mod search` 引入。

### 4.2 性能边界

- 单次搜索结果上限：**200 个文件**，每文件最多 **50 条匹配**，超出截断并在返回值中标注 `truncated: bool`
- 超过 5MB 的文件跳过（与现有 `read_file_cmd` 逻辑一致）
- 搜索在调用线程同步执行（Tauri command 默认异步执行在线程池），不阻塞 UI

---

## 5. 前端状态：searchStore

**新文件** `src/features/search/searchStore.ts`

```typescript
interface SearchFileResult {
  filePath: string;  // 相对路径（显示）
  absPath: string;   // 绝对路径（打开文件）
  matches: SearchMatch[];
}

interface SearchMatch {
  lineNumber: number;    // 1-based
  lineContent: string;
  columnStart: number;
  columnEnd: number;
}

interface SearchState {
  isOpen: boolean;
  projectPath: string | null;
  activeTab: 'content' | 'filename';
  query: string;
  options: {
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
  };
  fileGlob: string;
  results: SearchFileResult[];
  selectedFileIdx: number;
  selectedMatchIdx: number;
  isSearching: boolean;
  truncated: boolean;
}
```

**Actions**：

| Action | 行为 |
|--------|------|
| `open(projectPath)` | 打开弹窗，绑定项目路径，清空上次结果 |
| `close()` | 关闭弹窗，不清空 query（下次打开可继续） |
| `setTab(tab)` | 切换模式，重新触发搜索 |
| `setQuery(q)` | 更新 query，300ms 防抖后触发搜索 |
| `setOptions(opts)` | 更新搜索选项，重新触发搜索 |
| `setFileGlob(glob)` | 更新文件过滤，重新触发搜索 |
| `navigate('up'\|'down')` | 在结果间移动，自动跨文件边界 |
| `confirmSelection()` | 调用 `editorStore.openFile(absPath, lineNumber)` 并关闭弹窗 |

**防抖实现**：store 内用 `let debounceTimer: ReturnType<typeof setTimeout>` 在 action 中管理，query 为空时立即清空结果不发起请求。

---

## 6. 行号跳转扩展

### 6.1 editorStore.ts 修改

```typescript
// 新增状态
pendingScrollLine: Record<string, number>; // path → 行号（1-based）

// openFile 签名扩展
openFile: async (path: string, lineNumber?: number) => Promise<void>
// 打开文件后，若 lineNumber 非空，写入 pendingScrollLine[path]

// 新增 action
clearPendingScroll: (path: string) => void;
```

### 6.2 Editor.tsx 修改

在现有 `useEffect` 体系中新增一个 effect，监听 `pendingScrollLine[activeFilePath]`：

```typescript
useEffect(() => {
  if (!viewRef.current || !activeFilePath) return;
  const line = pendingScrollLine[activeFilePath];
  if (line == null) return;

  const doc = viewRef.current.state.doc;
  // line 是 1-based，CodeMirror doc.line() 也是 1-based
  if (line < 1 || line > doc.lines) return;

  const lineObj = doc.line(line);
  viewRef.current.dispatch({
    selection: { anchor: lineObj.from },
    effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
  });
  clearPendingScroll(activeFilePath);
}, [pendingScrollLine, activeFilePath]);
```

---

## 7. UI 组件设计

### 7.1 文件结构

```
src/features/search/
├── index.ts
├── searchStore.ts
├── SearchModal.tsx        # 弹窗根，负责遮罩和键盘事件
├── SearchResults.tsx      # 结果列表（上半，可滚动）
└── SearchPreview.tsx      # 预览面板（下半）
```

### 7.2 SearchModal 布局

```
┌──────────────────────────────────────────────┐  固定宽度 680px，最大高度 70vh
│  [搜索图标] 在文件中搜索...      [Aa][ab][.*][▽] │  搜索框行，autofocus
├──────────────────────────────────────────────┤
│  [文件 P]  [内容 F]                           │  Tab 行
├──────────────────────────────────────────────┤
│                                              │
│  src/App.tsx                          3 处   │  ResultsPane（上半，flex: 1）
│    42  const result = search(query)          │  按文件分组
│    67  const s = searchStore.query           │  行号 + 行内容
│    89  // 搜索结果处理                        │  匹配词高亮（<mark>）
│                                              │
├──────────────────────────────────────────────┤  分隔线
│                                              │
│  选择结果以预览                               │  PreviewPane（下半，固定高度）
│                                              │
├──────────────────────────────────────────────┤
│  ↑↓ 导航  ↵ 打开  Esc 关闭    文件过滤: [*.ts] │  Footer
└──────────────────────────────────────────────┘
```

### 7.3 键盘事件处理

在 `SearchModal` 根元素 `onKeyDown`（`useEffect` 中 `window.addEventListener`）：

| 按键 | 行为 |
|------|------|
| `Escape` | `searchStore.close()` |
| `ArrowUp` | `searchStore.navigate('up')` |
| `ArrowDown` | `searchStore.navigate('down')` |
| `Enter` | `searchStore.confirmSelection()` |

### 7.4 入口修改（ProjectListItem.tsx）

在项目名行右侧新增搜索图标按钮，仅当该项目为激活项目时显示（或 hover 时显示）：

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    searchStore.open(project.path);
  }}
  title="搜索项目文件"
>
  {/* Font Awesome 图标 */}
  <i className="fa-solid fa-magnifying-glass" />
</button>
```

### 7.5 在 App.tsx 中挂载

```tsx
// SearchModal 常驻挂载，由 isOpen 控制显示
{isOpen && <SearchModal />}
```

---

## 8. 样式规范

遵循项目 Obsidian Forge 设计系统（CSS 变量）：

- 遮罩背景：`rgba(0,0,0,0.5)` + `backdrop-filter: blur(8px)`
- 弹窗背景：`var(--c-surface-2)`
- 边框：`1px solid var(--c-border)`
- 圆角：`var(--radius-lg)`
- 搜索框字号：14px
- 结果行字号：13px，行号颜色 `var(--c-fg-subtle)`
- 匹配高亮：`background: var(--c-accent-muted)`，`color: var(--c-fg)`
- 激活结果行背景：`var(--c-surface-3)`

---

## 9. 实现顺序建议

1. **Rust 后端** — `search.rs` + `search_files_cmd` 注册（可独立测试）
2. **行号跳转** — `editorStore` + `Editor.tsx` 扩展（依赖现有 CodeMirror）
3. **searchStore** — 状态管理，mock Rust 调用先测通数据流
4. **SearchModal UI** — 弹窗组件，依赖 searchStore
5. **入口** — `ProjectListItem.tsx` 加图标，接通 `searchStore.open()`
6. **集成测试** — 端到端验证完整链路

---

## 10. 不确定项（后续迭代）

- **实时搜索 vs 按 Enter 触发**：当前设计为 300ms 防抖后自动搜索；若大型项目性能有问题，改为 Enter 触发
- **预览面板内容**：当前方案复用 `read_file_cmd` 读取完整文件内容再截取 ±5 行；若文件过大，可改为 Rust 端只返回上下文行
- **搜索结果截断提示**：超过 200 文件时 UI 如何提示用户缩小范围

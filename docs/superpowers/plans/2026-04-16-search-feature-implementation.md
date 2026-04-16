# GhostTerm 项目内全文搜索 — 实现计划

**日期**: 2026-04-16  
**状态**: 待执行  
**设计文档**: `docs/superpowers/specs/2026-04-16-search-design.md`  
**作者**: Atlas.oi

---

## 前置说明

- 所有任务在 `main` 分支直接执行（无 worktree）
- 测试工具：Rust = `cargo test`，TypeScript = `pnpm vitest`
- 代码风格遵循 `CLAUDE.md`，注释用中文，文件头用标准格式

---

## Task 1：Rust 搜索后端

**目标**：新建 `src-tauri/src/fs_backend/search.rs`，实现 `search_files_cmd`，在 `mod.rs` 和 `lib.rs` 注册。

### 要修改的文件

1. **新建** `src-tauri/src/fs_backend/search.rs`
2. **修改** `src-tauri/src/fs_backend/mod.rs` — 添加 `pub mod search; pub use search::search_files_cmd;`
3. **修改** `src-tauri/src/lib.rs` — 在 `use fs_backend` 导入行加 `search_files_cmd`，并注册到 `invoke_handler`
4. **修改** `src-tauri/Cargo.toml` — 添加 `regex = "1"`（`ignore` crate 已存在，无需重复添加）

### 实现规范（来自设计文档 §4）

**类型定义**：

```rust
#[derive(serde::Serialize)]
pub struct SearchMatch {
    pub line_number: u32,     // 1-based
    pub line_content: String,
    pub column_start: u32,    // 0-based
    pub column_end: u32,      // exclusive
}

#[derive(serde::Serialize)]
pub struct SearchFileResult {
    pub file_path: String,    // 相对 root_path（显示用）
    pub abs_path: String,     // 绝对路径（传给 openFile）
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,      // 该文件是否超过 50 条截断
}

// 整体结果包装（带 truncated 标记）
#[derive(serde::Serialize)]
pub struct SearchResult {
    pub files: Vec<SearchFileResult>,
    pub truncated: bool,  // 是否超过 200 文件截断
}

#[derive(serde::Deserialize)]
pub struct SearchParams {
    pub root_path: String,
    pub query: String,
    pub mode: String,              // "content" | "filename"
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    pub file_glob: Option<String>,
}
```

**内容搜索流程**：
1. 用 `ignore::WalkBuilder::new(&root_path)` 遍历，自动读取 `.gitignore`
2. 若 `file_glob` 非空，通过 `ignore::overrides::OverrideBuilder` 添加 glob 过滤
3. 根据选项构建正则（`case_sensitive` + `whole_word` + `use_regex`）；非正则模式用 `Regex::escape` 转义 query
4. 每个文件：超过 5MB 跳过，读为 UTF-8（失败则跳过），逐行扫描
5. 每文件最多 50 条匹配，总文件数最多 200，超出时截断并标记 `truncated: true`

**文件名搜索流程**：
仅对相对路径字符串做 regex 匹配，不读取文件内容。

**注意**：`whole_word` 的实现方式：在 query 两边加 `\b` 边界断言（仅在非正则模式下）。

**Tauri Command**：
```rust
#[tauri::command]
pub fn search_files_cmd(params: SearchParams) -> Result<SearchResult, String>
```

### 测试（写在 search.rs 内 `#[cfg(test)]` 模块）

- `test_content_search_basic`：用 tempdir 创建含关键词的文件，搜索应返回正确行号和列偏移
- `test_filename_search`：文件名匹配模式下仅匹配路径，不读取内容
- `test_gitignore_respected`：tempdir 内创建 `.gitignore` 排除某目录，搜索不应返回该目录的文件
- `test_truncation`：超过 50 条匹配的文件，`truncated` 为 true

### 验证

```bash
cd src-tauri && cargo test fs_backend::search
```

---

## Task 2：editorStore 行号跳转扩展

**目标**：扩展 `editorStore.ts` 支持带行号打开文件，新增 `pendingScrollLine` 状态。

### 要修改的文件

1. **修改** `src/features/editor/editorStore.ts`

### 实现规范（来自设计文档 §6.1）

在 `EditorState` 接口中新增：

```typescript
// 待滚动行号 map，key = 文件绝对路径，value = 1-based 行号
pendingScrollLine: Record<string, number>;
// 清除待滚动行号
clearPendingScroll: (path: string) => void;
```

修改 `openFile` 签名为：
```typescript
openFile: (path: string, lineNumber?: number) => Promise<void>
```

`openFile` 内部逻辑：文件打开/切换后，若 `lineNumber` 非空，写入 `pendingScrollLine[path] = lineNumber`。

实现时注意：`pendingScrollLine` 初始值为 `{}`，`clearPendingScroll` 用 `set` 删除对应 key。

### 测试

修改 `src/features/editor/__tests__/editorStore.test.ts`，新增：
- `opens file with line number sets pendingScrollLine`：调用 `openFile(path, 5)`，验证 `pendingScrollLine[path] === 5`
- `clearPendingScroll removes the entry`：设置后清除，验证 key 不存在

### 验证

```bash
pnpm vitest run src/features/editor/__tests__/editorStore.test.ts
```

---

## Task 3：Editor.tsx 滚动到行

**目标**：在 `Editor.tsx` 中新增 effect，监听 `pendingScrollLine` 并用 CodeMirror 滚动到指定行。

### 要修改的文件

1. **修改** `src/features/editor/Editor.tsx`

### 实现规范（来自设计文档 §6.2）

新增一个 `useEffect`，依赖 `[pendingScrollLine, activeFilePath]`（从 editorStore 订阅）：

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

从 editorStore 中解构 `pendingScrollLine` 和 `clearPendingScroll`。

### 测试

`Editor.test.tsx` 中新增测试：
- `scrolls to line when pendingScrollLine is set`：mock editorStore，设置 `pendingScrollLine[path] = 10`，验证 `viewRef.current.dispatch` 被调用（用 vitest mock）

注意：Editor 组件的测试依赖 mock xterm 和 CodeMirror，参考现有 Editor.test.tsx 的 mock 模式。

### 验证

```bash
pnpm vitest run src/features/editor/__tests__/Editor.test.tsx
```

---

## Task 4：searchStore 状态管理

**目标**：新建 `src/features/search/searchStore.ts`，实现搜索状态和所有 actions。

### 要修改的文件

1. **新建** `src/features/search/searchStore.ts`
2. **新建** `src/features/search/index.ts`（导出 store）

### 实现规范（来自设计文档 §5）

完整状态接口：

```typescript
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

**Actions 实现要点**：

- `open(projectPath)`: 设置 `isOpen=true`，更新 `projectPath`，清空 `results`（保留 query 供下次继续使用）
- `close()`: 设置 `isOpen=false`，不清空 query
- `setQuery(q)`: 更新 query，若为空则立即清空 results；非空则 300ms 防抖后调用内部 `_runSearch()`
- `setTab(tab)`: 切换 `activeTab`，立即触发 `_runSearch()`
- `setOptions(opts)`: 更新 options，立即触发 `_runSearch()`
- `setFileGlob(glob)`: 更新 fileGlob，立即触发 `_runSearch()`
- `navigate('up'|'down')`: 在结果间移动，自动跨文件边界（selectedFileIdx/selectedMatchIdx 联动）
- `confirmSelection()`: 调用 `useEditorStore.getState().openFile(absPath, lineNumber)` 并调用 `close()`

**防抖实现**：用闭包外的 `let debounceTimer: ReturnType<typeof setTimeout> | null = null`，在 `setQuery` 中 `clearTimeout(debounceTimer); debounceTimer = setTimeout(() => _runSearch(), 300)`。

**_runSearch 内部逻辑**：
```typescript
const _runSearch = async () => {
  const { projectPath, query, activeTab, options, fileGlob } = get();
  if (!projectPath || !query.trim()) return;
  
  set({ isSearching: true });
  try {
    const result = await invoke<SearchResult>('search_files_cmd', {
      params: {
        rootPath: projectPath,
        query,
        mode: activeTab,
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        useRegex: options.useRegex,
        fileGlob: fileGlob || null,
      }
    });
    set({ results: result.files, truncated: result.truncated, isSearching: false, selectedFileIdx: 0, selectedMatchIdx: 0 });
  } catch {
    set({ isSearching: false, results: [] });
  }
};
```

注意：invoke 参数中 Rust `snake_case` 对应前端 `camelCase`（Tauri 自动转换）：`root_path` → `rootPath`，等等。

**navigate 逻辑**：
- `down`：当前 file 的 matches 还有下一条 → selectedMatchIdx+1；否则移到下一个 file 的第一条（若无下一个 file 则停留）
- `up`：当前 match 还有上一条 → selectedMatchIdx-1；否则移到上一个 file 的最后一条（若无上一个 file 则停留）

### 测试

新建 `src/features/search/__tests__/searchStore.test.ts`：

- `open sets isOpen and projectPath, clears results`
- `close sets isOpen false, keeps query`
- `setQuery with empty string clears results without invoking`
- `navigate down moves to next match then next file`
- `navigate up moves to previous match then previous file`
- `confirmSelection calls openFile with correct args and closes`

mock `invoke`（vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))）

### 验证

```bash
pnpm vitest run src/features/search/__tests__/searchStore.test.ts
```

---

## Task 5：SearchModal UI 组件

**目标**：新建搜索弹窗三个组件，遵循 Obsidian Forge 设计系统。

### 要修改的文件

1. **新建** `src/features/search/SearchModal.tsx`
2. **新建** `src/features/search/SearchResults.tsx`
3. **新建** `src/features/search/SearchPreview.tsx`

### 实现规范（来自设计文档 §7、§8）

**SearchModal.tsx（弹窗根）**：
- 遮罩：`position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(8px); z-index: 1000`
- 弹窗容器：`width: 680px; max-height: 70vh; background: var(--c-surface-2); border: 1px solid var(--c-border); border-radius: var(--radius-lg); display: flex; flex-direction: column`
- 搜索框行：Font Awesome `fa-solid fa-magnifying-glass` 图标 + `<input>` + 三个 toggle 按钮（Aa/ab/.*）
- Tab 行：文件 P / 内容 F 两个 tab
- 结果区 `<SearchResults />` — `flex: 1; overflow-y: auto`
- 分隔线
- 预览区 `<SearchPreview />` — 固定高度约 120px
- Footer：键盘提示 + glob 输入框

键盘事件：`useEffect` 中 `window.addEventListener('keydown', handler)`，清理函数 `removeEventListener`。

搜索框 `autoFocus`，输入时调用 `searchStore.setQuery(e.target.value)`。

**SearchResults.tsx（结果列表）**：
- 按文件分组：文件路径头（`file_path`）+ 匹配行列表
- 每条匹配：行号（`var(--c-fg-subtle)`）+ 行内容（关键词用 `<mark>` 高亮，`background: var(--c-accent-muted)`）
- 激活行背景 `var(--c-surface-3)`
- `isSearching` 时显示 loading 状态（简单文字或 spinner）
- 无结果时显示提示文字

高亮实现：将 `lineContent` 按 `columnStart/columnEnd` 分为三段，中间段用 `<mark>` 包裹。

**SearchPreview.tsx（预览面板）**：
- 无选中结果时显示 "选择结果以预览" 居中占位
- 有选中结果时：显示文件路径 + 匹配行 ±5 行上下文（从 `results[selectedFileIdx]` 中取匹配行所在文件的所有行，但预览功能需要完整文件内容）
- **简化实现**：由于读取文件内容需要 `read_file_cmd`，预览只显示已有的 `lineContent`（±5 行来自 results 中该文件的邻近 matches），而不是单独发起读文件请求。若该文件只有 1 条匹配，则只显示该匹配行 + "仅显示匹配行" 提示。

### 测试

新建 `src/features/search/__tests__/SearchModal.test.tsx`：
- `renders when isOpen is true`
- `does not render when isOpen is false`（注意此组件由父组件条件渲染，无需测试该条件）
- `closes on Escape key`：dispatch keydown Escape 事件，验证 `searchStore.close` 被调用
- `calls setQuery on input change`

mock searchStore 使用 `vi.mock('../searchStore', ...)`。

### 验证

```bash
pnpm vitest run src/features/search/__tests__/
pnpm build  # 确保 TypeScript 编译无错误
```

---

## Task 6：入口接通与 App.tsx 挂载

**目标**：在 `ProjectListItem.tsx` 添加搜索图标入口，在 `App.tsx` 挂载 `SearchModal`。

### 要修改的文件

1. **修改** `src/features/sidebar/ProjectListItem.tsx`
2. **修改** `src/App.tsx`

### 实现规范（来自设计文档 §7.4、§7.5）

**ProjectListItem.tsx**：
在项目名右侧（hover 或激活状态时可见）添加搜索图标按钮：
```tsx
<button
  className="search-icon-btn"
  onClick={(e) => {
    e.stopPropagation();
    useSearchStore.getState().open(project.path);
  }}
  title="搜索项目文件"
>
  <i className="fa-solid fa-magnifying-glass" />
</button>
```

仅在 `project.path === activeProjectPath`（当前激活项目）时显示，或 hover 时显示均可 — 参考现有 action 按钮的显示逻辑（现有代码中如何处理 hover 状态）。

**App.tsx**：
在 JSX 根部添加 SearchModal 条件渲染：
```tsx
import { SearchModal } from './features/search/SearchModal';
import { useSearchStore } from './features/search/searchStore';

// 在组件内
const isSearchOpen = useSearchStore((s) => s.isOpen);

// 在 return 中（与其他 overlay 同级）
{isSearchOpen && <SearchModal />}
```

### 测试

无独立测试，集成到现有组件测试即可：
- `ProjectListItem.test.tsx` 中验证点击搜索按钮后 `searchStore.open` 被调用（如果现有测试结构允许）

### 验证

```bash
pnpm vitest run
pnpm build
```

---

## 完整验证顺序

1. `cd src-tauri && cargo test` — Rust 单元测试全部通过
2. `pnpm vitest run` — TypeScript 测试全部通过
3. `pnpm build` — TypeScript 编译无错误
4. 手动测试路径：打开项目 → 点击搜索图标 → 输入关键词 → 结果显示 → 点击结果 → 编辑器跳到对应行

---

## 任务间依赖关系

```
Task 1 (Rust 后端) ─────────────────────────────────┐
Task 2 (editorStore 行号跳转) ──┐                    │
Task 3 (Editor.tsx 滚动)        │── Task 4 (searchStore) ── Task 5 (UI) ── Task 6 (接通)
                                └── Task 4 依赖 editorStore.openFile 签名
```

- Task 1 可与 Task 2/3 并行
- Task 4 依赖 Task 2（openFile 签名变更）
- Task 5 依赖 Task 4（searchStore API）
- Task 6 依赖 Task 5（SearchModal 存在）

**推荐执行顺序**：1 → 2 → 3 → 4 → 5 → 6（顺序执行，避免接口变更传播）

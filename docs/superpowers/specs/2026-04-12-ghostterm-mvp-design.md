# GhostTerm MVP -- 设计文档

> 日期: 2026-04-12
> 作者: Atlas.oi
> 状态: Draft

---

## 1. 核心目标

打造一个轻量级代码编辑器 + 终端一体化工具，深度集成 Claude Code，解决三个核心痛点：

1. **IDE 太重** -- Cursor/VS Code 启动慢、资源占用高，只需要编辑器 + 终端时大材小用
2. **编辑器与终端割裂** -- 在 IDE 和终端之间来回切换，上下文断裂
3. **内容传递摩擦** -- 图片/文本/网页/文件需手动复制粘贴给 AI CLI，操作繁琐

## 2. 目标受众

自用为主，架构预留开源可能性。

## 3. 技术栈

| 层 | 技术 | 选择理由 |
|---|---|---|
| 桌面框架 | Tauri 2 | 轻量(~5MB) + 跨平台(macOS/Windows) + Rust 后端 |
| 前端 | React 19 + TypeScript + Vite | 生态成熟，组件丰富 |
| 终端 | xterm.js + WebGL Addon + Unicode11 Addon | VS Code 同方案，已验证可渲染 Claude Code statusline |
| 编辑器 | CodeMirror 6 | 轻量，Lezer 语法高亮（CM6 内置解析器） |
| UI 组件 | shadcn/ui + Radix UI | 无样式锁定，按需引入 |
| 状态管理 | Zustand | 轻量，支持多 store 隔离 |
| 分屏 | react-resizable-panels | ~3KB gzipped，shadcn 推荐 |

## 4. 平台支持

macOS + Windows。先在 macOS 上开发，Tauri 保证跨平台编译。

## 5. 功能范围

### 5.1 Phase 1 -- MVP（能替代日常使用）

1. **终端**: xterm.js + WebGL，正确渲染 Claude Code 全部输出（含 statusline）
2. **代码编辑器**: CodeMirror 6，Lezer 语法高亮、行号、搜索替换、多光标、自动缩进、文件保存。不做 LSP/自动补全
3. **左侧面板**:
   - 顶部项目选择器（当前项目名 + 路径，下拉切换最近项目）
   - 三标签页: Files / Changes / Worktrees
   - Files: 目录树浏览，文件增删改实时更新
   - Changes: Git 暂存/未暂存文件，修改状态标记
   - Worktrees: Git Worktree 列表与切换
4. **分屏布局**: 左侧面板 | 编辑器 | 终端，可拖拽调比例，双击全屏某区域
5. **文件实时监听**: AI 修改文件后编辑器自动检测并提示更新

### 5.2 Phase 2 -- 差异化功能（MVP 之后）

6. 内容管道: 右键菜单发送文本/文件/图片/目录/路径给 AI CLI
7. 命令面板: Cmd+K 触发自定义 skill/工作流
8. 内置浏览器: 选区一键发送给 AI CLI
9. Claude Code 深度集成: 输出美化渲染（Markdown -> 富文本）、会话历史管理

### 5.3 明确排除

- 不做完整 IDE（调试器、扩展市场、LSP）
- 不做多 AI CLI 平等支持（MVP 仅深度集成 Claude Code）
- 不做原生终端渲染（接受 webview 性能天花板）
- 不做商业化功能

## 6. 架构设计

### 6.1 前端架构: Feature-Sliced + Zustand 多 Store

每个功能模块是独立目录，包含自己的组件、hooks、store。新增功能只加目录不改现有代码。

```
src/
  features/
    terminal/
      Terminal.tsx          # xterm.js 容器
      useTerminal.ts        # WebSocket 连接 + PTY 生命周期
      terminalStore.ts      # 终端状态（连接状态、当前 shell）
    editor/
      Editor.tsx            # CodeMirror 6 容器
      useEditor.ts          # 文件加载/保存
      editorStore.ts        # 打开的文件列表、活跃文件
      tabs/
        EditorTabs.tsx      # 文件标签栏
    sidebar/
      Sidebar.tsx           # 三标签页容器
      ProjectSelector.tsx   # 顶部项目选择器
      FileTree.tsx          # Files 标签页
      Changes.tsx           # Changes 标签页
      Worktrees.tsx         # Worktrees 标签页
      sidebarStore.ts       # 活跃标签、展开状态
  shared/
    components/
      ResizablePanel.tsx    # 可拖拽分屏组件
    hooks/
      useTauriCommand.ts    # invoke 封装
    types/
      index.ts
  layouts/
    AppLayout.tsx           # 顶层分屏布局
  App.tsx                   # 入口
```

选择理由: Supremum 的 MainLayout.tsx（4849 行上帝组件）证明了 Minimal Monolith 的终局。Feature-Sliced 从一开始就保证模块隔离。

### 6.2 前后端通信: Tauri Commands + WebSocket

两种通信模式对应两种数据特征:

| 数据类型 | 特征 | 通信方式 |
|---|---|---|
| 文件/Git 操作 | 低频请求/响应，结构化 JSON | Tauri Commands (`invoke`) |
| PTY 数据流 | 高频双向，二进制字节流 | WebSocket (`ws://127.0.0.1:PORT`) |

PTY 走 WebSocket 而非 Tauri Events 的理由:
- WebSocket 原生支持二进制帧，无 base64 编码膨胀（Events 需 +33%）
- xterm.js AttachAddon 直接对接 WebSocket，零胶水代码
- TCP 流控天然提供背压（Events 是 fire-and-forget）
- VS Code Remote、Hyper Terminal 均采用此模式

### 6.3 Rust 后端: 4 个模块

#### 6.3.1 pty_manager

职责: PTY 生命周期管理 + WebSocket 双向桥接。

**Tauri Commands (控制面):**

```
spawn_pty(shell, cwd, env) → { pty_id, ws_port, ws_token }
resize_pty(pty_id, cols, rows) → ()
kill_pty(pty_id) → ()
```

**WebSocket (数据面):**

```
ws://127.0.0.1:{port}?token={token}

上行: Binary frame → PTY stdin
下行: PTY stdout → Binary frame → xterm.js

安全: 绑定 127.0.0.1 + URL query 一次性 token
```

依赖: `portable-pty`, `tokio-tungstenite`, `tokio`

#### 6.3.2 fs_backend

职责: 文件系统 CRUD + 实时监听。

**Tauri Commands:**

```
list_dir(path) → Vec<FileEntry>
read_file(path) → { content, encoding }
write_file(path, content) → ()
create_entry(path, is_dir) → ()
delete_entry(path) → ()
rename_entry(old_path, new_path) → ()
start_watching(project_path) → ()
stop_watching() → ()
```

**Tauri Events (文件变更推送):**

```
"fs:created"  { path }
"fs:modified" { path }
"fs:deleted"  { path }
"fs:renamed"  { old_path, new_path }
```

监听配置: 排除 `.git`、`node_modules` 等目录。Debounce 100ms 防止批量操作刷屏。

依赖: `notify` (v6), `ignore` (gitignore 解析)

#### 6.3.3 git_backend

职责: Git 状态查询 + Worktree 管理。

**Tauri Commands:**

```
git_status(repo_path) → Vec<StatusEntry>
git_diff(repo_path, path?) → String
git_stage(repo_path, paths) → ()
git_unstage(repo_path, paths) → ()
git_current_branch(repo_path) → String
worktree_list(repo_path) → Vec<Worktree>
worktree_add(repo_path, branch, path?) → ()
worktree_remove(worktree_path) → ()
worktree_switch(worktree_path) → ()
```

已知限制: `git2` 的 worktree API 不完整，`worktree_add` / `worktree_remove` 可能需要 fallback 到 `std::process::Command` 调用 git CLI。

依赖: `git2`

#### 6.3.4 project_manager

职责: 项目列表持久化 + 项目切换协调。

```
list_recent_projects() → Vec<Project>
open_project(path) → ProjectInfo
  → 触发: fs_backend.start_watching(path)
  → 触发: pty_manager.spawn_pty(shell, path)
close_project() → ()

持久化: ~/.ghostterm/projects.json
```

依赖: `serde` + `serde_json`, `dirs`

### 6.4 模块间依赖

```
project_manager (协调者)
  ├──→ fs_backend.start_watching()      项目打开时
  ├──→ pty_manager.spawn_pty()          项目打开时
  └──→ git_backend (无直接调用, 前端按需查询)

worktree_switch 触发链:
  git_backend.worktree_switch()
    → project_manager.open_project(new_path)
      → fs_backend: stop + restart watching
      → pty_manager: cd 或 respawn

独立模块:
  fs_backend ←→ git_backend    (各自独立)
  pty_manager ←→ fs_backend    (各自独立)
```

## 7. 前端状态管理

### 7.1 terminalStore

```typescript
interface TerminalState {
  ptyId: string | null
  wsPort: number | null
  wsToken: string | null
  connected: boolean

  spawn: (cwd: string) => Promise<void>
  kill: () => Promise<void>
  resize: (cols: number, rows: number) => Promise<void>
}
```

特点: 状态极少。PTY 实际数据流走 WebSocket，不经过 store。

### 7.2 editorStore

```typescript
interface EditorState {
  openFiles: OpenFile[]
  activeFileId: string | null

  openFile: (path: string) => Promise<void>
  closeFile: (id: string) => void
  saveFile: (id: string) => Promise<void>
  setActive: (id: string) => void
  handleExternalChange: (path: string, content: string) => void
}

interface OpenFile {
  id: string
  path: string
  content: string       // 编辑器当前内容
  diskContent: string   // 磁盘上的内容（用于冲突检测）
  isDirty: boolean      // 是否有未保存修改
}
```

特点: 跟踪 `content` vs `diskContent` 用于检测 AI 修改文件后的冲突。

### 7.3 sidebarStore

```typescript
interface SidebarState {
  activeTab: 'files' | 'changes' | 'worktrees'
  visible: boolean
  currentProject: Project | null
  recentProjects: Project[]
  fileTree: FileNode[]
  expandedDirs: Set<string>
  changes: StatusEntry[]
  worktrees: Worktree[]

  setTab: (tab: string) => void
  toggleVisibility: () => void
  switchProject: (path: string) => Promise<void>
  refreshFileTree: () => Promise<void>
  refreshGitStatus: () => Promise<void>
  refreshWorktrees: () => Promise<void>
}
```

特点: 最复杂的 store，管理文件树 + Git 状态 + Worktree 列表 + 项目切换。

## 8. 核心数据流

### 8.1 文件打开

```
FileTree onClick(path)
  → editorStore.openFile(path)
  → invoke('read_file', { path })
  → Rust fs_backend 返回 { content, encoding }
  → editorStore 更新: openFiles.push({ path, content, diskContent: content, isDirty: false })
  → Editor.tsx: CodeMirror 加载 content，根据扩展名选择语法高亮
```

### 8.2 AI 修改文件后的实时更新

```
Claude Code 写入磁盘
  → notify watcher 检测 Modify 事件 (Rust fs_backend)
  → debounce 100ms
  → app.emit("fs:modified", { path })
  → React listen("fs:modified")
  → editorStore.handleExternalChange(path, content)
  → 判断:
    - 文件未在编辑器中打开 → 忽略（文件树自动更新修改标记）
    - 文件已打开, isDirty = false → 直接替换 content + diskContent
    - 文件已打开, isDirty = true → 提示用户: "文件已被外部修改" [保留修改] [加载新版本] [查看 diff]
```

### 8.3 Worktree 切换

```
Worktrees.tsx onClick(worktree)
  → invoke('worktree_switch', { path })
  → Rust project_manager 协调:
    - fs_backend: stop_watching() → start_watching(new_path)
    - pty_manager: cd new_path 或 respawn
    - 更新 projects.json
  → 前端连锁更新:
    - sidebarStore: currentProject 更新, 刷新 fileTree + changes
    - editorStore: 关闭所有文件（或提示保存未保存的）
    - terminalStore: cwd 已通过 Rust 端更新
```

## 9. 布局设计

### 9.1 默认布局

三栏水平分屏: 左侧面板 (18%) | 编辑器 (41%) | 终端 (41%)

```
+-------------------+-------------------+-------------------+
| Sidebar           | Editor            | Terminal          |
|                   |                   |                   |
| [Project ▾]       | [Tab1] [Tab2]     | Terminal — zsh    |
| [Files][Chg][WT]  |                   |                   |
|                   | (CodeMirror 6)    | $ claude          |
| ▼ src/            |                   | > █               |
|   ├─ features/    |                   |                   |
|   └─ shared/      |                   |                   |
+-------------------+-------------------+-------------------+
        ↑ 拖拽 ↑              ↑ 拖拽 ↑
```

### 9.2 交互行为

| 操作 | 行为 |
|---|---|
| 拖拽分隔线 | 实时调整面板宽度，最小宽度: sidebar 160px, editor/terminal 200px |
| 双击面板标题栏 | 该面板全屏展开（动画过渡），再次双击恢复 |
| Cmd+B | 切换左侧面板显示/隐藏 |
| Cmd+` | 终端/编辑器焦点切换 |
| 窗口 < 800px | 自动折叠左侧面板，编辑器和终端上下堆叠 |

### 9.3 实现

使用 `react-resizable-panels`:

```tsx
<PanelGroup direction="horizontal">
  <Panel defaultSize={18} minSize={12}>
    <Sidebar />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={41} minSize={15}>
    <Editor />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={41} minSize={15}>
    <Terminal />
  </Panel>
</PanelGroup>
```

## 10. 错误处理

原则: 暴露错误、修复根因，不做降级或静默吞没。

### 10.1 pty_manager

| 失败场景 | 检测 | 处理 |
|---|---|---|
| PTY 启动失败 | spawn_pty 返回 Err | 终端区域显示错误 + 重试按钮 |
| WebSocket 断开 | onclose 事件 | 显示 "连接已断开" + 自动重连（进程存活时）或提示重启 |
| PTY 进程退出 | Rust wait() 检测 | 终端显示退出码 + "按任意键重启" |

### 10.2 fs_backend

| 失败场景 | 检测 | 处理 |
|---|---|---|
| 文件读取失败 | read_file Err | 编辑器标签显示错误状态 |
| 文件保存失败 | write_file Err | Toast 通知错误原因，保留未保存内容 |
| watcher 崩溃 | 线程 panic 捕获 | 通知 "文件监听已停止" + 重启按钮 |

### 10.3 git_backend

| 失败场景 | 检测 | 处理 |
|---|---|---|
| 非 Git 仓库 | git2 open Err | Changes/Worktrees 显示提示，功能禁用但不影响其他模块 |
| git2 worktree API 不可用 | 调用 Err | fallback 到 git CLI；CLI 也不可用则显示具体错误 |

### 10.4 project_manager

| 失败场景 | 检测 | 处理 |
|---|---|---|
| projects.json 损坏 | serde Err | 重置为空列表，日志记录错误 |

## 11. 测试策略

### 11.1 三层测试

**Rust 单元测试** (`cargo test`):
- fs_backend: list_dir / read_file / write_file 正确性
- git_backend: git_status 状态解析 / worktree_list 格式
- pty_manager: spawn + 退出 / WebSocket token 验证 / resize 参数校验
- project_manager: projects.json 序列化/反序列化

**前端组件测试** (`vitest` + `@testing-library/react`):
- Store 测试: editorStore openFile/closeFile/handleExternalChange 状态变更
- 组件测试: FileTree 点击 / EditorTabs 切换关闭 / ProjectSelector 渲染

**集成测试** (`tauri-driver`):
- 打开项目 → 文件树加载 → 点击文件 → 编辑器显示
- PTY spawn → WebSocket 连接 → 输入命令 → 收到输出
- 外部修改文件 → fs 事件 → 编辑器更新提示
- Worktree 切换 → 全模块重置

### 11.2 MVP 测试优先级

| 优先级 | 测试内容 | 理由 |
|---|---|---|
| P0 | PTY spawn + WebSocket 连接 + 数据收发 | 核心功能，不工作则应用无意义 |
| P0 | 文件读写 + 编辑器加载/保存 | 基础编辑功能 |
| P1 | fs watcher 事件 + 编辑器冲突处理 | AI 修改文件场景的核心体验 |
| P1 | Git status + 文件树状态标记 | 日常使用需要 |
| P2 | Worktree 操作 + 项目切换 | 功能完整性 |

## 12. 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 重建 vs Fork Supremum | 重建 | MainLayout.tsx 4849 行上帝组件，改造不如重建 |
| 前端架构 | Feature-Sliced + Zustand | Supremum 证明了 Monolith 的终局 |
| PTY 通信 | WebSocket | 二进制原生帧，无 base64 膨胀，xterm.js 直连，TCP 背压 |
| 文件/Git 通信 | Tauri Commands | 请求/响应模式，类型安全 |
| 终端方案 | xterm.js + WebGL，花屏再升级 alacritty_terminal | 最快能跑，已验证可渲染 Claude Code |
| 编辑器级别 | 基础编辑，无 LSP | MVP 够用，AI 帮改代码 |
| 布局 | 分屏 + 拖拽 + 全屏切换 | 比固定分屏灵活 |
| 左侧面板 | 项目选择器 + Files/Changes/Worktrees | Supremum 风格扩展 |
| 文件冲突策略 | 提示用户选择 | isDirty 时弹出提示而非静默覆盖 |
| AI CLI 范围 | 先 Claude Code 深度集成 | Codex 等后续按需 |
| 平台 | macOS + Windows | Tauri 跨平台 |

## 13. 终端方案升级路径

如果 xterm.js 在实际使用中出现渲染问题（花屏、性能不足），升级到方案 B:

```
方案 A (当前): xterm.js + WebGL → 前端渲染
方案 B (备选): alacritty_terminal (Rust VT 解析) → 前端只渲染 cell grid
```

方案 B 的改动范围仅限 terminal feature 模块内部，不影响其他模块。这是 Feature-Sliced 架构的优势。

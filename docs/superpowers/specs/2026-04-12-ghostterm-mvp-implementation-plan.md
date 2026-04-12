# GhostTerm MVP -- TDD + PBI 实施计划

> 日期: 2026-04-12
> 作者: Atlas.oi
> 设计文档: docs/superpowers/specs/2026-04-12-ghostterm-mvp-design.md

---

## 总览

### 依赖关系图

```
PBI-0 项目脚手架 + 共享基础
  │
  ├──→ PBI-1 终端模块 (Rust pty_manager + React terminal)
  │      │
  ├──→ PBI-2 编辑器模块 (Rust fs_backend CRUD + React editor)
  │      │
  ├──→ PBI-3 侧边栏模块 (React sidebar + 文件树)
  │      │
  │      ├──→ PBI-4 文件实时监听 (Rust fs watcher + 编辑器联动)
  │      │      依赖: PBI-1(终端运行) + PBI-2(编辑器) + PBI-3(文件树)
  │      │
  │      └──→ PBI-5 Git + Worktree (Rust git_backend + React Changes/Worktrees)
  │             依赖: PBI-1(PTY respawn) + PBI-2(dirty检查) + PBI-3(侧边栏UI) + PBI-4(watcher重启)
  │
  └──→ PBI-6 项目管理 + 集成 (Rust project_manager + 全模块串联)
         依赖: PBI-1 + PBI-2 + PBI-3 + PBI-4 + PBI-5
```

### 并行策略

| 阶段 | 可并行的 PBI | worktree 分支 | 说明 |
|------|-------------|--------------|------|
| 阶段 1 | PBI-0（串行） | `main` | 项目初始化 |
| 阶段 2 | PBI-1 / PBI-2 / PBI-3 | `feat/terminal` / `feat/editor` / `feat/sidebar` | 三个独立 feature 并行 |
| 阶段 2.5 | 合并阶段 2 到 main（串行） | `main` | 解决 lib.rs/AppLayout 冲突 |
| 阶段 3 | PBI-4（串行） | `feat/fs-watcher` | 需要终端+编辑器+文件树 |
| 阶段 4 | PBI-5（串行） | `feat/git-worktree` | 需要全部前置模块含 watcher |
| 阶段 5 | PBI-6（串行） | `feat/project-manager` | 全模块集成 |

---

## PBI-0: 项目脚手架 + 共享基础

**分支:** `main`（直接在主分支初始化）
**前置:** 无
**交付物:** 可编译运行的空 Tauri 应用 + 完整目录结构 + 共享基础设施

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 0.1 | Tauri 2 项目初始化 | `cargo build` 编译通过 | `src-tauri/` 整体 |
| 0.2 | Rust 模块骨架 | 各模块 `mod.rs` 存在且编译通过 | `src-tauri/src/pty_manager/mod.rs`, `fs_backend/mod.rs`, `git_backend/mod.rs`, `project_manager/mod.rs` |
| 0.3 | Cargo.toml 依赖声明 | `cargo check` 通过 | `src-tauri/Cargo.toml`（portable-pty, tokio-tungstenite, tokio, notify, ignore, git2, serde, serde_json, dirs） |
| 0.4 | 共享类型定义 | 类型编译通过 | `src-tauri/src/types.rs`（FileEntry, FileNode, StatusEntry, Worktree, Project, ProjectInfo, ReadFileResult, FsEvent） |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 0.5 | React + Vite + TypeScript 初始化 | `pnpm dev` 启动 + 页面渲染 | `src/`, `package.json`, `vite.config.ts` |
| 0.6 | pnpm 依赖安装 | `pnpm install` 成功 | `package.json`（zustand, react-resizable-panels, @xterm/xterm, @xterm/addon-webgl, @xterm/addon-unicode11, @xterm/addon-attach, @codemirror/view, @codemirror/state, @codemirror/language, @codemirror/lang-javascript, @codemirror/lang-rust, @codemirror/lang-json, @codemirror/lang-html, @codemirror/lang-css, @codemirror/lang-python, @codemirror/theme-one-dark, @radix-ui/*, lucide-react） |
| 0.7 | Feature-Sliced 目录结构 | 所有目录存在 | `src/features/terminal/`, `src/features/editor/`, `src/features/sidebar/`, `src/shared/`, `src/layouts/` |
| 0.8 | 共享类型定义 | TypeScript 编译通过 | `src/shared/types/index.ts`（FileEntry, FileNode, StatusEntry, Worktree, Project, ProjectInfo, ReadFileResult, OpenFile, FsEvent） |
| 0.9 | themeStore 实现 | vitest: dark 配色常量正确 | `src/shared/stores/themeStore.ts` |
| 0.10 | AppLayout 骨架 | vitest: 三栏面板渲染 | `src/layouts/AppLayout.tsx`（PanelGroup + 3 Panel 占位） |
| 0.11 | useTauriCommand hook | vitest: mock invoke 调用 | `src/shared/hooks/useTauriCommand.ts` |
| 0.12 | vitest + testing-library 配置 | `pnpm test` 运行通过 | `vitest.config.ts`, `src/test/setup.ts` |
| 0.13 | E2E 测试环境配置 | `pnpm e2e` 启动（空测试通过） | `e2e-tests/wdio.conf.ts`, `e2e-tests/package.json` |
| 0.14 | tauri-webdriver 插件集成 | debug 构建加载插件，WebDriver server 启动 | `src-tauri/Cargo.toml`（tauri-plugin-webdriver-automation），`src-tauri/src/lib.rs` |

### 验收标准

- [ ] `pnpm tauri dev` 启动成功，显示空白三栏布局
- [ ] `cargo test` 通过（Rust 模块骨架编译）
- [ ] `pnpm test` 通过（前端基础测试）
- [ ] 目录结构与设计文档 6.1 完全一致

---

## PBI-1: 终端模块

**分支:** `feat/terminal`（worktree: `../ghostterm-worktrees/terminal`）
**前置:** PBI-0
**交付物:** 可交互的终端，能运行 shell 命令和 Claude Code

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 1.1 | PTY spawn/kill | `cargo test`: spawn 返回 pty_id + 进程存活；kill 后进程退出 | `src-tauri/src/pty_manager/mod.rs` |
| 1.2 | WebSocket server | `cargo test`: 启动 server 绑定 127.0.0.1 + 随机端口；token 验证通过/拒绝 | `src-tauri/src/pty_manager/ws_server.rs` |
| 1.3 | PTY ↔ WebSocket 桥接 | `cargo test`: 写入 PTY stdin 的数据从 stdout 回显；WebSocket 二进制帧正确传输 | `src-tauri/src/pty_manager/bridge.rs` |
| 1.4 | token 安全模型 | `cargo test`: token TTL 30s 过期；首次握手后失效；无连接 5s 自动 kill | `src-tauri/src/pty_manager/auth.rs` |
| 1.5 | resize_pty | `cargo test`: 调用后 PTY 窗口大小更新 | 集成到 `mod.rs` |
| 1.6 | reconnect_pty | `cargo test`: 签发新 token + 旧 token 失效 | 集成到 `mod.rs` |
| 1.7 | Tauri Command 注册 | `cargo test`: spawn_pty/reconnect_pty/resize_pty/kill_pty 可通过 invoke 调用 | `src-tauri/src/lib.rs`（注册命令） |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 1.8 | terminalStore | vitest: spawn 更新 ptyId/wsPort/wsToken；kill 重置为 null；reconnect 更新 token | `src/features/terminal/terminalStore.ts` |
| 1.9 | useTerminal hook | vitest: WebSocket 连接建立/断开状态管理；onclose 触发 reconnect | `src/features/terminal/useTerminal.ts` |
| 1.10 | Terminal.tsx | vitest: 组件挂载创建 xterm 实例；WebGL addon 加载；Unicode11 addon 加载；AttachAddon 连接 WebSocket | `src/features/terminal/Terminal.tsx` |
| 1.11 | xterm.js 主题同步 | vitest: 使用 themeStore 的 dark 配色 | 集成到 `Terminal.tsx` |
| 1.12 | 终端错误 UI | vitest: 连接失败显示错误 + 重试按钮；PTY 退出显示退出码 | 集成到 `Terminal.tsx` |

### 集成验证

- [ ] `pnpm tauri dev` → 终端面板可输入命令，回显正确
- [ ] 运行 `claude` 命令，statusline 正常渲染
- [ ] 终端 resize 随面板拖拽自适应
- [ ] 关闭终端后重新打开，PTY 重新 spawn

---

## PBI-2: 编辑器模块

**分支:** `feat/editor`（worktree: `../ghostterm-worktrees/editor`）
**前置:** PBI-0
**交付物:** 可打开/编辑/保存文件的代码编辑器 + 多标签页

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 2.1 | read_file（判别联合） | `cargo test`: text 文件返回 kind='text' + content；二进制返回 kind='binary' + mime_hint；大文件返回 kind='large'；权限不足返回 kind='error'；非 UTF-8 文件返回 kind='text' + detected encoding 或 kind='error' + 编码信息 | `src-tauri/src/fs_backend/mod.rs` |
| 2.2 | write_file | `cargo test`: 写入内容 → 读回一致；敏感路径（/etc）拒绝或提示 | `src-tauri/src/fs_backend/mod.rs` |
| 2.3 | list_dir | `cargo test`: 返回正确的 FileEntry 列表；排序；隐藏文件处理 | `src-tauri/src/fs_backend/mod.rs` |
| 2.4 | create/delete/rename_entry | `cargo test`: 创建文件/目录；删除；重命名后路径更新 | `src-tauri/src/fs_backend/mod.rs` |
| 2.5 | 路径安全（canonicalize） | `cargo test`: symlink 解析到真实路径；敏感路径写操作返回需确认标记 | `src-tauri/src/fs_backend/security.rs` |
| 2.6 | Tauri Command 注册 | 所有 fs 命令可通过 invoke 调用 | `src-tauri/src/lib.rs` |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 2.7 | editorStore | vitest: openFile 按 kind 分支创建 OpenFile；closeFile 移除；saveFile 更新 isDirty；setActive 切换 | `src/features/editor/editorStore.ts` |
| 2.8 | Editor.tsx（CodeMirror） | vitest: 加载 text content；语法高亮根据扩展名动态加载对应 Lezer 语言包（`@codemirror/lang-*`）；binary 显示占位符；large 显示只读提示；error 显示错误状态；非 UTF-8 文件（kind='error' + 编码信息）显示编码提示 + "以只读模式打开" 选项（MVP 不做转码/hex，仅提示） | `src/features/editor/Editor.tsx` |
| 2.9 | EditorTabs.tsx | vitest: 渲染打开的文件列表；点击切换 active；关闭按钮调用 closeFile；dirty 文件标记圆点 | `src/features/editor/tabs/EditorTabs.tsx` |
| 2.10 | 文件保存快捷键 | vitest: Cmd+S 触发 saveFile | 集成到 `Editor.tsx` |
| 2.11 | 编辑器主题同步 | vitest: 使用 themeStore 的 dark 配色应用 CM6 oneDark | 集成到 `Editor.tsx` |

### 集成验证

- [ ] 打开 text 文件 → 编辑器显示内容 + 语法高亮
- [ ] 编辑 → dirty 标记 → Cmd+S 保存 → dirty 消失
- [ ] 打开二进制文件 → 显示占位符
- [ ] 打开大文件 → 只读模式提示
- [ ] 多标签页切换正常

---

## PBI-3: 侧边栏模块

**分支:** `feat/sidebar`（worktree: `../ghostterm-worktrees/sidebar`）
**前置:** PBI-0
**交付物:** 左侧面板（项目选择器 + 文件树 + 标签页切换）

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 3.1 | list_recent_projects | `cargo test`: 从 projects.json 读取；空文件返回空列表；损坏文件备份恢复 | `src-tauri/src/project_manager/mod.rs` |
| 3.2 | open_project / close_project | `cargo test`: open 更新 recent list 并持久化；close 清理状态 | `src-tauri/src/project_manager/mod.rs` |
| 3.3 | projects.json 持久化 | `cargo test`: 序列化/反序列化；损坏文件备份为 .corrupt.timestamp | `src-tauri/src/project_manager/persistence.rs` |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 3.4 | sidebarStore | vitest: setTab 切换标签；toggleVisibility 显隐 | `src/features/sidebar/sidebarStore.ts` |
| 3.5 | projectStore | vitest: switchProject 更新 currentProject + recentProjects；closeProject 重置 | `src/features/sidebar/projectStore.ts` |
| 3.6 | fileTreeStore | vitest: refreshFileTree 填充树；toggleDir 展开/折叠；applyFsEvent 增量更新 | `src/features/sidebar/fileTreeStore.ts` |
| 3.7 | ProjectSelector.tsx | vitest: 显示当前项目名+路径；下拉列表渲染 recent projects；点击切换调用 switchProject | `src/features/sidebar/ProjectSelector.tsx` |
| 3.8 | FileTree.tsx | vitest: 渲染目录树；点击文件调用 editorStore.openFile；点击目录调用 toggleDir | `src/features/sidebar/FileTree.tsx` |
| 3.8.1 | FileTree 右键菜单 | vitest: 右键文件/目录弹出菜单（新建文件/新建目录/重命名/删除）；菜单操作调用对应 fs_backend 命令 | 集成到 `FileTree.tsx` |
| 3.9 | Sidebar.tsx | vitest: 三标签页容器；根据 activeTab 渲染对应面板 | `src/features/sidebar/Sidebar.tsx` |
| 3.10 | Cmd+B 快捷键 | vitest: 切换侧边栏显隐 | 集成到 `AppLayout.tsx` |

### 集成验证

- [ ] 文件树显示项目目录结构
- [ ] 点击文件 → 编辑器打开（需 PBI-2 合并后验证）
- [ ] 目录懒加载：展开子目录时才请求内容
- [ ] 项目选择器显示项目名 + 路径
- [ ] Cmd+B 切换侧边栏

---

## PBI-4: 文件实时监听

**分支:** `feat/fs-watcher`（worktree: `../ghostterm-worktrees/fs-watcher`）
**前置:** PBI-1 + PBI-2 + PBI-3（需要终端/编辑器/文件树都就绪）
**交付物:** AI 修改文件后编辑器自动检测 + 文件树实时更新

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 4.1 | start_watching / stop_watching | `cargo test`: 启动 watcher 后创建文件触发事件；stop 后不再触发 | `src-tauri/src/fs_backend/watcher.rs` |
| 4.2 | debounce + 排除规则 | `cargo test`: 100ms 内多次修改只触发一次；.git/node_modules 目录不触发 | `src-tauri/src/fs_backend/watcher.rs` |
| 4.3 | fs 事件类型区分 | `cargo test`: 创建→fs:created；修改→fs:modified；删除→fs:deleted；重命名→fs:renamed | `src-tauri/src/fs_backend/watcher.rs` |
| 4.4 | Tauri Event 推送 | `cargo test`: 事件正确通过 app.emit 推送 | 集成到 `watcher.rs` |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 4.5 | fs 事件监听注册 | vitest: listen("fs:created/modified/deleted/renamed") 触发回调 | `src/shared/hooks/useFsEvents.ts` |
| 4.6 | 文件树增量更新 | vitest: fs:created 添加节点；fs:deleted 移除节点；fs:renamed 更新路径 | 集成到 `fileTreeStore.ts` 的 `applyFsEvent` |
| 4.7 | 编辑器外部修改处理 | vitest: fs:modified → read_file → handleExternalChange；isDirty=false 直接替换；isDirty=true 弹出提示 | 集成到 `editorStore.ts` 的 `handleExternalChange` |
| 4.8 | 冲突提示 UI | vitest: 弹出三选项对话框 [保留修改] [加载新版本] [查看 diff] | `src/features/editor/ConflictDialog.tsx` |

### 集成验证

- [ ] 终端中用 `touch newfile.txt` → 文件树自动出现新文件
- [ ] 终端中删除文件 → 文件树自动移除
- [ ] Claude Code 修改已打开的文件（无 dirty） → 编辑器自动刷新
- [ ] 手动编辑后，Claude Code 再修改 → 弹出冲突提示
- [ ] 批量操作（git checkout）→ 文件树正确更新，无刷屏

---

## PBI-5: Git + Worktree

**分支:** `feat/git-worktree`（worktree: `../ghostterm-worktrees/git-worktree`）
**前置:** PBI-1（PTY respawn）+ PBI-2（dirty 检查）+ PBI-3（侧边栏 UI）+ PBI-4（watcher 重启）
**交付物:** Git 状态显示 + 暂存操作 + Worktree 管理（创建/删除/切换）

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 5.1 | git_status | `cargo test`: 新增文件→new；修改→modified；删除→deleted；staged/unstaged 区分 | `src-tauri/src/git_backend/mod.rs` |
| 5.2 | git_stage / git_unstage | `cargo test`: stage 后文件进入 staged；unstage 后回到 unstaged | `src-tauri/src/git_backend/mod.rs` |
| 5.3 | git_diff | `cargo test`: 返回文件级 diff 文本 | `src-tauri/src/git_backend/mod.rs` |
| 5.4 | git_current_branch | `cargo test`: 返回当前分支名；detached HEAD 场景 | `src-tauri/src/git_backend/mod.rs` |
| 5.5 | worktree_list | `cargo test`: 返回所有 worktree 的 path + branch + is_current | `src-tauri/src/git_backend/worktree.rs` |
| 5.6 | worktree_add / worktree_remove | `cargo test`: 创建新 worktree → list 中出现；删除 → 从 list 消失。git2 失败时 fallback 到 git CLI | `src-tauri/src/git_backend/worktree.rs` |
| 5.7 | worktree_switch（事务流程） | `cargo test`: 成功切换 → cwd 更新 + watcher 重启 + PTY respawn；spawn 失败 → 回滚到旧 cwd | `src-tauri/src/git_backend/worktree.rs` + `project_manager` |
| 5.8 | Tauri Command 注册 | 所有 git 命令可通过 invoke 调用 | `src-tauri/src/lib.rs` |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 5.9 | gitStore | vitest: refreshGitStatus 填充 changes/currentBranch；refreshWorktrees 填充 worktrees；stage/unstage 更新状态 | `src/features/sidebar/gitStore.ts` |
| 5.10 | Changes.tsx | vitest: 渲染 staged/unstaged 列表；文件状态标记（M/A/D）；stage/unstage 按钮 | `src/features/sidebar/Changes.tsx` |
| 5.11 | Worktrees.tsx | vitest: 渲染 worktree 列表；当前 worktree 高亮；点击切换调用 worktree_switch | `src/features/sidebar/Worktrees.tsx` |
| 5.12 | Worktree 创建/删除 UI | vitest: 创建按钮→弹出分支名输入→调用 worktree_add；删除按钮→确认对话框→调用 worktree_remove | 集成到 `Worktrees.tsx` |
| 5.13 | Worktree 切换事务 UI | vitest: 未保存文件弹出提示；切换中 UI 冻结 + 进度指示；失败恢复 + Toast 错误 | 集成到 `Worktrees.tsx` |
| 5.14 | 文件树 Git 状态标记 | vitest: FileTree 节点根据 git status 显示颜色标记（M-黄/A-绿/D-红） | 集成到 `FileTree.tsx` |

### 集成验证

- [ ] Changes 标签页显示暂存/未暂存文件列表
- [ ] 点击 stage → 文件移到 staged 区域
- [ ] Worktrees 标签页显示所有 worktree
- [ ] 切换 worktree → 文件树/编辑器/终端全部更新到新 cwd
- [ ] 切换时有未保存文件 → 弹出保存提示
- [ ] 文件树中修改的文件有颜色标记

---

## PBI-6: 项目管理 + 集成

**分支:** `feat/project-manager`（worktree: `../ghostterm-worktrees/project-manager`）
**前置:** PBI-1 + PBI-2 + PBI-3 + PBI-4 + PBI-5（全模块就绪）
**交付物:** 完整的项目打开/关闭/切换 + 全链路集成测试 + 布局交互完善

### 后端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 6.1 | open_project 协调链路 | `cargo test`: open → start_watching + spawn_pty；项目加入 recent list | `src-tauri/src/project_manager/mod.rs` |
| 6.2 | close_project 协调链路 | `cargo test`: close → stop_watching + kill_pty；状态清理 | `src-tauri/src/project_manager/mod.rs` |
| 6.3 | 多项目切换 | `cargo test`: 切换项目 → 旧项目 close + 新项目 open | `src-tauri/src/project_manager/mod.rs` |

### 前端任务

| # | 任务 | TDD 测试 | 产出文件 |
|---|------|----------|----------|
| 6.4 | projectStore 协调 | vitest: switchProject → editorStore 关闭所有文件 + fileTreeStore 刷新 + gitStore 刷新 | 集成到 `projectStore.ts` |
| 6.5 | 布局交互完善 | vitest: 双击面板标题栏全屏/恢复；Cmd+` 焦点切换；窗口 < 800px 自动折叠 | 集成到 `AppLayout.tsx` |
| 6.6 | 快捷键系统 | vitest: Cmd+B 侧边栏；Cmd+` 焦点切换；Cmd+S 保存 | `src/shared/hooks/useKeyboardShortcuts.ts` |

### E2E 集成测试（tauri-webdriver + WebdriverIO）

测试方案：使用 [danielraffel/tauri-webdriver](https://github.com/danielraffel/tauri-webdriver) 作为 WebDriver 后端，WebdriverIO 作为测试框架。

**架构：**
```
WebdriverIO 测试脚本
  → W3C WebDriver 协议 (port 4444)
  → tauri-wd CLI (WebDriver server)
  → tauri-plugin-webdriver-automation (嵌入 Tauri 应用的插件)
  → WKWebView (macOS) / WebView2 (Windows) / WebKitGTK (Linux)
```

**配置：**
```
e2e-tests/
  wdio.conf.ts          # WebdriverIO 配置
  specs/
    project-flow.test.ts    # 6.7 打开项目全链路
    terminal.test.ts        # 6.8 终端数据通道
    fs-watcher.test.ts      # 6.9 文件监听链路
    worktree.test.ts        # 6.10 事务切换
    lifecycle.test.ts       # 6.11 生命周期
    layout.test.ts          # 6.12 响应式布局
```

| # | 测试场景 | 验证点 | WebdriverIO 操作 |
|---|----------|--------|-----------------|
| 6.7 | 打开项目 → 文件树 → 点击文件 → 编辑器显示 | 全链路数据流 | `$('.file-tree-item').click()` → 断言编辑器内容非空 |
| 6.8 | PTY spawn → WebSocket → 输入命令 → 输出回显 | 终端数据通道 | `$('.terminal').click()` → 键入 `echo test` → 断言输出包含 `test` |
| 6.9 | 外部修改文件 → fs 事件 → 编辑器更新 | 文件监听链路 | 终端中 `echo "new" > file.txt` → 断言编辑器 content 更新 |
| 6.10 | Worktree 切换 → 全模块重置 | 事务切换 | `$('.worktree-item').click()` → 断言文件树 + 编辑器 + 终端 cwd 更新 |
| 6.11 | 关闭项目 → 重新打开 → 状态恢复 | 生命周期 | 项目选择器切换 → 断言 recent list 更新 |
| 6.12 | 窗口缩小 → 布局响应 → 放大恢复 | 响应式布局 | `browser.setWindowSize(600, 400)` → 断言侧边栏隐藏 |

### 验收标准（MVP 完成标准）

- [ ] `pnpm tauri dev` 启动 → 显示完整三栏布局
- [ ] 终端可运行 Claude Code，statusline 正常
- [ ] 编辑器可打开/编辑/保存文件
- [ ] 文件树实时响应文件系统变化
- [ ] AI 修改文件后编辑器自动更新或提示
- [ ] Git 状态正确显示，可暂存/取消暂存
- [ ] Worktree 可创建/删除/切换
- [ ] 项目可切换，状态正确重置
- [ ] `cargo test` 全部通过
- [ ] `pnpm test` 全部通过
- [ ] E2E 集成测试全部通过（`pnpm e2e`，tauri-webdriver + WebdriverIO）

---

## Worktree 操作指南

### 创建 worktree 开始新 PBI

```bash
# 在项目根目录执行（-b 自动创建新分支）
mkdir -p ../ghostterm-worktrees
git worktree add -b feat/terminal ../ghostterm-worktrees/terminal
git worktree add -b feat/editor ../ghostterm-worktrees/editor
git worktree add -b feat/sidebar ../ghostterm-worktrees/sidebar
```

### 合并完成的 PBI

```bash
# 回到主 worktree
cd /path/to/GhostTerm

# 合并 PBI（按阶段顺序）
git merge feat/terminal
git merge feat/editor
git merge feat/sidebar

# 清理 worktree
git worktree remove ../ghostterm-worktrees/terminal
```

### 冲突预防

阶段 2 的三个 PBI 之间几乎无代码重叠：
- `feat/terminal` 只修改 `src/features/terminal/` + `src-tauri/src/pty_manager/`
- `feat/editor` 只修改 `src/features/editor/` + `src-tauri/src/fs_backend/`（CRUD 部分）
- `feat/sidebar` 只修改 `src/features/sidebar/` + `src-tauri/src/project_manager/`

共享修改点（壳层文件）:
- `src-tauri/src/lib.rs` — Tauri Command 注册
- `src/layouts/AppLayout.tsx` — 挂载 Sidebar/Editor/Terminal 组件
- `src/shared/types/index.ts` — 跨模块类型定义
- `src/App.tsx` — 顶层路由/Provider

**策略：** 阶段 2 各分支只产出各自 feature 目录内的文件和对应 Rust 模块。壳层文件的接线统一在阶段 2.5 合并时由主分支完成。各分支中的组件用 `export default` 导出，合并时在 AppLayout 中统一 import 挂载。

---

## TDD 工作流（每个任务）

```
1. 写测试（红灯）
   cargo test / pnpm test → 测试失败

2. 最小实现（绿灯）
   编写刚好让测试通过的代码

3. 重构（保持绿灯）
   改善代码质量，测试仍通过

4. 提交
   git commit -m "feat(模块): 功能描述"
```

### Rust 测试模板

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_spawn_pty_returns_valid_id() {
        let result = spawn_pty("/bin/zsh", "/tmp", HashMap::new()).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(!info.pty_id.is_empty());
        assert!(info.ws_port > 0);
        assert!(!info.ws_token.is_empty());
    }
}
```

### 前端测试模板

```typescript
import { describe, it, expect } from 'vitest'
import { useTerminalStore } from './terminalStore'

describe('terminalStore', () => {
  it('spawn 更新连接信息', async () => {
    const store = useTerminalStore.getState()
    await store.spawn('/tmp')
    expect(store.ptyId).not.toBeNull()
    expect(store.wsPort).toBeGreaterThan(0)
    expect(store.connected).toBe(false) // WebSocket 未连接，仅 PTY 已 spawn
  })
})
```

### E2E 测试模板（tauri-webdriver + WebdriverIO）

```typescript
// e2e-tests/specs/project-flow.test.ts
describe('项目打开全链路', () => {
  it('打开项目后文件树显示目录内容', async () => {
    // 等待应用启动完成
    await browser.waitUntil(
      async () => (await $('.file-tree')).isDisplayed(),
      { timeout: 10000, timeoutMsg: '文件树未在 10s 内加载' }
    )

    // 点击文件树中的文件
    const fileItem = await $('.file-tree-item[data-path="src/App.tsx"]')
    await fileItem.click()

    // 验证编辑器加载了文件内容
    const editorContent = await $('.cm-content')
    await expect(editorContent).toHaveTextContaining('App')
  })

  it('编辑文件后标签页显示 dirty 标记', async () => {
    const editor = await $('.cm-content')
    await editor.click()
    await browser.keys(['a']) // 输入一个字符

    const activeTab = await $('.editor-tab.active')
    const isDirty = await activeTab.$('.dirty-indicator')
    await expect(isDirty).toBeDisplayed()
  })
})
```

### E2E 环境配置

```typescript
// e2e-tests/wdio.conf.ts
import { join } from 'path'

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.test.ts'],
  maxInstances: 1, // Tauri 应用单实例
  capabilities: [{
    // tauri-webdriver 配置
    browserName: 'tauri',
    'tauri:options': {
      application: join(__dirname, '../src-tauri/target/debug/ghostterm'),
    },
  }],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 30000, // E2E 测试给更长超时
  },
}
```

### 三层测试策略总览

```
┌─────────────────────────────────────────────────────────┐
│  E2E 测试 (tauri-webdriver + WebdriverIO)               │
│  6 个关键链路 · 验证真实 webview 行为                    │
│  pnpm e2e · 慢（~30s/case）· PBI-6 阶段编写             │
├─────────────────────────────────────────────────────────┤
│  前端组件/Store 测试 (vitest + testing-library)          │
│  每个 feature 模块 · mock Tauri invoke                   │
│  pnpm test · 快（~100ms/case）· 每个 PBI 编写            │
├─────────────────────────────────────────────────────────┤
│  Rust 单元测试 (cargo test)                              │
│  4 个后端模块 · 真实文件系统/PTY/Git                     │
│  cargo test · 中速（~1s/case）· 每个 PBI 编写            │
└─────────────────────────────────────────────────────────┘
```

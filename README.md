# GhostTerm

轻量级代码编辑器 + 终端一体化桌面应用，为 Claude Code 等 AI CLI 工具深度优化。

## 为什么做 GhostTerm

现有 IDE（VS Code、Cursor）太重，编辑器与终端之间的上下文切换割裂。把图片、文本、文件等内容喂给 AI CLI 需要反复复制粘贴。GhostTerm 的目标是用一个轻量桌面应用解决这些摩擦：

- **三栏一体**：侧边栏 + 编辑器 + 终端，拖拽调整比例
- **零摩擦上下文**：文件/选区/图片可直接发送给 AI CLI（Phase 2）
- **轻量启动**：打包体积 ~5MB，秒级启动

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Tauri | 2.x |
| 前端 | React + TypeScript | 19.x / 5.8 |
| 状态管理 | Zustand | 5.x |
| 编辑器 | CodeMirror 6 | 6.x |
| 终端 | xterm.js + WebGL | 5.x |
| 后端 | Rust | 2021 Edition |
| 构建 | Vite | 7.x |

## 项目结构

```
GhostTerm/
  src/                          # 前端（React + TypeScript）
    features/
      editor/                   # CodeMirror 6 编辑器（多标签、语法高亮、保存）
      sidebar/                  # 左侧面板（项目选择器、Files/Changes/Worktrees）
      terminal/                 # xterm.js 终端（WebSocket 连接 PTY）
    layouts/
      AppLayout.tsx             # 三栏布局（react-resizable-panels）
    shared/
      hooks/                    # 全局快捷键等共享 Hook
      types/                    # 类型定义

  src-tauri/src/                # 后端（Rust）
    pty_manager/                # PTY 管理（spawn/kill/WebSocket 数据流）
    fs_backend/                 # 文件系统（读写、目录树、watcher）
    git_backend/                # Git 操作（状态、暂存、worktree）
    project_manager/            # 项目管理（打开/关闭、最近列表、持久化）
```

## 功能

### 已实现（MVP）

- **终端**：xterm.js + WebGL 渲染 + Unicode 11 支持，通过 WebSocket 连接 Rust PTY
- **代码编辑器**：CodeMirror 6，支持 JS/TS/Rust/Python/JSON/HTML/CSS 语法高亮、行号、多标签页、文件保存、二进制文件检测、编码检测
- **左侧面板**：
  - 项目选择器：当前项目 + 最近项目下拉切换
  - Files 标签页：目录树浏览，lazy 加载子目录
  - Changes 标签页：Git 暂存/未暂存文件列表，支持 stage/unstage
  - Worktrees 标签页：Git worktree 列表与切换
- **布局**：三栏分屏，react-resizable-panels 拖拽调比例
- **快捷键**：Cmd+B 切换侧边栏、Cmd+\` 切换焦点面板、Cmd+S 保存文件
- **窗口自适应**：窄屏自动折叠侧边栏，宽屏恢复（尊重用户手动折叠）
- **项目切换协调**：串行化锁防止并发切换，watcher/PTY 生命周期自动管理

### 计划中（Phase 2）

- 内容管道：右键菜单发送文本/文件/图片/目录给 AI CLI
- 命令面板：Cmd+K 触发自定义 skill/工作流
- Claude Code 深度集成：Markdown 输出渲染、会话历史管理
- 内置浏览器：选区一键发送给 AI CLI

## 环境要求

- **Node.js** >= 22.x（推荐使用 [volta](https://volta.sh) 管理）
- **pnpm** >= 9.x
- **Rust** >= 1.80（通过 [rustup](https://rustup.rs) 安装）
- **平台**：macOS / Windows

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/kissesu/GhostTerm.git
cd GhostTerm

# 安装前端依赖
pnpm install

# 启动开发模式（前端 + Tauri 后端）
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

## 测试

```bash
# 运行前端单元测试（192 tests）
pnpm test

# 监听模式
pnpm test:watch

# 运行 E2E 测试（需要先 build）
pnpm e2e

# Rust 后端测试
cd src-tauri && cargo test
```

## 项目状态

- 版本：0.1.0（MVP）
- 测试：192 个前端单元测试通过
- 阶段：MVP 已完成，Phase 2 开发中

## 作者

Atlas.oi

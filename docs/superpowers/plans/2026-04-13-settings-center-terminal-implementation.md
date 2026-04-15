# GhostTerm 设置中心（终端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 GhostTerm 增加一个独立设置页面与终端配置能力，替换当前终端 shell 硬编码，并支持本地持久化。

**Architecture:** 通过应用级视图状态在主界面与设置页面之间切换；新增 `settingsStore` 负责终端配置与本地持久化；终端创建流程从设置中读取 shell 策略，并通过新增的 Tauri command 解析系统默认 shell。

**Tech Stack:** React 19、Zustand、Vitest、Tauri 2、Rust

---

### Task 1: 文档与状态骨架

**Files:**
- Create: `src/shared/stores/settingsStore.ts`
- Create: `src/test/settingsStore.test.ts`
- Modify: `src/App.tsx`

- [ ] 编写 `settingsStore`，定义 `appView` 与 `terminalSettings` 默认值，并使用本地持久化。
- [ ] 补 `settingsStore` 单元测试，覆盖默认值、视图切换、终端设置更新。
- [ ] 调整 `App.tsx`，根据 `appView` 渲染主布局或设置页壳层。

### Task 2: 主界面标题栏设置入口

**Files:**
- Modify: `src/layouts/AppLayout.tsx`
- Test: `src/test/AppLayout.test.tsx`

- [ ] 在现有 title 栏右侧增加设置按钮与布局样式。
- [ ] 点击设置按钮时切换到 `settings` 视图。
- [ ] 扩充 `AppLayout` 测试，验证设置入口存在且可切换视图。

### Task 3: 设置页面 UI

**Files:**
- Create: `src/features/settings/SettingsPage.tsx`
- Create: `src/features/settings/index.ts`
- Test: `src/test/SettingsPage.test.tsx`

- [ ] 创建设置页面，两栏结构：左侧导航、右侧内容。
- [ ] 实现“终端”分组表单与返回主界面的按钮。
- [ ] 使用 `settingsStore` 绑定表单状态。
- [ ] 编写设置页测试，覆盖表单渲染、切回主界面、字段交互。

### Task 4: 终端配置接入前端

**Files:**
- Modify: `src/features/terminal/terminalStore.ts`
- Modify: `src/features/terminal/Terminal.tsx`
- Test: `src/test/terminalStore.test.ts`
- Test: `src/test/Terminal.test.tsx`

- [ ] `terminalStore.spawn()` 改为从 `settingsStore` 读取 shell 策略。
- [ ] `Terminal.tsx` 改为从 `settingsStore` 读取字体、光标、终端主题。
- [ ] 扩充测试，覆盖系统 shell / 自定义 shell 分支，以及 xterm 选项更新。

### Task 5: 后端系统默认 shell 解析

**Files:**
- Modify: `src-tauri/src/pty_manager/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/pty_manager/mod.rs`

- [ ] 新增 `get_default_shell_cmd`。
- [ ] 提取并测试默认 shell 解析逻辑。
- [ ] 在 Tauri `invoke_handler` 中注册该 command。

### Task 6: 全量验证

**Files:**
- Modify: `src-tauri/src/pty_manager/bridge.rs`（仅在 lint/警告修正必要时）

- [ ] 运行前端测试：`pnpm test`
- [ ] 运行后端测试：`cargo test`
- [ ] 运行构建：`pnpm build`
- [ ] 如环境允许，补充一次 `pnpm tauri dev` 手工验证设置页与终端 shell 行为

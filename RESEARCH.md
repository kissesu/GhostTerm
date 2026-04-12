# GhostTerm - 前期调研整理

> 工作名，最终命名待定。本文档整理自 2026-04-12 会话中对 Supremum 项目的分析，供 `/discover` 需求发现阶段参考。

## 1. 参考项目：Supremum

- GitHub: https://github.com/HybridTalentComputing/Supremum
- 定位：轻量 AI 代码编辑器（~5MB），终端优先，面向 Claude CLI 用户
- 本地副本：/tmp/Supremum（浅克隆）

### 1.1 技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 桌面框架 | Tauri 2 | Rust + 系统 webview |
| 前端 | React 19 + Vite | TypeScript 73.4% |
| 终端 | xterm.js | JS 终端模拟器，运行在 webview 内 |
| 编辑器 | CodeMirror 6 | |
| UI 组件 | shadcn/ui + Radix UI | |
| 后端 PTY | Rust（spawn_pty / write_pty） | |
| Git | Rust git_backend.rs | |

### 1.2 代码质量评估

| 指标 | 数值 | 评价 |
|---|---|---|
| 总代码量 | ~20,000 行（TS 13K + Rust 2.3K + CSS 4.7K） | 中小型 |
| MainLayout.tsx | 4,849 行 | 上帝组件，所有逻辑紧耦合 |
| Terminal.tsx | 567 行 | 相对独立，可参考 |
| Rust 后端 | lib.rs 1062 + git_backend.rs 1268 | 简洁，PTY+Git |
| 文件结构 | 33 个文件平铺 src/，无分层 | 无架构 |
| 前端依赖 | 36 个 | 偏多 |

### 1.3 结论

**重建比 fork 改造快 2-3 倍**。原因：
1. MainLayout.tsx 4849 行紧耦合上帝组件，改造风险高于重建
2. 无架构分层（无 components/hooks/stores），隐式依赖多
3. Terminal.tsx 仅 567 行，说明终端集成本身不复杂
4. Rust PTY 代码可直接复用

## 2. 终端技术方案对比

核心诉求：渲染 Claude CLI 不花屏，性能好。

### 2.1 Tauri webview 内的方案

| 方案 | 思路 | 工作量 | 花屏风险 | 性能 |
|---|---|---|---|---|
| **A. xterm.js + WebGL** | 直接用，加 WebGL addon + Unicode11 addon | 低 | 配置正确则低（VS Code 同方案） | 中 |
| **B. alacritty_terminal** | Rust 后端做 VT 解析，前端只渲染 cell grid | 中高 | 极低 | 中高 |
| **C. libghostty-vt** | 同 B 思路但用 Ghostty 核心库（alpha） | 中高 | 极低 | 中高 |

### 2.2 突破 webview 的方案

| 方案 | 思路 | 可行性 |
|---|---|---|
| Tauri 原生子窗口 | NSView 嵌入，跑原生终端 | macOS 可行，跨平台痛苦 |
| 换框架到 GPUI | gpui-ghostty 已验证 | GPUI 文档不成熟 |
| 换框架到 Swift/AppKit | 等 libghostty Swift framework | 仅 macOS |

### 2.3 建议

先用方案 A（xterm.js + WebGL），如确实花屏再上方案 B（alacritty_terminal）。

## 3. Tauri 架构的天花板

- webview 内无法嵌入原生 GPU 渲染表面（Metal/OpenGL）
- 终端渲染性能上限受 webview 约束
- 如果未来需要 Ghostty 级原生终端体验，需要迁移到原生框架
- 这是架构选择的 trade-off：Tauri 的优势是轻量（5MB）+ 跨平台 + Web 技术栈

## 4. 建议的重建路线

```
tauri init
  -> 复用 Supremum 的 Rust PTY 代码（lib.rs spawn_pty/write_pty）
  -> Terminal: xterm.js + WebGL addon + Unicode11 addon
  -> 布局: React 19 + shadcn/ui（从零搭，不抄 MainLayout）
  -> 编辑器: CodeMirror 6（独立集成）
  -> Git: 参考 Supremum 的 git_backend.rs
```

## 5. 待 /discover 确定的问题

- [ ] 项目最终命名
- [ ] 目标用户画像（自用 / 开源社区 / 商业？）
- [ ] 核心差异化定位（vs Supremum / vs Cursor / vs Zed？）
- [ ] 终端方案最终选择（先 A 后 B？还是直接 B？）
- [ ] 是否只做 macOS，还是跨平台？
- [ ] Claude CLI 之外是否支持其他 AI CLI（Codex CLI、Gemini CLI、Hermes）？
- [ ] MVP scope 定义（最小可用功能集）
- [ ] 是否需要 AI 对话面板（非终端内嵌的独立 chat UI）？

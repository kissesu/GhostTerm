# GhostTerm 设置中心（终端）设计

## 背景

当前 GhostTerm 缺少统一的配置页面，终端关键行为仍存在硬编码，最明显的是默认 shell 直接写死为 `/bin/zsh`。这会导致产品行为与用户真实系统环境不一致，也让终端相关调整无法通过 UI 完成。

第一版只解决“设置中心骨架 + 终端配置”问题，不同时引入编辑器、Git、快捷键等其他设置域。

## 目标

- 提供可达的设置入口，位置位于窗口 title 栏右侧。
- 点击入口后进入独立设置页面，而不是弹窗。
- 设置中心采用可扩展的信息架构，但首版只启用“终端”分组。
- 允许用户配置终端行为与外观，尤其是 shell 选择。
- 新配置应持久化到本地，并在应用重启后恢复。

## 非目标

- 不引入完整路由系统。
- 不实现编辑器、Git、快捷键等其他设置分组。
- 不做后端配置文件持久化；首版仅做前端本地持久化。
- 不对已打开终端强制热重启；shell 配置只影响后续新建 PTY。

## 方案概述

应用增加一个顶层视图状态：

- `main`：现有主工作区（三栏布局）
- `settings`：设置中心页面

设置 icon 放在 title 栏右侧，点击后切换到 `settings` 视图。设置页面内部采用两栏布局：

- 左侧导航：首版仅显示“终端”
- 右侧表单：终端相关设置项

配置通过新的 `settingsStore` 管理，并使用本地持久化保存。终端启动流程改为读取设置，而不是写死 `/bin/zsh`。

## 终端设置范围

首版终端设置项固定为以下 6 项：

1. `使用系统默认 shell`
2. `自定义 shell 路径`
3. `终端字体大小`
4. `终端字体家族`
5. `光标样式`
6. `终端主题`

### 行为规则

- `使用系统默认 shell = true` 时，禁用自定义 shell 输入框。
- `使用系统默认 shell = false` 时，使用自定义 shell 路径。
- shell 设置只影响之后调用 `spawn_pty_cmd` 创建的新终端。
- 字体、光标样式、终端主题属于纯前端显示配置，应即时反映到终端组件。

## 默认值

- `useSystemShell = true`
- `customShellPath = ""`
- `fontSize = 13`
- `fontFamily = "Menlo, Monaco, 'Courier New', monospace"`
- `cursorStyle = "block"`
- `theme = "ghostterm-dark"`

## 数据模型

新增前端设置状态：

- `appView: 'main' | 'settings'`
- `terminalSettings.useSystemShell: boolean`
- `terminalSettings.customShellPath: string`
- `terminalSettings.fontSize: number`
- `terminalSettings.fontFamily: string`
- `terminalSettings.cursorStyle: 'block' | 'underline' | 'bar'`
- `terminalSettings.theme: 'ghostterm-dark' | 'ghostterm-light'`

## 数据流

### 页面切换

- title 栏右侧 settings icon -> 更新应用视图状态 -> 渲染设置页面
- 设置页面提供“返回”操作 -> 切回 `main`

### 设置读取与持久化

- `settingsStore` 初始化时从本地存储恢复
- 用户在设置页修改表单时，直接更新 `settingsStore`
- `persist` 中间件负责自动写回本地存储

### 终端启动链路

- `Terminal` 组件挂载时仍调用 `terminalStore.spawn(cwd)`
- `terminalStore.spawn()` 从 `settingsStore` 读取 shell 策略
- 若 `useSystemShell = true`，调用新的 Tauri command 获取系统默认 shell
- 若 `useSystemShell = false`，使用 `customShellPath`
- 将最终 shell 路径传给 `spawn_pty_cmd`

### 终端显示链路

- `Terminal.tsx` 从 `settingsStore` 读取字体大小、字体家族、光标样式、终端主题
- xterm 实例初始化时使用这些值
- 配置变更时更新已有 xterm 实例的对应 options/theme

## 后端职责

新增一个轻量 Tauri command，用于解析系统默认 shell：

- 命令名建议：`get_default_shell_cmd`
- macOS/Linux：优先读取 `SHELL` 环境变量；为空时回退 `/bin/zsh` 或 `/bin/bash`
- Windows：暂按现有兼容策略回退 `cmd.exe`

后端不负责设置持久化，只负责提供系统默认 shell 解析能力。

## UI 结构

### Title 栏

- 左侧保持 traffic lights 留白区
- 右侧增加设置按钮
- 设置按钮使用项目内联 SVG 图标，不依赖额外图标库

### 设置页面

- 顶部保留与主界面一致的 title 栏拖拽区
- 页面主体为左右两栏
- 左栏宽度固定，作为设置导航
- 右栏为表单内容区，表单项纵向排列

### 终端表单

- 使用简单原生表单控件，保持现有项目风格
- Shell 选项放在最上方
- 外观配置放在其后

## 测试策略

前端：

- `App` 或应用视图测试：点击 settings icon 后进入设置页，点击返回后恢复主界面
- `settingsStore` 测试：默认值、更新行为、持久化恢复
- `terminalStore` 测试：根据设置决定使用系统 shell 还是自定义 shell
- `Terminal` 测试：字体/光标/主题设置能传入 xterm

后端：

- `get_default_shell_cmd` 测试：有 `SHELL` 时返回其值；无时走回退逻辑

## 风险与约束

- 当前项目没有路由体系，所以首版使用应用级视图状态切换，避免把一个简单设置页问题升级成路由改造。
- 终端主题如果提供明亮主题，应用外围仍保持暗色；这是首版允许的局部不一致，优先满足终端可配置。
- 本地持久化基于浏览器存储，若未来需要跨设备或后端统一配置，再迁移到 Tauri 配置文件。

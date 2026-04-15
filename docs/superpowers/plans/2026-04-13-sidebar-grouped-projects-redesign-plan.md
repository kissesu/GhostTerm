# GhostTerm 左侧面板整体整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将左侧面板从“最近项目下拉”重构为“分组后的项目列表”为中心的导航面板，并完成顶部分组栏、分组切换面板、搜索和项目列表交互。

**Architecture:** 保留后端最近项目与项目切换能力，新建前端 `projectGroupingStore` 负责分组、映射、当前分组和搜索状态；重构当前 `ProjectSelector` 周边组件，把顶部与项目区拆成更小的视图单元，由 `Sidebar` 统一编排。

**Tech Stack:** React 19、Zustand、Vitest、Tauri 2

---

### Task 1: 建立分组状态模型

**Files:**
- Create: `src/features/sidebar/projectGroupingStore.ts`
- Test: `src/features/sidebar/__tests__/projectGroupingStore.test.ts`

- [ ] 定义分组类型、默认分组约定（`all`、`ungrouped`）与项目到分组映射结构。
- [ ] 使用本地持久化保存 `groups`、`projectGroupMap`、`selectedGroupId`。
- [ ] 实现以下状态操作：
  - 创建分组
  - 重命名分组
  - 删除分组
  - 选择当前分组
  - 修改搜索词
  - 将项目归类到某分组
- [ ] 实现派生选择器：
  - 分组项目计数
  - 当前分组项目列表
  - 当前分组 + 搜索后的过滤结果
- [ ] 编写单元测试覆盖默认值、创建/删除/重命名、过滤和搜索行为。

### Task 2: 拆分顶部分组区组件

**Files:**
- Create: `src/features/sidebar/ProjectGroupHeader.tsx`
- Create: `src/features/sidebar/ProjectGroupMenu.tsx`
- Test: `src/features/sidebar/__tests__/ProjectGroupHeader.test.tsx`
- Test: `src/features/sidebar/__tests__/ProjectGroupMenu.test.tsx`

- [ ] 新建 `ProjectGroupHeader`，渲染：
  - emoji
  - 颜色圆点
  - 当前分组名
  - 项目数胶囊
  - 下拉切换按钮
  - 编辑按钮
- [ ] 新建 `ProjectGroupMenu`，渲染：
  - `全部`
  - `未分组`
  - 自定义分组
  - 当前选中勾选
  - 底部“新建分组”
- [ ] 把“展开/收起面板”的显隐逻辑放到顶部项目区容器层，不埋在 header 内部。
- [ ] 为两个组件分别补交互测试。

### Task 3: 重构搜索和项目列表

**Files:**
- Create: `src/features/sidebar/ProjectSearchBar.tsx`
- Create: `src/features/sidebar/ProjectList.tsx`
- Create: `src/features/sidebar/ProjectListItem.tsx`
- Test: `src/features/sidebar/__tests__/ProjectSearchBar.test.tsx`
- Test: `src/features/sidebar/__tests__/ProjectList.test.tsx`

- [ ] 把搜索框从现有项目选择器逻辑中独立出来。
- [ ] 搜索作用域限定在当前分组结果集。
- [ ] 新建 `ProjectList` 和 `ProjectListItem`，负责渲染项目卡片。
- [ ] 当前项目高亮，但不改变顶部当前分组摘要。
- [ ] 点击项目卡片继续调用 `projectStore.openProject/switchProject`。
- [ ] 编写测试覆盖：
  - 分组过滤结果渲染
  - 搜索后过滤
  - 点击项目切换
  - 当前项目高亮

### Task 4: 替换旧 ProjectSelector 结构

**Files:**
- Modify: `src/features/sidebar/Sidebar.tsx`
- Modify: `src/features/sidebar/ProjectSelector.tsx`
- Modify: `src/features/sidebar/index.ts`
- Test: `src/features/sidebar/__tests__/Sidebar.test.tsx`
- Test: `src/features/sidebar/__tests__/ProjectSelector.test.tsx`

- [ ] 将 `ProjectSelector` 从“最近项目下拉”改造成“左侧项目区容器”。
- [ ] 组合新组件：
  - `ProjectGroupHeader`
  - `ProjectGroupMenu`
  - `ProjectSearchBar`
  - `ProjectList`
- [ ] 移除原来的“最近项目 listbox + 打开文件夹按钮在下拉底部”的结构。
- [ ] 保留“打开文件夹”能力，但将其迁移到更合适的位置，例如项目区工具栏或列表区操作按钮。
- [ ] 更新 `Sidebar.tsx`，确保左侧面板顶部与内容区仍满足独立滚动约束。
- [ ] 重写旧 `ProjectSelector` 测试，删除不再成立的“最近项目下拉”断言。

### Task 5: 接入现有项目数据源

**Files:**
- Modify: `src/features/sidebar/projectStore.ts`
- Modify: `src/features/sidebar/projectGroupingStore.ts`
- Test: `src/features/sidebar/__tests__/projectStore.test.ts`
- Test: `src/features/sidebar/__tests__/projectGroupingStore.test.ts`

- [ ] 保持 `projectStore` 继续从后端加载最近项目列表。
- [ ] 当最近项目变化时，`projectGroupingStore` 的派生结果应自动把未映射项目归入 `未分组`。
- [ ] 不修改后端 `projects.json` 结构。
- [ ] 确保打开新项目后，项目区立刻能在当前分组视图中出现。

### Task 6: 分组管理最小交互

**Files:**
- Modify: `src/features/sidebar/ProjectGroupMenu.tsx`
- Modify: `src/features/sidebar/projectGroupingStore.ts`
- Test: `src/features/sidebar/__tests__/ProjectGroupMenu.test.tsx`

- [ ] 实现“新建分组”最小交互。
- [ ] 实现重命名与删除当前分组的最小交互入口。
- [ ] 删除分组时把项目映射自动回收到 `未分组`。
- [ ] `全部` 不允许编辑；`未分组` 不允许删除。

### Task 7: 验证与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-04-13-sidebar-grouped-projects-redesign.md`（仅在实现中发现设计偏差时更新）

- [ ] 运行前端测试：`pnpm test`
- [ ] 运行构建：`pnpm build`
- [ ] 手工验证左侧面板：
  - 分组切换
  - 搜索过滤
  - 项目切换
  - 分组创建/删除/重命名
  - 左侧面板独立滚动

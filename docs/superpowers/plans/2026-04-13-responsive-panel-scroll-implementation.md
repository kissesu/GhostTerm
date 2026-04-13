# Responsive Panel Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 GhostTerm 页面保持固定三栏与固定可视区，所有溢出内容只在左侧面板、编辑区、终端区内部滚动。

**Architecture:** 以 `AppLayout` 为固定根布局，统一固化“外层裁剪、内层滚动”的容器链路；通过补齐 `min-width: 0`、`min-height: 0`、`overflow: hidden/auto`，阻止中间容器撑开页面，并保留侧边栏自动折叠作为极窄窗口兜底。

**Tech Stack:** React 19、TypeScript、react-resizable-panels、Vitest、Testing Library

---

### Task 1: 补充布局回归测试

**Files:**
- Modify: `src/layouts/__tests__/AppLayout.test.tsx`
- Modify: `src/features/sidebar/__tests__/Sidebar.test.tsx`
- Test: `src/layouts/__tests__/AppLayout.test.tsx`
- Test: `src/features/sidebar/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: 写出失败测试**

```tsx
it('编辑器和终端面板容器应允许收缩而不撑开页面', () => {
  render(<AppLayout />);
  const editorPanel = screen.getByTestId('editor-panel').parentElement;
  const terminalPanel = screen.getByTestId('terminal-panel').parentElement;

  expect(editorPanel).toHaveStyle({ minWidth: '0', minHeight: '0', overflow: 'hidden' });
  expect(terminalPanel).toHaveStyle({ minWidth: '0', minHeight: '0', overflow: 'hidden' });
});

it('侧边栏应为固定头部加内部滚动内容区结构', () => {
  render(<Sidebar />);
  const filesPanel = screen.getByTestId('panel-files');
  expect(filesPanel).toHaveStyle({ height: '100%', minHeight: '0' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/layouts/__tests__/AppLayout.test.tsx src/features/sidebar/__tests__/Sidebar.test.tsx`

Expected: FAIL，提示缺少 `minWidth/minHeight` 或侧边栏内容区不可收缩。

- [ ] **Step 3: 实现最小布局修正**

```tsx
<PanelGroup direction="horizontal" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
```

```tsx
style={{ overflow: 'hidden', minWidth: 0, minHeight: 0 }}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/layouts/__tests__/AppLayout.test.tsx src/features/sidebar/__tests__/Sidebar.test.tsx`

Expected: PASS

### Task 2: 固化三栏容器滚动边界

**Files:**
- Modify: `src/layouts/AppLayout.tsx`
- Modify: `src/features/sidebar/Sidebar.tsx`
- Modify: `src/features/editor/Editor.tsx`
- Modify: `src/features/terminal/Terminal.tsx`

- [ ] **Step 1: 先让测试覆盖目标结构**

```tsx
expect(screen.getByTestId('app-panel-group')).toHaveStyle({ minWidth: '0', minHeight: '0' });
expect(screen.getByTestId('editor-panel-shell')).toHaveStyle({ minWidth: '0', minHeight: '0', overflow: 'hidden' });
expect(screen.getByTestId('terminal-panel-shell')).toHaveStyle({ minWidth: '0', minHeight: '0', overflow: 'hidden' });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/layouts/__tests__/AppLayout.test.tsx`

Expected: FAIL，缺少测试用壳层或样式不满足。

- [ ] **Step 3: 写最小实现**

```tsx
<PanelGroup data-testid="app-panel-group" ... />
<div data-testid="editor-panel-shell" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
<div data-testid="terminal-panel-shell" style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/layouts/__tests__/AppLayout.test.tsx`

Expected: PASS

### Task 3: 下沉左侧面板滚动职责

**Files:**
- Modify: `src/features/sidebar/Sidebar.tsx`
- Modify: `src/features/sidebar/FileTree.tsx`
- Modify: `src/features/sidebar/Changes.tsx`
- Modify: `src/features/sidebar/Worktrees.tsx`
- Test: `src/features/sidebar/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
const filesPanel = screen.getByTestId('panel-files');
expect(filesPanel).toHaveStyle({ height: '100%', minHeight: '0' });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/features/sidebar/__tests__/Sidebar.test.tsx`

Expected: FAIL，当前面板内容层未补齐 `minHeight: 0`

- [ ] **Step 3: 写最小实现**

```tsx
<div data-testid="sidebar-content-shell" style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
```

```tsx
style={{ height: '100%', minHeight: 0, minWidth: 0 }}
```

```tsx
style={{ height: '100%', minHeight: 0, minWidth: 0, overflow: 'auto' }}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/features/sidebar/__tests__/Sidebar.test.tsx`

Expected: PASS

### Task 4: 全量回归验证

**Files:**
- Verify only

- [ ] **Step 1: 跑前端单测**

Run: `pnpm test`

Expected: 全部 PASS

- [ ] **Step 2: 跑前端构建**

Run: `pnpm build`

Expected: exit 0

- [ ] **Step 3: 记录人工验收项**

```text
1. 长文件仅编辑区滚动
2. 长终端输出仅终端区滚动
3. 文件树节点过多仅左栏滚动
4. 缩窗后页面不滚动，极窄时侧边栏自动折叠
```

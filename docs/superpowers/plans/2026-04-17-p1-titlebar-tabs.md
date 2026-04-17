# P1 - 标题栏三分区 Tab 架构

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标题栏新增"项目 / 工具 / 进度"三 tab，主区整体替换式切换；三 workspace 常驻 DOM 通过 `display:none` 保活；此 plan 只建骨架（工具/进度 tab 是占位），不涉及 sidecar、规则、模板

**Architecture:** Zustand `tabStore` 管 activeTab；新增 `WorkspaceRouter` 并列渲染三 Workspace 子树；改造 `WindowTitleBar` 加入 `TabNav`；跨平台品牌左对齐（icon + name 同行）+ flex spacer + tabs 右紧邻设置，Windows 保留右侧 Win32 控件

**Tech Stack:** React + TypeScript + Zustand + Vitest；Tauri 2；GhostTerm 现有 CSS 变量体系

**依赖 spec:** `docs/superpowers/specs/2026-04-17-titlebar-nav-tools-design.md` Section 1-2

**不在本 plan 范围**：Python sidecar (P2) / 配置模板 (P3) / 规则引擎 (P4)

---

## File Structure

| 动作 | 路径 | 职责 |
|------|------|------|
| Create | `src/shared/stores/tabStore.ts` | Zustand store：activeTab + setActive，不持久化 |
| Create | `src/test/tabStore.test.ts` | tabStore 单元测试 |
| Create | `src/layouts/ProjectWorkspace.tsx` | 包装现有三面板（从 AppLayout 抽取） |
| Create | `src/features/tools/ToolsWorkspace.tsx` | 占位："敬请期待"空态 |
| Create | `src/features/tools/index.ts` | barrel |
| Create | `src/features/progress/ProgressWorkspace.tsx` | 占位："敬请期待"空态 |
| Create | `src/features/progress/index.ts` | barrel |
| Create | `src/layouts/WorkspaceRouter.tsx` | 三 workspace 并列 + display:none 保活 |
| Create | `src/shared/components/TabNav.tsx` | 三 tab 按钮，读写 tabStore |
| Create | `src/test/TabNav.test.tsx` | TabNav 点击切换测试 |
| Create | `src/test/WorkspaceRouter.test.tsx` | 保活（display:none）测试 |
| Modify | `src/shared/components/WindowTitleBar.tsx` | 加入 TabNav；改跨平台布局（品牌左 + flex + tabs 右 + 设置 + Win32） |
| Modify | `src/layouts/AppLayout.tsx` | 用 WorkspaceRouter 替代直接的 PanelGroup |

---

## Task 1: 创建 tabStore

**Files:**
- Create: `src/shared/stores/tabStore.ts`
- Test: `src/test/tabStore.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/test/tabStore.test.ts`：

```ts
/**
 * @file tabStore.test.ts
 * @description tabStore 单元测试
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTabStore } from '../shared/stores/tabStore';

describe('tabStore', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('默认激活 project tab', () => {
    expect(useTabStore.getState().activeTab).toBe('project');
  });

  it('setActive 切换 tab', () => {
    useTabStore.getState().setActive('tools');
    expect(useTabStore.getState().activeTab).toBe('tools');
    useTabStore.getState().setActive('progress');
    expect(useTabStore.getState().activeTab).toBe('progress');
  });

  it('不写 localStorage（无持久化）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    useTabStore.getState().setActive('tools');
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('tab'), expect.anything());
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- --run src/test/tabStore.test.ts`
Expected: FAIL (tabStore 模块不存在)

- [ ] **Step 3: 实现 tabStore**

创建 `src/shared/stores/tabStore.ts`：

```ts
/**
 * @file tabStore.ts
 * @description 标题栏三分区 Tab 状态管理。activeTab: project | tools | progress。
 *              不持久化 localStorage，每次启动默认回 'project'。
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { create } from 'zustand';

export type Tab = 'project' | 'tools' | 'progress';

interface TabState {
  activeTab: Tab;
  setActive: (tab: Tab) => void;
}

export const useTabStore = create<TabState>((set) => ({
  activeTab: 'project',
  setActive: (tab) => set({ activeTab: tab }),
}));
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- --run src/test/tabStore.test.ts`
Expected: PASS（3 tests passed）

- [ ] **Step 5: Commit**

```bash
git add src/shared/stores/tabStore.ts src/test/tabStore.test.ts
git commit -m "feat(tabStore): 标题栏三分区 Zustand store"
```

---

## Task 2: 创建 ProjectWorkspace（从 AppLayout 抽取现有三面板）

**Files:**
- Create: `src/layouts/ProjectWorkspace.tsx`
- Modify: `src/layouts/AppLayout.tsx`（本 task 只抽取，不接入 Router，后面 Task 8 才接入）

**背景**：当前 `AppLayout.tsx` 直接渲染 `PanelGroup` 三面板（Sidebar + Editor + Terminal）。先把 PanelGroup 及其子节点抽到新组件 `ProjectWorkspace`，AppLayout 暂时直接渲染 ProjectWorkspace。这一步保证现有功能不坏，为后面插 WorkspaceRouter 腾位。

- [ ] **Step 1: 读取现有 AppLayout.tsx**

Run: Read `src/layouts/AppLayout.tsx` 全文

- [ ] **Step 2: 创建 ProjectWorkspace.tsx**

创建 `src/layouts/ProjectWorkspace.tsx`，把 AppLayout 里 **PanelGroup direction="horizontal"** 开始到结束的整段（含 Sidebar / Editor / Terminal 的完整结构）复制过来：

```tsx
/**
 * @file ProjectWorkspace.tsx
 * @description "项目" Tab 的 workspace：侧边栏 + 编辑器 + 终端 三面板
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar } from '../features/sidebar/Sidebar';
import { Editor } from '../features/editor/Editor';
import { EditorTabs } from '../features/editor/tabs/EditorTabs';
import { Terminal } from '../features/terminal/Terminal';
// （根据 AppLayout 实际 import 复制全部必要 import）

interface ProjectWorkspaceProps {
  sidebarVisible: boolean;
  // （从 AppLayout 继承必要的 props）
}

export function ProjectWorkspace({ sidebarVisible }: ProjectWorkspaceProps) {
  return (
    <PanelGroup direction="horizontal" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* 从 AppLayout 完整复制 Sidebar Panel / Editor Panel / Terminal Panel 结构 */}
      {/* 保留所有原有 style / props / 终端工具栏等 */}
    </PanelGroup>
  );
}
```

**注意**：确保复制所有 props、事件处理、ref。不要改动任何颜色或行为。

- [ ] **Step 3: 修改 AppLayout.tsx 用 ProjectWorkspace 替代内联 PanelGroup**

```tsx
// AppLayout.tsx 中原来的 <PanelGroup>...</PanelGroup> 替换为：
<ProjectWorkspace sidebarVisible={sidebarVisible} />
```

加 import：`import { ProjectWorkspace } from './ProjectWorkspace';`

- [ ] **Step 4: 验证 build + test**

```bash
pnpm tsc --noEmit
pnpm test -- --run
pnpm build
```

Expected: tsc 无错误；test 257 仍全绿；build 成功

- [ ] **Step 5: Commit**

```bash
git add src/layouts/ProjectWorkspace.tsx src/layouts/AppLayout.tsx
git commit -m "refactor: 抽取 ProjectWorkspace 组件（为三 tab 架构做准备）"
```

---

## Task 3: 创建 ToolsWorkspace 占位

**Files:**
- Create: `src/features/tools/ToolsWorkspace.tsx`
- Create: `src/features/tools/index.ts`

- [ ] **Step 1: 创建 ToolsWorkspace.tsx**

```tsx
/**
 * @file ToolsWorkspace.tsx
 * @description "工具" Tab 的 workspace。P1 阶段为占位，P2 接入工具箱
 * @author Atlas.oi
 * @date 2026-04-17
 */
export function ToolsWorkspace() {
  return (
    <div
      data-testid="tools-workspace"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        color: 'var(--c-fg-muted)',
        background: 'var(--c-bg)',
      }}
    >
      <div style={{ fontSize: 32, opacity: 0.5 }}>🛠</div>
      <div style={{ fontSize: 14 }}>工具箱 — 敬请期待</div>
      <div style={{ fontSize: 12, color: 'var(--c-fg-subtle)' }}>
        论文格式检测、引用格式化、写作质量辅助等规则型工具
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 barrel**

```ts
/**
 * @file index.ts
 * @description tools feature barrel
 * @author Atlas.oi
 * @date 2026-04-17
 */
export { ToolsWorkspace } from './ToolsWorkspace';
```

- [ ] **Step 3: 验证 tsc**

```bash
pnpm tsc --noEmit
```

Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/features/tools/
git commit -m "feat(tools): ToolsWorkspace 占位组件"
```

---

## Task 4: 创建 ProgressWorkspace 占位

**Files:**
- Create: `src/features/progress/ProgressWorkspace.tsx`
- Create: `src/features/progress/index.ts`

- [ ] **Step 1: 创建 ProgressWorkspace.tsx**

```tsx
/**
 * @file ProgressWorkspace.tsx
 * @description "进度" Tab 的 workspace。当前占位，后续接入进度追踪
 * @author Atlas.oi
 * @date 2026-04-17
 */
export function ProgressWorkspace() {
  return (
    <div
      data-testid="progress-workspace"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        color: 'var(--c-fg-muted)',
        background: 'var(--c-bg)',
      }}
    >
      <div style={{ fontSize: 32, opacity: 0.5 }}>📊</div>
      <div style={{ fontSize: 14 }}>进度 — 敬请期待</div>
      <div style={{ fontSize: 12, color: 'var(--c-fg-subtle)' }}>
        等工具分区完善后开放
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 barrel**

```ts
/**
 * @file index.ts
 * @description progress feature barrel
 * @author Atlas.oi
 * @date 2026-04-17
 */
export { ProgressWorkspace } from './ProgressWorkspace';
```

- [ ] **Step 3: 验证 tsc**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/features/progress/
git commit -m "feat(progress): ProgressWorkspace 占位组件"
```

---

## Task 5: 创建 WorkspaceRouter

**Files:**
- Create: `src/layouts/WorkspaceRouter.tsx`
- Create: `src/test/WorkspaceRouter.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
/**
 * @file WorkspaceRouter.test.tsx
 * @description 验证 WorkspaceRouter 三 workspace 并列 + display 切换
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTabStore } from '../shared/stores/tabStore';
import { WorkspaceRouter } from '../layouts/WorkspaceRouter';

// Mock ProjectWorkspace（避免它内部依赖 Tauri）
vi.mock('../layouts/ProjectWorkspace', () => ({
  ProjectWorkspace: () => <div data-testid="project-workspace">project</div>,
}));

describe('WorkspaceRouter', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('三个 workspace 均挂载到 DOM', () => {
    render(<WorkspaceRouter sidebarVisible={true} />);
    expect(screen.getByTestId('project-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('tools-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('progress-workspace')).toBeInTheDocument();
  });

  it('默认激活 project，其它 display:none', () => {
    render(<WorkspaceRouter sidebarVisible={true} />);
    const project = screen.getByTestId('project-workspace').parentElement!;
    const tools = screen.getByTestId('tools-workspace').parentElement!;
    expect(project).toHaveStyle({ display: 'flex' });
    expect(tools).toHaveStyle({ display: 'none' });
  });

  it('切换到 tools 后 tools 显示，其它隐藏', () => {
    useTabStore.setState({ activeTab: 'tools' });
    render(<WorkspaceRouter sidebarVisible={true} />);
    const tools = screen.getByTestId('tools-workspace').parentElement!;
    const project = screen.getByTestId('project-workspace').parentElement!;
    expect(tools).toHaveStyle({ display: 'flex' });
    expect(project).toHaveStyle({ display: 'none' });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- --run src/test/WorkspaceRouter.test.tsx`
Expected: FAIL（WorkspaceRouter 不存在）

- [ ] **Step 3: 实现 WorkspaceRouter.tsx**

```tsx
/**
 * @file WorkspaceRouter.tsx
 * @description 三 workspace 并列常驻 DOM，通过 display:none 保活
 *              （终端 PTY / 编辑器 session 不 unmount，参照 feedback_xterm_display_none）
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useTabStore, type Tab } from '../shared/stores/tabStore';
import { ProjectWorkspace } from './ProjectWorkspace';
import { ToolsWorkspace } from '../features/tools';
import { ProgressWorkspace } from '../features/progress';

interface WorkspaceRouterProps {
  sidebarVisible: boolean;
}

function tabDisplay(active: Tab, tab: Tab): 'flex' | 'none' {
  return active === tab ? 'flex' : 'none';
}

export function WorkspaceRouter({ sidebarVisible }: WorkspaceRouterProps) {
  const activeTab = useTabStore((s) => s.activeTab);
  return (
    <>
      <div style={{ display: tabDisplay(activeTab, 'project'), flex: 1, minHeight: 0, minWidth: 0 }}>
        <ProjectWorkspace sidebarVisible={sidebarVisible} />
      </div>
      <div style={{ display: tabDisplay(activeTab, 'tools'), flex: 1, minHeight: 0, minWidth: 0 }}>
        <ToolsWorkspace />
      </div>
      <div style={{ display: tabDisplay(activeTab, 'progress'), flex: 1, minHeight: 0, minWidth: 0 }}>
        <ProgressWorkspace />
      </div>
    </>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test -- --run src/test/WorkspaceRouter.test.tsx
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/layouts/WorkspaceRouter.tsx src/test/WorkspaceRouter.test.tsx
git commit -m "feat(router): WorkspaceRouter 三 workspace 并列 + display 保活"
```

---

## Task 6: 创建 TabNav 组件

**Files:**
- Create: `src/shared/components/TabNav.tsx`
- Create: `src/test/TabNav.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
/**
 * @file TabNav.test.tsx
 * @description TabNav 点击切换 activeTab + 激活样式测试
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTabStore } from '../shared/stores/tabStore';
import { TabNav } from '../shared/components/TabNav';

describe('TabNav', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('渲染三个 tab 按钮', () => {
    render(<TabNav />);
    expect(screen.getByRole('button', { name: /项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /工具/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /进度/ })).toBeInTheDocument();
  });

  it('点击"工具"切换 activeTab', () => {
    render(<TabNav />);
    fireEvent.click(screen.getByRole('button', { name: /工具/ }));
    expect(useTabStore.getState().activeTab).toBe('tools');
  });

  it('激活 tab 有 data-active="true" 属性', () => {
    render(<TabNav />);
    expect(screen.getByRole('button', { name: /项目/ })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /工具/ })).toHaveAttribute('data-active', 'false');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test -- --run src/test/TabNav.test.tsx
```

Expected: FAIL

- [ ] **Step 3: 实现 TabNav.tsx**

```tsx
/**
 * @file TabNav.tsx
 * @description 标题栏三 tab 导航。读写 tabStore
 *              设计：未激活 --c-fg-muted；激活 --c-accent + 2px 下划线
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useTabStore, type Tab } from '../stores/tabStore';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'project',  label: '项目' },
  { id: 'tools',    label: '工具' },
  { id: 'progress', label: '进度' },
];

export function TabNav() {
  const activeTab = useTabStore((s) => s.activeTab);
  const setActive = useTabStore((s) => s.setActive);

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', alignItems: 'stretch' }}>
      {TABS.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            data-active={active ? 'true' : 'false'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--c-accent)' : 'var(--c-fg-muted)',
              padding: '0 2px',
              borderBottom: active ? '2px solid var(--c-accent)' : '2px solid transparent',
              transition: 'color var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out)',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-fg)';
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-fg-muted)';
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test -- --run src/test/TabNav.test.tsx
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/components/TabNav.tsx src/test/TabNav.test.tsx
git commit -m "feat(tabnav): 三 tab 导航组件"
```

---

## Task 7: 改造 WindowTitleBar 加入 TabNav + 跨平台布局

**Files:**
- Modify: `src/shared/components/WindowTitleBar.tsx`

**设计目标**（来自 spec Section 2）：品牌左对齐（icon + name 同行）+ flex spacer + TabNav + 设置按钮 + （Windows）Win32 控件。macOS 红黄绿由系统渲染在最左空白区（`titleBarStyle: Overlay`）。

- [ ] **Step 1: 读取现有 WindowTitleBar.tsx 确认结构**

Run: Read `src/shared/components/WindowTitleBar.tsx` 全文

- [ ] **Step 2: 改造 layout**

找到 WindowTitleBar 根节点的 flex container（前面扫描得知大约在 195-200 行附近，含 `background: 'var(--c-bg)'`）：

```tsx
// 原 container style 基本保留，里面的子节点顺序调整为：
<div ref={titlebarRef} style={{
  /* 保留原有：height、padding、alignItems、userSelect、borderBottom、background: var(--c-bg) */
  display: 'flex',
  gap: 16,
}}>
  {/* macOS 窗口控件会由系统渲染到此 div 的左侧空白区（titleBarStyle: Overlay） */}

  {/* 1. 品牌（icon + name 同行） */}
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: 'var(--c-fg)',
    fontSize: 13,
    fontWeight: 500,
    paddingLeft: isMac ? 76 : 12,  // macOS 给红黄绿留位；Windows 紧贴左
    flexShrink: 0,
  }}>
    <GhostTermBrand size={14} />  {/* 保留现有 brand icon 组件 */}
    <span>GhostTerm</span>
  </div>

  {/* 2. flex spacer */}
  <div style={{ flex: 1 }} />

  {/* 3. TabNav */}
  <TabNav />

  {/* 4. 设置按钮（保留现有实现） */}
  {/* 原 SettingsButton 逻辑不动 */}

  {/* 5. Win32 控件（仅 Windows，保留现有 isWindows 分支） */}
  {isWindows && <Win32Controls ... />}
</div>
```

加 import：`import { TabNav } from './TabNav';`

**注意事项**：
- 不修改现有 brand icon / settings button / Win32 控件的内部实现
- 保留 `isMac` / `isWindows` 平台判断逻辑
- 保留拖拽区域（通常是 brand 和 spacer 上加 `data-tauri-drag-region`）

- [ ] **Step 3: 验证 tsc + 原测试**

```bash
pnpm tsc --noEmit
pnpm test -- --run
```

Expected: tsc 无错误；原测试全绿（含 TabNav 新测试）

- [ ] **Step 4: 视觉验证（启动 dev server）**

```bash
pnpm tauri dev
```

在 macOS 和 Windows 检查（如有条件）：
- 品牌左对齐，icon + name 同行 ✓
- 三 tab 在右侧紧挨设置 ✓
- 激活 tab 有下划线 + accent 色 ✓
- 点击可切换（但此步 WorkspaceRouter 还没接入 AppLayout，主区不变）

- [ ] **Step 5: Commit**

```bash
git add src/shared/components/WindowTitleBar.tsx
git commit -m "feat(titlebar): 跨平台统一布局 + 接入 TabNav"
```

---

## Task 8: AppLayout 接入 WorkspaceRouter

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

- [ ] **Step 1: 读 AppLayout.tsx 确认现状**

Run: Read `src/layouts/AppLayout.tsx`（Task 2 后应只在一处用 `<ProjectWorkspace />` 替代了 PanelGroup）

- [ ] **Step 2: 用 WorkspaceRouter 替代直接渲染 ProjectWorkspace**

```tsx
// 原：<ProjectWorkspace sidebarVisible={sidebarVisible} />
// 改为：
<WorkspaceRouter sidebarVisible={sidebarVisible} />
```

加 import：`import { WorkspaceRouter } from './WorkspaceRouter';`
删除：`import { ProjectWorkspace } from './ProjectWorkspace';`（AppLayout 不再直接用，由 WorkspaceRouter 使用）

- [ ] **Step 3: tsc + test**

```bash
pnpm tsc --noEmit
pnpm test -- --run
```

Expected: 全绿

- [ ] **Step 4: dev 视觉验证**

```bash
pnpm tauri dev
```

- 启动时默认看到"项目" workspace（FileTree/Editor/Terminal）
- 点击"工具" tab → 中间区域变为"工具箱 — 敬请期待"占位
- 点击"进度" tab → "进度 — 敬请期待"占位
- 点回"项目" tab → FileTree/Editor/Terminal 状态保留（**关键**：如果之前开了终端，回来应该继续运行；如果之前打开了 README.md，回来仍在同一光标位置）

如果"项目"状态丢失 —— 说明 display:none 保活未生效，停止并排查：
```bash
# 检查 React DevTools 中三 workspace 是否全部 mounted
# 检查 WorkspaceRouter 的三 div 是否都在 DOM
```

- [ ] **Step 5: Commit**

```bash
git add src/layouts/AppLayout.tsx
git commit -m "feat(layout): AppLayout 接入 WorkspaceRouter"
```

---

## Task 9: 集成测试 - tab 切换保活

**Files:**
- Create: `src/test/tab-switching.integration.test.tsx`

- [ ] **Step 1: 写集成测试**

```tsx
/**
 * @file tab-switching.integration.test.tsx
 * @description tab 切换后原 workspace 不卸载（保活）验证
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTabStore } from '../shared/stores/tabStore';
import { WorkspaceRouter } from '../layouts/WorkspaceRouter';
import { TabNav } from '../shared/components/TabNav';

vi.mock('../layouts/ProjectWorkspace', () => ({
  ProjectWorkspace: () => <div data-testid="project-workspace">project-content</div>,
}));

describe('tab 切换保活集成', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('切换到 tools 后 project workspace 仍在 DOM（未卸载）', () => {
    render(<><TabNav /><WorkspaceRouter sidebarVisible={true} /></>);
    expect(screen.getByTestId('project-workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /工具/ }));
    // 关键断言：project-workspace 仍然在 DOM 里（虽然 display:none）
    expect(screen.getByTestId('project-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('tools-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('progress-workspace')).toBeInTheDocument();
  });

  it('来回切换 tab 不触发 workspace 重新挂载', () => {
    const { rerender } = render(<><TabNav /><WorkspaceRouter sidebarVisible={true} /></>);
    const projectBefore = screen.getByTestId('project-workspace');
    fireEvent.click(screen.getByRole('button', { name: /工具/ }));
    fireEvent.click(screen.getByRole('button', { name: /项目/ }));
    const projectAfter = screen.getByTestId('project-workspace');
    // React 的同一 DOM 节点：是同一个 Element 实例
    expect(projectBefore).toBe(projectAfter);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test -- --run src/test/tab-switching.integration.test.tsx
```

Expected: 2 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/test/tab-switching.integration.test.tsx
git commit -m "test: tab 切换保活集成测试"
```

---

## Task 10: 全量验证 + 收尾

- [ ] **Step 1: 跑全量测试**

```bash
pnpm tsc --noEmit
pnpm test -- --run
pnpm build
```

Expected:
- tsc 0 错误
- test 全绿（原 257 + 本 plan 新增至少 8 个 = 265+）
- build 成功

- [ ] **Step 2: 手动 smoke test**

```bash
pnpm tauri dev
```

checklist：
- [ ] 启动默认"项目" tab 高亮
- [ ] "项目" tab 下现有 FileTree / Editor / Terminal / Changes 全部正常
- [ ] 点"工具" → "工具箱 — 敬请期待"占位显示；标题栏 tab 状态正确切换
- [ ] 点"进度" → "进度 — 敬请期待"占位显示
- [ ] 项目 → 工具 → 项目 切换后，之前打开的文件仍保留光标位置
- [ ] 项目 → 工具 → 项目 切换后，终端 PTY 仍在运行（之前运行的 `tail -f` 之类应该继续）
- [ ] 跨平台：macOS 标题栏左侧有窗口控件；Windows 标题栏右侧有 Win32 控件（如在 Windows 测试）

- [ ] **Step 3: 更新 memory（可选）**

如果过程中发现新的坑（例如某个组件的 ref 处理要特别注意），追加到 memory：

```bash
# 示例：若发现切换 tab 时 Terminal resize 被触发出问题
# 新增 feedback_tab_switch_resize_trick.md（按 GhostTerm memory 模式）
```

- [ ] **Step 4: Git tag milestone（不 push，不 release）**

```bash
git tag -a milestone-p1-titlebar-tabs -m "P1 完成：三 tab 架构骨架可用，工具/进度为占位"
# 本地 tag，后续 P2/P3/P4 合并完再统一打 release tag
```

- [ ] **Step 5: 最终 commit（若有未提交改动）**

```bash
git status
# 确认干净；若有未提交则 commit
```

---

## Self-Review（P1）

- **Spec 覆盖**：P1 对应 spec Section 1（架构总览，仅前端部分）+ Section 2（前端组件与 Tab 路由），sidecar/模板/规则在 P2-P4
- **Placeholder**：无 TBD/TODO
- **类型一致**：`Tab` 类型、`tabStore.activeTab` / `setActive` 签名在所有 task 中一致；`WorkspaceRouter` / `TabNav` 不接受或接受的 props 在各处一致
- **独立可交付**：P1 完成后 merge 到 main 即是一个可发布版本（工具/进度为占位，不影响现有功能）

---

## 下一个 plan

P1 完成后：`docs/superpowers/plans/2026-04-17-p2-python-sidecar.md`（Python sidecar 骨架 + NDJSON IPC + 首条规则 cjk_ascii_space）

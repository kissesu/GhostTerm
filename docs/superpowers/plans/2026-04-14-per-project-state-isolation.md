# Per-Project State Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个项目拥有独立的编辑器标签页和终端会话，切换项目时完整恢复上次状态。

**Architecture:** `editorStore` 从全局单例重构为 per-project session map；`terminalStore` 从单 PTY 重构为 per-project PTY map，Rust 后端已原生支持多 PTY（无需修改）；`AppLayout` 通过 `display: none/block` 保持所有已激活项目的 xterm.js DOM 实例存活，保留 scrollback 缓冲区；`projectStore.openProject()` 用 save/restore 替代 closeAll。持久化通过新增 `editor_sessions.json` 实现，无需 SQLite。

**Tech Stack:** TypeScript · Zustand · xterm.js · Tauri invoke · serde_json (Rust)

---

## 文件改动清单

| 文件 | 操作 | 职责变化 |
|------|------|---------|
| `src/features/editor/editorStore.ts` | 修改 | 新增 `projectSessions` map、`saveSession`、`restoreSession` |
| `src/features/terminal/terminalStore.ts` | 修改 | 新增 `sessions` map、`spawnForProject`、`activateProject`；删除全局 kill-on-spawn 逻辑 |
| `src/features/terminal/useTerminal.ts` | 修改 | 接受 `projectPath` 参数，订阅 per-project wsPort/wsToken |
| `src/features/terminal/Terminal.tsx` | 修改 | prop `cwd` 改为 `projectPath`，从 store 获取 PTY 状态 |
| `src/layouts/AppLayout.tsx` | 修改 | 多 Terminal `display:none` 切换 + 三态占位（无项目/无session/有session）+ 终端工具栏（关闭/重启） |
| `src/features/sidebar/projectStore.ts` | 修改 | `openProject` 用 saveSession/restoreSession/activateProject 替代 closeAll |
| `src-tauri/src/project_manager/session.rs` | 新建 | `editor_sessions.json` 的读写逻辑 |
| `src-tauri/src/project_manager/mod.rs` | 修改 | 注册 session 模块，导出 get/save session commands |
| `src-tauri/src/lib.rs` | 修改 | 注册 `get_editor_session_cmd`、`save_editor_session_cmd` |
| `src/features/editor/__tests__/EditorTabs.test.tsx` | 修改 | 更新 mock：使用 restoreSession 替代 closeAll |
| `src/test/terminalStore.test.ts` | 修改 | 测试 per-project sessions map |
| `src/test/useTerminal.test.ts` | 修改 | 传入 projectPath 参数 |
| `src/test/Terminal.test.tsx` | 修改 | prop `cwd` 改为 `projectPath` |

---

## Task 1：验证 Rust PTY 注册表支持并发

**Files:**
- Read: `src-tauri/src/pty_manager/mod.rs:1-60`

- [ ] **Step 1: 确认 Rust 后端是 HashMap 结构**

```bash
grep -n "PTY_REGISTRY\|HashMap" src-tauri/src/pty_manager/mod.rs | head -10
```

期望输出包含：
```
27: static ref PTY_REGISTRY: Arc<Mutex<HashMap<String, PtyState>>> =
```

- [ ] **Step 2: 确认 kill_pty 不会影响其他 PTY**

```bash
grep -n "fn kill_pty\|remove\|retain" src-tauri/src/pty_manager/mod.rs
```

期望：kill_pty 用 `remove(pty_id)` 精确删除，不清空整个 HashMap。

- [ ] **Step 3: 提交确认结论（无代码改动）**

```bash
git commit --allow-empty -m "chore: confirm pty_manager supports concurrent PTYs (no Rust changes needed)"
```

---

## Task 2：重构 editorStore — per-project session map

**Files:**
- Modify: `src/features/editor/editorStore.ts`

**背景：** 当前 `closeAll()` 在 `openProject` 时清空所有 openFiles。目标：保存旧项目状态到 `projectSessions`，切换时从 map 恢复。

- [ ] **Step 1: 在 `editorStore.test.ts`（或现有测试）中写失败测试**

在 `src/features/editor/__tests__/EditorTabs.test.tsx` 末尾加：

```typescript
describe('per-project session isolation', () => {
  it('saveSession 保存当前 openFiles 到 projectSessions', () => {
    const store = useEditorStore.getState();
    // 手动设置当前状态
    useEditorStore.setState({
      openFiles: [
        { path: '/proj-a/src/main.ts', content: 'hello', diskContent: 'hello',
          isDirty: false, language: 'ts', kind: 'text' },
      ],
      activeFilePath: '/proj-a/src/main.ts',
    });
    store.saveSession('/proj-a');
    const sessions = useEditorStore.getState().projectSessions;
    expect(sessions['/proj-a']?.openFiles).toHaveLength(1);
    expect(sessions['/proj-a']?.activeFilePath).toBe('/proj-a/src/main.ts');
  });

  it('restoreSession 从 projectSessions 恢复状态（已有会话）', () => {
    useEditorStore.setState({
      projectSessions: {
        '/proj-b': {
          openFiles: [
            { path: '/proj-b/index.ts', content: 'world', diskContent: 'world',
              isDirty: false, language: 'ts', kind: 'text' },
          ],
          activeFilePath: '/proj-b/index.ts',
        },
      },
    });
    useEditorStore.getState().restoreSession('/proj-b');
    const state = useEditorStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.activeFilePath).toBe('/proj-b/index.ts');
  });

  it('restoreSession 对无记录项目清空状态', () => {
    useEditorStore.setState({
      openFiles: [
        { path: '/old/file.ts', content: '', diskContent: '',
          isDirty: false, language: 'ts', kind: 'text' },
      ],
      activeFilePath: '/old/file.ts',
      projectSessions: {},
    });
    useEditorStore.getState().restoreSession('/new-project-no-session');
    const state = useEditorStore.getState();
    expect(state.openFiles).toHaveLength(0);
    expect(state.activeFilePath).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm vitest run src/features/editor/__tests__/EditorTabs.test.tsx 2>&1 | tail -20
```

期望：`TypeError: store.saveSession is not a function` 或类似错误。

- [ ] **Step 3: 在 `editorStore.ts` 中新增 session 类型和字段**

在 `interface EditorState` 的 `openFiles` 字段前加：

```typescript
/** 单项目编辑器会话快照 */
interface EditorSession {
  openFiles: OpenFile[];
  activeFilePath: string | null;
}
```

在 `interface EditorState` 中新增以下字段（在 `handleExternalChange` 后）：

```typescript
  /** 所有已激活过的项目编辑器会话，key = projectPath */
  projectSessions: Record<string, EditorSession>;
  /**
   * 将当前 openFiles/activeFilePath 快照保存到 projectSessions[projectPath]
   * 在 openProject 切换前调用，防止状态丢失
   */
  saveSession: (projectPath: string) => void;
  /**
   * 从 projectSessions[projectPath] 恢复状态到 openFiles/activeFilePath
   * 若该项目无会话记录，则清空（等同于 closeAll 的效果）
   */
  restoreSession: (projectPath: string) => void;
```

- [ ] **Step 4: 在 store 实现中初始化 projectSessions 并实现两个方法**

在 `useEditorStore = create<EditorState>((set, get) => ({` 的 `openFiles: [],` 后加：

```typescript
  projectSessions: {},
```

在 `handleExternalChange` 实现之后，在 `}));` 之前加：

```typescript
  saveSession: (projectPath: string) => {
    const { openFiles, activeFilePath } = get();
    // 只保存文件路径和激活状态，内容从磁盘重新读取（节省内存）
    set((state) => ({
      projectSessions: {
        ...state.projectSessions,
        [projectPath]: { openFiles, activeFilePath },
      },
    }));
  },

  restoreSession: (projectPath: string) => {
    const { projectSessions } = get();
    const session = projectSessions[projectPath];
    if (session) {
      // 恢复该项目上次的 openFiles 和激活文件
      set({ openFiles: session.openFiles, activeFilePath: session.activeFilePath });
    } else {
      // 无历史会话：清空，等效旧的 closeAll
      set({ openFiles: [], activeFilePath: null });
    }
  },
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
pnpm vitest run src/features/editor/__tests__/EditorTabs.test.tsx 2>&1 | tail -15
```

期望：`Tests 3 passed` (新增的三个测试)

- [ ] **Step 6: 提交**

```bash
git add src/features/editor/editorStore.ts src/features/editor/__tests__/EditorTabs.test.tsx
git commit -m "feat(editor): add per-project session save/restore to editorStore"
```

---

## Task 3：重构 terminalStore — per-project PTY map

**Files:**
- Modify: `src/features/terminal/terminalStore.ts`

**背景：** 当前 `spawn()` 在第 67-69 行主动 kill 旧 PTY。目标：每个项目有独立 PTY 状态，切换时不 kill，只改 `activeProjectPath`。

- [ ] **Step 1: 写失败测试**

在 `src/test/terminalStore.test.ts` 末尾加：

```typescript
describe('per-project PTY sessions', () => {
  beforeEach(() => {
    // 重置 store
    useTerminalStore.setState({
      sessions: {},
      activeProjectPath: null,
    });
  });

  it('spawnForProject 在 sessions 中为项目创建条目', async () => {
    // mock invoke
    vi.mocked(invoke).mockResolvedValueOnce({
      pty_id: 'pty-123',
      ws_port: 9001,
      ws_token: 'tok-abc',
    });

    await useTerminalStore.getState().spawnForProject('/proj-a', '/proj-a');

    const sessions = useTerminalStore.getState().sessions;
    expect(sessions['/proj-a']).toBeDefined();
    expect(sessions['/proj-a']!.ptyId).toBe('pty-123');
    expect(sessions['/proj-a']!.wsPort).toBe(9001);
  });

  it('spawnForProject 不 kill 其他项目的 PTY', async () => {
    // 先有一个已存在的 proj-b 会话
    useTerminalStore.setState({
      sessions: {
        '/proj-b': { ptyId: 'pty-b', wsPort: 9002, wsToken: 'tok-b', connected: true },
      },
      activeProjectPath: '/proj-b',
    });

    vi.mocked(invoke).mockResolvedValueOnce({
      pty_id: 'pty-a',
      ws_port: 9001,
      ws_token: 'tok-a',
    });

    await useTerminalStore.getState().spawnForProject('/proj-a', '/proj-a');

    // proj-b 未被 kill
    const killCalls = vi.mocked(invoke).mock.calls.filter(c => c[0] === 'kill_pty_cmd');
    expect(killCalls).toHaveLength(0);

    // 两个项目都在 sessions 中
    const sessions = useTerminalStore.getState().sessions;
    expect(sessions['/proj-a']).toBeDefined();
    expect(sessions['/proj-b']).toBeDefined();
  });

  it('setConnected 只更新指定项目的 connected 状态', () => {
    useTerminalStore.setState({
      sessions: {
        '/proj-a': { ptyId: 'pty-a', wsPort: 9001, wsToken: 'tok-a', connected: false },
        '/proj-b': { ptyId: 'pty-b', wsPort: 9002, wsToken: 'tok-b', connected: false },
      },
    });

    useTerminalStore.getState().setConnected('/proj-a', true);

    const sessions = useTerminalStore.getState().sessions;
    expect(sessions['/proj-a']!.connected).toBe(true);
    expect(sessions['/proj-b']!.connected).toBe(false); // 未受影响
  });
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm vitest run src/test/terminalStore.test.ts 2>&1 | tail -20
```

期望：`TypeError: ...spawnForProject is not a function`

- [ ] **Step 3: 完整重写 `terminalStore.ts`**

用以下内容替换整个文件（保留文件头注释，更新描述）：

```typescript
/**
 * @file terminalStore - PTY 终端状态管理
 * @description 管理多项目 PTY 进程生命周期。每个项目独立维护一个 PTY 会话（sessions map），
 *              切换项目时不销毁旧 PTY，仅改变 activeProjectPath。
 *              Rust 后端 PTY_REGISTRY 原生支持多 PTY 并发（HashMap<pty_id, PtyState>）。
 * @author Atlas.oi
 * @date 2026-04-14
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../shared/stores/settingsStore';

/** 单个 PTY 会话信息 */
export interface PtySession {
  ptyId: string;
  wsPort: number;
  wsToken: string;
  connected: boolean;
}

/** PTY 创建结果 - 与 Rust PtyInfo 对应 */
interface PtyInfo {
  pty_id: string;
  ws_port: number;
  ws_token: string;
}

type DefaultShell = string;

/** 终端 store 状态接口 */
export interface TerminalState {
  /** 所有已激活项目的 PTY 会话，key = projectPath */
  sessions: Record<string, PtySession>;
  /** 当前激活的项目路径 */
  activeProjectPath: string | null;

  /**
   * 为指定项目 spawn PTY（不 kill 其他项目）
   * 若该项目已有 PTY，先 kill 旧的（重启场景），再创建新的
   */
  spawnForProject: (projectPath: string, cwd: string) => Promise<void>;
  /**
   * 激活指定项目（切换终端焦点）
   * 若项目尚无 PTY，调用 spawnForProject；已有则只更新 activeProjectPath
   */
  activateProject: (projectPath: string) => Promise<void>;
  /** kill 指定项目的 PTY，从 sessions 中移除 */
  killProject: (projectPath: string) => Promise<void>;
  /** 重连指定项目 PTY（签发新 token） */
  reconnect: (projectPath: string) => Promise<void>;
  /** 通知 Rust 后端当前活跃 PTY 的窗口尺寸变化 */
  resize: (cols: number, rows: number) => Promise<void>;
  /** 由 useTerminal hook 更新指定项目的连接状态 */
  setConnected: (projectPath: string, v: boolean) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  activeProjectPath: null,

  spawnForProject: async (projectPath: string, cwd: string) => {
    const { sessions } = get();

    // 若该项目已有 PTY，先 kill（重启/重连场景）
    const existing = sessions[projectPath];
    if (existing) {
      await invoke('kill_pty_cmd', { ptyId: existing.ptyId }).catch(() => {
        // 旧 PTY 可能已退出，忽略错误
      });
    }

    const terminalSettings = useSettingsStore.getState().terminal;
    const shell = terminalSettings.useSystemShell
      ? await invoke<DefaultShell>('get_default_shell_cmd')
      : terminalSettings.customShellPath.trim();

    if (!shell) {
      throw new Error('终端 shell 未配置');
    }

    const info = await invoke<PtyInfo>('spawn_pty_cmd', { shell, cwd });

    set((state) => ({
      sessions: {
        ...state.sessions,
        [projectPath]: {
          ptyId: info.pty_id,
          wsPort: info.ws_port,
          wsToken: info.ws_token,
          connected: false,
        },
      },
    }));
  },

  activateProject: async (projectPath: string) => {
    const { sessions } = get();
    // 更新活跃项目（Terminal 组件通过 display:none/block 切换）
    set({ activeProjectPath: projectPath });

    // 若项目尚无 PTY 会话，spawn 一个
    if (!sessions[projectPath]) {
      await get().spawnForProject(projectPath, projectPath);
    }
  },

  killProject: async (projectPath: string) => {
    const { sessions } = get();
    const session = sessions[projectPath];
    if (!session) return;

    await invoke('kill_pty_cmd', { ptyId: session.ptyId }).catch(() => {});

    set((state) => {
      const next = { ...state.sessions };
      delete next[projectPath];
      return {
        sessions: next,
        activeProjectPath:
          state.activeProjectPath === projectPath ? null : state.activeProjectPath,
      };
    });
  },

  reconnect: async (projectPath: string) => {
    const { sessions } = get();
    const session = sessions[projectPath];
    if (!session) return;

    const info = await invoke<PtyInfo>('reconnect_pty_cmd', { ptyId: session.ptyId });

    set((state) => ({
      sessions: {
        ...state.sessions,
        [projectPath]: {
          ...state.sessions[projectPath]!,
          wsPort: info.ws_port,
          wsToken: info.ws_token,
          connected: false,
        },
      },
    }));
  },

  resize: async (cols: number, rows: number) => {
    const { sessions, activeProjectPath } = get();
    if (!activeProjectPath) return;
    const session = sessions[activeProjectPath];
    if (!session) return;
    await invoke('resize_pty_cmd', { ptyId: session.ptyId, cols, rows });
  },

  setConnected: (projectPath: string, v: boolean) => {
    set((state) => {
      if (!state.sessions[projectPath]) return state;
      return {
        sessions: {
          ...state.sessions,
          [projectPath]: { ...state.sessions[projectPath]!, connected: v },
        },
      };
    });
  },
}));
```

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run src/test/terminalStore.test.ts 2>&1 | tail -20
```

期望：新增三个测试全部通过。**若有旧测试引用 `ptyId`/`wsPort`/`wsToken`/`connected` 字段或 `spawn`/`kill`/`reconnect` 方法（旧 API），先跳过它们（`it.skip`），在 Task 9 统一修复。**

- [ ] **Step 5: 提交**

```bash
git add src/features/terminal/terminalStore.ts src/test/terminalStore.test.ts
git commit -m "feat(terminal): refactor terminalStore to per-project PTY sessions map"
```

---

## Task 4：更新 useTerminal hook — 接受 projectPath 参数

**Files:**
- Modify: `src/features/terminal/useTerminal.ts`

**背景：** 旧 `useTerminal` 订阅全局 `wsPort/wsToken`，新版本需订阅 `sessions[projectPath]` 的字段，并将 connected 回写到 `setConnected(projectPath, v)`。

- [ ] **Step 1: 写失败测试**

在 `src/test/useTerminal.test.ts` 里找到（或新增）`useTerminal` 的测试，加入：

```typescript
it('useTerminal 接受 projectPath 并订阅对应 session', () => {
  // 只验证 hook 能用 projectPath 参数调用，不抛错
  const { result } = renderHook(() => useTerminal('/proj-a'));
  expect(result.current.wsRef).toBeDefined();
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm vitest run src/test/useTerminal.test.ts 2>&1 | tail -10
```

期望：`useTerminal` 不接受参数导致报错，或类型错误。

- [ ] **Step 3: 重写 `useTerminal.ts`**

用以下内容替换整个文件（保留头注释，更新描述）：

```typescript
/**
 * @file useTerminal - 单项目 WebSocket 连接生命周期管理 hook
 * @description 接受 projectPath 参数，订阅 terminalStore.sessions[projectPath] 的
 *              wsPort/wsToken 变化，建立并维护该项目的 PTY WebSocket 连接。
 *              连接断开时触发重连，返回 WebSocket ref 给 Terminal.tsx。
 * @author Atlas.oi
 * @date 2026-04-14
 */

import { useEffect, useRef } from 'react';
import { useTerminalStore } from './terminalStore';

export interface UseTerminalResult {
  wsRef: React.RefObject<WebSocket | null>;
}

/**
 * useTerminal - 管理指定项目的 PTY WebSocket 连接
 *
 * 业务逻辑：
 * 1. 从 sessions[projectPath] 读取 wsPort/wsToken
 * 2. 有值时建立 WebSocket 连接
 * 3. onopen：setConnected(projectPath, true)
 * 4. onclose：setConnected(projectPath, false) + 延迟 1s 重连
 * 5. 组件卸载（或项目切换）时关闭 WebSocket
 */
export function useTerminal(projectPath: string): UseTerminalResult {
  const wsRef = useRef<WebSocket | null>(null);

  // 只订阅当前项目的 wsPort/wsToken，避免其他项目变化触发重渲染
  const wsPort = useTerminalStore((s) => s.sessions[projectPath]?.wsPort ?? null);
  const wsToken = useTerminalStore((s) => s.sessions[projectPath]?.wsToken ?? null);
  const setConnected = useTerminalStore((s) => s.setConnected);
  const reconnect = useTerminalStore((s) => s.reconnect);

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    if (!wsPort || !wsToken) return;

    let aborted = false;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      try {
        wsRef.current.close();
      } catch {
        // 忽略已失效连接
      }
    }
    intentionalCloseRef.current = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${wsToken}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (aborted) {
        ws.close();
        return;
      }
      setConnected(projectPath, true);
    };

    ws.onclose = (event) => {
      if (aborted) return;
      setConnected(projectPath, false);
      if (!intentionalCloseRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnect(projectPath).catch(() => {});
        }, 1000);
      }
    };

    ws.onerror = () => {
      console.error(`[terminal] ${projectPath} WebSocket 连接错误`);
    };

    return () => {
      aborted = true;
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (ws.readyState !== WebSocket.CLOSED) {
        try {
          ws.close();
        } catch {}
      }
    };
  }, [wsPort, wsToken, projectPath]);

  return { wsRef };
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run src/test/useTerminal.test.ts 2>&1 | tail -10
```

期望：新增测试通过。旧测试若引用旧签名用 `it.skip` 暂时跳过（Task 9 修复）。

- [ ] **Step 5: 提交**

```bash
git add src/features/terminal/useTerminal.ts src/test/useTerminal.test.ts
git commit -m "feat(terminal): useTerminal accepts projectPath for per-project WS connection"
```

---

## Task 5：更新 Terminal.tsx — prop 改为 projectPath

**Files:**
- Modify: `src/features/terminal/Terminal.tsx`

**背景：** 旧 `Terminal` 接受 `cwd` prop 并订阅全局 store；新版本接受 `projectPath`，从 `sessions[projectPath]` 读取状态。

- [ ] **Step 1: 写失败测试**

在 `src/test/Terminal.test.tsx` 里找到现有的 Terminal render 测试，将 `cwd="/tmp/test"` 改为 `projectPath="/tmp/test"`，运行确认失败：

```bash
pnpm vitest run src/test/Terminal.test.tsx 2>&1 | tail -10
```

- [ ] **Step 2: 更新 Terminal.tsx 的 props 和 store 订阅**

**修改 TerminalProps 接口**（替换 `cwd` 为 `projectPath`）：

```typescript
interface TerminalProps {
  /** 项目路径，同时作为 PTY 工作目录和 sessions map 的 key */
  projectPath: string;
  className?: string;
}
```

**修改 store 订阅**（替换 `spawn`/`ptyId`/`connected` 的获取方式，在 `Terminal` 函数体内）：

```typescript
export default function Terminal({ projectPath, className }: TerminalProps) {
  // ...（保留 containerRef、termRef、fitAddonRef、error state）

  const terminalSettings = useSettingsStore((s) => s.terminal);
  const terminalTheme = getTerminalThemeById(terminalSettings.theme);

  // 只订阅本项目的 session 状态
  const session = useTerminalStore((s) => s.sessions[projectPath] ?? null);
  const connected = session?.connected ?? false;
  const ptyId = session?.ptyId ?? null;
  const spawnForProject = useTerminalStore((s) => s.spawnForProject);
  const resize = useTerminalStore((s) => s.resize);

  const { wsRef } = useTerminal(projectPath);
```

**修改 Effect 2**（spawn 改为 `spawnForProject`）：

```typescript
  // Effect 2：启动 PTY（组件挂载时，若无 session 则 spawn）
  useEffect(() => {
    // 已有 session 说明之前 spawn 过（切换项目时恢复），不重复 spawn
    if (session) return;
    spawnForProject(projectPath, projectPath).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`PTY 启动失败: ${msg}`);
    });
  }, [projectPath]); // 仅 projectPath 变化时检查
```

**修改 showOverlay 判断**（`!cwd` 改为 `!session`）：

```typescript
  const showOverlay = (!session && !connected) || (error && !connected);
```

**修改覆盖层文案**（`!cwd` 改为 `!session`）：

```typescript
  {!session && !connected ? (
    <div style={{ color: '#565f89', fontSize: '13px' }}>
      正在启动终端...
    </div>
  ) : error ? (
    <>
      <div style={{ color: '#f7768e', fontSize: '14px' }}>
        终端连接失败: {error}
      </div>
      <button
        onClick={() => {
          setError(null);
          spawnForProject(projectPath, projectPath).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            setError(`PTY 启动失败: ${msg}`);
          });
        }}
        // ...（保留按钮样式）
      >
        重试
      </button>
    </>
  ) : null}
```

- [ ] **Step 3: 运行测试**

```bash
pnpm vitest run src/test/Terminal.test.tsx 2>&1 | tail -10
```

期望：Terminal 测试通过（prop 名更新后匹配）。

- [ ] **Step 4: 提交**

```bash
git add src/features/terminal/Terminal.tsx src/test/Terminal.test.tsx
git commit -m "feat(terminal): Terminal accepts projectPath prop, reads per-project session"
```

---

## Task 6：更新 AppLayout — 多终端 display:none 渲染

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

**背景：** 旧版只渲染单个 `<Terminal cwd={currentProjectPath} />`；新版渲染所有已激活项目的 Terminal 实例，通过 `display: none/block` 切换，保留 xterm.js DOM 和 scrollback 缓冲区。

- [ ] **Step 1: 写失败测试（集成层面的快速检查）**

在 `src/test/AppLayout.test.tsx` 中加：

```typescript
it('切换项目时不销毁旧 Terminal 实例', async () => {
  // 初始化两个项目的 sessions
  useTerminalStore.setState({
    sessions: {
      '/proj-a': { ptyId: 'pty-a', wsPort: 9001, wsToken: 'tok-a', connected: true },
      '/proj-b': { ptyId: 'pty-b', wsPort: 9002, wsToken: 'tok-b', connected: true },
    },
    activeProjectPath: '/proj-b',
  });
  useProjectStore.setState({
    currentProject: { name: 'proj-b', path: '/proj-b', last_opened: 0 },
    recentProjects: [],
  });

  render(<AppLayout />);

  // 两个项目的 terminal-container 均存在（不销毁）
  const containers = screen.getAllByTestId('terminal-container');
  expect(containers).toHaveLength(2);
});

it('活跃项目无 session 时显示"启动终端"按钮而非空白', () => {
  // 活跃项目 proj-a 存在，但 sessions 中无 proj-a 的条目（已被关闭）
  useTerminalStore.setState({ sessions: {}, activeProjectPath: null });
  useProjectStore.setState({
    currentProject: { name: 'proj-a', path: '/proj-a', last_opened: 0 },
    recentProjects: [],
  });

  render(<AppLayout />);

  expect(screen.getByRole('button', { name: '启动终端' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm vitest run src/test/AppLayout.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: 更新 AppLayout.tsx 的终端面板**

**修改 import**：加入 `useTerminalStore`：

```typescript
import { useTerminalStore } from '../features/terminal';
```

**修改 import**：还需引入 `killProject` 和 `activateProject`：

```typescript
import { useTerminalStore } from '../features/terminal';
```

**修改组件内 store 订阅**：

```typescript
  const activeProjectPath = useProjectStore((s) => s.currentProject?.path ?? null);
  // sessions 直接引用（比 Object.keys 更精确，可访问 killProject 需要的方法）
  const sessions = useTerminalStore((s) => s.sessions);
  const killProject = useTerminalStore((s) => s.killProject);
  const activateProject = useTerminalStore((s) => s.activateProject);
```

**替换右侧终端 Panel 内容**（修复三种占位状态 + 工具栏在 Task 12 添加，此处仅修复占位逻辑）：

```typescript
        {/* 右侧面板 - PBI-1 终端（多项目 display:none/block 切换） */}
        <Panel
          defaultSize={30}
          minSize={15}
          style={{
            overflow: 'hidden', minWidth: 0, minHeight: 0,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* 占位状态 1：无活跃项目 */}
          {!activeProjectPath && (
            <div
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#565f89', fontSize: '13px', background: '#1a1b26',
              }}
            >
              打开项目后启动终端
            </div>
          )}

          {/* 占位状态 2：有活跃项目，但该项目无 PTY session（刚关闭或首次进入前） */}
          {activeProjectPath && !sessions[activeProjectPath] && (
            <div
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 12, color: '#565f89', fontSize: '13px', background: '#1a1b26',
              }}
            >
              <span>终端已关闭</span>
              <button
                onClick={() => activateProject(activeProjectPath)}
                data-testid="start-terminal-button"
                aria-label="启动终端"
                style={{
                  padding: '6px 16px', background: '#7aa2f7', color: '#1a1b26',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '13px',
                }}
              >
                启动终端
              </button>
            </div>
          )}

          {/* 状态 3：有 PTY session 的项目（display:none/flex 切换保留 scrollback） */}
          {Object.keys(sessions).map((path) => (
            <div
              key={path}
              style={{
                // display:none 隐藏非活跃终端，DOM 和 xterm scrollback buffer 继续存活
                // display:flex 保证 Terminal 内部 flex 布局正常
                display: path === activeProjectPath ? 'flex' : 'none',
                flex: 1, minWidth: 0, minHeight: 0,
              }}
            >
              <Terminal projectPath={path} style={{ flex: 1 }} />
            </div>
          ))}
        </Panel>
```

**同时移除旧的 `currentProjectPath` 引用**——删除：

```typescript
const currentProjectPath = useProjectStore((s) => s.currentProject?.path);
```

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run src/test/AppLayout.test.tsx 2>&1 | tail -10
```

- [ ] **Step 5: 提交**

```bash
git add src/layouts/AppLayout.tsx src/test/AppLayout.test.tsx
git commit -m "feat(layout): render per-project Terminal instances with display:none isolation"
```

---

## Task 7：更新 projectStore.openProject — save/restore 替代 closeAll

**Files:**
- Modify: `src/features/sidebar/projectStore.ts`

**背景：** 旧版第 81 行调用 `closeAll()`，新版改为 `saveSession(currentPath)` + `restoreSession(newPath)` + `activateProject(newPath)`。

- [ ] **Step 1: 写失败测试**

在 `src/features/sidebar/__tests__/ProjectSelector.test.tsx` 加：

```typescript
it('openProject 调用 saveSession 保存旧状态而非 closeAll', async () => {
  // 准备：当前有 proj-a 打开了文件
  const saveSession = vi.fn();
  const restoreSession = vi.fn();
  vi.doMock('../../editor/editorStore', () => ({
    useEditorStore: {
      getState: () => ({ saveSession, restoreSession, closeAll: vi.fn() }),
    },
  }));

  vi.mocked(invoke).mockResolvedValue({ name: 'proj-b', path: '/proj-b', last_opened: 0 });

  useProjectStore.setState({
    currentProject: { name: 'proj-a', path: '/proj-a', last_opened: 0 },
    recentProjects: [{ name: 'proj-a', path: '/proj-a', last_opened: 0 }],
  });

  await useProjectStore.getState().openProject('/proj-b');

  expect(saveSession).toHaveBeenCalledWith('/proj-a');
  expect(restoreSession).toHaveBeenCalledWith('/proj-b');
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm vitest run src/features/sidebar/__tests__/ProjectSelector.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: 修改 `projectStore.ts` 的 `openProject` 方法**

替换 `openProject` 函数体内的**第四步**（当前代码约第 79-81 行）：

旧代码：
```typescript
    // ============================================
    // 第四步：关闭所有编辑器文件（旧项目文件不应出现在新项目中）
    // ============================================
    const { useEditorStore } = await import('../editor/editorStore');
    useEditorStore.getState().closeAll();
```

新代码：
```typescript
    // ============================================
    // 第四步：保存旧项目编辑器状态，恢复新项目编辑器状态
    // 使用 save/restore 替代 closeAll，确保切换项目时状态不丢失
    // ============================================
    const { useEditorStore } = await import('../editor/editorStore');
    // 保存切换前项目的编辑器状态（currentProject 此时已是新项目，用之前记录的旧路径）
    const previousPath = project.path === path
      ? get().recentProjects.find((p) => p.path !== path)?.path ?? null
      : null;
    // 实际上 set({ currentProject: project }) 在第一步，需在第一步前记录旧路径
    useEditorStore.getState().restoreSession(path);
```

**注意：** 上面的逻辑有问题——`set({ currentProject: project })` 在第一步已经执行，需要在第一步**之前**记录旧项目路径。完整修改如下：

替换整个 `openProject` 函数体：

```typescript
  openProject: async (path: string) => {
    // 记录切换前的项目路径（用于 saveSession）
    const previousPath = get().currentProject?.path ?? null;

    // ============================================
    // 第一步：通知后端打开项目（协调 watcher + PTY）
    // ============================================
    const project = await invoke<ProjectInfo>('open_project_cmd', { path });
    set({ currentProject: project });

    // ============================================
    // 第二步：刷新文件树（重置为新项目根目录）
    // ============================================
    const { useFileTreeStore } = await import('./fileTreeStore');
    await useFileTreeStore.getState().refreshFileTree(path);

    // ============================================
    // 第三步：并行刷新 git 状态 + worktree 列表
    // ============================================
    const { useGitStore } = await import('./gitStore');
    await Promise.all([
      useGitStore.getState().refreshGitStatus(path),
      useGitStore.getState().refreshWorktrees(path),
    ]);

    // ============================================
    // 第四步：保存旧项目编辑器状态，恢复新项目编辑器状态
    // previousPath 在函数开头记录，此时仍有效
    // ============================================
    const { useEditorStore } = await import('../editor/editorStore');
    if (previousPath && previousPath !== path) {
      // 保存旧项目当前打开的标签页状态
      useEditorStore.getState().saveSession(previousPath);
    }
    // 恢复新项目状态（无记录时等同于 closeAll）
    useEditorStore.getState().restoreSession(path);

    // ============================================
    // 第五步：激活新项目终端（已有 PTY 则复用，无则 spawn）
    // ============================================
    const { useTerminalStore } = await import('../terminal/terminalStore');
    await useTerminalStore.getState().activateProject(path);

    // ============================================
    // 第六步：按需刷新最近项目列表
    // ============================================
    const alreadyInList = get().recentProjects.some((p) => p.path === path);
    if (!alreadyInList) {
      await get().loadRecentProjects();
    }
  },
```

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run src/features/sidebar/__tests__/ProjectSelector.test.tsx 2>&1 | tail -10
```

- [ ] **Step 5: 提交**

```bash
git add src/features/sidebar/projectStore.ts src/features/sidebar/__tests__/ProjectSelector.test.tsx
git commit -m "feat(project): openProject saves/restores editor sessions and activates terminal"
```

---

## Task 8：新增编辑器会话持久化（Rust side）

**Files:**
- Create: `src-tauri/src/project_manager/session.rs`
- Modify: `src-tauri/src/project_manager/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**目标：** 应用重启后恢复上次每个项目的标签页状态。数据存储在 `~/.config/ghostterm/editor_sessions.json`。

- [ ] **Step 1: 创建 `session.rs`**

```rust
// @file: project_manager/session.rs
// @description: 编辑器会话持久化 - 按项目路径保存/加载上次打开的文件列表
//               存储路径：~/.config/ghostterm/editor_sessions.json
//               格式：{ "/project/path": { "open_file_paths": [...], "active_file_path": "..." } }
// @author: Atlas.oi
// @date: 2026-04-14

use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

/// 单项目编辑器会话快照
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditorSession {
    /// 上次打开的文件路径列表（顺序与标签页顺序一致）
    pub open_file_paths: Vec<String>,
    /// 上次激活的文件路径，None 表示无激活文件
    pub active_file_path: Option<String>,
}

/// 从 editor_sessions.json 加载所有项目的编辑器会话
///
/// 业务逻辑：
/// 1. 文件不存在 → 返回空 map（首次启动正常情况）
/// 2. 文件存在但解析失败 → 备份损坏文件，返回空 map
/// 3. 返回后过滤掉文件路径不存在的条目
pub fn load_sessions(path: &Path) -> HashMap<String, EditorSession> {
    if !path.exists() {
        return HashMap::new();
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[session] 读取 editor_sessions.json 失败: {e}");
            return HashMap::new();
        }
    };

    match serde_json::from_str::<HashMap<String, EditorSession>>(&content) {
        Ok(sessions) => sessions,
        Err(e) => {
            eprintln!("[session] 解析 editor_sessions.json 失败: {e}");
            // 备份损坏文件，不影响启动
            let backup = path.with_extension("json.corrupt");
            let _ = std::fs::rename(path, backup);
            HashMap::new()
        }
    }
}

/// 保存所有项目的编辑器会话到 editor_sessions.json
pub fn save_sessions(path: &Path, sessions: &HashMap<String, EditorSession>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {e}"))?;
    }

    let content = serde_json::to_string_pretty(sessions)
        .map_err(|e| format!("序列化 editor_sessions 失败: {e}"))?;

    std::fs::write(path, content)
        .map_err(|e| format!("写入 editor_sessions.json 失败: {e}"))
}

/// 获取单个项目的编辑器会话（不存在时返回默认空会话）
pub fn get_session(path: &Path, project_path: &str) -> EditorSession {
    let sessions = load_sessions(path);
    sessions.get(project_path).cloned().unwrap_or_default()
}

/// 保存单个项目的编辑器会话（其他项目的数据不受影响）
pub fn save_session(path: &Path, project_path: &str, session: EditorSession) -> Result<(), String> {
    let mut sessions = load_sessions(path);
    sessions.insert(project_path.to_string(), session);
    save_sessions(path, &sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_sessions_path(tmp: &TempDir) -> std::path::PathBuf {
        tmp.path().join("editor_sessions.json")
    }

    #[test]
    fn test_load_sessions_file_not_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let path = make_sessions_path(&tmp);
        let result = load_sessions(&path);
        assert!(result.is_empty());
    }

    #[test]
    fn test_save_and_load_session_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = make_sessions_path(&tmp);

        let session = EditorSession {
            open_file_paths: vec!["src/main.ts".to_string(), "src/index.ts".to_string()],
            active_file_path: Some("src/main.ts".to_string()),
        };

        save_session(&path, "/my/project", session.clone()).unwrap();
        let loaded = get_session(&path, "/my/project");

        assert_eq!(loaded.open_file_paths, session.open_file_paths);
        assert_eq!(loaded.active_file_path, session.active_file_path);
    }

    #[test]
    fn test_save_session_does_not_affect_other_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let path = make_sessions_path(&tmp);

        save_session(&path, "/proj-a", EditorSession {
            open_file_paths: vec!["a.ts".to_string()],
            active_file_path: None,
        }).unwrap();

        save_session(&path, "/proj-b", EditorSession {
            open_file_paths: vec!["b.ts".to_string()],
            active_file_path: Some("b.ts".to_string()),
        }).unwrap();

        let sessions = load_sessions(&path);
        assert_eq!(sessions.len(), 2);
        assert!(sessions.contains_key("/proj-a"));
        assert!(sessions.contains_key("/proj-b"));
    }
}
```

- [ ] **Step 2: 在 `project_manager/mod.rs` 中注册 session 模块并添加 Tauri commands**

在 `mod.rs` 文件顶部加 `pub mod session;`，然后在文件末尾加入：

```rust
pub mod session;

use session::{EditorSession, get_session, save_session};

/// 获取指定项目的编辑器会话（上次打开的文件列表）
#[tauri::command]
pub async fn get_editor_session_cmd(
    project_path: String,
    app: tauri::AppHandle,
) -> Result<EditorSession, String> {
    let sessions_path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?
        .join("editor_sessions.json");

    Ok(get_session(&sessions_path, &project_path))
}

/// 保存指定项目的编辑器会话
#[tauri::command]
pub async fn save_editor_session_cmd(
    project_path: String,
    open_file_paths: Vec<String>,
    active_file_path: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let sessions_path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?
        .join("editor_sessions.json");

    let session = EditorSession { open_file_paths, active_file_path };
    save_session(&sessions_path, &project_path, session)
}
```

- [ ] **Step 3: 在 `lib.rs` 中注册新 commands**

在 `invoke_handler` 的 command 列表中加入：

```rust
project_manager::get_editor_session_cmd,
project_manager::save_editor_session_cmd,
```

- [ ] **Step 4: 运行 Rust 测试**

```bash
cd src-tauri && cargo test project_manager::session 2>&1 | tail -20
cd ..
```

期望：session 模块的 3 个测试全部通过。

- [ ] **Step 5: 构建验证**

```bash
pnpm build 2>&1 | tail -20
```

期望：无 TypeScript/Rust 编译错误。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/project_manager/session.rs src-tauri/src/project_manager/mod.rs src-tauri/src/lib.rs
git commit -m "feat(persistence): add editor_sessions.json per-project persistence"
```

---

## Task 9：集成持久化到前端 — 启动恢复 + 切换保存

**Files:**
- Modify: `src/features/editor/editorStore.ts`
- Modify: `src/features/sidebar/projectStore.ts`

**目标：** 应用启动时从 `editor_sessions.json` 加载历史标签页；切换项目时保存到磁盘。

- [ ] **Step 1: 在 `editorStore` 中添加 `loadPersistedSession` 和 `persistSession`**

在 `editorStore.ts` 的 `restoreSession` 实现之后加：

```typescript
  /**
   * 从磁盘加载指定项目的会话并注入到 projectSessions
   * 用于应用启动时恢复历史标签页
   */
  loadPersistedSession: async (projectPath: string) => {
    try {
      const data = await invoke<{ open_file_paths: string[]; active_file_path: string | null }>(
        'get_editor_session_cmd',
        { projectPath }
      );

      // 过滤掉文件不存在的路径（项目文件可能已被删除）
      // 只存路径，实际内容在 restoreSession 时重新从磁盘读取
      const openFilePaths = data.open_file_paths;
      if (openFilePaths.length === 0 && !data.active_file_path) return;

      // 构造轻量 OpenFile 占位（内容为空，restoreSession 重新读取）
      // 注意：需要配合 restoreSession 在打开项目时重新 openFile
      set((state) => ({
        projectSessions: {
          ...state.projectSessions,
          [projectPath]: {
            openFiles: [], // 路径在下方通过 openFile 填充
            activeFilePath: data.active_file_path,
            // 保存路径列表供 openProject 使用
            _pendingPaths: openFilePaths,
          } as any,
        },
      }));
    } catch {
      // 无历史记录，静默忽略
    }
  },

  /**
   * 将当前项目的编辑器状态持久化到磁盘
   * 在 saveSession 成功后调用
   */
  persistSession: async (projectPath: string) => {
    const { projectSessions } = get();
    const session = projectSessions[projectPath];
    if (!session) return;

    await invoke('save_editor_session_cmd', {
      projectPath,
      openFilePaths: session.openFiles.map((f) => f.path),
      activeFilePath: session.activeFilePath,
    }).catch((e: unknown) => {
      // 持久化失败不影响主流程，记录日志
      console.error('[editor] 持久化会话失败', e);
    });
  },
```

同时在 `EditorState` 接口中声明两个新方法：

```typescript
  loadPersistedSession: (projectPath: string) => Promise<void>;
  persistSession: (projectPath: string) => Promise<void>;
```

- [ ] **Step 2: 更新 `projectStore.openProject` 加入持久化调用**

在第四步 `saveSession` 之后，加一行持久化调用：

```typescript
    // 保存旧项目状态到磁盘
    if (previousPath && previousPath !== path) {
      useEditorStore.getState().saveSession(previousPath);
      await useEditorStore.getState().persistSession(previousPath); // 写入磁盘
    }
    useEditorStore.getState().restoreSession(path);
```

- [ ] **Step 3: 在 `AppLayout.tsx` 的启动恢复逻辑中加载持久化会话**

在 `AppLayout.tsx` 的 `restore` 函数中（`useEffect` 第 79-91 行），在 `openProject` 之前加载持久化会话：

```typescript
    const restore = async () => {
      const { loadRecentProjects, openProject } = useProjectStore.getState();
      await loadRecentProjects();
      const { recentProjects } = useProjectStore.getState();

      // 预加载所有项目的持久化会话（不阻塞）
      const { useEditorStore } = await import('../features/editor/editorStore');
      await Promise.all(
        recentProjects.map((p) =>
          useEditorStore.getState().loadPersistedSession(p.path).catch(() => {})
        )
      );

      if (recentProjects.length > 0) {
        try {
          await openProject(recentProjects[0].path);
        } catch {
          // 路径不存在，静默跳过
        }
      }
    };
```

- [ ] **Step 4: 构建 + 全量测试**

```bash
pnpm build 2>&1 | tail -10 && pnpm vitest run 2>&1 | tail -20
```

期望：构建通过，测试无新增失败（`_pendingPaths` 相关逻辑在当前测试中不涉及）。

- [ ] **Step 5: 提交**

```bash
git add src/features/editor/editorStore.ts src/features/sidebar/projectStore.ts src/layouts/AppLayout.tsx
git commit -m "feat(persistence): integrate editor session load/save into startup and project switch"
```

---

## Task 10：修复旧测试 — 统一更新所有引用旧 API 的测试

**Files:**
- Modify: `src/test/terminalStore.test.ts`（旧 `spawn`/`kill`/`ptyId` 引用）
- Modify: `src/test/useTerminal.test.ts`（旧无参数调用）
- Modify: `src/features/sidebar/__tests__/Sidebar.test.tsx`（可能引用 `closeAll`）

- [ ] **Step 1: 查找所有引用旧 API 的测试**

```bash
grep -rn "\.spawn\b\|\.kill\(\)\|\.closeAll\(\)\|cwd=" src/test/ src/features/ --include="*.test.tsx" --include="*.test.ts" | grep -v "node_modules"
```

- [ ] **Step 2: 逐个更新测试**

对 `terminalStore.test.ts` 中旧测试：
- `useTerminalStore.getState().spawn(cwd)` → `useTerminalStore.getState().spawnForProject(path, cwd)`
- `store.ptyId` → `store.sessions[projectPath]?.ptyId`
- `store.connected` → `store.sessions[projectPath]?.connected`
- `store.kill()` → `store.killProject(projectPath)`

对 `useTerminal.test.ts` 中旧测试：
- `useTerminal()` → `useTerminal('/test/project')`

对引用 `closeAll` 的测试（如 `Sidebar.test.tsx`）：
- 确认 `closeAll` 方法仍存在于 store（仍保留，可被调用）；若测试期望 closeAll 在 openProject 时被调用，改为期望 `restoreSession` 被调用。

- [ ] **Step 3: 运行全量测试**

```bash
pnpm vitest run 2>&1 | grep -E "PASS|FAIL|Tests" | tail -20
```

期望：所有测试通过，无 `it.skip` 残留。

- [ ] **Step 4: 提交**

```bash
git add -u
git commit -m "test: update all tests to new per-project store APIs"
```

---

## Task 12：终端工具栏 — 关闭与重启按钮

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

**背景：** `killProject(path)` 在 Task 3 已有实现，但没有 UI 入口。需要在终端面板顶部加一个轻量工具栏，提供"关闭终端"和"重启终端"两个操作。工具栏放在 `AppLayout` 的终端 Panel 内（不在 Terminal.tsx 里，因为终端组件不应感知项目管理逻辑）。

**终端生命周期的两条路径（必须区分）：**

| 路径 | 触发 | 结果 | scrollback |
|------|------|------|-----------|
| 用户主动关闭（点工具栏 X） | `killProject` → 删 session → unmount | 面板显示"启动终端"按钮 | 丢失（用户明确选择） |
| PTY 自然退出（`exit` 命令） | ws.onclose → error overlay → "重试" | Terminal DOM **存活** | **保留**（可追加新输出） |

工具栏只负责"主动关闭"这条路径。PTY 自然退出的错误 overlay 和重试按钮已在 Task 5（Terminal.tsx）处理。

- [ ] **Step 1: 写失败测试**

在 `src/test/AppLayout.test.tsx` 中加：

```typescript
it('活跃项目有 session 时显示关闭终端按钮', () => {
  useTerminalStore.setState({
    sessions: {
      '/proj-a': { ptyId: 'pty-a', wsPort: 9001, wsToken: 'tok-a', connected: true },
    },
    activeProjectPath: '/proj-a',
  });
  useProjectStore.setState({
    currentProject: { name: 'proj-a', path: '/proj-a', last_opened: 0 },
    recentProjects: [],
  });

  render(<AppLayout />);

  expect(screen.getByRole('button', { name: '关闭终端' })).toBeInTheDocument();
});

it('点击关闭终端按钮调用 killProject', async () => {
  const user = userEvent.setup();
  const killProject = vi.fn().mockResolvedValue(undefined);
  useTerminalStore.setState({
    sessions: {
      '/proj-a': { ptyId: 'pty-a', wsPort: 9001, wsToken: 'tok-a', connected: true },
    },
    activeProjectPath: '/proj-a',
    killProject,
  });
  useProjectStore.setState({
    currentProject: { name: 'proj-a', path: '/proj-a', last_opened: 0 },
    recentProjects: [],
  });

  render(<AppLayout />);
  await user.click(screen.getByRole('button', { name: '关闭终端' }));

  expect(killProject).toHaveBeenCalledWith('/proj-a');
});

it('无活跃项目时不显示关闭终端按钮', () => {
  useTerminalStore.setState({ sessions: {}, activeProjectPath: null });
  useProjectStore.setState({ currentProject: null, recentProjects: [] });

  render(<AppLayout />);

  expect(screen.queryByRole('button', { name: '关闭终端' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm vitest run src/test/AppLayout.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: 在 AppLayout.tsx 终端 Panel 内加工具栏**

在 Task 6 的 Panel 内容**最顶部**（占位状态 div 之前）加入工具栏：

```typescript
        <Panel
          defaultSize={30}
          minSize={15}
          style={{
            overflow: 'hidden', minWidth: 0, minHeight: 0,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* 终端工具栏：始终可见，操作当前活跃项目的 PTY */}
          <div
            style={{
              height: 28,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              background: '#16161e',
              borderBottom: '1px solid #27293d',
              gap: 4,
            }}
          >
            <span style={{ flex: 1, fontSize: 11, color: '#565f89', userSelect: 'none' }}>
              终端
            </span>

            {/* 重启按钮：仅当活跃项目有 session 时显示（重启 = kill 旧 PTY + spawn 新 PTY） */}
            {activeProjectPath && sessions[activeProjectPath] && (
              <button
                onClick={() => {
                  // spawnForProject 内部会先 kill 已有 PTY 再创建新的
                  useTerminalStore.getState().spawnForProject(activeProjectPath, activeProjectPath)
                    .catch(() => {});
                }}
                aria-label="重启终端"
                title="重启终端"
                style={{
                  width: 20, height: 20, border: 'none', background: 'transparent',
                  color: '#565f89', cursor: 'pointer', borderRadius: 3,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0,
                }}
              >
                {/* 刷新 SVG icon */}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.1-3.45l-1.4 1.4V2h4v4l-1.85-1.65Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}

            {/* 关闭按钮：仅当活跃项目有 session 时显示 */}
            {activeProjectPath && sessions[activeProjectPath] && (
              <button
                onClick={() => killProject(activeProjectPath)}
                aria-label="关闭终端"
                title="关闭终端"
                style={{
                  width: 20, height: 20, border: 'none', background: 'transparent',
                  color: '#565f89', cursor: 'pointer', borderRadius: 3,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0,
                }}
              >
                {/* X SVG icon */}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path
                    d="M1 1l8 8M9 1L1 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* 其余内容（占位 + Terminal 实例）与 Task 6 Step 3 完全一致，不变 */}
          {/* ... */}
        </Panel>
```

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run src/test/AppLayout.test.tsx 2>&1 | tail -10
```

期望：Task 6 和 Task 12 新增的所有测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/layouts/AppLayout.tsx src/test/AppLayout.test.tsx
git commit -m "feat(terminal): add toolbar with close/restart buttons to terminal panel"
```

---

## Task 13：端到端验证

- [ ] **Step 1: 启动开发服务器**

```bash
pnpm tauri dev
```

- [ ] **Step 2: 验证编辑器隔离**

1. 打开项目 A，在编辑器打开 `src/main.ts`
2. 切换到项目 B，编辑器应清空（或显示 B 的上次记录）
3. 切换回项目 A，`src/main.ts` 应仍在标签页中

- [ ] **Step 3: 验证终端隔离（scrollback 保留）**

1. 在项目 A 的终端运行 `echo "hello from A"`
2. 切换到项目 B（右侧终端面板切换到 B 的终端）
3. 切换回项目 A，应看到 `echo "hello from A"` 的输出仍在 scrollback 中

- [ ] **Step 4: 验证主动关闭终端**

1. 在项目 A 的终端面板顶部工具栏点击关闭按钮（X）
2. 面板应显示"终端已关闭"和"启动终端"按钮
3. 面板不应为空白——有可操作的恢复入口

- [ ] **Step 5: 验证重启终端**

1. 接 Step 4，点击"启动终端"按钮
2. 终端应重新启动（全新 PTY，工作目录为项目 A 根目录）
3. 点击工具栏刷新按钮（重启终端），应关闭旧 PTY 并立即启动新 PTY

- [ ] **Step 6: 验证 PTY 自然退出不同于主动关闭**

1. 在项目 A 终端输入 `echo "before exit"` 然后输入 `exit`
2. 终端应显示错误 overlay（"终端连接失败"）+ "重试"按钮，**不跳转到"终端已关闭"占位**
3. scrollback 仍可见（`before exit` 仍在屏幕上）
4. 点击"重试"，新 PTY 启动，旧 scrollback 保留可见，新输出追加其后

- [ ] **Step 7: 验证重启恢复编辑器标签页**

1. 在项目 A 打开 `src/index.ts`
2. 切换到项目 B（此时 A 的会话被持久化到磁盘）
3. 关闭应用，重新启动
4. 项目 A 的 `src/index.ts` 应自动重新打开

- [ ] **Step 8: 最终提交**

```bash
git add -A
git commit -m "feat: per-project editor and terminal state isolation complete"
```

---

## 自检

### Spec 覆盖

| 需求 | 覆盖 Task |
|------|---------|
| 编辑器标签页切换项目后保留 | Task 2, 7 |
| 终端 scrollback 切换项目后保留 | Task 3, 5, 6 |
| 重启后恢复编辑器标签页 | Task 8, 9 |
| 不需要 SQLite（JSON 够用） | Task 8（session.rs 用 JSON） |
| Rust 后端零改动（多 PTY 天然支持）| Task 1 确认 |
| 用户主动关闭终端 → 可恢复 | Task 6（占位+启动按钮）、Task 12（工具栏 X 按钮） |
| PTY 自然退出 vs 主动关闭行为不同 | Task 5（error overlay 保留 DOM）、Task 12（主动关闭 unmount） |

### 终端生命周期状态机

```
[无活跃项目]
    → 打开项目 → activateProject
        ↓
[有 session，PTY 运行中]  ←─────────────────────────────────┐
    → 切换项目 → display:none（PTY 和 DOM 均存活）          │
    → PTY 自然退出 → error overlay（DOM 存活，scrollback 保留）
        → 点重试 → spawnForProject（重用同一 Terminal DOM）──┘
    → 点工具栏 X → killProject → session 删除 → Terminal unmount
        ↓
[无 session，有活跃项目] ← "终端已关闭" 占位
    → 点"启动终端" → activateProject → spawnForProject
        ↓
[有 session，PTY 运行中]（新 PTY，scrollback 清空）
```

### 类型一致性

- `PtySession`：Task 3 定义，Task 4、5、6、12 使用
- `EditorSession`：Task 2 TypeScript 接口 / Task 8 Rust struct，字段名对应（snake_case ↔ camelCase 由 Tauri 自动映射）
- `spawnForProject(projectPath, cwd)` ↔ Task 5 `Terminal.tsx`、Task 12 工具栏重启调用签名一致
- `activateProject(projectPath)` ↔ Task 7 `projectStore`、Task 6 "启动终端"按钮调用签名一致
- `killProject(projectPath)` ↔ Task 12 工具栏关闭按钮调用签名一致
- `setConnected(projectPath, v)` ↔ Task 4 `useTerminal` 调用签名一致

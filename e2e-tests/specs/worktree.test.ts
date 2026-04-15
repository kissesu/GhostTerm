/**
 * @file worktree.test.ts
 * @description E2E 测试：Git Worktree 事务切换验证（PBI-6.10）。
 *              验证 worktree 创建/切换/删除的完整事务流程，
 *              以及切换失败时的错误暴露（无降级处理）。
 *              所有测试保留 it.skip，需真实 Tauri 运行环境。
 * @author Atlas.oi
 * @date 2026-04-13
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriInvoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  browser.execute((c, a) => (window as any).__TAURI__.core.invoke(c, a), cmd, args) as Promise<T>;

interface WorktreeInfo {
  path: string;
  branch: string;
  is_current: boolean;
}

// 测试用 git 仓库路径（需在真实环境中替换为有效路径）
const TEST_REPO_PATH = '/tmp/ghostterm-e2e-git-repo';
const TEST_WORKTREE_PATH = '/tmp/ghostterm-e2e-worktree-branch';
const TEST_BRANCH_NAME = 'e2e-test-branch';

describe('PBI-6 E2E: Worktree 事务切换', () => {
  before(async () => {
    // 等待应用加载
    await browser.waitUntil(
      async () => {
        const sidebar = await $('[data-testid="sidebar-root"]');
        return sidebar.isDisplayed();
      },
      { timeout: 10000, timeoutMsg: '应用未加载' },
    );

    // 打开测试仓库（初始化 git 状态）
    await tauriInvoke('open_project_cmd', { path: TEST_REPO_PATH });
  });

  afterEach(async () => {
    // 尝试清理测试 worktree（若存在）
    try {
      await tauriInvoke('worktree_remove_cmd', {
        repo_path: TEST_REPO_PATH,
        worktree_path: TEST_WORKTREE_PATH,
        force: true,
      });
    } catch {
      // 忽略不存在的 worktree 删除错误
    }
  });

  it.skip('应能创建新 worktree 并显示在列表中', async () => {
    // 创建 worktree
    await tauriInvoke('worktree_add_cmd', {
      repo_path: TEST_REPO_PATH,
      branch: TEST_BRANCH_NAME,
      worktree_path: TEST_WORKTREE_PATH,
    });

    // 查询 worktree 列表（后端调用）
    const worktrees = await tauriInvoke<WorktreeInfo[]>('worktree_list_cmd', {
      repo_path: TEST_REPO_PATH,
    });

    // 断言新 worktree 出现在列表中
    const added = worktrees.find((w) => w.path === TEST_WORKTREE_PATH);
    expect(added).toBeDefined();
    expect(added?.branch).toContain(TEST_BRANCH_NAME);

    // UI 的 Worktrees 面板也应显示新条目
    const worktreeTab = await $('[data-testid="sidebar-tab-worktrees"]');
    await worktreeTab.click();

    await browser.waitUntil(async () => {
      const items = await $$('[data-testid="worktree-item"]');
      return (await items.length) >= 2; // 主 worktree + 新增 worktree
    }, { timeout: 3000, timeoutMsg: 'Worktrees 面板未显示新条目' });
  });

  it.skip('切换 worktree 后文件树应更新为新 worktree 路径', async () => {
    // 先创建 worktree
    await tauriInvoke('worktree_add_cmd', {
      repo_path: TEST_REPO_PATH,
      branch: TEST_BRANCH_NAME,
      worktree_path: TEST_WORKTREE_PATH,
    });

    // 切换到新 worktree（事务操作：watcher 重启 + PTY respawn）
    await tauriInvoke('worktree_switch_cmd', {
      repo_path: TEST_REPO_PATH,
      worktree_path: TEST_WORKTREE_PATH,
    });

    // 等待文件树更新到新 worktree 路径
    await browser.waitUntil(
      async () => {
        const projectSelector = await $('[data-testid="project-selector"]');
        const text = await projectSelector.getText();
        return text.includes('ghostterm-e2e-worktree-branch');
      },
      { timeout: 5000, timeoutMsg: 'ProjectSelector 未更新到新 worktree 路径' },
    );

    // 编辑器标签应已清空（切换时 editorStore.closeAll 被调用）
    const tabs = await $$('[data-testid="editor-tab"]');
    expect(await tabs.length).toBe(0);
  });

  it.skip('删除 worktree 后列表应移除该条目', async () => {
    // 先创建
    await tauriInvoke('worktree_add_cmd', {
      repo_path: TEST_REPO_PATH,
      branch: TEST_BRANCH_NAME,
      worktree_path: TEST_WORKTREE_PATH,
    });

    // 确认已存在
    let worktrees = await tauriInvoke<WorktreeInfo[]>('worktree_list_cmd', {
      repo_path: TEST_REPO_PATH,
    });
    expect(worktrees.find((w) => w.path === TEST_WORKTREE_PATH)).toBeDefined();

    // 删除
    await tauriInvoke('worktree_remove_cmd', {
      repo_path: TEST_REPO_PATH,
      worktree_path: TEST_WORKTREE_PATH,
      force: false,
    });

    // 再次查询，断言已移除
    worktrees = await tauriInvoke<WorktreeInfo[]>('worktree_list_cmd', {
      repo_path: TEST_REPO_PATH,
    });
    expect(worktrees.find((w) => w.path === TEST_WORKTREE_PATH)).toBeUndefined();
  });

  it.skip('切换到不存在分支时应返回错误而非静默失败', async () => {
    // 尝试切换到不存在的 worktree 路径
    const promise = tauriInvoke('worktree_switch_cmd', {
      repo_path: TEST_REPO_PATH,
      worktree_path: '/nonexistent/worktree/path',
    });

    // 应该 reject（错误暴露，不降级处理）
    await expect(promise).rejects.toMatch(/not found|不存在|no such/i);
  });
});

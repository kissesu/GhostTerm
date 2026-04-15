/**
 * @file sidebar-dialogs.test.ts
 * @description E2E 测试：侧边栏正式对话框交互。
 *              覆盖项目分组管理与 worktree 创建/删除确认的关键入口。
 *              目前保留 it.skip，需真实 Tauri + tauri-webdriver 环境。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriInvoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  browser.execute((c, a) => (window as any).__TAURI__.core.invoke(c, a), cmd, args) as Promise<T>;

const TEST_REPO_PATH = '/tmp/ghostterm-e2e-sidebar';

describe('Sidebar E2E: 对话框交互', () => {
  before(async () => {
    await browser.waitUntil(
      async () => {
        const sidebar = await $('[data-testid="sidebar-root"]');
        return sidebar.isDisplayed();
      },
      { timeout: 15000, timeoutMsg: '应用未在 15s 内加载完成' },
    );
  });

  it.skip('应能从分组菜单打开新建分组对话框并创建分组', async () => {
    const toggle = await $('[data-testid="project-group-toggle"]');
    await toggle.click();

    const createEntry = await $('button=新建分组');
    await createEntry.click();

    const dialog = await $('[data-testid="group-create-dialog"]');
    await expect(dialog).toBeDisplayed();

    const input = await $('[data-testid="group-name-input"]');
    await input.setValue('E2E 分组');
    await $('[data-testid="group-create-confirm"]').click();

    await browser.waitUntil(
      async () => (await $('[data-testid="project-group-toggle"]')).isDisplayed(),
      { timeout: 3000, timeoutMsg: '创建分组后界面未恢复' },
    );

    await toggle.click();
    await expect(await $('button=切换到E2E 分组')).toBeDisplayed();
  });

  it.skip('应能重命名并删除当前分组', async () => {
    const toggle = await $('[data-testid="project-group-toggle"]');
    await toggle.click();
    await $('button=新建分组').click();
    await $('[data-testid="group-name-input"]').setValue('待重命名分组');
    await $('[data-testid="group-create-confirm"]').click();

    await toggle.click();
    await $('button=切换到待重命名分组').click();

    const editButton = await $('button[aria-label="编辑分组"]');
    await editButton.click();
    await $('button=重命名分组').click();

    const renameDialog = await $('[data-testid="group-rename-dialog"]');
    await expect(renameDialog).toBeDisplayed();
    const renameInput = await $('[data-testid="group-rename-input"]');
    await renameInput.setValue('已重命名分组');
    await $('[data-testid="group-rename-confirm"]').click();

    expect(await (await $('[data-testid="project-group-label"]')).getText()).toContain('已重命名分组');

    await editButton.click();
    await $('button=删除分组').click();

    const deleteDialog = await $('[data-testid="group-delete-dialog"]');
    await expect(deleteDialog).toBeDisplayed();
    await $('[data-testid="group-delete-confirm"]').click();

    expect(await (await $('[data-testid="project-group-label"]')).getText()).toContain('未分组');
  });

  it.skip('应能打开 worktree 新建与删除确认对话框', async () => {
    await tauriInvoke('open_project_cmd', { path: TEST_REPO_PATH });

    const worktreesTab = await $('button=Worktrees');
    await worktreesTab.click();

    const createButton = await $('button=+ 新建');
    await createButton.click();

    const createDialog = await $('[data-testid="worktree-create-dialog"]');
    await expect(createDialog).toBeDisplayed();

    await $('[data-testid="worktree-create-branch-input"]').setValue('e2e/sidebar-dialog');
    await $('[data-testid="worktree-create-path-input"]').setValue('/tmp/ghostterm-e2e-sidebar-worktree');
    await $('[data-testid="worktree-create-confirm"]').click();

    await browser.waitUntil(async () => {
      const removeButtons = await $$('button[title^="删除 "]');
      return (await removeButtons.length) > 0;
    }, { timeout: 5000, timeoutMsg: '新建 worktree 后未出现可删除条目' });

    const removeButtons = await $$('button[title^="删除 "]');
    await removeButtons[0].click();

    const removeDialog = await $('[data-testid="worktree-remove-dialog"]');
    await expect(removeDialog).toBeDisplayed();
  });
});

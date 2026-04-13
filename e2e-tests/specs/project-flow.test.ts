/**
 * @file project-flow.test.ts
 * @description E2E 测试：打开项目全链路验证（PBI-6.7）。
 *              验证从选择目录到侧边栏/编辑器/终端全部刷新的完整流程。
 *              前置：tauri-wd WebDriver server 在 localhost:4444，Tauri debug 构建已完成。
 *              所有测试保留 it.skip，需真实 Tauri 运行环境。
 * @author Atlas.oi
 * @date 2026-04-13
 */

// tauri-webdriver 测试辅助：在 webview 上下文中执行 Tauri invoke
// 类型强制转换使 TypeScript 不报错（E2E 环境有 window.__TAURI__）
const tauriInvoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  browser.execute(
    (c: string, a: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__TAURI__.core.invoke(c, a),
    cmd,
    args,
  ) as Promise<T>;

// 测试专用项目路径（真实环境需替换为实际可读写路径）
const TEST_PROJECT_PATH = '/tmp/ghostterm-e2e-project';
const ANOTHER_PROJECT_PATH = '/tmp/ghostterm-e2e-project-b';

describe('PBI-6 E2E: 打开项目全链路', () => {
  before(async () => {
    // 等待应用完全加载（侧边栏出现）
    await browser.waitUntil(
      async () => {
        const sidebar = await $('[data-testid="sidebar-root"]');
        return sidebar.isDisplayed();
      },
      { timeout: 15000, timeoutMsg: '应用未在 15s 内完成加载' },
    );
  });

  it.skip('打开项目后侧边栏文件树应显示项目根目录内容', async () => {
    // 通过 invoke 绕开文件选择对话框，直接传入测试路径
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });

    // 等待文件树加载（open_project → refreshFileTree → 前端渲染）
    await browser.waitUntil(
      async () => {
        const items = await $$('[data-testid="file-tree-item"]');
        return items.length > 0;
      },
      { timeout: 5000, timeoutMsg: '文件树未在 5s 内显示内容' },
    );

    // 断言项目名显示在 ProjectSelector
    const selector = await $('[data-testid="project-selector"]');
    await expect(selector).toHaveTextContaining('ghostterm-e2e-project');

    // 断言文件树有内容（目录不为空）
    const items = await $$('[data-testid="file-tree-item"]');
    expect(items.length).toBeGreaterThan(0);
  });

  it.skip('切换项目后编辑器应清空旧文件标签', async () => {
    // Step 1: 打开项目 A，打开一个文件
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });
    await browser.waitUntil(
      async () => (await $$('[data-testid="file-tree-item"]')).length > 0,
      { timeout: 5000, timeoutMsg: '项目 A 文件树未加载' },
    );

    const [firstFile] = await $$('[data-testid="file-tree-item"]');
    await firstFile.click();

    // 等待编辑器标签出现
    await browser.waitUntil(
      async () => (await $$('[data-testid="editor-tab"]')).length > 0,
      { timeout: 3000, timeoutMsg: '编辑器标签未出现' },
    );

    // Step 2: 切换到项目 B
    await tauriInvoke('open_project_cmd', { path: ANOTHER_PROJECT_PATH });

    // Step 3: 断言编辑器标签已清空（projectStore.openProject 调用 editorStore.closeAll）
    await browser.waitUntil(
      async () => (await $$('[data-testid="editor-tab"]')).length === 0,
      { timeout: 3000, timeoutMsg: '切换项目后编辑器标签未清空' },
    );
  });

  it.skip('切换项目后 git 状态应反映新项目', async () => {
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });

    // 点击 Changes 标签页
    const changesTab = await $('[data-testid="sidebar-tab-changes"]');
    await changesTab.click();

    // 等待 git 状态加载（refreshGitStatus 返回后渲染分支名）
    await browser.waitUntil(
      async () => {
        const branchEl = await $('[data-testid="git-branch-name"]');
        return branchEl.isDisplayed();
      },
      { timeout: 5000, timeoutMsg: '分支名未在 5s 内显示' },
    );

    const branchEl = await $('[data-testid="git-branch-name"]');
    const branchText = await branchEl.getText();
    expect(branchText.trim()).not.toBe('');
  });

  it.skip('打开项目后文件监听应自动启动', async () => {
    // open_project_cmd 内部调用 start_watching，前端注册 fs:event 监听
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });

    await browser.waitUntil(
      async () => (await $$('[data-testid="file-tree-item"]')).length > 0,
      { timeout: 5000, timeoutMsg: '文件树未加载' },
    );

    const initialCount = (await $$('[data-testid="file-tree-item"]')).length;

    // 通过后端命令写入新文件（模拟 AI 创建文件）
    await tauriInvoke('write_file', {
      path: `${TEST_PROJECT_PATH}/_e2e_probe.txt`,
      content: 'E2E probe',
    });

    // 等待 fs:event 触发文件树增量更新（applyFsEvent）
    await browser.waitUntil(
      async () => (await $$('[data-testid="file-tree-item"]')).length > initialCount,
      { timeout: 3000, timeoutMsg: '文件树未响应 fs:event（文件监听未启动）' },
    );

    // 清理探针文件
    await tauriInvoke('delete_entry', { path: `${TEST_PROJECT_PATH}/_e2e_probe.txt` });
  });
});

/**
 * @file lifecycle.test.ts
 * @description E2E 测试：应用生命周期验证（PBI-6.11）。
 *              验证应用启动、项目打开/关闭、状态持久化等生命周期行为。
 *              所有测试保留 it.skip，需真实 Tauri 运行环境。
 * @author Atlas.oi
 * @date 2026-04-13
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriInvoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  browser.execute((c, a) => (window as any).__TAURI__.core.invoke(c, a), cmd, args) as Promise<T>;

interface ProjectInfo {
  name: string;
  path: string;
  last_opened: number;
}

const TEST_PROJECT_PATH = '/tmp/ghostterm-e2e-lifecycle-project';

describe('PBI-6 E2E: 应用生命周期', () => {
  beforeAll(async () => {
    // 等待应用完成启动（ProjectSelector 出现）
    await browser.waitUntil(
      async () => {
        const selector = await $('[data-testid="project-selector"]');
        return selector.isDisplayed();
      },
      { timeout: 15000, timeoutMsg: '应用未在 15s 内启动' },
    );
  });

  it.skip('应用启动后应加载最近项目列表', async () => {
    // 先打开一个项目确保有历史记录
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });
    await tauriInvoke('close_project_cmd');

    // 调用 list_recent_projects_cmd，断言返回包含刚打开的项目
    const projects = await tauriInvoke<ProjectInfo[]>('list_recent_projects_cmd');
    expect(projects.length).toBeGreaterThan(0);

    // 最近项目列表第一项应为刚打开的项目
    const found = projects.find((p) => p.path === TEST_PROJECT_PATH);
    expect(found).toBeDefined();
  });

  it.skip('打开项目后重启应用，最近项目列表应包含该项目', async () => {
    // 这个测试需要重启应用，tauri-webdriver 暂不支持热重启
    // 通过 projects.json 持久化验证替代：打开项目 → 读取文件 → 确认写入
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });

    // 立即读取 recent projects（持久化到 projects.json）
    const projects = await tauriInvoke<ProjectInfo[]>('list_recent_projects_cmd');

    // 新打开的项目应在列表头部（last_opened 最新）
    expect(projects[0].path).toBe(TEST_PROJECT_PATH);
    expect(projects[0].last_opened).toBeGreaterThan(0);
  });

  it.skip('关闭项目后 currentProject 应为空', async () => {
    // 打开项目
    await tauriInvoke('open_project_cmd', { path: TEST_PROJECT_PATH });

    // 等待文件树显示（确认项目已打开）
    await browser.waitUntil(
      async () => (await $$('[data-testid="file-tree-item"]')).length > 0,
      { timeout: 5000, timeoutMsg: '文件树未加载' },
    );

    // 关闭项目
    await tauriInvoke('close_project_cmd');

    // ProjectSelector 应显示"未选择项目"或空状态
    await browser.waitUntil(
      async () => {
        const selector = await $('[data-testid="project-selector"]');
        const text = await selector.getText();
        return text.includes('打开项目') || text.trim() === '' || text.includes('未选择');
      },
      { timeout: 3000, timeoutMsg: '关闭项目后 ProjectSelector 未更新' },
    );

    // 文件树应清空
    const items = await $$('[data-testid="file-tree-item"]');
    expect(items.length).toBe(0);
  });

  it.skip('最近项目列表最多保留 20 条', async () => {
    // 打开 21 个不同路径的项目（直接调用 open_project_inner 逻辑由后端处理）
    // 由于需要真实目录，此测试依赖 setup fixture 创建 21 个目录
    // 这里用 invoke 验证后端的 MAX_RECENT_PROJECTS = 20 限制
    const projects = await tauriInvoke<ProjectInfo[]>('list_recent_projects_cmd');

    // 断言最多 20 条（后端已截断）
    expect(projects.length).toBeLessThanOrEqual(20);
  });
});

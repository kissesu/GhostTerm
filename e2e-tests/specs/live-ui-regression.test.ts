const TARGET_PROJECT_NAME = 'gt-regression-proj-10';
const FIRST_PROJECT_NAME = 'gt-regression-proj-01';

describe('Live regression: sidebar + titlebar', () => {
  before(async () => {
    await browser.waitUntil(
      async () => {
        const hasSidebar = await browser.execute(
          () => Boolean(document.querySelector('[data-testid="sidebar-root"]')),
        );
        return Boolean(hasSidebar);
      },
      { timeout: 20000, timeoutMsg: '应用未在 20s 内加载完成' },
    );

    await browser.waitUntil(
      async () => {
        const cardCount = await browser.execute(
          () => document.querySelectorAll('[data-testid^="project-card-"]').length,
        );
        return Number(cardCount) >= 10;
      },
      { timeout: 10000, timeoutMsg: '最近项目列表未按预期加载' },
    );
  });

  it('展开较低位置项目时应保持列表顺序且不自动跳回顶部', async () => {
    const before = await browser.execute((targetProjectName) => {
      const container = document.querySelector('[data-testid="project-list-scroll-container"]') as HTMLDivElement | null;
      if (!container) {
        throw new Error('missing project list scroll container');
      }

      container.scrollTop = container.scrollHeight;

      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="project-card-"]'));
      const order = cards.map((card) => card.dataset.testid?.replace('project-card-', '') ?? '');
      const targetCard = document.querySelector<HTMLElement>(`[data-testid="project-card-${targetProjectName}"]`);
      const targetButton = targetCard?.querySelector('button[aria-label^="打开项目 "]') as HTMLButtonElement | null;
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetCard?.getBoundingClientRect();

      return {
        scrollTop: container.scrollTop,
        order,
        targetVisibleBeforeClick: Boolean(targetRect && targetRect.bottom > containerRect.top && targetRect.top < containerRect.bottom),
        targetOffsetBeforeClick: targetRect ? targetRect.top - containerRect.top : null,
        targetButtonExists: Boolean(targetButton),
      };
    }, TARGET_PROJECT_NAME as never);

    expect(before.targetButtonExists).toBe(true);
    expect(before.targetVisibleBeforeClick).toBe(true);
    expect(before.order[0]).toBe(FIRST_PROJECT_NAME);

    const targetOpenButton = await $(`[data-testid="project-card-${TARGET_PROJECT_NAME}"] button[aria-label="打开项目 ${TARGET_PROJECT_NAME}"]`);
    await targetOpenButton.click();

    await browser.waitUntil(
      async () => {
        const panelShown = await browser.execute((targetProjectName) => {
          const panel = document.querySelector<HTMLElement>(`[data-testid="accordion-panel-${targetProjectName}"]`);
          if (!panel) {
            return false;
          }

          const rect = panel.getBoundingClientRect();
          return rect.height > 0 && rect.width > 0;
        }, TARGET_PROJECT_NAME as never);
        return Boolean(panelShown);
      },
      { timeout: 10000, timeoutMsg: '目标项目展开面板未显示' },
    );

    const after = await browser.execute((targetProjectName) => {
      const container = document.querySelector('[data-testid="project-list-scroll-container"]') as HTMLDivElement | null;
      if (!container) {
        throw new Error('missing project list scroll container');
      }

      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="project-card-"]'));
      const order = cards.map((card) => card.dataset.testid?.replace('project-card-', '') ?? '');
      const targetCard = document.querySelector<HTMLElement>(`[data-testid="project-card-${targetProjectName}"]`);
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetCard?.getBoundingClientRect();

      return {
        scrollTop: container.scrollTop,
        order,
        targetOffsetAfterClick: targetRect ? targetRect.top - containerRect.top : null,
      };
    }, TARGET_PROJECT_NAME as never);

    expect(after.order[0]).toBe(FIRST_PROJECT_NAME);
    expect(after.order).toEqual(before.order);
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(120);
    expect(after.targetOffsetAfterClick).not.toBeNull();
    expect(after.targetOffsetAfterClick as number).toBeGreaterThan(40);
  });

  it('Files / Changes / Worktrees 的内容区域应增大到更高可见高度', async () => {
    const panelMetrics = await browser.execute((targetProjectName) => {
      const panel = document.querySelector<HTMLElement>(`[data-testid="accordion-panel-${targetProjectName}"]`);
      if (!panel) {
        throw new Error('missing accordion panel');
      }

      const contentArea = panel.lastElementChild as HTMLElement | null;
      if (!contentArea) {
        throw new Error('missing accordion content area');
      }

      return {
        inlineMaxHeight: contentArea.style.maxHeight,
        renderedHeight: Math.round(contentArea.getBoundingClientRect().height),
        viewportHeight: window.innerHeight,
      };
    }, TARGET_PROJECT_NAME as never);

    expect(panelMetrics.inlineMaxHeight).toBe('min(84vh, 960px)');
    expect(panelMetrics.renderedHeight).toBeGreaterThanOrEqual(720);
    expect(panelMetrics.renderedHeight).toBeLessThanOrEqual(820);
  });

  it('双击自定义 titlebar 应切换为 fill 整个屏幕的最大化状态', async () => {
    const titlebar = await $('[data-testid="window-titlebar"]');

    const initial = await browser.execute(async () => {
      const appWindow = (window as any).__TAURI__.window.getCurrentWindow();
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        maximized: await appWindow.isMaximized(),
      };
    });

    if (initial.maximized) {
      await titlebar.doubleClick();
      await browser.waitUntil(
        async () => !(await browser.execute(async () => (window as any).__TAURI__.window.getCurrentWindow().isMaximized())),
        { timeout: 5000, timeoutMsg: '测试前无法将窗口恢复为非最大化状态' },
      );
    }

    const baseline = await browser.execute(async () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      maximized: await (window as any).__TAURI__.window.getCurrentWindow().isMaximized(),
    }));

    await titlebar.doubleClick();

    await browser.waitUntil(
      async () => await browser.execute(async () => (window as any).__TAURI__.window.getCurrentWindow().isMaximized()),
      { timeout: 5000, timeoutMsg: '双击 titlebar 后窗口未进入最大化状态' },
    );

    const maximized = await browser.execute(async () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      maximized: await (window as any).__TAURI__.window.getCurrentWindow().isMaximized(),
    }));

    expect(maximized.maximized).toBe(true);
    expect(maximized.width).toBeGreaterThan(baseline.width + 100);
    expect(maximized.height).toBeGreaterThan(baseline.height + 100);

    await titlebar.doubleClick();
    await browser.waitUntil(
      async () => !(await browser.execute(async () => (window as any).__TAURI__.window.getCurrentWindow().isMaximized())),
      { timeout: 5000, timeoutMsg: '双击 titlebar 第二次后窗口未恢复' },
    );
  });
});

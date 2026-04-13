/**
 * @file terminal.test.ts
 * @description E2E 测试：终端数据通道验证（PBI-6.8）。
 *              验证 PTY 进程创建、数据读写、窗口大小调整等核心功能。
 *              前置：tauri-wd WebDriver server 在 localhost:4444，Tauri debug 构建已完成。
 *              所有测试保留 it.skip，需真实 Tauri 运行环境。
 * @author Atlas.oi
 * @date 2026-04-13
 */

// webview 上下文中的 invoke 调用
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriInvoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  browser.execute((c, a) => (window as any).__TAURI__.core.invoke(c, a), cmd, args) as Promise<T>;

// webview 上下文中监听 Tauri 事件（返回触发的第一个事件 payload）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const waitForTauriEvent = (eventName: string, timeoutMs = 5000): Promise<any> =>
  browser.execute(
    (name: string, ms: number) =>
      new Promise((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unlisten = (window as any).__TAURI__.event.listen(name, (evt: any) => {
          resolve(evt.payload);
          unlisten.then((fn: () => void) => fn());
        });
        setTimeout(() => reject(new Error(`事件 ${name} 超时 ${ms}ms`)), ms);
      }),
    eventName,
    timeoutMs,
  );

interface PtyInfo {
  pty_id: string;
  ws_port: number;
  ws_token: string;
}

describe('PBI-6 E2E: 终端数据通道', () => {
  // 清理每个测试后创建的 PTY，避免资源泄漏
  afterEach(async () => {
    try {
      // 关闭项目会 kill PTY（项目级别清理）
      await tauriInvoke('close_project_cmd');
    } catch {
      // 忽略清理错误
    }
  });

  it.skip('应能成功创建 PTY 进程', async () => {
    // spawn_pty_cmd 返回 PtyInfo
    const info = await tauriInvoke<PtyInfo>('spawn_pty_cmd', {
      shell: '/bin/zsh',
      cwd: '/tmp',
    });

    // 断言返回有效的连接信息
    expect(info.pty_id).toBeDefined();
    expect(info.pty_id.length).toBeGreaterThan(0);
    expect(info.ws_port).toBeGreaterThan(0);
    expect(info.ws_token.length).toBeGreaterThan(0);

    // 清理
    await tauriInvoke('kill_pty_cmd', { ptyId: info.pty_id });
  });

  it.skip('输入命令后应在终端输出中看到回显', async () => {
    // 先打开项目（open_project 会 spawn PTY）
    const info = await tauriInvoke<PtyInfo>('spawn_pty_cmd', {
      shell: '/bin/zsh',
      cwd: '/tmp',
    });

    // 等待 PTY 数据事件（xterm.js 会通过 WebSocket 接收并渲染）
    // 发送 echo 命令后，终端面板应显示 "hello"
    const terminalPanel = await $('[data-testid="terminal-panel"]');
    await terminalPanel.click();

    await browser.keys(['e', 'c', 'h', 'o', ' ', 'h', 'e', 'l', 'l', 'o', 'Enter']);

    // 等待 xterm.js 渲染输出
    await browser.waitUntil(
      async () => {
        const termContent = await terminalPanel.getText();
        return termContent.includes('hello');
      },
      { timeout: 5000, timeoutMsg: '终端未在 5s 内显示 echo 输出' },
    );

    await tauriInvoke('kill_pty_cmd', { ptyId: info.pty_id });
  });

  it.skip('调整终端窗口大小后不应崩溃', async () => {
    const info = await tauriInvoke<PtyInfo>('spawn_pty_cmd', {
      shell: '/bin/zsh',
      cwd: '/tmp',
    });

    // 调用 resize_pty_cmd，断言无错误返回
    await expect(
      tauriInvoke('resize_pty_cmd', { ptyId: info.pty_id, cols: 120, rows: 40 }),
    ).resolves.not.toThrow();

    // 再次 resize 到更小的尺寸
    await expect(
      tauriInvoke('resize_pty_cmd', { ptyId: info.pty_id, cols: 40, rows: 10 }),
    ).resolves.not.toThrow();

    await tauriInvoke('kill_pty_cmd', { ptyId: info.pty_id });
  });

  it.skip('kill PTY 后 pty:exit 事件应触发', async () => {
    const info = await tauriInvoke<PtyInfo>('spawn_pty_cmd', {
      shell: '/bin/zsh',
      cwd: '/tmp',
    });

    // 注册 pty:exit 事件监听（在 kill 前注册）
    const exitEventPromise = waitForTauriEvent(`pty:exit:${info.pty_id}`, 3000);

    // kill PTY
    await tauriInvoke('kill_pty_cmd', { ptyId: info.pty_id });

    // 等待 exit 事件触发
    const exitPayload = await exitEventPromise;
    expect(exitPayload).toBeDefined();
  });
});

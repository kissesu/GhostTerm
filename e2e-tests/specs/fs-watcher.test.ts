/**
 * @file fs-watcher.test.ts
 * @description E2E 测试：文件监听链路验证（PBI-6.9）。
 *              验证 start_watching → 文件变更 → fs:event 前端接收的完整链路。
 *              所有测试保留 it.skip，需真实 Tauri 运行环境。
 * @author Atlas.oi
 * @date 2026-04-13
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tauriInvoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  browser.execute((c, a) => (window as any).__TAURI__.core.invoke(c, a), cmd, args) as Promise<T>;

// 在 webview 上下文中监听 Tauri 事件，返回第一个事件的 payload
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captureNextFsEvent = (timeoutMs = 2000): Promise<any> =>
  browser.execute(
    (ms: number) =>
      new Promise((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__TAURI__.event.listen('fs:event', (evt: any) => {
          resolve(evt.payload);
        });
        setTimeout(() => reject(new Error('fs:event 超时')), ms);
      }),
    timeoutMs,
  );

// 在 webview 上下文中验证指定时间内没有 fs:event 触发
const assertNoFsEvent = (waitMs = 300): Promise<boolean> =>
  browser.execute(
    (ms: number) =>
      new Promise<boolean>((resolve) => {
        let received = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__TAURI__.event.listen('fs:event', () => {
          received = true;
        });
        setTimeout(() => resolve(!received), ms);
      }),
    waitMs,
  );

const TMP_DIR = '/tmp/ghostterm-e2e-watcher';

describe('PBI-6 E2E: 文件监听链路', () => {
  beforeAll(async () => {
    // 确保测试目录存在
    await tauriInvoke('create_entry', { path: TMP_DIR, is_dir: true });
  });

  afterEach(async () => {
    // 每次测试后停止 watcher，避免干扰下一个测试
    try {
      await tauriInvoke('stop_watching_cmd');
    } catch {
      // 忽略未启动时的停止错误
    }
  });

  it.skip('创建文件后前端应收到 fs:event created', async () => {
    // 启动文件监听
    await tauriInvoke('start_watching_cmd', { path: TMP_DIR });

    // 先注册监听器，再创建文件（顺序不能颠倒）
    const eventPromise = captureNextFsEvent(3000);
    await tauriInvoke('write_file', {
      path: `${TMP_DIR}/new-file.txt`,
      content: 'hello',
    });

    const payload = await eventPromise;
    expect(payload.event_type).toBe('created');
    expect(payload.path).toContain('new-file.txt');

    // 清理
    await tauriInvoke('delete_entry', { path: `${TMP_DIR}/new-file.txt` });
  });

  it.skip('删除文件后前端应收到 fs:event deleted', async () => {
    // 先创建文件
    await tauriInvoke('write_file', {
      path: `${TMP_DIR}/to-delete.txt`,
      content: 'goodbye',
    });

    await tauriInvoke('start_watching_cmd', { path: TMP_DIR });

    const eventPromise = captureNextFsEvent(3000);
    await tauriInvoke('delete_entry', { path: `${TMP_DIR}/to-delete.txt` });

    const payload = await eventPromise;
    expect(payload.event_type).toBe('deleted');
    expect(payload.path).toContain('to-delete.txt');
  });

  it.skip('重命名文件后前端应收到 fs:event renamed', async () => {
    await tauriInvoke('write_file', {
      path: `${TMP_DIR}/old-name.txt`,
      content: 'rename me',
    });

    await tauriInvoke('start_watching_cmd', { path: TMP_DIR });

    const eventPromise = captureNextFsEvent(3000);
    await tauriInvoke('rename_entry', {
      from: `${TMP_DIR}/old-name.txt`,
      to: `${TMP_DIR}/new-name.txt`,
    });

    const payload = await eventPromise;
    expect(payload.event_type).toBe('renamed');
    // payload 应包含旧路径和新路径
    expect(payload.old_path || payload.path).toContain('old-name.txt');

    // 清理
    await tauriInvoke('delete_entry', { path: `${TMP_DIR}/new-name.txt` });
  });

  it.skip('.git 目录下的变更不应触发 fs:event', async () => {
    // 使用已有 git 仓库（当前项目目录）
    await tauriInvoke('start_watching_cmd', { path: '/tmp/ghostterm-e2e-project' });

    // 在 .git 目录创建文件（watcher 配置了 ignore 规则排除 .git/）
    await tauriInvoke('write_file', {
      path: '/tmp/ghostterm-e2e-project/.git/e2e-probe',
      content: 'probe',
    });

    // 等待 300ms，断言没有 fs:event 触发（debounce + ignore 规则生效）
    const noEvent = await assertNoFsEvent(300);
    expect(noEvent).toBe(true);

    // 清理
    await tauriInvoke('delete_entry', { path: '/tmp/ghostterm-e2e-project/.git/e2e-probe' });
  });

  it.skip('stop_watching 后不再收到 fs:event', async () => {
    await tauriInvoke('start_watching_cmd', { path: TMP_DIR });
    // 立即停止
    await tauriInvoke('stop_watching_cmd');

    // 创建文件 - 此时 watcher 已停止
    await tauriInvoke('write_file', {
      path: `${TMP_DIR}/after-stop.txt`,
      content: 'silent',
    });

    // 断言没有事件触发
    const noEvent = await assertNoFsEvent(300);
    expect(noEvent).toBe(true);

    // 清理
    await tauriInvoke('delete_entry', { path: `${TMP_DIR}/after-stop.txt` });
  });
});

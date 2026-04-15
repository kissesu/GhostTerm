/**
 * @file App - 应用根组件
 * @description GhostTerm 应用入口。订阅 appTheme 设置，将 data-theme 属性写到 #root，
 *              驱动 CSS 自定义属性切换；同时同步 themeStore（供 xterm.js 使用）。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { useEffect } from 'react';
import AppLayout from './layouts/AppLayout';
import { SettingsPage } from './features/settings';
import { useSettingsStore } from './shared/stores/settingsStore';
import { syncTheme } from './shared/stores/themeStore';
import { useUpdater } from './features/updater/useUpdater';
import UpdateBanner from './features/updater/UpdateBanner';

function App() {
  const appView  = useSettingsStore((s) => s.appView);
  const appTheme = useSettingsStore((s) => s.appTheme);
  const [updateState, updateActions] = useUpdater();

  useEffect(() => {
    // 跟随系统偏好的 media query
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved = syncTheme(appTheme, mq.matches);
      // 将解析后的主题写入 HTML 根元素，驱动 CSS 令牌切换
      document.documentElement.setAttribute('data-theme', resolved);
    };

    apply();

    // 当 appTheme === 'system' 时，监听系统偏好变化
    if (appTheme === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [appTheme]);

  // ============================================
  // AppLayout 必须常驻挂载（不能卸载再重建），
  // 否则 display:none 保留的 xterm 实例会随卸载销毁，
  // 返回主页时终端显示空白。
  // 进入设置页时用 display:none 隐藏 AppLayout，
  // SettingsPage 条件渲染叠加在上层。
  // ============================================
  return (
    <>
      <div
        style={{
          display: appView === 'settings' ? 'none' : 'flex',
          width: '100%',
          height: '100%',
        }}
      >
        <AppLayout />
      </div>
      {appView === 'settings' && <SettingsPage />}
      {/* 更新提示横幅：有新版本时显示在窗口底部 */}
      <UpdateBanner state={updateState} actions={updateActions} />
    </>
  );
}

export default App;

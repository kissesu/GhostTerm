/**
 * @file App - 应用根组件
 * @description GhostTerm 应用入口，挂载全局 Provider 并渲染主布局。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import AppLayout from './layouts/AppLayout';
import { SettingsPage } from './features/settings';
import { useSettingsStore } from './shared/stores/settingsStore';

function App() {
  const appView = useSettingsStore((s) => s.appView);

  return appView === 'settings' ? <SettingsPage /> : <AppLayout />;
}

export default App;

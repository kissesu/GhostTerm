import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// ============================================
// 阻止 Tauri webview 的默认滚动行为
// macOS 双指滑动会导致整个页面在窗口内弹性滚动
// 必须在 document 级别阻止 wheel/touchmove 默认行为
// ============================================
document.addEventListener('wheel', (e) => {
  // 仅阻止 document/body/root 级别的滚动（不影响内部可滚动容器）
  const target = e.target as HTMLElement;
  if (!target.closest('[data-scrollable]')) {
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('[data-scrollable]')) {
    e.preventDefault();
  }
}, { passive: false });

// 禁止右键菜单（Tauri 桌面应用不需要浏览器右键菜单）
// 各组件需要自定义右键菜单的自行处理
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

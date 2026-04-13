import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// ============================================
// 强制页面滚动位置归零（防止 webview 记住之前的滚动偏移导致白边）
// ============================================
window.scrollTo(0, 0);
document.documentElement.scrollLeft = 0;
document.documentElement.scrollTop = 0;

// ============================================
// 阻止 Tauri webview 的默认滚动行为
// macOS 双指滑动会导致整个页面在窗口内弹性滚动
// 在 document 级别全局阻止 wheel/touchmove，无例外
// 内部可滚动容器（FileTree 等）在组件级别自行处理滚动
// ============================================
document.addEventListener('wheel', (e) => {
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  e.preventDefault();
}, { passive: false });

// 禁止右键菜单（Tauri 桌面应用不需要浏览器右键菜单）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

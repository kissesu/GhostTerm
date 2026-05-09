import React from "react";
import ReactDOM from "react-dom/client";

// Geist Sans UI 字体 — 本地 npm 依赖 + vite bundle，替代原 index.html 的 Google Fonts CDN
// 安全 finding L6：CSP 收紧到禁止 fonts.googleapis.com / fonts.gstatic.com，避免 supply chain 攻击
// 业务覆盖 300/400/500/600/700 五档字重，对应 designs 中 Geist 的全部使用范围
import "@fontsource/geist-sans/300.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";

import App from "./App";
import "./App.css";

// 禁止右键浏览器菜单（桌面应用不需要，组件自定义右键菜单各自处理）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { initSentry, SentryErrorBoundary } from "./sentry";

// GlitchTip 错误监控必须在 createRoot 之前初始化，否则首屏 error 抓不到
initSentry();

// 禁止右键浏览器菜单（桌面应用不需要，组件自定义右键菜单各自处理）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SentryErrorBoundary fallback={<div style={{ padding: 24 }}>渲染异常已上报，请刷新或联系管理员。</div>}>
      <App />
    </SentryErrorBoundary>
  </React.StrictMode>,
);

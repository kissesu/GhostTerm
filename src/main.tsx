import React from "react";
import ReactDOM from "react-dom/client";
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

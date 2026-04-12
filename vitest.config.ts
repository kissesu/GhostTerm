/**
 * @file vitest.config.ts - 前端单元测试配置
 * @description 配置 vitest + jsdom 环境，支持 React Testing Library。
 *              mock @tauri-apps/api/core 使测试可在浏览器环境运行（无需 Tauri webview）。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // 使用 jsdom 模拟浏览器 DOM 环境
    environment: 'jsdom',
    // 全局 API（describe/it/expect）不需要手动 import
    globals: true,
    // 测试前加载 setup 文件（配置 @testing-library/jest-dom matchers）
    setupFiles: ['./src/test/setup.ts'],
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});

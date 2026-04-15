/**
 * @file vitest.config.ts - 前端单元测试配置
 * @description 配置 vitest + jsdom 环境，支持 React Testing Library。
 *              mock @tauri-apps/api/core 使测试可在浏览器环境运行（无需 Tauri webview）。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// git worktree 中 .git 是文件（非目录），需显式指定 root 避免 vitest
// 向上查找 package.json 时跳出 worktree 目录解析到主仓库路径
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  test: {
    // 使用 jsdom 模拟浏览器 DOM 环境
    environment: 'jsdom',
    // 全局 API（describe/it/expect）不需要手动 import
    globals: true,
    // 测试前加载 setup 文件（配置 @testing-library/jest-dom matchers）
    // 使用绝对路径避免 git worktree 中 .git 文件导致的根目录解析偏移
    setupFiles: [fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))],
    // 排除嵌套 worktree 目录（它们有独立的测试运行环境，避免 React 双实例问题）
    // e2e-tests/ 使用 WebdriverIO + mocha 运行（需真实 Tauri webview），不在 vitest 中运行
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'GhostTerm-feat-git-worktree/**',
      'GhostTerm-feat-fs-watcher/**',
      'GhostTerm-feat-project-manager/**',
      'GhostTerm-feat-per-project-state/**',
      'ghostterm-worktrees/**',
      'e2e-tests/**',
    ],
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});

/**
 * @file test/setup.ts - 测试环境初始化
 * @description 配置 @testing-library/jest-dom 的自定义 matchers（toBeInTheDocument 等），
 *              并 mock Tauri API（测试环境无 webview，invoke 需要 mock）
 * @author Atlas.oi
 * @date 2026-04-12
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock @tauri-apps/api/core - 测试环境无 Tauri webview，invoke 需要手动 mock
// 各测试文件通过 vi.mocked(invoke).mockResolvedValue(...) 定制返回值
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event - 测试环境无 Tauri 事件系统
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));

// Mock ResizeObserver - jsdom 不支持，xterm.js FitAddon 和 Terminal.tsx 使用
// observe/disconnect 是空实现，测试不验证 resize 触发，只确保不报错
(globalThis as Record<string, unknown>).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

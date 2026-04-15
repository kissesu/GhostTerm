/**
 * @file main.test.ts
 * @description 应用入口测试 - 验证全局样式文件已在入口导入，确保根布局滚动约束生效。
 */

import { describe, it, expect } from 'vitest';
import mainSource from '../main.tsx?raw';

describe('main.tsx', () => {
  it('应导入 App.css 以应用全局根布局样式', () => {
    expect(mainSource).toMatch(/import\s+["']\.\/App\.css["'];?/);
  });
});

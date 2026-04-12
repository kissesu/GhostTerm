/**
 * @file wdio.conf.ts - WebdriverIO E2E 测试配置
 * @description 使用 tauri-webdriver (danielraffel/tauri-webdriver) 作为 WebDriver 后端，
 *              通过 tauri-plugin-webdriver-automation 控制真实 Tauri webview（WKWebView/macOS）。
 *              E2E 测试在 PBI-6 阶段编写，此处为骨架配置。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config: WebdriverIO.Config = {
  runner: 'local',
  // E2E 测试 spec 文件位置
  specs: ['./specs/**/*.test.ts'],
  // Tauri 应用是单实例，不能并行运行
  maxInstances: 1,
  capabilities: [
    {
      // tauri-webdriver 通过 W3C WebDriver 协议控制 Tauri 应用
      browserName: 'tauri',
      'tauri:options': {
        // debug 构建路径（PBI-6 时更新为实际路径）
        application: join(__dirname, '../src-tauri/target/debug/ghostterm'),
      },
    } as WebdriverIO.Capabilities,
  ],
  // WebDriver server 端口（tauri-wd 默认监听 4444）
  hostname: '127.0.0.1',
  port: 4444,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    // E2E 测试比单元测试慢，给更长超时
    timeout: 30000,
  },
};

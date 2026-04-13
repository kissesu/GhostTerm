/**
 * @file terminal/index.ts - 终端模块公开 API
 * @description 导出终端 feature 的公开接口，供其他 feature 和 layouts 使用。
 *              Terminal 组件、terminalStore 和 useTerminal hook 都从此文件导入。
 * @author Atlas.oi
 * @date 2026-04-13
 */

export { default as Terminal } from './Terminal';
export { useTerminalStore } from './terminalStore';
export { useTerminal } from './useTerminal';
export type { TerminalState } from './terminalStore';
export type { UseTerminalResult } from './useTerminal';

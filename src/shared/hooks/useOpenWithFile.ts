/**
 * @file useOpenWithFile.ts
 * @description 处理通过系统"打开方式"传入的文件路径。
 *              双平台机制不同，统一通过两条通路汇聚：
 *              1. mount 时主动拉取：应对启动时 Rust 早于 WebView 拿到路径的情形
 *                 （macOS 冷启动 / Windows CLI 参数）
 *              2. 监听 ghostterm:open-with-file 事件：应对 GhostTerm 已运行、
 *                 用户在 Finder/Explorer 再次"打开方式"的情形
 *
 *              收到路径后的行为：
 *              - 将文件所在目录作为项目根打开（openProject）
 *              - 在编辑器中打开该文件（openFile）
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useProjectStore } from '../../features/sidebar/projectStore';
import { useEditorStore } from '../../features/editor/editorStore';

/**
 * 从完整文件路径中提取父目录路径
 * 兼容 macOS（/）和 Windows（\）两种分隔符
 */
function getParentDir(filePath: string): string {
  // 统一为正斜杠后取最后一段之前的部分
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  // lastSlash <= 0 说明是根目录或无目录，直接返回原路径
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : filePath;
}

/**
 * 打开单个文件：先切换项目目录，再在编辑器中展开该文件
 * openProject 是幂等的——若已是该项目则不会重置状态
 */
async function openWithFile(filePath: string): Promise<void> {
  const parentDir = getParentDir(filePath);
  await useProjectStore.getState().openProject(parentDir);
  await useEditorStore.getState().openFile(filePath);
}

/**
 * 在 App 根组件中调用此 hook，完成"打开方式"的全生命周期监听。
 * 无需任何参数，无返回值。
 */
export function useOpenWithFile(): void {
  useEffect(() => {
    // ============================================
    // 通路 1：主动拉取启动时 Rust 暂存的文件队列
    // Rust 在 setup（Windows）或 RunEvent::Opened（macOS 冷启动）时
    // 将路径写入 PendingFiles 队列，前端 mount 后通过此命令取出并清空
    // ============================================
    invoke<string[]>('get_startup_files_cmd').then((paths) => {
      for (const path of paths) {
        openWithFile(path).catch(console.error);
      }
    });

    // ============================================
    // 通路 2：监听实时事件
    // 应用已在运行时，用户再次通过"打开方式"选择文件，
    // Rust 直接 emit 此事件，跳过队列直达前端
    // ============================================
    let unlisten: (() => void) | null = null;
    listen<string>('ghostterm:open-with-file', (event) => {
      openWithFile(event.payload).catch(console.error);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}

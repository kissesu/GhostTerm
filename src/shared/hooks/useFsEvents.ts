/**
 * @file useFsEvents.ts
 * @description 文件系统事件监听 Hook - 订阅 Rust watcher 推送的 "fs:event" Tauri 事件，
 *              将 FsEvent payload 转发给回调函数。组件卸载时自动取消订阅，防止内存泄漏。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { FsEvent } from '../types';

/**
 * 监听文件系统事件的 Hook
 *
 * 业务逻辑说明：
 * 1. 组件挂载时调用 Tauri listen("fs:event") 注册事件监听器
 * 2. 收到事件时将 payload（FsEvent 类型）转发给 onFsEvent 回调
 * 3. 组件卸载时调用 unlisten() 取消订阅，避免回调在组件销毁后继续触发
 *
 * @param onFsEvent - 收到文件系统事件时的回调函数
 */
export function useFsEvents(onFsEvent: (event: FsEvent) => void): void {
  useEffect(() => {
    // 用于清理的 unlisten 函数，初始为 null（等待 listen 完成后赋值）
    let unlisten: (() => void) | null = null;

    // 注册 Tauri 事件监听器
    // listen 是异步的，返回 Promise<UnlistenFn>
    const setupListener = async () => {
      unlisten = await listen<FsEvent>('fs:event', (tauriEvent) => {
        onFsEvent(tauriEvent.payload);
      });
    };

    setupListener();

    // 清理函数：组件卸载时取消监听
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  // onFsEvent 引用变化时重新注册（通常应由调用方用 useCallback 稳定引用）
  }, [onFsEvent]);
}

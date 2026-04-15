/**
 * @file useUpdater - 在线自动更新 Hook
 * @description 应用启动后延迟检测 GitHub Releases 最新版本；
 *              发现新版本时将 updateInfo 填入 state，由调用方决定如何呈现。
 *              用户确认后调用 applyUpdate() 流式下载并重启安装。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdaterState {
  /** 当前是否有新版本可用 */
  available: boolean;
  /** 新版本号，例如 "0.2.0" */
  version: string | null;
  /** 版本说明（release notes） */
  notes: string | null;
  /** 是否正在下载/安装 */
  installing: boolean;
  /** 安装下载进度 0-100，null 表示未开始 */
  progress: number | null;
  /** 错误信息 */
  error: string | null;
}

export interface UpdaterActions {
  /** 用户确认更新：下载并重启安装 */
  applyUpdate: () => Promise<void>;
  /** 用户忽略：关闭更新提示 */
  dismiss: () => void;
}

const INITIAL_STATE: UpdaterState = {
  available: false,
  version: null,
  notes: null,
  installing: false,
  progress: null,
  error: null,
};

// 启动后延迟检测，避免阻塞首屏渲染（单位：毫秒）
const CHECK_DELAY_MS = 3000;

export function useUpdater(): [UpdaterState, UpdaterActions] {
  const [state, setState] = useState<UpdaterState>(INITIAL_STATE);
  // 缓存 Update 对象，applyUpdate 时复用（避免重复检测网络请求）
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    // ============================================
    // 第一步：延迟检测，不影响启动性能
    // check() 返回 null 表示无更新，否则返回 Update 对象
    // ============================================
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update !== null) {
          updateRef.current = update;
          setState({
            ...INITIAL_STATE,
            available: true,
            version: update.version,
            notes: update.body ?? null,
          });
        }
      } catch (e) {
        // 检测失败静默处理（网络不可用、私有仓库未授权等属正常情况）
        console.warn('[updater] 检测更新失败:', e);
      }
    }, CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  const applyUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((s) => ({ ...s, installing: true, progress: 0, error: null }));

    // 用 ref 追踪下载进度，不触发不必要的 re-render
    // contentLength 在 Started 事件中提供，Progress 事件中仅含增量字节数
    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      // ============================================
      // 第二步：流式下载，实时更新进度
      // DownloadEvent:
      //   Started  → data.contentLength 可选（服务器可能不返回）
      //   Progress → data.chunkLength（本次接收字节数）
      //   Finished → 下载完成
      // ============================================
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          // 有 contentLength 时显示百分比；无 contentLength 时维持 progress=0（indeterminate）
          if (totalBytes > 0) {
            const pct = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
            setState((s) => ({ ...s, progress: pct }));
          }
        } else if (event.event === 'Finished') {
          setState((s) => ({ ...s, progress: 100 }));
        }
      });

      // 第三步：安装完成，重启应用使更新生效
      await relaunch();
    } catch (e) {
      setState((s) => ({
        ...s,
        installing: false,
        progress: null,
        error: String(e),
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState(INITIAL_STATE);
    updateRef.current = null;
  }, []);

  return [state, { applyUpdate, dismiss }];
}

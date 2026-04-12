/**
 * @file useTauriCommand - Tauri invoke 封装 hook
 * @description 封装 Tauri Commands 调用，提供统一的 loading/error 状态管理。
 *              测试时可通过 mock @tauri-apps/api/core 替换 invoke。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CommandState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Tauri Command 调用 hook
 *
 * 业务逻辑说明：
 * 1. 封装 invoke 调用，统一管理 loading/error 状态
 * 2. 调用失败时提取错误信息（Rust 侧 anyhow::Error 转为字符串）
 * 3. 返回 execute 函数供外部触发调用
 *
 * @param command - Tauri Command 名称（与 Rust #[tauri::command] 函数名一致）
 */
export function useTauriCommand<TResult, TArgs extends Record<string, unknown> = Record<string, never>>(
  command: string
) {
  const [state, setState] = useState<CommandState<TResult>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (args?: TArgs): Promise<TResult | null> => {
      setState(prev => ({ ...prev, loading: true, error: null }));
      try {
        const result = await invoke<TResult>(command, args);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (err) {
        // Rust anyhow::Error 通过 Tauri 传递为字符串
        const message = typeof err === 'string' ? err : String(err);
        setState({ data: null, loading: false, error: message });
        return null;
      }
    },
    [command]
  );

  return { ...state, execute };
}

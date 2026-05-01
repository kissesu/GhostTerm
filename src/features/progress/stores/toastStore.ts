/**
 * @file toastStore.ts
 * @description Toast 通知全局 store - 进度模块内部 slide-in 通知
 *              show(text, durationMs) 显示 toast，timer 到期自动 hide；
 *              防竞争：仅当 message 仍是同条时 timer hide（后续 show 不会被先前 timer 误 hide）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';

interface ToastState {
  message: string | null;
  visible: boolean;
  show: (text: string, durationMs?: number) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  message: null,
  visible: false,

  show: (text, durationMs = 2800) => {
    set({ message: text, visible: true });
    // 防竞争：仅在 message 仍是本次 text 时才 hide（后续 show 不会被先前 timer 误 hide）
    setTimeout(() => {
      if (get().message === text) set({ visible: false });
    }, durationMs);
  },

  hide: () => set({ visible: false }),
}));

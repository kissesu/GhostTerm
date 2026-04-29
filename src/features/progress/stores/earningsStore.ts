/**
 * @file earningsStore.ts
 * @description 进度模块 earnings store（Phase 9 Worker F）。
 *
 *              数据形态：单一 EarningsSummary 缓存（当前用户的）。
 *                - 登录用户即对应一份；切换用户由 store 在 logout 时 clear
 *                - refetch() 重新拉一次（PaymentDialog 提交结算成功后会调用，让 dashboard 即时刷新）
 *
 *              不做的事：
 *                - 不缓存"上一周期 vs 当前周期"对比：UI 衍生指标（如 delta）
 *                  由 EarningsView 基于 lastPaidAt 自行衍生，避免后端做日期魔法
 *                - 不预加载：业务上 dashboard 才需要，按需拉取
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import { getMyEarnings, type EarningsSummary } from '../api/earnings';
import { ProgressApiError } from '../api/client';

interface EarningsState {
  summary: EarningsSummary | null;
  loading: boolean;
  error: string | null;

  // ============ actions ============

  /** 拉取并替换 summary（首次加载 / 提交结算后） */
  refetch: () => Promise<void>;

  /** 清空（登出时调用） */
  clear: () => void;
}

export const useEarningsStore = create<EarningsState>((set) => ({
  summary: null,
  loading: false,
  error: null,

  // ----------------------------------------------------------
  // refetch
  // ----------------------------------------------------------
  async refetch() {
    set({ loading: true, error: null });
    try {
      const summary = await getMyEarnings();
      set({ summary, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // clear
  // ----------------------------------------------------------
  clear() {
    set({ summary: null, loading: false, error: null });
  },
}));

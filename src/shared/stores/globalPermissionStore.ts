/**
 * @file globalPermissionStore.ts
 * @description GhostTerm 全局权限码缓存 store。
 *
 *              数据来源（双轨）：
 *              - 旧路径：globalAuthStore.login/loadMe → user.permissions: string[]
 *                调用 hydrateFromMe()；用于进度模块历史 2 段权限码（resource:action）
 *              - 新路径（Task 9）：fetch() 调 GET /api/me/effective-permissions
 *                返回 { permissions: string[], superAdmin: boolean }，3 段权限码
 *                （resource:action:scope，如 nav:view:work）；用于 nav 级 tab 门控
 *
 *              has(code) 三档兜底：
 *              - super_admin → 直接 true（Task 9 fetch 后置位 isSuperAdmin）
 *                              或 permissions.has('*:*') 哨兵（任意来源）
 *              - 精确匹配字面量
 *              - 3 段通配："r:a:*" → "r:*:*" → "*:*"
 *              - 2 段通配（兼容历史 progress 权限）："r:*" / "*:a"
 *
 *              语义边界：
 *              - 本 store 仅持"码集合 + super_admin 标志"，不解析 scope（all/member）
 *                scope 由后端 RLS 处理
 *              - 与 progressPermissionStore 并存（Task 9 决策 #14）：
 *                progress 内部仍用旧 store；本 store 服务 nav tab 门控 + Atlas UI
 *
 *              清空时机：
 *              - 登出 → globalAuthStore.logout() 后调 clear()
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { create } from 'zustand';
import { z } from 'zod';

import type { UserPayload } from '../../features/progress/api/schemas';
import type { Permission } from '../../features/progress/api/permissions';
import {
  getBaseUrl,
  ProgressApiError,
  silentRefreshOnce,
} from '../../features/progress/api/client';
import { getAccessToken } from './globalAuthStore';

// ============================================
// 后端响应 schema（手写而非走 ogen 类型，避免 store 反向耦合）
// 该端点不走 DataEnvelope 包裹（OAS 直接定义为顶层对象）
// ============================================
const EffectivePermissionsResponseSchema = z.object({
  permissions: z.array(z.string()),
  superAdmin: z.boolean(),
});

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface GlobalPermissionState {
  /** 当前用户拥有的权限码集合（精确字面量；通配兜底由 has() 实现） */
  permissions: Set<string>;
  /** 后端 effective endpoint 返回 superAdmin=true 时置位；has() 直接放行 */
  isSuperAdmin: boolean;
  /** fetch() 进行中 */
  loading: boolean;
  /** 上次 fetch() 失败信息；nav fallback 用它判断 "已尝试但失败" */
  error: string | null;
  /** fetch() 至少完成一次（无论成功失败）；UI 用此区分 "未拉过 vs 拉过但空" */
  initialized: boolean;

  // ===== actions =====

  /**
   * 调 GET /api/me/effective-permissions 拉取最新有效权限。
   * 401 走 silentRefreshOnce 重试一次；最终失败设 error 不抛。
   */
  fetch: () => Promise<void>;
  /**
   * 从 /api/auth/me 响应回填（globalAuthStore.login/loadMe 钩子用）。
   * 兼容历史 2 段码；不写入 isSuperAdmin（来源是 me schema 而非 effective endpoint）。
   */
  hydrateFromMe: (user: Pick<UserPayload, 'permissions'>) => void;
  /** 直接传码列表覆盖（测试 / 手动场景）。不动 isSuperAdmin。 */
  hydrate: (codes: string[]) => void;
  /** 三档通配匹配；super_admin 永真 */
  has: (perm: Permission | string) => boolean;
  /** 任一码命中即返回 true */
  hasAny: (...codes: string[]) => boolean;
  /** 重置全部状态（含 isSuperAdmin / initialized） */
  reset: () => void;
  /** 仅清码集合 + isSuperAdmin（兼容旧 globalAuthStore.logout 调用） */
  clear: () => void;
}

export const useGlobalPermissionStore = create<GlobalPermissionState>((set, get) => ({
  permissions: new Set<string>(),
  isSuperAdmin: false,
  loading: false,
  error: null,
  initialized: false,

  // ----------------------------------------------------------
  // fetch: GET /api/me/effective-permissions
  // 该端点不走 DataEnvelope，故不能用 apiFetch；手写 fetch + 401 自愈
  // ----------------------------------------------------------
  async fetch() {
    set({ loading: true, error: null });

    // 内部封装：注入 Bearer + 容错读 access token（与 apiFetch 同源 store）
    const doFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      return fetch(`${getBaseUrl()}/api/me/effective-permissions`, {
        method: 'GET',
        headers,
      });
    };

    try {
      // 第一次请求 + 401 单飞 refresh + 重试一次（与 apiFetch / activities.ts 一致）
      let res = await doFetch();
      if (res.status === 401) {
        const refreshed = await silentRefreshOnce();
        if (refreshed) {
          res = await doFetch();
        }
      }

      // 解析响应体（容错非 JSON）
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        const parsed = ErrorEnvelopeSchema.safeParse(body);
        const msg = parsed.success
          ? `${parsed.data.error.code}: ${parsed.data.error.message}`
          : `HTTP ${res.status}`;
        throw new ProgressApiError(
          res.status,
          parsed.success ? parsed.data.error.code : 'unknown',
          msg,
        );
      }

      // 顶层就是 EffectivePermissionsResponse（无 data 包裹）
      const result = EffectivePermissionsResponseSchema.safeParse(body);
      if (!result.success) {
        throw new ProgressApiError(200, 'schema_drift', 'effective-permissions schema mismatch');
      }

      set({
        permissions: new Set(result.data.permissions),
        isSuperAdmin: result.data.superAdmin,
        loading: false,
        error: null,
        initialized: true,
      });
    } catch (err) {
      // 失败暴露为 error 字段；不抛（让 UI 上层重试或显示 splash）。
      // 关键：**不**设 initialized=true。
      // initialized=true 表示"已成功拉到权限快照"，AppLayout 用它判断是否可以渲染
      // NoPermissionFallback。若失败也 set true，超管/任何用户在刷新瞬间 fetch 401 +
      // silent refresh 也失败时会被误展"无任何模块访问权限"全屏页。让 initialized
      // 保持 false 表示"权限态未知"，AppLayout 上层渲染 splash 等待下次成功 fetch。
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ loading: false, error: msg });
    }
  },

  hydrateFromMe(user) {
    const codes = user.permissions ?? [];
    set({ permissions: new Set(codes) });
  },

  hydrate(codes) {
    set({ permissions: new Set(codes) });
  },

  has(perm) {
    if (!perm) return false;
    const { isSuperAdmin, permissions } = get();
    // super_admin 双重兜底：fetch 后的 flag + 历史 "*:*" 哨兵
    if (isSuperAdmin) return true;
    if (permissions.has('*:*')) return true;
    if (permissions.has(perm)) return true;

    // 解析 segments；按 colon 数判断 2 段或 3 段
    const parts = perm.split(':');
    if (parts.length === 3) {
      // 3 段：r:a:s → 兜底 r:a:* / r:*:* / *:*:*
      if (permissions.has(`${parts[0]}:${parts[1]}:*`)) return true;
      if (permissions.has(`${parts[0]}:*:*`)) return true;
      if (permissions.has('*:*:*')) return true;
      return false;
    }
    if (parts.length === 2) {
      // 2 段：r:a → 兜底 r:* / *:a（兼容旧 progress 权限）
      if (permissions.has(`${parts[0]}:*`)) return true;
      if (permissions.has(`*:${parts[1]}`)) return true;
      return false;
    }
    return false;
  },

  hasAny(...codes) {
    const has = get().has;
    return codes.some((c) => has(c));
  },

  reset() {
    set({
      permissions: new Set<string>(),
      isSuperAdmin: false,
      loading: false,
      error: null,
      initialized: false,
    });
  },

  clear() {
    // 兼容 globalAuthStore.logout()：清码集合 + 超管 flag，但保留 initialized
    // 让 AppLayout 再次进入登录态时 fetch effect 仍会触发
    set({ permissions: new Set<string>(), isSuperAdmin: false });
  },
}));

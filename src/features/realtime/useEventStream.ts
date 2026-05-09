/**
 * @file useEventStream.ts
 * @description SSE 事件订阅 hook：
 *              1. invoke('subscribe_events_cmd') 启动 Rust SSE task（带 baseUrl + accessToken）
 *              2. listen('app://event') → 路由 5 类事件到对应 store
 *              3. listen('app://need-reload') → 调 reloadVisibleData 兜底
 *              4. visibilitychange visible → 调 reloadVisibleData 兜底
 *              spec v3.5 §8
 * @author Atlas.oi
 * @date 2026-05-09
 */
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { reloadVisibleData } from './reloadVisibleData';
import { EventEnvelopeSchema, type EventEnvelope } from './types';
import { useProjectsStore } from '../progress/stores/projectsStore';
import { useFeedbacksStore } from '../progress/stores/feedbacksStore';
import { usePaymentsStore } from '../progress/stores/paymentsStore';
import { useAtlasRolesStore } from '../atlas/stores/atlasRolesStore';
import { useGlobalPermissionStore } from '../../shared/stores/globalPermissionStore';
import { useGlobalAuthStore } from '../../shared/stores/globalAuthStore';
import { useToastStore } from '../progress/stores/toastStore';
import { getBaseUrl } from '../progress/api/client';

export function useEventStream(): void {
  useEffect(() => {
    let unlistenEvent: UnlistenFn | undefined;
    let unlistenReload: UnlistenFn | undefined;
    let cancelled = false;

    void (async () => {
      const accessToken = useGlobalAuthStore.getState().accessToken;
      // 未登录时不启动 SSE：避免无效连接占用资源
      if (!accessToken) return;

      try {
        await invoke('subscribe_events_cmd', {
          baseUrl: getBaseUrl(),
          accessToken,
        });
      } catch (e) {
        // subscribe_events_cmd 失败不阻断 UI，只 warn（Rust 侧会自动重试）
        // eslint-disable-next-line no-console
        console.warn('[realtime] subscribe_events_cmd failed', e);
        return;
      }

      // cleanup 在 invoke 完成前已调（React StrictMode 卸载）→ 直接返回
      if (cancelled) return;

      // 监听来自 Rust SSE 客户端解析后的业务事件
      unlistenEvent = await listen<unknown>('app://event', (ev) => {
        const parsed = EventEnvelopeSchema.safeParse(ev.payload);
        if (!parsed.success) {
          // schema 漂移：保留 log 便于诊断，但不向 store 写入错位数据
          // eslint-disable-next-line no-console
          console.warn('[realtime] event schema drift', parsed.error);
          return;
        }
        routeEvent(parsed.data);
      });

      // 监听后端广播的全量刷新信号（后端重启 / 大批量写入场景）
      unlistenReload = await listen('app://need-reload', () => {
        void reloadVisibleData();
      });
    })();

    // visibilitychange 兜底：页面重新激活时拉最新数据
    const onVis = () => {
      if (document.visibilityState === 'visible') void reloadVisibleData();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      unlistenEvent?.();
      unlistenReload?.();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
}

/**
 * 把解析后的 EventEnvelope 路由到对应 store 的增量 patch 方法
 *
 * 路由决策：
 * - role_permissions.updated → globalPermissionStore.fetch 全量重拉（影响 PermissionGate）
 *                             + atlasRolesStore.invalidateRole（管理员自己刚改的 toast）
 * - project.created / project.updated → projectsStore.upsert
 * - feedback.created → feedbacksStore.upsertByProject
 * - payment.created  → paymentsStore.upsertByProject
 */
function routeEvent(evt: EventEnvelope): void {
  switch (evt.type) {
    case 'role_permissions.updated': {
      // effective-permissions 全量重拉（PermissionGate 全局可见性依赖最新结果）
      void useGlobalPermissionStore.getState().fetch();
      // 失效该 role 在 atlasRolesStore 的本地快照，触发重拉
      const roleId = (evt.data as { roleId?: number }).roleId;
      if (roleId !== undefined) {
        useAtlasRolesStore.getState().invalidateRole(roleId);
      }
      // 管理员自己刚改的权限回流：给本人显示 toast 确认同步
      const me = useGlobalAuthStore.getState().user;
      if (me && evt.actorUserId === me.id && roleId !== undefined) {
        useToastStore.getState().show(`角色 ${roleId} 权限已同步`);
      }
      break;
    }
    case 'project.created':
    case 'project.updated':
      // data 经 zod 校验为 unknown；store.upsert 期望 Project 类型；
      // 运行时已通过 EventEnvelopeSchema 的外层 schema 校验，断言 as never 让 TS 通过
      useProjectsStore.getState().upsert(evt.data as never);
      break;
    case 'feedback.created': {
      const projectId = (evt.data as { projectId?: number }).projectId;
      if (projectId !== undefined) {
        useFeedbacksStore.getState().upsertByProject(projectId, evt.data as never);
      }
      break;
    }
    case 'payment.created': {
      const projectId = (evt.data as { projectId?: number }).projectId;
      if (projectId !== undefined) {
        usePaymentsStore.getState().upsertByProject(projectId, evt.data as never);
      }
      break;
    }
  }
}

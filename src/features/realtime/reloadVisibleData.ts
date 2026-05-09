/**
 * @file reloadVisibleData.ts
 * @description 漏帧 / 重连 / visibilitychange / SSE 重连 兜底协调函数（spec v3.5 §8.1）
 *              按用户当前 appView + currentView + selectedProjectId 精准 reload 对应 store 子集
 *              不动 atlas 模块（admin 操作频率低；漏帧靠 SSE 直推 role_permissions.updated 事件
 *              + globalPermissionStore.fetch 自愈）
 * @author Atlas.oi
 * @date 2026-05-09
 */
import { useGlobalPermissionStore } from '../../shared/stores/globalPermissionStore';
import { useSettingsStore } from '../../shared/stores/settingsStore';
import { useProgressUiStore } from '../progress/stores/progressUiStore';
import { useProjectsStore } from '../progress/stores/projectsStore';
import { useActivitiesStore } from '../progress/stores/activitiesStore';
import { useFeedbacksStore } from '../progress/stores/feedbacksStore';
import { usePaymentsStore } from '../progress/stores/paymentsStore';
import { useFilesStore } from '../progress/stores/filesStore';
import { useEarningsStore } from '../progress/stores/earningsStore';
import { useNotificationsStore } from '../progress/stores/notificationsStore';

/**
 * 按当前可见视图精准 reload 最小 store 子集
 *
 * 调用时机：
 * 1. SSE 重连成功后（漏帧兜底）
 * 2. document visibilitychange → visible（页面重新激活）
 * 3. need-reload 帧（后端广播全量刷新信号）
 *
 * 设计决策：
 * - effective-permissions 始终 reload —— PermissionGate 全局可见性受影响
 * - view=settings 时不 reload progress 模块（用户不在该页，数据过时影响不大）
 * - Promise.allSettled 确保单个 store reload 失败不阻塞其他
 */
export async function reloadVisibleData(): Promise<void> {
  const { appView } = useSettingsStore.getState();
  const { currentView, selectedProjectId } = useProgressUiStore.getState();

  const tasks: Promise<unknown>[] = [];

  // effective-permissions 始终 reload —— PermissionGate 全局可见性受影响
  tasks.push(useGlobalPermissionStore.getState().fetch());

  if (appView === 'main') {
    // 进度模块（含看板/列表/甘特/收入/通知）— 项目列表始终需要最新状态
    tasks.push(useProjectsStore.getState().loadAll());

    // 详情面板打开时，额外 reload 当前项目及其子数据
    if (selectedProjectId !== null) {
      const id = selectedProjectId;
      tasks.push(useProjectsStore.getState().loadOne(id));
      tasks.push(useActivitiesStore.getState().loadActivities(id));
      tasks.push(useFeedbacksStore.getState().loadByProject(id));
      tasks.push(usePaymentsStore.getState().loadByProject(id));
      tasks.push(useFilesStore.getState().loadByProject(id));
    }

    // 收入页单独 reload
    if (currentView === 'earnings') {
      tasks.push(useEarningsStore.getState().load());
    }

    // 通知页单独 reload
    if (currentView === 'notifications') {
      tasks.push(useNotificationsStore.getState().load());
    }
  }

  await Promise.allSettled(tasks);
}

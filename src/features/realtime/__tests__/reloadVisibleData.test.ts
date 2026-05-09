/**
 * @file reloadVisibleData.test.ts
 * @description 验证 reloadVisibleData 按当前 view + selectedProjectId 精准 reload 对应 store 子集
 * @author Atlas.oi
 * @date 2026-05-09
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// 必须在 import reloadVisibleData 之前 mock
vi.mock('../../../shared/stores/globalPermissionStore', () => ({
  useGlobalPermissionStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/projectsStore', () => ({
  useProjectsStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/activitiesStore', () => ({
  useActivitiesStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/feedbacksStore', () => ({
  useFeedbacksStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/paymentsStore', () => ({
  usePaymentsStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/filesStore', () => ({
  useFilesStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/earningsStore', () => ({
  useEarningsStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/notificationsStore', () => ({
  useNotificationsStore: { getState: vi.fn() },
}));
vi.mock('../../progress/stores/progressUiStore', () => ({
  useProgressUiStore: { getState: vi.fn() },
}));
vi.mock('../../../shared/stores/settingsStore', () => ({
  useSettingsStore: { getState: vi.fn() },
}));

import { reloadVisibleData } from '../reloadVisibleData';
import { useGlobalPermissionStore } from '../../../shared/stores/globalPermissionStore';
import { useProjectsStore } from '../../progress/stores/projectsStore';
import { useActivitiesStore } from '../../progress/stores/activitiesStore';
import { useFeedbacksStore } from '../../progress/stores/feedbacksStore';
import { usePaymentsStore } from '../../progress/stores/paymentsStore';
import { useFilesStore } from '../../progress/stores/filesStore';
import { useEarningsStore } from '../../progress/stores/earningsStore';
import { useNotificationsStore } from '../../progress/stores/notificationsStore';
import { useProgressUiStore } from '../../progress/stores/progressUiStore';
import { useSettingsStore } from '../../../shared/stores/settingsStore';

const fetchPerms = vi.fn().mockResolvedValue(undefined);
const projectsLoadAll = vi.fn().mockResolvedValue(undefined);
const projectsLoadOne = vi.fn().mockResolvedValue(undefined);
const activitiesLoad = vi.fn().mockResolvedValue(undefined);
const feedbacksLoad = vi.fn().mockResolvedValue(undefined);
const paymentsLoad = vi.fn().mockResolvedValue(undefined);
const filesLoad = vi.fn().mockResolvedValue(undefined);
const earningsLoad = vi.fn().mockResolvedValue(undefined);
const notificationsLoad = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  (useGlobalPermissionStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ fetch: fetchPerms });
  (useProjectsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    loadAll: projectsLoadAll,
    loadOne: projectsLoadOne,
  });
  (useActivitiesStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ loadActivities: activitiesLoad });
  (useFeedbacksStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ loadByProject: feedbacksLoad });
  (usePaymentsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ loadByProject: paymentsLoad });
  (useFilesStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ loadByProject: filesLoad });
  (useEarningsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ load: earningsLoad });
  (useNotificationsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ load: notificationsLoad });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reloadVisibleData', () => {
  test('看板视图（main + kanban + 无选中）：reload projects + permission，不动详情子数据', async () => {
    (useSettingsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ appView: 'main' });
    (useProgressUiStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      currentView: 'kanban',
      selectedProjectId: null,
    });

    await reloadVisibleData();

    expect(fetchPerms).toHaveBeenCalledTimes(1);
    expect(projectsLoadAll).toHaveBeenCalledTimes(1);
    expect(projectsLoadOne).not.toHaveBeenCalled();
    expect(activitiesLoad).not.toHaveBeenCalled();
    expect(feedbacksLoad).not.toHaveBeenCalled();
    expect(paymentsLoad).not.toHaveBeenCalled();
    expect(filesLoad).not.toHaveBeenCalled();
    expect(earningsLoad).not.toHaveBeenCalled();
    expect(notificationsLoad).not.toHaveBeenCalled();
  });

  test('详情页（main + selectedProjectId=99）：reload projects + 全部 byProject 子数据', async () => {
    (useSettingsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ appView: 'main' });
    (useProgressUiStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      currentView: 'kanban',
      selectedProjectId: 99,
    });

    await reloadVisibleData();

    expect(fetchPerms).toHaveBeenCalledTimes(1);
    expect(projectsLoadAll).toHaveBeenCalledTimes(1);
    expect(projectsLoadOne).toHaveBeenCalledWith(99);
    expect(activitiesLoad).toHaveBeenCalledWith(99);
    expect(feedbacksLoad).toHaveBeenCalledWith(99);
    expect(paymentsLoad).toHaveBeenCalledWith(99);
    expect(filesLoad).toHaveBeenCalledWith(99);
  });

  test('收入页（main + earnings）：调 earningsStore', async () => {
    (useSettingsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ appView: 'main' });
    (useProgressUiStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      currentView: 'earnings',
      selectedProjectId: null,
    });

    await reloadVisibleData();

    expect(earningsLoad).toHaveBeenCalledTimes(1);
    expect(notificationsLoad).not.toHaveBeenCalled();
  });

  test('通知页（main + notifications）：调 notificationsStore', async () => {
    (useSettingsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ appView: 'main' });
    (useProgressUiStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      currentView: 'notifications',
      selectedProjectId: null,
    });

    await reloadVisibleData();

    expect(notificationsLoad).toHaveBeenCalledTimes(1);
    expect(earningsLoad).not.toHaveBeenCalled();
  });

  test('设置页（appView=settings）：仅 reload permission，不动 progress 模块 store', async () => {
    (useSettingsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ appView: 'settings' });
    (useProgressUiStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      currentView: 'kanban',
      selectedProjectId: null,
    });

    await reloadVisibleData();

    expect(fetchPerms).toHaveBeenCalledTimes(1);
    expect(projectsLoadAll).not.toHaveBeenCalled();
  });
});

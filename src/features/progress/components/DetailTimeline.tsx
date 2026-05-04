/**
 * @file DetailTimeline.tsx
 * @description 进度时间线视图 —— 从 activitiesStore 拿数据，IntersectionObserver 无限滚动
 *
 *              业务逻辑说明：
 *              1. mount 时若 store 中无对应 projectId 桶 → 调 loadActivities 拉首页
 *              2. 渲染 ActivityItem 列表（store items 已按 occurred_at DESC 排好序）
 *              3. nextCursor 非空时挂 sentinel；进入视口 → 拉下一页
 *                 （loading 中跳过，避免重复请求）
 *              4. 三态分支：loading 首屏 → skeleton；error → 重试链接；空 → 提示文案
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useActivitiesStore } from '../stores/activitiesStore';
import { useProjectsStore } from '../stores/projectsStore';
import { ActivityItem } from './ActivityItem';
import { ActivityDetailDialog } from './ActivityDetailDialog';
import type { Activity } from '../api/activities';
import styles from '../progress.module.css';

interface Props {
  projectId: number;
}

export function DetailTimeline({ projectId }: Props): ReactElement {
  const state = useActivitiesStore((s) => s.byProject.get(projectId));
  const loadActivities = useActivitiesStore((s) => s.loadActivities);
  // 项目当前状态用于判断"哪条 status_change 是当前阶段"（用户反馈"已停留"实时计时）
  const currentStatus = useProjectsStore((s) => s.projects.get(projectId)?.status);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 计算最新一条 status_change 的 id：当 toStatus === project.currentStatus 时，
  // 该条就是"项目当前所处阶段的进入记录"，需用 useNow 实时算 now-occurredAt 显示"已停留 X"
  const currentStatusEventId = useMemo(() => {
    if (!currentStatus || !state?.items) return null;
    const latest = state.items.find((a) => a.kind === 'status_change');
    if (!latest || latest.kind !== 'status_change') return null;
    return latest.payload.toStatus === currentStatus ? latest.id : null;
  }, [currentStatus, state?.items]);
  // 用户需求 2026-05-02：每条时间线点击弹 modal 显示完整详情
  const [activeDetail, setActiveDetail] = useState<Activity | null>(null);

  // 第一步：首次进入页面（无 state）→ 拉首页
  useEffect(() => {
    if (!state) {
      void loadActivities(projectId);
    }
  }, [projectId, state, loadActivities]);

  // 第二步：sentinel 监听 —— nextCursor 非空才挂；loading 时不重入
  useEffect(() => {
    if (!state?.nextCursor || !sentinelRef.current) return;
    const target = sentinelRef.current;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && state.nextCursor && !state.loading) {
          void loadActivities(projectId, state.nextCursor);
        }
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [projectId, state?.nextCursor, state?.loading, loadActivities]);

  const handleRetry = useCallback(() => {
    void loadActivities(projectId);
  }, [projectId, loadActivities]);

  // 首屏 loading：state 不存在或正在拉且无内容
  if (!state || (state.loading && state.items.length === 0)) {
    return (
      <div className={styles.timelineSkeleton}>
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className={styles.timelineError}>
        动态加载失败，
        <button type="button" onClick={handleRetry} className={styles.linkButton}>
          点击重试
        </button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return <p className={styles.timelineEmpty}>当前项目暂无进度动态</p>;
  }

  return (
    <div className={styles.timelineList}>
      {state.items.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => setActiveDetail(a)}
          aria-label="查看详情"
          // 重置 native button 默认样式，让外层 button 视觉与原 div 一致 + 整行 hover 可点击
          style={{
            all: 'unset',
            display: 'block',
            width: '100%',
            cursor: 'pointer',
          }}
          data-testid={`timeline-item-${a.id}`}
        >
          <ActivityItem activity={a} isCurrentStatus={a.id === currentStatusEventId} />
        </button>
      ))}
      {state.nextCursor ? <div ref={sentinelRef} className={styles.timelineSentinel} /> : null}
      {activeDetail && (
        <ActivityDetailDialog
          activity={activeDetail}
          onClose={() => setActiveDetail(null)}
          isCurrentStatus={activeDetail.id === currentStatusEventId}
        />
      )}
    </div>
  );
}

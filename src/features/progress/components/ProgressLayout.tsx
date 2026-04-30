/**
 * @file ProgressLayout.tsx
 * @description 进度模块顶层布局：toolbar（segmented 视图切换 + filters + 搜索 + 新建项目）+ summary + 主内容 slot。
 *
 *              业务背景（设计稿 1:1 复刻）：
 *              - 顶部 toolbar 50px，grid 4 列：segmented | filters | spacer | rightActions
 *              - segmented 三选一：看板 / 列表 / Gantt（active 用 accent 反色）
 *              - filters：3 个下拉（所有项目 / 所有论文级别 / 所有学科）—— 当前 v1 仅状态过滤接入
 *              - rightActions：刷新图标 / 字段筛选图标 / 搜索框 / 主按钮
 *              - 详情页打开时（selectedProjectId !== null）隐藏 toolbar + summary，让详情独占视觉
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import {
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useProgressUiStore, type StatusFilter, type ProgressView } from '../stores/progressUiStore';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { ProgressSummary } from './ProgressSummary';
import styles from '../progress.module.css';

interface ProgressLayoutProps {
  children: ReactNode;
}

/**
 * 状态过滤下拉项：与 spec §6.1 status 枚举一一对应；中文标签便于扫读。
 *
 * 业务背景：把 9 个状态都列出来，避免 UI 里 if-else 硬编码；新增状态时只改这里。
 * "全部" 标签按设计稿改为 "所有项目"。
 */
const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '所有项目' },
  { value: 'dealing', label: '洽谈中' },
  { value: 'quoting', label: '报价中' },
  { value: 'developing', label: '开发中' },
  { value: 'confirming', label: '待验收' },
  { value: 'delivered', label: '已交付' },
  { value: 'paid', label: '已收款' },
  { value: 'archived', label: '已归档' },
  { value: 'after_sales', label: '售后中' },
  { value: 'cancelled', label: '已取消' },
];

interface SegmentedItem {
  value: ProgressView;
  label: string;
}

/** segmented 视图切换 3 选项（设计稿：看板 / 列表 / Gantt） */
const SEGMENTED_ITEMS: ReadonlyArray<SegmentedItem> = [
  { value: 'kanban', label: '看板' },
  { value: 'list', label: '列表' },
  { value: 'gantt', label: 'Gantt' },
];

export function ProgressLayout({ children }: ProgressLayoutProps): ReactElement {
  const currentView = useProgressUiStore((s) => s.currentView);
  const setCurrentView = useProgressUiStore((s) => s.setCurrentView);
  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const setSearchQuery = useProgressUiStore((s) => s.setSearchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);
  const setStatusFilter = useProgressUiStore((s) => s.setStatusFilter);
  const selectedProjectId = useProgressUiStore((s) => s.selectedProjectId);

  // 新建项目对话框开关：本地 state（仅 toolbar 内部使用）
  const [createOpen, setCreateOpen] = useState(false);

  const isDetail = selectedProjectId !== null;

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleStatusChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value as StatusFilter);
  };

  return (
    <>
      {/* ============================================
          顶部 toolbar（设计稿 §toolbar）
          详情页时隐藏（避免误操作 + 让详情有更多空间）
          ============================================ */}
      {!isDetail && (
        <header
          data-testid="progress-toolbar"
          className={styles.toolbar}
          aria-label="进度模块工具栏"
        >
          {/* 1. 视图切换 segmented */}
          <div
            className={styles.segmented}
            data-testid="progress-view-switcher"
            role="tablist"
            aria-label="视图切换"
          >
            {SEGMENTED_ITEMS.map((item) => {
              const active = currentView === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-active={active ? 'true' : 'false'}
                  data-testid={`progress-view-${item.value}`}
                  onClick={() => setCurrentView(item.value)}
                  className={active ? styles.active : ''}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* 2. filters：3 个下拉（v1 仅状态过滤接入；论文级别 / 学科占位） */}
          <div className={styles.filters}>
            <span className={styles.filterWrap}>
              <select
                value={statusFilter}
                onChange={handleStatusChange}
                data-testid="progress-status-filter"
                className={`${styles.filter} ${styles.filterSelect}`}
                aria-label="项目状态过滤"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className={styles.filterArrow} aria-hidden="true">⌄</span>
            </span>
            {/* 占位：论文级别 / 学科 —— TODO: 等后端字段加入项目模型后接入 */}
            <span className={styles.filterWrap}>
              <button type="button" className={styles.filter} disabled>
                所有论文级别 <span aria-hidden="true">⌄</span>
              </button>
            </span>
            <span className={styles.filterWrap}>
              <button type="button" className={styles.filter} disabled>
                所有学科 <span aria-hidden="true">⌄</span>
              </button>
            </span>
          </div>

          {/* 3. spacer */}
          <div />

          {/* 4. rightActions：刷新 / 筛选 / 搜索 / 主按钮 */}
          <div className={styles.rightActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="刷新进度"
              data-testid="progress-refresh"
              onClick={() => {
                // 刷新走 store load；store 内部去重，重复点击安全
                void import('../stores/projectsStore').then(({ useProjectsStore }) => {
                  void useProjectsStore.getState().load().catch(() => {});
                });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                <path d="M20 4v6h-6" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="筛选字段"
              disabled
              title="筛选字段（待开发）"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16" />
                <path d="M7 12h10" />
                <path d="M10 18h4" />
              </svg>
            </button>
            <label className={styles.search} aria-label="搜索">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="搜索项目 / 客户 / 反馈"
                data-testid="progress-search-input"
              />
            </label>
            <button
              type="button"
              className={styles.primary}
              data-testid="progress-new-project"
              onClick={() => setCreateOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              新建项目
            </button>
          </div>
        </header>
      )}

      {/* ============================================
          顶部 6 卡 summary（设计稿 §summary）；详情页隐藏
          ============================================ */}
      {!isDetail && <ProgressSummary />}

      {/* ============================================
          主内容区：list / kanban / gantt / detail 由调用方决定
          ============================================ */}
      <main
        data-testid="progress-content"
        className={isDetail ? styles.detailWrap : styles.viewStack}
      >
        {children}
      </main>

      {/* 新建项目对话框：受控在 layout 顶层渲染避免被列表/详情切换销毁 */}
      <ProjectCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setCreateOpen(false)}
      />
    </>
  );
}

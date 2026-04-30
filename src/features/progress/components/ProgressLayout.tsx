/**
 * @file ProgressLayout.tsx
 * @description 进度模块顶层布局：toolbar（搜索 / 状态过滤 / 视图切换）+ 主内容 slot。
 *
 *              业务背景（spec §10.1）：
 *              - 顶部 toolbar 是固定栏，主内容根据 currentView / selectedProjectId 切换
 *              - 详情页打开时（selectedProjectId !== null）隐藏视图切换按钮
 *                避免在详情态切到看板/列表的歧义；用户应先返回列表再切换
 *
 *              交互细节：
 *              - 搜索框：受控；每次输入即更新 store.searchQuery，由列表/看板自行 filter
 *              - 状态过滤：select 下拉；spec §6.1 9 个状态 + "全部"
 *              - 视图切换：两个 icon button，激活态用 --c-accent 反色边框
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type ReactElement, type ReactNode, type ChangeEvent } from 'react';
import { List, Columns3, Search, Plus } from 'lucide-react';

import { useProgressUiStore, type StatusFilter } from '../stores/progressUiStore';
import { ProjectCreateDialog } from './ProjectCreateDialog';

interface ProgressLayoutProps {
  children: ReactNode;
}

/**
 * 状态过滤下拉项：与 spec §6.1 status 枚举一一对应；中文标签便于扫读。
 *
 * 业务背景：把 9 个状态都列出来，避免 UI 里 if-else 硬编码；新增状态时只改这里。
 */
const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
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

export function ProgressLayout({ children }: ProgressLayoutProps): ReactElement {
  const currentView = useProgressUiStore((s) => s.currentView);
  const setCurrentView = useProgressUiStore((s) => s.setCurrentView);
  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const setSearchQuery = useProgressUiStore((s) => s.setSearchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);
  const setStatusFilter = useProgressUiStore((s) => s.setStatusFilter);
  const selectedProjectId = useProgressUiStore((s) => s.selectedProjectId);

  // 新建项目对话框开关：本地 state（仅 toolbar 内部使用）
  // 用户需求修正 2026-04-30：客户从独立资源降级为 customerLabel 字段，"新建客户"按钮已删除
  const [createOpen, setCreateOpen] = useState(false);

  const isDetail = selectedProjectId !== null;

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleStatusChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value as StatusFilter);
  };

  return (
    <div
      data-testid="progress-layout"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-bg)',
        color: 'var(--c-fg)',
        minHeight: 0,
      }}
    >
      {/* ============================================
          顶部 toolbar：搜索 + 状态过滤 + 视图切换
          详情页时隐藏视图切换按钮（避免误操作）
          ============================================ */}
      {!isDetail && (
        <header
          data-testid="progress-toolbar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-panel)',
          }}
        >
          {/* 搜索框 */}
          <div
            style={{
              position: 'relative',
              flex: 1,
              maxWidth: 320,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Search
              size={14}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 8,
                color: 'var(--c-fg-muted)',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="搜索项目名 / 客户"
              data-testid="progress-search-input"
              style={{
                width: '100%',
                padding: '6px 8px 6px 28px',
                borderRadius: 6,
                border: '1px solid var(--c-border)',
                background: 'var(--c-bg)',
                color: 'var(--c-fg)',
                fontSize: 13,
              }}
            />
          </div>

          {/* 状态过滤 */}
          <select
            value={statusFilter}
            onChange={handleStatusChange}
            data-testid="progress-status-filter"
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--c-border)',
              background: 'var(--c-bg)',
              color: 'var(--c-fg)',
              fontSize: 13,
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div style={{ flex: 1 }} />

          {/* 新建项目按钮 — 后端按 RBAC project:write 校验，前端不 gate */}
          <button
            type="button"
            data-testid="progress-new-project"
            onClick={() => setCreateOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--c-accent)',
              background: 'var(--c-accent)',
              color: 'var(--c-on-accent, var(--c-bg))',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Plus size={14} aria-hidden="true" />
            新建项目
          </button>

          {/* 视图切换：两个图标按钮 */}
          <div
            data-testid="progress-view-switcher"
            role="tablist"
            aria-label="视图切换"
            style={{
              display: 'inline-flex',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <ViewSwitchButton
              active={currentView === 'list'}
              onClick={() => setCurrentView('list')}
              testid="progress-view-list"
              label="列表视图"
            >
              <List size={14} aria-hidden="true" />
            </ViewSwitchButton>
            <ViewSwitchButton
              active={currentView === 'kanban'}
              onClick={() => setCurrentView('kanban')}
              testid="progress-view-kanban"
              label="看板视图"
            >
              <Columns3 size={14} aria-hidden="true" />
            </ViewSwitchButton>
          </div>
        </header>
      )}

      {/* ============================================
          主内容区：list / kanban / detail 由调用方决定
          ============================================ */}
      <main
        data-testid="progress-content"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {children}
      </main>

      {/* 新建项目对话框：受控在 layout 顶层渲染避免被列表/详情切换销毁 */}
      <ProjectCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setCreateOpen(false)}
      />
    </div>
  );
}

interface ViewSwitchButtonProps {
  active: boolean;
  onClick: () => void;
  testid: string;
  label: string;
  children: ReactNode;
}

/**
 * 视图切换按钮：扁平风（spec §10 视觉要求）；激活态用 accent 反色 + 边框。
 *
 * 拆为子组件让按钮 a11y 属性（role=tab / aria-selected）保持一致；
 * 同时压缩两个按钮的 inline 样式重复。
 */
function ViewSwitchButton({
  active,
  onClick,
  testid,
  label,
  children,
}: ViewSwitchButtonProps): ReactElement {
  // active 用 --c-accent 反色（fg / 背景）；非 active 透明背景
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      data-active={active ? 'true' : 'false'}
      data-testid={testid}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 10px',
        border: 'none',
        background: active ? 'var(--c-accent)' : 'transparent',
        color: active ? 'var(--c-on-accent, var(--c-bg))' : 'var(--c-fg-muted)',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

/**
 * @file UpdateBanner - 更新提示横幅组件
 * @description 当检测到新版本时，在窗口底部显示一条横幅，
 *              提供"立即更新"和"稍后"两个操作。
 *              进度条样式跟随 Obsidian Forge 设计令牌（OKLCH 黄铜 accent）。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import type { UpdaterState, UpdaterActions } from './useUpdater';

interface UpdateBannerProps {
  state: UpdaterState;
  actions: UpdaterActions;
}

export default function UpdateBanner({ state, actions }: UpdateBannerProps) {
  if (!state.available) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        // 使用设计令牌：深色背景 + 黄铜 accent 边框
        background: 'var(--c-panel)',
        borderTop: '1px solid var(--c-accent)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '13px',
        color: 'var(--c-fg)',
      }}
    >
      {/* 版本信息文字 */}
      <span style={{ flex: 1 }}>
        GhostTerm {state.version} 已发布
        {state.notes && (
          <span style={{ marginLeft: '6px', opacity: 0.6, fontSize: '12px' }}>
            {state.notes.length > 60 ? `${state.notes.slice(0, 60)}...` : state.notes}
          </span>
        )}
      </span>

      {/* 下载进度条（仅安装中显示） */}
      {state.installing && (
        <div
          style={{
            width: '120px',
            height: '4px',
            background: 'var(--c-raised)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: state.progress !== null ? `${state.progress}%` : '0%',
              background: 'var(--c-accent)',
              borderRadius: '2px',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      )}

      {/* 错误提示 */}
      {state.error && (
        <span style={{ color: 'var(--c-danger)', fontSize: '12px' }}>{state.error}</span>
      )}

      {/* 操作按钮 */}
      <button
        disabled={state.installing}
        onClick={() => void actions.applyUpdate()}
        style={{
          padding: '4px 12px',
          borderRadius: '4px',
          border: '1px solid var(--c-accent)',
          background: state.installing ? 'transparent' : 'var(--c-accent)',
          color: state.installing ? 'var(--c-accent)' : 'var(--c-accent-text)',
          cursor: state.installing ? 'not-allowed' : 'pointer',
          fontSize: '12px',
          opacity: state.installing ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {state.installing
          ? state.progress !== null
            ? `${state.progress}%`
            : '安装中...'
          : '立即更新'}
      </button>

      {!state.installing && (
        <button
          onClick={actions.dismiss}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--c-fg-muted)',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          稍后
        </button>
      )}
    </div>
  );
}

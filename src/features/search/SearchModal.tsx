/**
 * @file SearchModal.tsx - 项目内全文搜索弹窗
 * @description 居中弹窗，提供文件内容搜索和文件名搜索两种模式
 *              通过 searchStore 统一管理状态，遵循 Obsidian Forge 设计系统
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { useEffect, type ReactNode } from 'react';
import { useSearchStore } from './searchStore';
import SearchResults from './SearchResults';
import SearchPreview from './SearchPreview';

// ============================================================
// 内部辅助组件：搜索选项切换按钮（大小写/全词/正则）
// ============================================================
function OptionToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: '2px 6px',
        borderRadius: 4,
        border: '1px solid',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'monospace',
        borderColor: active ? 'var(--c-accent)' : 'var(--c-border)',
        background: active ? 'var(--c-accent-dim)' : 'transparent',
        color: active ? 'var(--c-accent)' : 'var(--c-fg-subtle)',
      }}
    >
      {children}
    </button>
  );
}

// ============================================================
// 内部辅助组件：Tab 切换按钮（内容 / 文件名）
// ============================================================
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 12,
        color: active ? 'var(--c-accent)' : 'var(--c-fg-subtle)',
        // 激活 tab 用底部边框指示，未激活透明占位保持高度一致
        borderBottom: active ? '2px solid var(--c-accent)' : '2px solid transparent',
      }}
    >
      {children}
    </button>
  );
}

// ============================================================
// 主组件：SearchModal
// ============================================================
export default function SearchModal() {
  const isOpen = useSearchStore((s) => s.isOpen);
  const query = useSearchStore((s) => s.query);
  const activeTab = useSearchStore((s) => s.activeTab);
  const options = useSearchStore((s) => s.options);
  const fileGlob = useSearchStore((s) => s.fileGlob);
  const close = useSearchStore((s) => s.close);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setTab = useSearchStore((s) => s.setTab);
  const setOptions = useSearchStore((s) => s.setOptions);
  const setFileGlob = useSearchStore((s) => s.setFileGlob);

  // 弹窗打开时绑定全局键盘事件：Esc 关闭、↑↓ 导航、Enter 确认
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        useSearchStore.getState().navigate('down');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        useSearchStore.getState().navigate('up');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        useSearchStore.getState().confirmSelection();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // 弹窗关闭时不渲染任何 DOM
  if (!isOpen) return null;

  return (
    // 遮罩层：点击关闭弹窗
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 弹窗容器：stopPropagation 防止点击内部关闭遮罩 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680,
          maxHeight: '70vh',
          background: 'var(--c-surface-2)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* ================================================
            搜索框行：放大镜图标 + 输入框 + 选项 toggle
            ================================================ */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--c-border)',
          }}
        >
          <i
            className="fa-solid fa-magnifying-glass"
            style={{ color: 'var(--c-fg-subtle)', fontSize: 14 }}
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="在文件中搜索..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--c-fg)',
              fontSize: 14,
              fontFamily: 'var(--font-ui)',
            }}
          />
          {/* 大小写敏感 toggle */}
          <OptionToggle
            active={options.caseSensitive}
            onClick={() => setOptions({ caseSensitive: !options.caseSensitive })}
            title="大小写敏感"
          >
            Aa
          </OptionToggle>
          {/* 全词匹配 toggle */}
          <OptionToggle
            active={options.wholeWord}
            onClick={() => setOptions({ wholeWord: !options.wholeWord })}
            title="全词匹配"
          >
            ab
          </OptionToggle>
          {/* 正则表达式 toggle */}
          <OptionToggle
            active={options.useRegex}
            onClick={() => setOptions({ useRegex: !options.useRegex })}
            title="使用正则"
          >
            .*
          </OptionToggle>
        </div>

        {/* ================================================
            Tab 行：内容搜索 / 文件名搜索切换
            ================================================ */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--c-border)',
            padding: '0 14px',
          }}
        >
          <TabButton active={activeTab === 'content'} onClick={() => setTab('content')}>
            内容 F
          </TabButton>
          <TabButton active={activeTab === 'filename'} onClick={() => setTab('filename')}>
            文件名 P
          </TabButton>
        </div>

        {/* ================================================
            结果列表区：按文件分组，支持关键词高亮
            ================================================ */}
        <SearchResults />

        {/* ================================================
            预览区：显示选中条目的上下文匹配行
            ================================================ */}
        <SearchPreview />

        {/* ================================================
            底部 Footer：快捷键提示 + 文件过滤输入框
            ================================================ */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            borderTop: '1px solid var(--c-border)',
            fontSize: 11,
            color: 'var(--c-fg-muted)',
          }}
        >
          <span>&#8593;&#8595; 导航 &nbsp; &#8629; 打开 &nbsp; Esc 关闭</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>文件过滤:</span>
            <input
              value={fileGlob}
              onChange={(e) => setFileGlob(e.target.value)}
              placeholder="*.ts"
              style={{
                width: 80,
                padding: '2px 6px',
                background: 'var(--c-input)',
                border: '1px solid var(--c-border)',
                borderRadius: 4,
                color: 'var(--c-fg)',
                fontSize: 11,
                outline: 'none',
                fontFamily: 'var(--font-ui)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

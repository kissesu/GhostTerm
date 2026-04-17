/**
 * @file ConflictDialog.tsx
 * @description 文件冲突对话框 - 当磁盘文件被外部修改且编辑器中有未保存改动时弹出，
 *              提示用户三种处理方案：保留本地修改、加载磁盘新版本、查看 diff（PBI-5 实现）。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import React from 'react';

/** ConflictDialog 属性 */
interface ConflictDialogProps {
  /** 发生冲突的文件路径，展示给用户 */
  path: string;
  /** 保留本地修改：忽略外部变更，清除 hasConflict */
  onKeep: () => void;
  /** 加载新版本：用磁盘最新内容替换当前编辑内容，清除 hasConflict */
  onLoad: () => void;
  /** 查看 diff：当前为 stub，PBI-5 实现 diff 视图，点击后关闭对话框 */
  onDiff: () => void;
}

/**
 * 文件冲突对话框组件
 *
 * 业务逻辑：
 * 1. 显示文件名和冲突说明
 * 2. 三个操作按钮分别触发对应回调
 * 3. 不持有自身关闭状态（由父组件通过 hasConflict 控制显示/隐藏）
 */
export default function ConflictDialog({
  path,
  onKeep,
  onLoad,
  onDiff,
}: ConflictDialogProps): React.ReactElement {
  // 从完整路径提取文件名，用于展示
  const fileName = path.split('/').pop() ?? path;

  return (
    // 遮罩层：半透明背景 + 居中对话框
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--c-overlay-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* 对话框容器 */}
      <div
        style={{
          backgroundColor: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: '8px',
          padding: '24px',
          minWidth: '360px',
          maxWidth: '480px',
          color: 'var(--c-fg)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* 标题 */}
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: '16px',
            fontWeight: 600,
            color: 'var(--c-danger)',
          }}
        >
          文件冲突
        </h3>

        {/* 说明文本 */}
        <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--c-fg-muted)' }}>
          文件 <strong style={{ color: 'var(--c-accent)' }}>{fileName}</strong> 已被外部程序修改，
          但你有未保存的本地修改。
        </p>
        <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: 'var(--c-fg-subtle)' }}>
          路径：{path}
        </p>

        {/* 操作按钮区 */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
          }}
        >
          {/* 保留修改按钮 */}
          <button
            onClick={onKeep}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--c-raised)',
              color: 'var(--c-fg)',
              border: '1px solid var(--c-border)',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            保留修改
          </button>

          {/* 查看 diff 按钮（PBI-5 stub） */}
          <button
            onClick={onDiff}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--c-raised)',
              color: 'var(--c-accent)',
              border: '1px solid var(--c-accent)',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            查看 diff
          </button>

          {/* 加载新版本按钮（主要操作，突出显示） */}
          <button
            onClick={onLoad}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--c-accent)',
              color: 'var(--c-accent-text)',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            加载新版本
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @file TemplateManager.tsx
 * @description 模板管理 modal。列表形式展示所有模板；
 *   支持编辑 / 导出（占位）/ 删除 / 内置恢复默认操作；
 *   底部提供新建 / 从 docx / 导入 三个入口（Task 10 接入前占位）。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useState } from 'react';
import { useTemplateStore } from './TemplateStore';
import type { TemplateJson } from './TemplateStore';
import { TemplateEditor } from './TemplateEditor';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// 内置模板 ID，仅此模板显示"恢复默认"按钮
const BUILTIN_ID = '_builtin-gbt7714';

// source type 中文标签
const SOURCE_LABELS: Record<string, string> = {
  builtin:   '内置',
  manual:    '手动创建',
  extracted: '从 docx 提取',
};

export function TemplateManager({ isOpen, onClose }: Props) {
  const { templates, remove, restoreBuiltin, update } = useTemplateStore();
  // null = 列表视图；非 null = 编辑视图
  const [editing, setEditing] = useState<TemplateJson | null>(null);

  if (!isOpen) return null;

  // ============================================
  // 删除模板：confirm 后调 store.remove
  // ============================================
  const handleRemove = (t: TemplateJson) => {
    if (!window.confirm(`确认删除模板"${t.name}"？此操作不可撤销。`)) return;
    remove(t.id).catch((err: unknown) => {
      console.error('[TemplateManager] remove failed', err);
      alert(`删除失败：${String(err)}`);
    });
  };

  // ============================================
  // 恢复内置模板：confirm 后调 store.restoreBuiltin
  // ============================================
  const handleRestoreBuiltin = () => {
    if (!window.confirm('确认将内置模板恢复为默认值？所有对内置模板的修改将丢失。')) return;
    restoreBuiltin().catch((err: unknown) => {
      console.error('[TemplateManager] restoreBuiltin failed', err);
      alert(`恢复失败：${String(err)}`);
    });
  };

  // ============================================
  // 保存编辑：调 store.update → reload，回到列表
  // ============================================
  const handleSave = async (updated: TemplateJson) => {
    await update(updated.id, { rules: updated.rules });
    setEditing(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="template-manager"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--c-overlay-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          width: 680,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── 标题栏 ─────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid var(--c-border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-fg)', fontFamily: 'var(--font-ui)' }}>
            模板管理
          </span>
          <button
            data-testid="manager-close-btn"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--c-fg-muted)',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            x
          </button>
        </div>

        {/* ─── 内容区：列表 或 编辑器 ──── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {editing ? (
            // 编辑视图：覆盖列表区域
            <TemplateEditor
              template={editing}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          ) : (
            // 列表视图
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <table
                data-testid="template-list-table"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  fontFamily: 'var(--font-ui)',
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--c-raised)', borderBottom: '1px solid var(--c-border)' }}>
                    <th style={{ textAlign: 'left', padding: '7px 20px', fontWeight: 500, color: 'var(--c-fg-muted)' }}>模板名称</th>
                    <th style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 500, color: 'var(--c-fg-muted)', width: 110 }}>类型</th>
                    <th style={{ textAlign: 'right', padding: '7px 20px', fontWeight: 500, color: 'var(--c-fg-muted)', width: 200 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t, idx) => (
                    <tr
                      key={t.id}
                      data-testid={`template-row-${t.id}`}
                      style={{
                        borderBottom: '1px solid var(--c-border)',
                        background: idx % 2 === 0 ? 'transparent' : 'var(--c-raised)',
                      }}
                    >
                      {/* 模板名 */}
                      <td style={{ padding: '9px 20px', color: 'var(--c-fg)', verticalAlign: 'middle' }}>
                        {t.name}
                      </td>

                      {/* source type 标签 */}
                      <td style={{ padding: '9px 12px', color: 'var(--c-fg-muted)', verticalAlign: 'middle' }}>
                        {SOURCE_LABELS[t.source.type] ?? t.source.type}
                      </td>

                      {/* 操作按钮组 */}
                      <td style={{ padding: '9px 20px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          {/* 编辑 */}
                          <button
                            data-testid={`edit-btn-${t.id}`}
                            onClick={() => setEditing(t)}
                            style={btnStyle}
                          >
                            编辑
                          </button>

                          {/* 导出（Task 10 前占位） */}
                          <button
                            data-testid={`export-btn-${t.id}`}
                            onClick={() => alert('导出功能 Task 10 接入')}
                            style={btnStyle}
                          >
                            导出
                          </button>

                          {/* 恢复默认（仅内置模板） */}
                          {t.id === BUILTIN_ID && (
                            <button
                              data-testid={`restore-btn-${t.id}`}
                              onClick={handleRestoreBuiltin}
                              style={btnStyle}
                            >
                              恢复默认
                            </button>
                          )}

                          {/* 删除（内置模板不允许删除） */}
                          {t.id !== BUILTIN_ID && (
                            <button
                              data-testid={`delete-btn-${t.id}`}
                              onClick={() => handleRemove(t)}
                              style={{ ...btnStyle, color: 'var(--c-danger)' }}
                            >
                              删除
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {templates.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: 'var(--c-fg-muted)', fontSize: 13 }}>
                        暂无模板
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── 底部操作栏（列表视图才显示） ─ */}
        {!editing && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '12px 20px',
              borderTop: '1px solid var(--c-border)',
              flexShrink: 0,
            }}
          >
            {/* 新建模板（Task 10 前占位） */}
            <button
              data-testid="create-template-btn"
              onClick={() => alert('新建模板 Task 10 接入')}
              style={actionBtnStyle}
            >
              新建模板
            </button>

            {/* 从 docx 创建（Task 10 前占位） */}
            <button
              data-testid="create-from-docx-btn"
              onClick={() => alert('从 docx 创建 Task 10 接入')}
              style={actionBtnStyle}
            >
              从 docx 创建
            </button>

            {/* 导入 JSON（Task 10 前占位） */}
            <button
              data-testid="import-json-btn"
              onClick={() => alert('导入 JSON Task 10 接入')}
              style={actionBtnStyle}
            >
              导入 JSON
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 行内样式常量（避免每次渲染创建新对象） ─────────────

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--c-raised)',
  color: 'var(--c-fg)',
  border: '1px solid var(--c-border)',
  borderRadius: 'var(--r-sm)',
  fontSize: 12,
  fontFamily: 'var(--font-ui)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  background: 'var(--c-raised)',
  color: 'var(--c-fg)',
  border: '1px solid var(--c-border)',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontFamily: 'var(--font-ui)',
  cursor: 'pointer',
};

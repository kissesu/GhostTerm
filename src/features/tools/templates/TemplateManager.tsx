/**
 * @file TemplateManager.tsx
 * @description 模板管理 modal。列表形式展示所有模板；
 *   支持编辑 / 导出 / 删除 / 内置恢复默认操作；
 *   底部提供新建 / 从 docx / 导入 JSON 三个入口。
 *   「从 docx 创建」通过 P4 RuleTemplateWorkspace 完整 extract + 逐字段确认流程。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useTemplateStore } from './TemplateStore';
import type { TemplateJson } from './TemplateStore';
import { TemplateEditor } from './TemplateEditor';
import { RuleTemplateWorkspace } from './RuleTemplateWorkspace';
import { NamePromptModal } from './NamePromptModal';

// 从文件路径中提取文件名（兼容 macOS / Windows 路径分隔符）
function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? 'template';
}

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

// namePrompt state 类型：null 表示关闭，非 null 记录当前触发模式
type NamePromptState =
  | { mode: 'blank' }
  | { mode: 'fromDocx'; docxPath: string; defaultName: string };

export function TemplateManager({ isOpen, onClose }: Props) {
  const { templates, remove, restoreBuiltin, update, create, load } = useTemplateStore();
  // null = 列表视图；非 null = 编辑视图
  const [editing, setEditing] = useState<TemplateJson | null>(null);
  // 非 null = RuleTemplateWorkspace 全屏打开状态（含 docxPath + 预填名称）
  const [workspaceOpen, setWorkspaceOpen] = useState<{ docxPath: string; name: string } | null>(null);
  // 非 null = NamePromptModal 打开状态
  const [namePrompt, setNamePrompt] = useState<NamePromptState | null>(null);

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
  // 失败时弹 alert 暴露错误，editing 保持不变让用户重试
  // ============================================
  const handleSave = async (updated: TemplateJson) => {
    try {
      await update(updated.id, { rules: updated.rules });
      setEditing(null);
    } catch (e) {
      console.error('[TemplateManager] save failed', e);
      alert(`保存失败：${String(e)}`);
    }
  };

  // ============================================
  // 新建空白模板：打开 NamePromptModal 输入名称 → store.create 深拷贝内置
  // Tauri 2 WebView 禁用 window.prompt()，调用恒返回 null，改用自定义 modal
  // ============================================
  const handleNewBlank = () => {
    setNamePrompt({ mode: 'blank' });
  };

  // ============================================
  // 从 docx 创建模板：
  //   1. 选 docx 文件
  //   2. 打开 NamePromptModal 输入名称（预填去扩展名的文件名）
  //   3. NamePromptModal 确认后打开 RuleTemplateWorkspace 全屏工作台
  // ============================================
  const handleNewFromDocx = async () => {
    const docx = await open({
      multiple: false,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (typeof docx !== 'string') return;
    setNamePrompt({
      mode: 'fromDocx',
      docxPath: docx,
      defaultName: basename(docx).replace(/\.docx$/i, ''),
    });
  };

  // ============================================
  // NamePromptModal 确认回调：按 mode 分支执行
  // ============================================
  const handleNamePromptSubmit = async (name: string) => {
    if (!namePrompt) return;
    if (namePrompt.mode === 'blank') {
      // 先关闭 modal，再异步 create（避免 modal 遮挡后续 alert）
      setNamePrompt(null);
      try {
        await create(name);
      } catch (e) {
        console.error('[TemplateManager] create failed', e);
        alert(`新建失败：${String(e)}`);
      }
    } else {
      // fromDocx：打开 RuleTemplateWorkspace 全屏工作台
      setWorkspaceOpen({ docxPath: namePrompt.docxPath, name });
      setNamePrompt(null);
    }
  };

  // ============================================
  // 导入 JSON 模板：文件选择器 → Rust template_import_cmd → reload
  // ============================================
  const handleImport = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (typeof picked !== 'string') return;
    try {
      // Rust 函数参数名 json_path → JS camelCase jsonPath
      await invoke('template_import_cmd', { jsonPath: picked });
      await load();
    } catch (e) {
      console.error('[TemplateManager] import failed', e);
      // 提供用户友好提示，说明必填字段（id / name / rules）
      alert(
        `导入失败：${String(e)}\n\n` +
        `请检查 JSON 文件格式——必须包含 id、name、rules 三个字段。\n` +
        `schema_version / source / updated_at 字段可省略，会自动补全。`
      );
    }
  };

  // ============================================
  // 导出单条模板：文件保存对话框 → Rust template_export_cmd
  // ============================================
  const handleExport = async (template: TemplateJson) => {
    const dest = await save({
      defaultPath: `${template.name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!dest) return;
    try {
      // Rust 函数参数名 dest_path → JS camelCase destPath
      await invoke('template_export_cmd', { id: template.id, destPath: dest });
    } catch (e) {
      console.error('[TemplateManager] export failed', e);
      alert(`导出失败：${String(e)}`);
    }
  };

  return (
    <>
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
            // key=editing.id 强制 remount，切换模板时重置 draft 避免脏数据残留
            <TemplateEditor
              key={editing.id}
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

                          {/* 导出：保存对话框 → Rust template_export_cmd */}
                          <button
                            data-testid={`export-btn-${t.id}`}
                            onClick={() => handleExport(t)}
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
            {/* 新建空白模板：NamePromptModal 输入名称 → store.create */}
            <button
              data-testid="create-template-btn"
              onClick={handleNewBlank}
              style={actionBtnStyle}
            >
              新建模板
            </button>

            {/* 从 docx 创建：选文件 → NamePromptModal 输入名称 → RuleTemplateWorkspace */}
            <button
              data-testid="create-from-docx-btn"
              onClick={() => { void handleNewFromDocx(); }}
              style={actionBtnStyle}
            >
              从 docx 创建
            </button>

            {/* 导入 JSON：文件选择器 → Rust template_import_cmd */}
            <button
              data-testid="import-json-btn"
              onClick={() => { void handleImport(); }}
              style={actionBtnStyle}
            >
              导入 JSON
            </button>
          </div>
        )}
      </div>
    </div>

    {/* NamePromptModal：替代 window.prompt，用于新建空白/从 docx 创建时输入模板名 */}
    <NamePromptModal
      isOpen={!!namePrompt}
      title={
        namePrompt?.mode === 'fromDocx'
          ? `从 ${basename(namePrompt.docxPath)} 创建模板`
          : '新建空白模板'
      }
      defaultValue={namePrompt?.mode === 'fromDocx' ? namePrompt.defaultName : ''}
      placeholder="请输入模板名称"
      onSubmit={(name) => { void handleNamePromptSubmit(name); }}
      onCancel={() => setNamePrompt(null)}
    />

    {/* RuleTemplateWorkspace：P4 全屏工作台，从 docx 逐字段确认后保存为模板 */}
    {workspaceOpen && (
      <div
        data-testid="workspace-overlay"
        style={{ position: 'fixed', inset: 0, background: 'var(--c-bg)', zIndex: 1100 }}
      >
        <RuleTemplateWorkspace
          docxPath={workspaceOpen.docxPath}
          initialName={workspaceOpen.name}
          onCancel={() => setWorkspaceOpen(null)}
          onSave={async (name, rules) => {
            try {
              await create(name, {
                // Workspace 传出的 rules 已经是 { enabled, value } 结构
                explicitRules: rules as Record<string, { enabled: boolean; value: Record<string, unknown> }>,
              });
              setWorkspaceOpen(null);
            } catch (e) {
              console.error('[TemplateManager] workspace save failed', e);
              alert(`保存失败：${String(e)}`);
            }
          }}
        />
      </div>
    )}
  </>
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

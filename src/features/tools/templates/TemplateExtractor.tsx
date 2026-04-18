/**
 * @file TemplateExtractor.tsx
 * @description 从 docx 文件提取格式规则并允许用户 review/编辑后保存为模板。
 *   调用 sidecar extract_template 命令获取提取结果，
 *   渲染为可编辑表格，用户确认后调 store.create + store.update 持久化。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useState, useEffect } from 'react';
import { sidecarInvoke } from '../toolsSidecarClient';
import { useTemplateStore } from './TemplateStore';
import { RULE_SCHEMAS } from './ruleSchemas';
import { RuleValueEditor } from './RuleValueEditor';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** sidecar extract_template 响应结构 */
interface ExtractResult {
  rules: Record<string, { enabled: boolean; value: unknown }>;
  evidence: Array<{ rule_id: string; source_xml: string | null; confidence: number }>;
}

export interface TemplateExtractorProps {
  isOpen: boolean;
  docxPath: string;
  defaultName?: string;
  onClose: () => void;
  onSaved?: (newId: string) => void;
}

// ─────────────────────────────────────────────
// 样式常量（复用 TemplateManager 风格）
// ─────────────────────────────────────────────

const actionBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  border: '1px solid var(--c-border)',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontFamily: 'var(--font-ui)',
  cursor: 'pointer',
};

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────

export function TemplateExtractor({
  isOpen,
  docxPath,
  defaultName,
  onClose,
  onSaved,
}: TemplateExtractorProps) {
  const { create, update } = useTemplateStore();

  // 模板名称输入
  const [name, setName] = useState(defaultName ?? '');
  // sidecar 提取结果（含 evidence 和原始 rules）
  const [extracted, setExtracted] = useState<ExtractResult | null>(null);
  // 用户可编辑的 draft rules（默认接受提取值）
  const [draft, setDraft] = useState<Record<string, { enabled: boolean; value: unknown }>>({});
  // 加载状态：正在调 sidecar
  const [loading, setLoading] = useState(false);
  // 保存中状态
  const [saving, setSaving] = useState(false);
  // 提取或保存出错时的错误信息
  const [error, setError] = useState<string | null>(null);

  // ============================================
  // 打开时调 sidecar extract_template
  // docxPath 变化时重新提取（用户换了文件）
  // ============================================
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setExtracted(null);
    setDraft({});
    sidecarInvoke<ExtractResult>({ cmd: 'extract_template', file: docxPath })
      .then((r) => {
        setExtracted(r);
        // 默认接受提取值，用户在表格中可逐条修改
        setDraft(r.rules);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [isOpen, docxPath]);

  if (!isOpen) return null;

  // ============================================
  // 保存：create（深拷贝内置）+ update（覆盖 draft rules）
  // 不直接传 fromDocx，避免 store 再次调 sidecar（重复提取）
  // ============================================
  const handleSave = async () => {
    if (!name.trim()) {
      alert('请输入模板名称');
      return;
    }
    setSaving(true);
    try {
      const newId = await create(name.trim());
      await update(newId, { rules: draft });
      onSaved?.(newId);
      onClose();
    } catch (e: unknown) {
      alert(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  // 从 docxPath 提取文件名供标题显示
  const filename = docxPath.split(/[/\\]/).pop() ?? docxPath;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="template-extractor"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--c-overlay-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          width: 860,
          maxWidth: '92vw',
          maxHeight: '85vh',
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
          <span
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-fg)', fontFamily: 'var(--font-ui)' }}
          >
            从 docx 创建模板：{filename}
          </span>
          <button
            data-testid="extractor-close-btn"
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

        {/* ─── 模板名称输入 ──────────────── */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--c-border)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <label
            htmlFor="extractor-name"
            style={{ fontSize: 13, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap' }}
          >
            模板名称
          </label>
          <input
            id="extractor-name"
            data-testid="extractor-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              flex: 1,
              maxWidth: 320,
              padding: '5px 10px',
              background: 'var(--c-raised)',
              color: 'var(--c-fg)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontFamily: 'var(--font-ui)',
            }}
            placeholder="请输入模板名称"
          />
        </div>

        {/* ─── 内容区 ─────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {/* 加载中 */}
          {loading && (
            <div
              data-testid="extractor-loading"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 40,
                fontSize: 14,
                color: 'var(--c-fg-muted)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              正在提取格式规则...
            </div>
          )}

          {/* 提取失败 */}
          {error && !loading && (
            <div
              data-testid="extractor-error"
              style={{
                margin: 24,
                padding: '12px 16px',
                background: 'var(--c-raised)',
                border: '1px solid var(--c-danger)',
                borderRadius: 'var(--r-sm)',
                fontSize: 13,
                color: 'var(--c-danger)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              提取失败：{error}
            </div>
          )}

          {/* 提取结果表格 */}
          {extracted && !loading && (
            <table
              data-testid="extractor-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                fontFamily: 'var(--font-ui)',
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--c-raised)',
                    borderBottom: '1px solid var(--c-border)',
                  }}
                >
                  <th style={thStyle}>规则</th>
                  <th style={thStyle}>提取值</th>
                  <th style={{ ...thStyle, maxWidth: 200 }}>证据</th>
                  <th style={{ ...thStyle, width: 72 }}>置信度</th>
                  <th style={{ ...thStyle, width: 52, textAlign: 'center' }}>启用</th>
                </tr>
              </thead>
              <tbody>
                {extracted.evidence.map((ev, idx) => {
                  const schema = RULE_SCHEMAS[ev.rule_id];
                  // 未知规则跳过显示（前后端版本不一致时的防御）
                  if (!schema) return null;
                  const entry = draft[ev.rule_id];
                  if (!entry) return null;

                  // 置信度低于 0.5 时用危险色标注，提示用户核查
                  const confidenceColor =
                    ev.confidence < 0.5 ? 'var(--c-danger)' : 'var(--c-success)';

                  return (
                    <tr
                      key={ev.rule_id}
                      data-testid={`extractor-row-${ev.rule_id}`}
                      style={{
                        borderBottom: '1px solid var(--c-border)',
                        background: idx % 2 === 0 ? 'transparent' : 'var(--c-raised)',
                      }}
                    >
                      {/* 规则中文名 */}
                      <td style={tdStyle}>{schema.label}</td>

                      {/* 可编辑的提取值 */}
                      <td style={tdStyle}>
                        <RuleValueEditor
                          shape={schema.valueShape}
                          value={entry.value}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              [ev.rule_id]: { ...d[ev.rule_id], value: v },
                            }))
                          }
                        />
                      </td>

                      {/* 证据 XML（单行截断，避免表格过宽） */}
                      <td
                        style={{
                          ...tdStyle,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'var(--c-fg-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                        }}
                        title={ev.source_xml ?? undefined}
                      >
                        {ev.source_xml || '—'}
                      </td>

                      {/* 置信度数字 */}
                      <td
                        style={{
                          ...tdStyle,
                          width: 72,
                          textAlign: 'right',
                          color: confidenceColor,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                        data-testid={`confidence-${ev.rule_id}`}
                      >
                        {ev.confidence.toFixed(2)}
                      </td>

                      {/* 启用 / 禁用 checkbox */}
                      <td style={{ ...tdStyle, width: 52, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          data-testid={`enable-${ev.rule_id}`}
                          checked={entry.enabled}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [ev.rule_id]: { ...d[ev.rule_id], enabled: e.target.checked },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ─── 底部操作栏 ─────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--c-border)',
            flexShrink: 0,
          }}
        >
          <button
            data-testid="extractor-cancel-btn"
            onClick={onClose}
            style={{ ...actionBtnStyle, background: 'var(--c-raised)', color: 'var(--c-fg)' }}
          >
            取消
          </button>
          <button
            data-testid="extractor-save-btn"
            onClick={() => { void handleSave(); }}
            disabled={!extracted || loading || saving}
            style={{
              ...actionBtnStyle,
              background: !extracted || loading || saving ? 'var(--c-raised)' : 'var(--c-accent)',
              color: !extracted || loading || saving ? 'var(--c-fg-muted)' : 'var(--c-accent-text)',
              cursor: !extracted || loading || saving ? 'not-allowed' : 'pointer',
              border: '1px solid var(--c-border)',
            }}
          >
            {saving ? '保存中...' : '保存为模板'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 表格单元格样式常量 ─────────────────────

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '7px 14px',
  fontWeight: 500,
  color: 'var(--c-fg-muted)',
};

const tdStyle: React.CSSProperties = {
  padding: '9px 14px',
  color: 'var(--c-fg)',
  verticalAlign: 'middle',
};

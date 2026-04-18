/**
 * @file IssueList.tsx
 * @description issue 列表组件。渲染 detect 返回的违规列表，每条 issue 提供"修复"按钮。
 *              点击"修复"触发 fix_preview → DiffPreview modal → 确认 → backup + fix + pushUndo → 重跑 detect。
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { sidecarInvoke, SidecarError, type IssueDict } from './toolsSidecarClient';
import { DiffPreview } from './DiffPreview';
import { useToolsStore } from './toolsStore';

// P2_TEMPLATE 中 rules 的 value 类型
type RuleValue = Record<string, unknown> | boolean | null;

export interface IssueListProps {
  /** 当前检测的文件绝对路径 */
  file: string;
  /** detect 返回的 issue 列表 */
  issues: IssueDict[];
  /** 按 rule_id 取对应 rule 的 value；fix/fix_preview 需要同一 value */
  ruleValues: Record<string, RuleValue>;
  /** fix 成功后由 ToolRunner 重跑 detect 刷新列表 */
  onChanged: () => Promise<void>;
  /** SidecarError 冒泡给 ToolRunner 的 ErrorModal 统一显示 */
  onError: (e: SidecarError) => void;
}

/** 从 backup_create_cmd 返回的快照路径中解析版本号 */
function parseVersionFromPath(p: string): number {
  // 路径形如 ~/.config/ghostterm/.bak/<hash>/v3_<ts>.docx，提取 v 后的数字
  const m = p.match(/v(\d+)_/);
  if (!m) {
    throw new Error(`无法从快照路径解析 version: ${p}`);
  }
  return parseInt(m[1], 10);
}

export function IssueList({ file, issues, ruleValues, onChanged, onError }: IssueListProps) {
  // 当前正在预览的 issue 和对应 diff
  const [previewing, setPreviewing] = useState<{ issue: IssueDict; diff: string } | null>(null);
  // fix_preview 或 fix 进行中时禁用按钮
  const [busy, setBusy] = useState(false);

  /**
   * 点击"修复"按钮：调用 fix_preview 拿 diff，展示 DiffPreview modal
   */
  async function handleFixPreview(issue: IssueDict) {
    setBusy(true);
    try {
      const value = ruleValues[issue.rule_id] ?? {};
      const result = await sidecarInvoke<{ diff: string }>({
        cmd: 'fix_preview',
        file,
        issue,
        value,
      });
      setPreviewing({ issue, diff: result.diff });
    } catch (e) {
      // 任何失败都必须冒泡到 ErrorModal 给用户看，禁止 silent re-throw
      // SidecarError 保留原始 code/message；其他类型（Tauri invoke 失败、内部异常）
      // 包装为 PREVIEW_FAILED 统一展示，fullError 保留原始信息
      if (e instanceof SidecarError) {
        onError(e);
      } else {
        onError(new SidecarError('PREVIEW_FAILED', String(e)));
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * DiffPreview 确认修复：
   * 1. 创建文件备份快照，解析 version
   * 2. 调用 sidecar fix 真实写文件
   * 3. 压入 undo 栈
   * 4. 重跑 detect 刷新列表
   */
  async function handleConfirm() {
    if (!previewing) return;
    setBusy(true);
    try {
      // ============================================================
      // 第一步：创建快照，获取 version（undo 时还原用）
      // ============================================================
      const snapshotPath = await invoke<string>('backup_create_cmd', { origin: file });
      const snapshotVersion = parseVersionFromPath(snapshotPath);

      // ============================================================
      // 第二步：调用 sidecar fix，真实写入修改
      // ============================================================
      const value = ruleValues[previewing.issue.rule_id] ?? {};
      await sidecarInvoke({
        cmd: 'fix',
        file,
        issue: previewing.issue,
        value,
      });

      // ============================================================
      // 第三步：将本次修改压入 undo 栈，关闭预览 modal
      // ============================================================
      useToolsStore.getState().pushUndo({
        originPath: file,
        snapshotVersion,
        issueId: previewing.issue.issue_id,
        timestamp: Date.now(),
      });
      setPreviewing(null);

      // ============================================================
      // 第四步：重跑 detect，刷新 issues 列表
      // ============================================================
      await onChanged();
    } catch (e) {
      // 涵盖三类失败：backup_create_cmd（Tauri 抛字符串）、parseVersionFromPath
      // （内部 Error）、sidecar fix（SidecarError）。统一冒泡 ErrorModal，禁止
      // re-throw 让用户看不到失败原因
      if (e instanceof SidecarError) {
        onError(e);
      } else {
        onError(new SidecarError('FIX_FAILED', String(e)));
      }
    } finally {
      setBusy(false);
    }
  }

  if (issues.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--c-fg-muted)' }}>
        未发现违规，文档符合规范。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, color: 'var(--c-fg-muted)' }}>
        共 {issues.length} 处违规
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {issues.map((issue) => (
          <li
            key={issue.issue_id}
            style={{
              padding: '10px 12px',
              background: 'var(--c-raised)',
              borderRadius: 'var(--r-sm)',
              marginBottom: 6,
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* issue 内容行：snippet 和修复按钮 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <code
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    color: 'var(--c-fg)',
                    background: 'var(--c-bg)',
                    padding: '2px 6px',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  {issue.snippet}
                </code>
                <span style={{ color: 'var(--c-fg-muted)' }}>{issue.message}</span>
              </div>

              {/* fix_available=true 才显示修复按钮 */}
              {issue.fix_available && (
                <button
                  onClick={() => handleFixPreview(issue)}
                  disabled={busy}
                  aria-label={`修复 ${issue.issue_id}`}
                  style={{
                    flexShrink: 0,
                    padding: '4px 10px',
                    background: busy ? 'var(--c-raised)' : 'var(--c-accent)',
                    color: busy ? 'var(--c-fg-subtle)' : 'var(--c-accent-text)',
                    border: 'none',
                    borderRadius: 'var(--r-sm)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                    opacity: busy ? 0.5 : 1,
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  修复
                </button>
              )}
            </div>

            {/* 段落上下文，供用户在 WPS 里定位段落 */}
            <div style={{ color: 'var(--c-fg-muted)', fontSize: 11 }}>
              所在段落：{issue.context}
            </div>
          </li>
        ))}
      </ul>

      {/* diff 预览 modal */}
      {previewing && (
        <DiffPreview
          diff={previewing.diff}
          onConfirm={handleConfirm}
          onCancel={() => !busy && setPreviewing(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

/**
 * @file ToolRunner.tsx
 * @description P2 最小 UI：选 docx → 点"检测"（仅 cjk_ascii_space） → 列 issues
 *              P3 接入 IssueList 组件，支持单条修复闭环
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { sidecarInvoke, SidecarError, type IssueDict, sidecarRestart, type TemplateJson } from './toolsSidecarClient';
// IssueDict 仅用于 setIssues 类型推断
import { ErrorModal } from './ErrorModal';
import { IssueList } from './IssueList';
import { useToolsStore } from './toolsStore';

// P2 写死最小模板：只启用 cjk_ascii_space
const P2_TEMPLATE: TemplateJson = {
  rules: {
    cjk_ascii_space: { enabled: true, value: { allowed: false } },
  },
};

// 从模板提取 ruleValues 映射，传给 IssueList 按 rule_id 取对应修复 value
// 这样 fix/fix_preview 和 detect 使用的 value 保持一致，不会因 P2_TEMPLATE 修改而产生分叉
const P2_RULE_VALUES: Record<string, Record<string, unknown> | boolean | null> = Object.fromEntries(
  Object.entries(P2_TEMPLATE.rules).map(([id, rule]) => [id, rule.value as Record<string, unknown> | boolean | null]),
);

export function ToolRunner() {
  // 返回工具卡片入口：setActiveTool(null) 回到 ToolBoxGrid
  const { activeToolId, setActiveTool } = useToolsStore();

  const [file, setFile] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueDict[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SidecarError | null>(null);

  const handlePick = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (typeof picked === 'string') {
      setFile(picked);
      setIssues(null);
    }
  };

  const handleDetect = async () => {
    if (!file) return;
    setRunning(true);
    setIssues(null);
    try {
      const result = await sidecarInvoke<{ issues: IssueDict[] }>({
        cmd: 'detect',
        file,
        template: P2_TEMPLATE,
      });
      // 校验新字段存在：旧版常驻 sidecar 进程可能无 snippet/context，
      // 必须显式报错并让用户重启 sidecar，不能让 UI 静默降级
      const missing = result.issues.find(
        (i) => typeof i.snippet !== 'string' || typeof i.context !== 'string',
      );
      if (missing) {
        throw new SidecarError(
          'SIDECAR_VERSION_MISMATCH',
          `sidecar 返回的 Issue 缺 snippet/context 字段，常驻进程是旧版本。\n` +
            `请在此对话框点"重启 sidecar"或退出重进 app。\n` +
            `示例 issue: ${JSON.stringify(missing)}`,
        );
      }
      setIssues(result.issues);
    } catch (e) {
      if (e instanceof SidecarError) {
        setError(e);
      } else {
        console.error('[ToolRunner] unexpected error', e);
        throw e;
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{
      flex: 1,
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      overflow: 'auto',
    }}>
      {/* activeToolId 非 null 时显示返回按钮，让用户回到工具卡片入口 */}
      {activeToolId && (
        <button
          onClick={() => setActiveTool(null)}
          style={{
            alignSelf: 'flex-start',
            padding: '4px 10px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg-muted)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          &larr; 返回工具箱
        </button>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600 }}>工具箱（P2：中英空格检测）</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={handlePick}
          style={{
            padding: '8px 14px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          选择 DOCX 文件
        </button>
        <span style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
          {file ?? '尚未选择'}
        </span>
      </div>

      <button
        onClick={handleDetect}
        disabled={!file || running}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 16px',
          background: file && !running ? 'var(--c-accent)' : 'var(--c-raised)',
          color: file && !running ? 'var(--c-accent-text)' : 'var(--c-fg-subtle)',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          cursor: file && !running ? 'pointer' : 'default',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {running ? '检测中…' : '运行检测（cjk_ascii_space）'}
      </button>

      {/* issues 列表：P3 替换为 IssueList 组件，支持单条修复闭环 */}
      {issues && (
        <IssueList
          file={file!}
          issues={issues}
          ruleValues={P2_RULE_VALUES}
          onChanged={handleDetect}
          onError={setError}
        />
      )}

      <ErrorModal
        error={error}
        onClose={() => setError(null)}
        onRestart={async () => {
          try {
            await sidecarRestart();
            setError(null);
          } catch (e) {
            if (e instanceof SidecarError) setError(e);
          }
        }}
      />
    </div>
  );
}

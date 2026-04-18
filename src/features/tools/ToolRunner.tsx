/**
 * @file ToolRunner.tsx
 * @description P2 最小 UI：选 docx → 点"检测"（仅 cjk_ascii_space） → 列 issues
 *              P3 接入模板下拉；P4 加工具箱分类 + 修复按钮
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { sidecarInvoke, SidecarError, type IssueDict, sidecarRestart, type TemplateJson } from './toolsSidecarClient';
import { ErrorModal } from './ErrorModal';

// P2 写死最小模板：只启用 cjk_ascii_space
const P2_TEMPLATE: TemplateJson = {
  rules: {
    cjk_ascii_space: { enabled: true, value: { allowed: false } },
  },
};

export function ToolRunner() {
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

      {issues && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--c-fg-muted)' }}>
            共 {issues.length} 处违规
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {issues.map((i) => (
              <li
                key={i.issue_id}
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
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
                    {i.snippet}
                  </code>
                  <span style={{ color: 'var(--c-fg-muted)' }}>→</span>
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      color: 'var(--c-accent)',
                      background: 'var(--c-bg)',
                      padding: '2px 6px',
                      borderRadius: 'var(--r-sm)',
                    }}
                  >
                    {i.snippet.replace(/ +/g, '')}
                  </code>
                </div>
                <div style={{ color: 'var(--c-fg-muted)', fontSize: 11 }}>
                  所在段落：{i.context}
                </div>
              </li>
            ))}
          </ul>
        </div>
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

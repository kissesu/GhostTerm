/**
 * @file ToolRunner.tsx
 * @description P3 工具运行器：从 useToolsStore 读 activeTemplateId/activeToolId，
 *              从 useTemplateStore 读对应模板，按 activeToolId 的 ruleIds 过滤后传 sidecar。
 *              无 activeTemplate 时提示用户先在顶部选择模板，不做静默降级。
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useState, useEffect, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  sidecarInvoke,
  SidecarError,
  type IssueDict,
  sidecarRestart,
  type MinimalTemplateForDetect,
} from './toolsSidecarClient';
import { ErrorModal } from './ErrorModal';
import { IssueList } from './IssueList';
import { useToolsStore } from './toolsStore';
import { useTemplateStore } from './templates/TemplateStore';
import { TOOL_BOXES } from './ToolBoxGrid';
import type { TemplateJson } from './templates/TemplateStore';

/**
 * 按 toolBoxId 的 ruleIds 过滤模板规则。
 *
 * 过滤逻辑：
 * 1. toolBoxId 为 null → 不过滤，返回完整 template
 * 2. 找不到对应 toolBox → 异常情况，返回完整 template（不静默丢失数据）
 * 3. 只保留 toolBox.ruleIds 中且在 template.rules 中存在的 rule
 */
function filterTemplateForTool(template: TemplateJson, toolBoxId: string | null): MinimalTemplateForDetect {
  // 无 toolBoxId 时运行全部规则
  if (!toolBoxId) return { rules: template.rules };

  const toolBox = TOOL_BOXES.find((tb) => tb.id === toolBoxId);
  // 找不到 toolBox 属于调用方数据不一致，走完整规则，不抛错静默继续
  if (!toolBox) return { rules: template.rules };

  const filteredRules: MinimalTemplateForDetect['rules'] = {};
  for (const ruleId of toolBox.ruleIds) {
    if (ruleId in template.rules) {
      filteredRules[ruleId] = template.rules[ruleId];
    }
  }
  return { rules: filteredRules };
}

export function ToolRunner() {
  // 返回工具卡片入口：setActiveTool(null) 回到 ToolBoxGrid
  const { activeToolId, activeTemplateId, setActiveTool } = useToolsStore();
  const templates = useTemplateStore((s) => s.templates);

  // 按 activeTemplateId 找当前模板；找不到时为 undefined
  const activeTemplate = templates.find((t) => t.id === activeTemplateId);

  const [file, setFile] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueDict[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SidecarError | null>(null);

  // ============================================================
  // mount 时如果模板列表为空则触发加载（延迟初始化）
  // ============================================================
  useEffect(() => {
    if (templates.length === 0) {
      useTemplateStore.getState().load();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // activeToolId 变化时清空文件和结果，避免上一个工具的数据残留
  // ============================================================
  useEffect(() => {
    setFile(null);
    setIssues(null);
    setError(null);
  }, [activeToolId]);

  // ============================================================
  // ruleValues：按当前工具过滤后的 rule → value 映射
  // 传给 IssueList 用于 fix/fix_preview 时取对应修复值
  // ============================================================
  // RuleValue 与 IssueList.tsx 保持一致，value 可能是 object/boolean/null
  type RuleValue = Record<string, unknown> | boolean | null;
  const ruleValues = useMemo(() => {
    if (!activeTemplate) return {} as Record<string, RuleValue>;
    const filtered = filterTemplateForTool(activeTemplate, activeToolId);
    const out: Record<string, RuleValue> = {};
    for (const [ruleId, ruleCfg] of Object.entries(filtered.rules)) {
      out[ruleId] = ruleCfg.value as RuleValue;
    }
    return out;
  }, [activeTemplate, activeToolId]);

  // 当前工具箱标题：有选中工具时显示工具名，否则显示通用"工具箱"
  const toolBox = activeToolId ? TOOL_BOXES.find((tb) => tb.id === activeToolId) : null;
  const title = toolBox ? toolBox.label : '工具箱';

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

    // 无 activeTemplate 时必须报错，不允许用旧的 hardcode 模板静默降级
    if (!activeTemplate) {
      setError(new SidecarError('NO_ACTIVE_TEMPLATE', '请先在顶部选择模板'));
      return;
    }

    setRunning(true);
    setIssues(null);
    try {
      // 按当前工具的 ruleIds 过滤模板，只检测该工具负责的规则
      const filtered = filterTemplateForTool(activeTemplate, activeToolId);

      const result = await sidecarInvoke<{ issues: IssueDict[] }>({
        cmd: 'detect',
        file,
        template: filtered,
      });

      // 校验新字段存在：旧版常驻 sidecar 进程可能无 snippet/context，
      // 必须显式报错让用户重启 sidecar，不能让 UI 静默降级
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

      <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2>

      {/* 无 activeTemplate 时提示用户选模板，阻断操作 */}
      {!activeTemplate && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--c-raised)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-sm)',
          fontSize: 12,
          color: 'var(--c-fg-muted)',
        }}>
          请先在顶部选择模板后再运行检测
        </div>
      )}

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
        disabled={!file || running || !activeTemplate}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 16px',
          background: file && !running && activeTemplate ? 'var(--c-accent)' : 'var(--c-raised)',
          color: file && !running && activeTemplate ? 'var(--c-accent-text)' : 'var(--c-fg-subtle)',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          cursor: file && !running && activeTemplate ? 'pointer' : 'default',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {running ? '检测中…' : '运行检测'}
      </button>

      {issues && (
        <IssueList
          file={file!}
          issues={issues}
          ruleValues={ruleValues}
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

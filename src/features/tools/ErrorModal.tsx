/**
 * @file ErrorModal.tsx
 * @description sidecar 错误 modal。spec Section 7：各 error code 对应用户友好文案 + 暴露完整信息 + 复制按钮
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useEffect, useState } from 'react';
import { SidecarError } from './toolsSidecarClient';

// spec Section 7 定义的各错误码对应友好文案
// title: 用户可读的错误类型名；hint: 原因说明；action: 建议操作
interface ErrorHint {
  title: string;
  hint: string;
  action: string;
}

const ERROR_HINTS: Record<string, ErrorHint> = {
  ENOENT: {
    title: '文件不存在',
    hint: '文件可能被移动或删除。',
    action: '请检查文件路径后重试。',
  },
  EPERM: {
    title: '无法写入文件',
    hint: '文件可能被 Word/WPS 等程序打开，或当前用户无写入权限。',
    action: '请关闭打开此文件的程序后重试。',
  },
  PARSE_ERROR: {
    title: 'DOCX 文件损坏',
    hint: '无法解析 docx XML，可能文件已损坏或不是有效的 Word 文档。',
    action: '请用 Word 重新保存修复后再试。',
  },
  RULE_ERROR: {
    title: '规则执行异常',
    hint: '某条规则在执行时抛出异常，导致整批检测中止。',
    action: '请将下方完整错误信息复制并反馈给开发者。',
  },
  SIDECAR_UNAVAILABLE: {
    title: '工具进程未启动',
    hint: 'Python sidecar 进程未运行或已退出。',
    action: '点击下方"重启 sidecar"按钮。',
  },
  SIDECAR_VERSION_MISMATCH: {
    title: 'Sidecar 版本不匹配',
    hint: '常驻 sidecar 是旧版本，缺少最新字段。',
    action: '点击"重启 sidecar"或退出重新打开应用。',
  },
  SIDECAR_RESTART_FAILED: {
    title: '重启 Sidecar 失败',
    hint: '尝试重启 Python sidecar 时遇到错误。',
    action: '请退出重启应用，或将错误信息反馈给开发者。',
  },
  BACKUP_FAILED: {
    title: '备份失败',
    hint: '无法在修复前创建文件备份，原文件未修改。',
    action: '请检查磁盘空间和写入权限。',
  },
  FIX_FAILED: {
    title: '修复操作失败',
    hint: '修复流程在执行中出错，原文件未被修改。',
    action: '请将完整错误信息反馈给开发者。',
  },
  PREVIEW_FAILED: {
    title: '修复预览失败',
    hint: '生成修复 diff 预览时出错。',
    action: '请将完整错误信息反馈给开发者。',
  },
  INTERNAL: {
    title: '内部错误',
    hint: 'Sidecar 内部抛出未捕获的异常。',
    action: '请将完整错误信息反馈给开发者。',
  },
  UNKNOWN_CMD: {
    title: '未识别命令',
    hint: 'Sidecar 收到未识别的命令名。',
    action: '请重启应用，或反馈给开发者。',
  },
  UNKNOWN_RULE: {
    title: '未识别规则',
    hint: '模板中含 sidecar 不识别的规则 id。',
    action: '请检查模板配置或重新生成。',
  },
};

// 未映射的 error code 回退到通用提示
const FALLBACK_HINT: ErrorHint = {
  title: '工具执行失败',
  hint: '',
  action: '',
};

interface Props {
  error: SidecarError | null;
  onClose: () => void;
  onRestart?: () => void;
}

export function ErrorModal({ error, onClose, onRestart }: Props) {
  const [copied, setCopied] = useState(false);

  // 切换 error 时重置复制状态
  useEffect(() => {
    if (!error) setCopied(false);
  }, [error]);

  if (!error) return null;

  // 按 error.code 查找对应友好文案，未映射时回退到通用提示
  const hint = ERROR_HINTS[error.code] ?? FALLBACK_HINT;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`[${error.code}]\n${error.fullError}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('复制失败，请手动选择文本');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'var(--c-overlay-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          maxWidth: 720,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题行：友好文案 + 错误码 */}
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-danger)' }}>
          {hint.title} [{error.code}]
        </div>

        {/* 友好提示：解释可能的原因 */}
        {hint.hint && (
          <div style={{ fontSize: 13, color: 'var(--c-fg)' }}>
            {hint.hint}
          </div>
        )}

        {/* 建议操作：告诉用户下一步怎么做 */}
        {hint.action && (
          <div style={{ fontSize: 13, color: 'var(--c-fg-muted)' }}>
            建议：{hint.action}
          </div>
        )}

        {/* 完整错误信息（保留换行、traceback 等） */}
        <pre
          style={{
            flex: 1, overflow: 'auto',
            padding: 12,
            background: 'var(--c-raised)',
            borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--c-fg)',
            whiteSpace: 'pre-wrap',
            maxHeight: 400,
          }}
        >
          {error.fullError}
        </pre>

        {/* 操作按钮行 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleCopy}
            style={{
              padding: '8px 14px',
              background: 'var(--c-raised)',
              color: 'var(--c-fg)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
            }}
          >
            {copied ? '已复制' : '复制完整错误信息'}
          </button>
          {onRestart && (
            <button
              onClick={onRestart}
              style={{
                padding: '8px 14px',
                background: 'var(--c-raised)',
                color: 'var(--c-fg)',
                border: '1px solid var(--c-border)',
                borderRadius: 'var(--r-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
              }}
            >
              重启 sidecar
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'var(--c-accent)',
              color: 'var(--c-accent-text)',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

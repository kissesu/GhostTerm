/**
 * @file FieldList.tsx
 * @description 32 字段状态列表，支持顺序推进 + 定位 + 跳过（图标用 lucide-react，不使用 emoji）
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { MapPin, SkipForward, Check, AlertCircle, Circle, MinusCircle } from 'lucide-react';

// 字段状态类型：done=已填写，partial=部分填写，empty=待填写，skipped=已跳过
export interface FieldStatus {
  id: string;
  label: string;
  status: 'done' | 'partial' | 'empty' | 'skipped';
  /** 置信度 0-1，来自 HanLP/规则引擎的识别结果 */
  confidence?: number;
  /** 字段的实际值，由 RuleValueEditor 使用 */
  value?: Record<string, unknown>;
}

interface Props {
  fields: FieldStatus[];
  /** 当前聚焦的字段 ID，null 表示无聚焦 */
  currentFieldId: string | null;
  /** 点击定位按钮时触发，将 DocxPreview 滚动到该字段位置 */
  onJump: (fieldId: string) => void;
  /** 点击跳过按钮时触发，将字段状态标记为 skipped */
  onSkip: (fieldId: string) => void;
}

/**
 * 根据字段状态和置信度计算显示颜色
 * - 已跳过：静音色
 * - 高置信度已完成（>=0.8）：成功绿
 * - 中置信度（>=0.5）：警告黄
 * - 空字段：极静音色
 * - 其余（低置信度/部分）：危险红
 */
function statusColor(status: FieldStatus['status'], conf?: number): string {
  if (status === 'skipped') return 'var(--c-fg-muted)';
  if (status === 'done' && (conf === undefined || conf >= 0.8)) return 'var(--c-success)';
  if (conf !== undefined && conf >= 0.5) return 'var(--c-warning)';
  if (status === 'empty') return 'var(--c-fg-subtle)';
  return 'var(--c-danger)';
}

/** 状态图标：用 lucide-react 图标映射各状态，避免使用 emoji */
function StatusIcon({ status }: { status: FieldStatus['status'] }) {
  const size = 14;
  switch (status) {
    case 'done':    return <Check size={size} />;
    case 'partial': return <AlertCircle size={size} />;
    case 'skipped': return <MinusCircle size={size} />;
    case 'empty':
    default:        return <Circle size={size} />;
  }
}

/**
 * 32 字段状态列表组件
 *
 * 业务逻辑：
 * 1. 顶部显示进度计数（done + skipped / total）
 * 2. 列表按顺序展示所有字段，当前字段高亮并有左边框标记
 * 3. 每行提供"定位"和"跳过"两个操作按钮
 */
export function FieldList({ fields, currentFieldId, onJump, onSkip }: Props) {
  // done 和 skipped 都算作"已处理"，体现在进度条中
  const doneCount = fields.filter(f => f.status === 'done' || f.status === 'skipped').length;

  return (
    <div style={{
      flex: 1,
      padding: 14,
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      fontFamily: 'var(--font-ui)',
      fontSize: 13,
      overflow: 'auto',
    }}>
      {/* 进度计数器 */}
      <div style={{ fontSize: 12, color: 'var(--c-fg-muted)', marginBottom: 10 }}>
        进度：{doneCount} / {fields.length}
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {fields.map((f) => {
          const isCurrent = f.id === currentFieldId;
          const color = statusColor(f.status, f.confidence);

          return (
            <li
              key={f.id}
              data-current={isCurrent}
              style={{
                padding: '6px 10px',
                margin: '2px 0',
                // 当前字段使用 accent-dim 背景 + 左边框高亮，其余透明
                background: isCurrent ? 'var(--c-accent-dim)' : 'transparent',
                borderLeft: isCurrent
                  ? '3px solid var(--c-accent)'
                  : '3px solid transparent',
                borderRadius: 'var(--r-sm)',
                color,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <StatusIcon status={f.status} />

              <span style={{ flex: 1 }}>
                {f.label}
                {/* 置信度辅助显示，帮助用户判断识别可信度 */}
                {f.confidence !== undefined && (
                  <span style={{
                    color: 'var(--c-fg-muted)',
                    marginLeft: 4,
                    fontSize: 11,
                  }}>
                    ({f.confidence.toFixed(2)})
                  </span>
                )}
              </span>

              {/* 定位按钮：将 DocxPreview 滚动到此字段的段落位置 */}
              <button
                aria-label="定位"
                title="定位到此字段"
                onClick={() => onJump(f.id)}
                style={{
                  padding: '3px 6px',
                  background: 'var(--c-raised)',
                  color: 'var(--c-fg)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <MapPin size={12} />
              </button>

              {/* 跳过按钮：将此字段标记为 skipped，不再参与规则检查 */}
              <button
                aria-label="跳过"
                title="跳过（不检查）"
                onClick={() => onSkip(f.id)}
                style={{
                  padding: '3px 6px',
                  background: 'transparent',
                  color: 'var(--c-fg-muted)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <SkipForward size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

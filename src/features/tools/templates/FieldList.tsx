/**
 * @file FieldList.tsx
 * @description 32 字段状态列表，支持顺序推进 + 定位 + 跳过（图标用 lucide-react，不使用 emoji）
 *   Task 2 重构：每个字段展开显示 applicable_attributes 的所有属性行 + 行内编辑器
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { MapPin, SkipForward, Check, AlertCircle, Circle, MinusCircle } from 'lucide-react';
import { applicableAttrs } from './fieldDefs';
import { RuleValueEditorByAttr } from './RuleValueEditor';

// 属性 key → 中文标签映射表
// 覆盖 fieldDefs.ts 中所有 applicable_attributes 出现的 key，用于在属性行左侧显示可读标签
const ATTR_LABEL: Record<string, string> = {
  'font.cjk': '中文字体',
  'font.ascii': '西文字体',
  'font.size_pt': '字号',
  'font.bold': '加粗',
  'para.align': '对齐',
  'para.first_line_indent_chars': '首行缩进',
  'para.line_spacing': '行距',
  'para.letter_spacing_chars': '字间距（字数）',
  'para.space_before_lines': '段前',
  'para.space_after_lines': '段后',
  'para.hanging_indent_chars': '悬挂缩进',
  'content.specific_text': '指定文本',
  'content.max_chars': '最大字数',
  'content.char_count_min': '最少字数',
  'content.char_count_max': '最多字数',
  'content.item_count_min': '最少项数',
  'content.item_count_max': '最多项数',
  'content.item_separator': '分隔符',
  'page.size': '纸张',
  'page.margin_top_cm': '上边距',
  'page.margin_bottom_cm': '下边距',
  'page.margin_left_cm': '左边距',
  'page.margin_right_cm': '右边距',
  'page.new_page_before': '另起页',
  'pagination.front_style': '前置页码',
  'pagination.body_style': '正文页码',
  'mixed_script.ascii_is_tnr': '西文用 Times New Roman',
  'layout.position': '图表位置',
  'citation.style': '引文样式',
};

// 字段状态类型：done=已填写，partial=部分填写，empty=待填写，skipped=已跳过
export interface FieldStatus {
  id: string;
  label: string;
  status: 'done' | 'partial' | 'empty' | 'skipped';
  /** 置信度 0-1，来自 HanLP/规则引擎的识别结果 */
  confidence?: number;
  /** 字段的实际值，按属性 key 存储 */
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
  /** 用户在属性行内编辑某个属性值时触发，外层同步到 fields 并将置信度升为 1.0 */
  onAttrChange: (fieldId: string, attrKey: string, newValue: unknown) => void;
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
 * 3. 每个字段卡片默认展开，显示该字段所有 applicable_attributes 的属性行
 * 4. 每条属性行提供行内编辑器（RuleValueEditorByAttr）+ 右侧状态标记（已抓到/未抓到）
 * 5. 每行提供"定位"和"跳过"两个操作按钮
 */
export function FieldList({ fields, currentFieldId, onJump, onSkip, onAttrChange }: Props) {
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
          // 获取该字段所有可配置属性 key，用于渲染属性行
          const attrs = applicableAttrs(f.id);

          return (
            <li
              key={f.id}
              data-current={isCurrent}
              style={{
                padding: '6px 10px 8px',
                margin: '2px 0',
                // 当前字段使用 accent-dim 背景 + 左边框高亮，其余透明
                background: isCurrent ? 'var(--c-accent-dim)' : 'transparent',
                borderLeft: isCurrent
                  ? '3px solid var(--c-accent)'
                  : '3px solid transparent',
                borderRadius: 'var(--r-sm)',
                color,
              }}
            >
              {/* 字段头行：状态图标 + 标签 + 置信度 + 定位/跳过按钮 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                columnGap: 8,
              }}>
                <StatusIcon status={f.status} />

                <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  {f.label}
                  {/* 置信度辅助显示，帮助用户判断识别可信度 */}
                  {f.confidence !== undefined && (
                    <span style={{
                      color: 'var(--c-fg-muted)',
                      fontSize: 11,
                    }}>
                      ({f.confidence.toFixed(2)})
                    </span>
                  )}
                </span>

                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
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
                </span>
              </div>

              {/* 属性行区域：按 applicable_attributes 顺序逐行渲染编辑器
                  默认全部展开，不做手风琴折叠；用户滚动查看即可 */}
              {attrs.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
                  {attrs.map((attr) => {
                    // 判断该属性是否已被识别到：存在于 f.value 中即为已抓到
                    const hasCaptured = f.value != null && attr in f.value;
                    const attrLabel = ATTR_LABEL[attr] ?? attr;

                    return (
                      <li
                        key={attr}
                        style={{
                          // 三列：属性标签（固定宽） | 编辑器（弹性） | 状态标记（自动宽）
                          display: 'grid',
                          gridTemplateColumns: '100px 1fr auto',
                          columnGap: 10,
                          alignItems: 'center',
                          padding: '4px 10px 4px 30px',
                        }}
                      >
                        {/* 属性标签 */}
                        <span style={{
                          fontSize: 12,
                          color: 'var(--c-fg-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {attrLabel}
                        </span>

                        {/* 行内编辑器：onChange 触发 onAttrChange 将改动同步到 Workspace */}
                        <RuleValueEditorByAttr
                          attr={attr}
                          value={f.value?.[attr]}
                          onChange={(next) => onAttrChange(f.id, attr, next)}
                        />

                        {/* 右侧状态标记：已识别到显示绿色勾，未识别到显示灰色提示 */}
                        <span style={{
                          fontSize: 11,
                          color: hasCaptured ? 'var(--c-success)' : 'var(--c-fg-muted)',
                          whiteSpace: 'nowrap',
                        }}>
                          {hasCaptured ? '✓' : '⨯ 未抓到'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

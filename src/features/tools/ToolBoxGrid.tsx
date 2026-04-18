/**
 * @file ToolBoxGrid.tsx
 * @description 工具箱分类卡片入口网格。按 spec Section 5 定义 5 个工具分类，
 *              每个卡片展示名称、描述、规则 ID 列表，点"运行"触发 onSelectTool 回调。
 *              Task 24 接入时 ToolRunner 将按 ruleIds 过滤规则；本 task 只做入口渲染。
 * @author Atlas.oi
 * @date 2026-04-18
 */

export interface ToolBox {
  id: string;
  label: string;
  description: string;
  ruleIds: string[];
}

// 5 个工具分类，与 spec Section 5 对应
export const TOOL_BOXES: ToolBox[] = [
  {
    id: 'thesis-format',
    label: '论文格式检测',
    description: '字体、字号、段落、章节分页等格式规范',
    ruleIds: ['font.body', 'font.h1', 'paragraph.indent', 'chapter.new_page'],
  },
  {
    id: 'citation',
    label: '引用格式化',
    description: 'GB/T 7714 引用格式检测',
    ruleIds: ['citation.format'],
  },
  {
    id: 'figure-table',
    label: '图表规范',
    description: '图表题位置、页眉页脚分页',
    ruleIds: ['figure.caption_pos', 'table.caption_pos', 'pagination'],
  },
  {
    id: 'writing-quality',
    label: '写作质量辅助',
    description: '中英文空格、引号风格',
    ruleIds: ['cjk_ascii_space', 'quote.style'],
  },
  {
    id: 'ai-detection',
    label: '去 AI 化检测',
    description: 'AI 化写作 marker 检测（仅检出，不修复）',
    ruleIds: ['ai_pattern.check'],
  },
];

interface ToolBoxGridProps {
  onSelectTool: (toolBox: ToolBox) => void;
}

export function ToolBoxGrid({ onSelectTool }: ToolBoxGridProps) {
  return (
    <div
      data-testid="toolbox-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
        padding: 16,
      }}
    >
      {TOOL_BOXES.map((tb) => (
        <div
          key={tb.id}
          data-testid={`toolbox-card-${tb.id}`}
          style={{
            background: 'var(--c-raised)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>{tb.label}</div>
          <div style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>{tb.description}</div>
          {/* 规则 ID 列表，Task 24 实际按此过滤 sidecar 调用 */}
          <div
            style={{
              fontSize: 11,
              color: 'var(--c-fg-subtle)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {tb.ruleIds.join(' · ')}
          </div>
          <button
            onClick={() => onSelectTool(tb)}
            style={{
              padding: '6px 12px',
              background: 'var(--c-accent)',
              color: 'var(--c-accent-text)',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            运行
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * @file RuleTemplateWorkspace.tsx
 * @description P4 核心工作台：双栏 docx 预览 + 字段表 sequential 工作流
 *              挂载时自动 extract_all → 用户点段落 → extract_from_selection → 推进下一字段
 *              支持跳转（临时切换字段 + 完成后回到原顺序）和跳过
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useEffect, useState } from 'react';
import { DocxPreview } from './DocxPreview';
import { FieldList, FieldStatus } from './FieldList';
import { FIELD_DEFS } from './fieldDefs';
import {
  sidecarInvoke,
  SidecarError,
  ExtractAllResult,
  ExtractFromSelectionResult,
} from '../toolsSidecarClient';

interface Props {
  docxPath: string;
  /** 初始模板名称，来自用户在 NamePromptModal 输入 */
  initialName?: string;
  onSave: (name: string, rules: Record<string, unknown>) => void;
  onCancel: () => void;
}

/**
 * 根据置信度和是否有值，判断字段的填写状态
 *
 * @param confidence - 识别置信度 0-1
 * @param hasValue   - sidecar 是否返回了该字段的值
 * @returns FieldStatus.status 枚举值
 */
function classifyStatus(
  confidence: number | undefined,
  hasValue: boolean,
): FieldStatus['status'] {
  if (!hasValue) return 'empty';
  if ((confidence ?? 0) >= 0.8) return 'done';
  if ((confidence ?? 0) >= 0.5) return 'partial';
  return 'empty';
}

export function RuleTemplateWorkspace({ docxPath, initialName, onSave, onCancel }: Props) {
  // 32 个字段的状态列表
  const [fields, setFields] = useState<FieldStatus[]>([]);
  // 当前聚焦字段 id（需要用户选段落确认的字段）
  const [currentFieldId, setCurrentFieldId] = useState<string | null>(null);
  // 跳转打断后的回归点：跳回该 id 后恢复顺序推进
  const [interruptReturn, setInterruptReturn] = useState<string | null>(null);
  // 错误提示（sidecar 调用失败时展示）
  const [error, setError] = useState<string | null>(null);
  // 模板名称，来自 Props 或默认值
  const [templateName, setTemplateName] = useState(initialName ?? '新模板');

  // ============================================
  // 第一步：挂载时自动全文抽取
  // 调用 extract_all 获取 32 个字段的当前值和置信度
  // ============================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await sidecarInvoke<ExtractAllResult>({
          cmd: 'extract_all',
          file: docxPath,
        });
        if (cancelled) return;

        // 将 evidence 列表转为 fieldId → confidence 快速查找 map
        const evidenceMap = new Map(result.evidence.map((e) => [e.field_id, e.confidence]));

        // 按 FIELD_DEFS 顺序构建初始状态列表
        const initial: FieldStatus[] = FIELD_DEFS.map((def) => {
          const conf = evidenceMap.get(def.id);
          const hasValue = def.id in result.rules;
          return {
            id: def.id,
            label: def.label,
            status: classifyStatus(conf, hasValue),
            confidence: conf,
            value: result.rules[def.id]?.value,
          };
        });
        setFields(initial);

        // 自动定位到第一个未完成字段
        const firstIncomplete = initial.find(
          (f) => f.status === 'empty' || f.status === 'partial',
        );
        setCurrentFieldId(firstIncomplete?.id ?? null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof SidecarError ? e.message : String(e);
          setError(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docxPath]);

  // ============================================
  // 辅助：推进到下一个待填字段
  // 若有 interruptReturn，优先回归；否则按 fields 当前顺序继续
  // 不在 setFields 回调内调 setCurrentFieldId，避免嵌套 setter 的渲染时序问题
  // ============================================
  const advanceField = () => {
    if (interruptReturn) {
      setCurrentFieldId(interruptReturn);
      setInterruptReturn(null);
      return;
    }
    const idx = fields.findIndex((f) => f.id === currentFieldId);
    // 从当前字段之后找下一个未完成字段
    const next = fields.slice(idx + 1).find(
      (f) => f.status === 'empty' || f.status === 'partial',
    );
    setCurrentFieldId(next?.id ?? null);
  };

  // ============================================
  // 第二步：用户点击段落
  // 调用 extract_from_selection 确认当前字段的值
  // ============================================
  const handleParaClick = async (paraIdx: number) => {
    if (!currentFieldId) return;
    try {
      const result = await sidecarInvoke<ExtractFromSelectionResult>({
        cmd: 'extract_from_selection',
        file: docxPath,
        para_indices: [paraIdx],
        field_id: currentFieldId,
      });
      // 更新该字段的状态和值
      // （字段值直接存入 fields[].value，handleSaveClick 从 fields 聚合最终规则，不需要单独 extractedRules map）
      setFields((prev) =>
        prev.map((f) =>
          f.id === currentFieldId
            ? {
                ...f,
                status: classifyStatus(result.confidence, true),
                confidence: result.confidence,
                value: result.value,
              }
            : f,
        ),
      );
      // 推进到下一字段
      advanceField();
    } catch (e) {
      const msg = e instanceof SidecarError ? e.message : String(e);
      setError(msg);
    }
  };

  // ============================================
  // 跳转到指定字段（临时打断顺序推进）
  // 记录下一个待续字段，完成跳转字段后回到它
  // 不在 setFields 回调内调 setInterruptReturn/setCurrentFieldId，避免嵌套 setter
  // ============================================
  const handleJump = (fieldId: string) => {
    const idx = fields.findIndex((f) => f.id === currentFieldId);
    // 找到当前位置后的下一个未完成字段作为回归点
    const returnTo = fields.slice(idx + 1).find(
      (f) => f.status === 'empty' || f.status === 'partial',
    );
    setInterruptReturn(returnTo?.id ?? null);
    setCurrentFieldId(fieldId);
  };

  // ============================================
  // 用户手动编辑某属性行
  // 将新值写入对应字段的 value map，并将置信度升为 1.0（满分）
  // 因为用户手动确认视为最可信来源，不再需要 sidecar 推断
  // ============================================
  const handleAttrChange = (fieldId: string, attrKey: string, newValue: unknown) => {
    setFields((prev) => prev.map((f) =>
      f.id === fieldId
        ? {
            ...f,
            value: { ...(f.value ?? {}), [attrKey]: newValue },
            status: 'done',
            confidence: 1.0,
          }
        : f,
    ));
  };

  // ============================================
  // 跳过当前字段
  // 将字段状态标记为 skipped，若是当前字段则顺序推进
  // ============================================
  const handleSkip = (fieldId: string) => {
    setFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, status: 'skipped' } : f)),
    );
    if (fieldId === currentFieldId) advanceField();
  };

  // ============================================
  // 第三步：保存模板
  // 过滤掉 skipped 字段，仅将有值的字段写入最终规则
  // ============================================
  const handleSaveClick = () => {
    const finalRules: Record<string, { enabled: boolean; value: Record<string, unknown> }> = {};
    for (const f of fields) {
      if (f.status === 'skipped') continue;
      if (f.value) {
        finalRules[f.id] = { enabled: true, value: f.value };
      }
    }
    onSave(templateName, finalRules);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--c-bg)',
      }}
    >
      {/* 顶部工具栏：模板名称输入 + 取消/保存按钮 */}
      <div
        style={{
          padding: 10,
          borderBottom: '1px solid var(--c-border)',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="模板名称"
          style={{
            flex: 1,
            padding: 6,
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-ui)',
          }}
        />
        <button
          onClick={onCancel}
          style={{
            padding: '6px 12px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          onClick={handleSaveClick}
          style={{
            padding: '6px 12px',
            background: 'var(--c-accent)',
            color: 'var(--c-accent-text, var(--c-bg))',
            border: 'none',
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
          }}
        >
          保存为模板
        </button>
      </div>

      {/* 错误提示横幅 */}
      {error && (
        <div
          style={{
            padding: 10,
            background: 'var(--c-danger-dim, rgba(200, 80, 80, 0.15))',
            color: 'var(--c-danger)',
            fontSize: 12,
          }}
        >
          错误：{error}
        </div>
      )}

      {/* 主体双栏：左侧 DocxPreview + 右侧 FieldList */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左栏：docx 预览 + 当前字段提示 */}
        <div
          style={{
            flex: 1.4,
            borderRight: '1px solid var(--c-border)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {/* 当前待选字段提示条 */}
          <div
            style={{
              padding: 10,
              background: 'var(--c-raised)',
              fontSize: 12,
              color: 'var(--c-fg-muted)',
              flexShrink: 0,
            }}
          >
            {currentFieldId
              ? `请为「${FIELD_DEFS.find((f) => f.id === currentFieldId)?.label}」选取段落`
              : '所有字段已完成或跳过，点击右上方「保存为模板」'}
          </div>
          <DocxPreview
            file={docxPath}
            onParaClick={handleParaClick}
            hoveredFieldId={currentFieldId ?? undefined}
          />
        </div>

        {/* 右栏：字段状态列表 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <FieldList
            fields={fields}
            currentFieldId={currentFieldId}
            onJump={handleJump}
            onSkip={handleSkip}
            onAttrChange={handleAttrChange}
          />
        </div>
      </div>
    </div>
  );
}

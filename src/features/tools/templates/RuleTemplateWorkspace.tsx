/**
 * @file RuleTemplateWorkspace.tsx
 * @description P4 核心工作台：双栏 docx 预览 + 字段表 sequential 工作流
 *              挂载时自动 extract_all → 用户点段落/句子 → extract_from_selection → 推进下一字段
 *              支持跳转（临时切换字段 + 完成后回到原顺序）、跳过、shift 多句选取积累
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxPreview, SelectionClick } from './DocxPreview';
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
  // Task 4：shift 多选状态
  // selectionBuffer：积累的选择项，Shift 松开后一次性 flush 到 sidecar
  // isShiftPressed：跟踪 Shift 键按下状态，驱动 hint 文字和背景变色
  // selectedSentenceIds：传给 DocxPreview 渲染 .docx-sent-selected class
  // ============================================
  const [selectionBuffer, setSelectionBuffer] = useState<SelectionClick[]>([]);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [selectedSentenceIds, setSelectedSentenceIds] = useState<Set<string>>(new Set());

  // 用 ref 持有最新的 selectionBuffer + currentFieldId，避免 keyUp 闭包捕获旧值
  const selectionBufferRef = useRef<SelectionClick[]>([]);
  const currentFieldIdRef = useRef<string | null>(null);
  const fieldsRef = useRef<FieldStatus[]>([]);
  const interruptReturnRef = useRef<string | null>(null);

  // 同步 ref
  selectionBufferRef.current = selectionBuffer;
  currentFieldIdRef.current = currentFieldId;
  fieldsRef.current = fields;
  interruptReturnRef.current = interruptReturn;

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
  // 用 ref 读取最新 fields 避免闭包过期问题
  // ============================================
  const advanceField = useCallback(() => {
    const currentFields = fieldsRef.current;
    const currentId = currentFieldIdRef.current;
    const ret = interruptReturnRef.current;

    if (ret) {
      setCurrentFieldId(ret);
      setInterruptReturn(null);
      return;
    }
    const idx = currentFields.findIndex((f) => f.id === currentId);
    const next = currentFields.slice(idx + 1).find(
      (f) => f.status === 'empty' || f.status === 'partial',
    );
    setCurrentFieldId(next?.id ?? null);
  }, []);

  // ============================================
  // 核心调用：invoke sidecar extract_from_selection
  // 由单击路径和 shift flush 路径共用
  // ============================================
  const invokeExtract = useCallback(async (
    paraIndices: number[],
    selectedText: string,
    fieldId: string,
  ) => {
    const result = await sidecarInvoke<ExtractFromSelectionResult>({
      cmd: 'extract_from_selection',
      file: docxPath,
      para_indices: paraIndices,
      field_id: fieldId,
      selected_text: selectedText || undefined,
    });
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? {
              ...f,
              status: classifyStatus(result.confidence, true),
              confidence: result.confidence,
              value: result.value,
            }
          : f,
      ),
    );
  }, [docxPath]);

  // ============================================
  // Task 4：flush 积累的 shift 选择项到 sidecar
  // 合并所有选中文本（空格连接），使用第一项的 paraIdx
  // ============================================
  const flushSelectionBuffer = useCallback(async () => {
    const buffer = selectionBufferRef.current;
    const fieldId = currentFieldIdRef.current;
    if (buffer.length === 0 || !fieldId) return;

    const combinedText = buffer.map((s) => s.text).join(' ');
    const firstParaIdx = buffer[0].paraIdx;

    try {
      await invokeExtract([firstParaIdx], combinedText, fieldId);
      advanceField();
    } catch (e) {
      const msg = e instanceof SidecarError ? e.message : String(e);
      setError(msg);
    } finally {
      // 无论成功失败都清空 buffer 和选中态，避免 UI 卡住
      setSelectionBuffer([]);
      setSelectedSentenceIds(new Set());
    }
  }, [invokeExtract, advanceField]);

  // ============================================
  // Task 4：Shift / Escape 键盘监听
  //
  // 为何在 useEffect 而非 onKeyDown 组件 prop：
  // DocxPreview 是 DOM 操作组件，焦点不在 React 元素上；
  // window 级监听保证用户在 docx 预览区操作时也能触发
  // ============================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true);
      }
      if (e.key === 'Escape') {
        // 取消多选积累
        setSelectionBuffer([]);
        setSelectedSentenceIds(new Set());
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
        // Shift 松开时 flush 积累的选择
        // 此处直接读 ref，避免闭包捕获到旧 selectionBuffer state
        if (selectionBufferRef.current.length > 0) {
          void flushSelectionBuffer();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [flushSelectionBuffer]);

  // ============================================
  // Task 4：用户点击段落或句子的统一处理
  // - shiftKey=true：积累到 buffer，不立即调 sidecar
  // - shiftKey=false：单次调用 sidecar，advanceField
  // ============================================
  const handleSelectionClick = useCallback(async (sel: SelectionClick) => {
    if (!currentFieldIdRef.current) return;

    if (sel.shiftKey) {
      // 多选积累模式：只更新 UI 选中态，不调 sidecar
      setSelectionBuffer((prev) => [...prev, sel]);
      if (sel.sentenceIdx) {
        setSelectedSentenceIds((prev) => new Set([...prev, sel.sentenceIdx!]));
      }
      return;
    }

    // 单选模式：直接调 sidecar
    const fieldId = currentFieldIdRef.current!;
    try {
      await invokeExtract([sel.paraIdx], sel.text, fieldId);
      advanceField();
    } catch (e) {
      const msg = e instanceof SidecarError ? e.message : String(e);
      setError(msg);
    }
    // 清除可能残留的选中态（如用户先 shift 了几句，再普通单击）
    setSelectedSentenceIds(new Set());
  }, [invokeExtract, advanceField]);

  // ============================================
  // 跳转到指定字段（临时打断顺序推进）
  // 记录下一个待续字段，完成跳转字段后回到它
  // ============================================
  const handleJump = (fieldId: string) => {
    const idx = fields.findIndex((f) => f.id === currentFieldId);
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

  // 当前字段标签，用于 hint 文字
  const currentFieldLabel = FIELD_DEFS.find((f) => f.id === currentFieldId)?.label ?? '';

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
          {/* 当前待选字段提示条
              shift 按下时变为积累模式提示，背景色切换为 accent-dim 让用户明确感知到"正在多选" */}
          <div
            style={{
              padding: 10,
              background: isShiftPressed ? 'var(--c-accent-dim)' : 'var(--c-raised)',
              fontSize: 12,
              color: isShiftPressed ? 'var(--c-fg)' : 'var(--c-fg-muted)',
              flexShrink: 0,
              transition: 'background-color 0.15s ease',
            }}
          >
            {currentFieldId
              ? isShiftPressed
                ? `多选中 · 已选 ${selectionBuffer.length} 句，松开 Shift 提交 · Esc 取消`
                : `请为「${currentFieldLabel}」选取段落\u3000按住 Shift 可多选多句，松开 Shift 提交 · Esc 取消`
              : '所有字段已完成或跳过，点击右上方「保存为模板」'}
          </div>
          <DocxPreview
            file={docxPath}
            onSelectionClick={handleSelectionClick}
            hoveredFieldId={currentFieldId ?? undefined}
            selectedSentenceIds={selectedSentenceIds}
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

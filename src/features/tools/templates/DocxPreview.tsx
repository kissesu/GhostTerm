/**
 * @file DocxPreview.tsx
 * @description docx-preview.js 包装组件：渲染 docx 并注入 data-para-idx（段落级）
 *              与 data-sent-idx（句子级）。支持单击选取单句，以及 shift 多选积累。
 *              复用 Editor 层已有的 read_image_bytes_cmd（返回 base64 字符串）。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { renderAsync } from 'docx-preview';

/**
 * 段落与句子交互样式（scoped 到 .docx-preview-container）
 *
 * 业务逻辑：
 * 1. [data-para-idx] 保留光标效果，作为无句子分割时的回退点击目标
 * 2. [data-sent-idx] 是按句选取的主交互单元，拥有独立高亮逻辑
 * 3. .docx-sent-selected 由父组件通过 selectedSentenceIds 驱动（不在组件内管理），
 *    以保证 shift 多选时跨渲染周期的视觉一致性
 * 注入为 inline <style> 避免 docx-preview 内联样式污染全局
 */
const DOCX_PARA_STYLES = `
.docx-preview-container [data-para-idx] {
  cursor: pointer;
  transition: background-color 0.12s ease, outline-color 0.12s ease;
  border-radius: 3px;
  outline: 1px solid transparent;
  outline-offset: 2px;
}
.docx-preview-container [data-para-idx]:hover {
  background-color: var(--c-accent-dim);
}
.docx-preview-container [data-para-idx].docx-para-selected {
  background-color: var(--c-accent-dim);
  outline-color: var(--c-accent);
}
.docx-preview-container [data-sent-idx] {
  cursor: pointer;
  transition: background-color 0.12s ease;
  border-radius: 2px;
}
.docx-preview-container [data-sent-idx]:hover {
  background-color: var(--c-accent-dim);
}
.docx-preview-container [data-sent-idx].docx-sent-selected {
  background-color: var(--c-accent-dim);
  outline: 1px solid var(--c-accent);
  outline-offset: 1px;
}
`;

/** 将 base64 字符串转换为 ArrayBuffer（与 WordPreview.tsx 保持一致） */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

/** 用户点击段落或句子时的选择数据 */
export interface SelectionClick {
  /** 段落在文档中的 0-based 顺序索引 */
  paraIdx: number;
  /** 句子在段落内的索引，格式 "段落索引.句子索引"，如 "2.1"；整段点击时 undefined */
  sentenceIdx?: string;
  /** 被选中的文本内容 */
  text: string;
  /** 是否按住 Shift 键（多选积累模式） */
  shiftKey: boolean;
}

interface DocxPreviewProps {
  /** docx 文件的绝对路径 */
  file: string;
  /** 点击段落或句子时的统一回调 */
  onSelectionClick?: (selection: SelectionClick) => void;
  /** 当前高亮字段 ID（供后续视觉提示扩展使用，当前未渲染） */
  hoveredFieldId?: string;
  /** 外部传入的已选句子 id 集合（格式 "para.sent"），组件负责同步到 DOM class */
  selectedSentenceIds?: Set<string>;
}

/**
 * 将段落 textContent 按中文句子终止符切分为句子数组
 *
 * 业务逻辑：
 * - 切分标点包含中文句末停顿符（。！？）和中文标点（；：）
 * - 使用 capture group 让分隔符保留在前一句末尾，而非丢弃
 * - 若段落无任何标点则整段视为一句（兼容英文/数字段落）
 * - 空字符串 / 全空白句子跳过，但仍计入索引（保持 DOM 与索引对应）
 */
function splitIntoSentences(text: string): string[] {
  // 用捕获组切分，确保标点归属于前一句
  const parts = text.split(/([。！？；：])/g);
  const sentences: string[] = [];
  // 两两合并：segment + punct → 一句；尾部单独 segment 直接压入
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i] ?? '';
    const punct = parts[i + 1] ?? '';
    const sentence = segment + punct;
    if (sentence.trim().length > 0) {
      sentences.push(sentence);
    }
  }
  // 若无标点，整段作为一句（sentences 此时仍是空数组）
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push(text);
  }
  return sentences;
}

// 样式注入标记，保证多实例挂载只插一次 <style> 到 document.head
const DOCX_PARA_STYLE_ID = 'ghostterm-docx-para-styles';

function ensureParaStylesInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DOCX_PARA_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = DOCX_PARA_STYLE_ID;
  el.textContent = DOCX_PARA_STYLES;
  document.head.appendChild(el);
}

export function DocxPreview({
  file,
  onSelectionClick,
  selectedSentenceIds,
}: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 挂载时确保段落交互样式已注入 head（docx-preview 会清空容器，故不能放子节点）
  useEffect(() => {
    ensureParaStylesInjected();
  }, []);

  // ============================================
  // Effect 1：加载并渲染 docx，注入 data-para-idx
  // ============================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // 清空上一次渲染（切换 file 时重置容器）
    container.innerHTML = '';

    invoke<string>('read_image_bytes_cmd', { path: file })
      .then((base64) => {
        if (cancelled) return;
        const buffer = base64ToArrayBuffer(base64);
        if (!containerRef.current) return;
        return renderAsync(buffer, containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });
      })
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // 注入 data-para-idx 到每个段落元素
        const paragraphs = containerRef.current.querySelectorAll('.docx-paragraph, p');
        paragraphs.forEach((p, idx) => {
          p.setAttribute('data-para-idx', String(idx));
        });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[DocxPreview] 渲染失败：', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // ============================================
  // Effect 2：在段落注入完成后，对每个段落内的文本按句切分，
  //           并用 <span data-sent-idx> 包裹每个句子。
  //
  // 为何用 MutationObserver 而非直接在 Effect 1 的 .then 里做：
  //   Effect 2 的依赖仅是 file，与 Effect 1 的 file 相同，
  //   但 Effect 2 注册的 MutationObserver 可以等到段落 DOM 真正写入后
  //   再执行切分，避免时序竞争（renderAsync 内部可能有多轮 microtask）。
  // 实际上两个 Effect 依赖相同 file，执行顺序保证 Effect 1 先 attach，
  // Effect 2 拿到的是 Effect 1 结束时已有内容的 container，
  // 因此改用单个 Effect 的 then 链更可靠，这里直接在渲染完后的 microtask 中做切分。
  //
  // 注意：这里不直接嵌入 Effect 1，而是用单独 Effect，利用 React
  //       同步批次保证两个 Effect 都在同一 commit 后运行，且 Effect 1 先于 Effect 2。
  // ============================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // 等到 docx 渲染完成（段落被写入 DOM）后执行句子切分
    // 利用一个简单轮询检查 data-para-idx 是否已注入，避免与 Effect 1 的 then 链竞争
    const tryWrap = () => {
      if (cancelled || !containerRef.current) return;
      const paragraphs = containerRef.current.querySelectorAll<HTMLElement>('[data-para-idx]');
      if (paragraphs.length === 0) {
        // 段落尚未注入，100ms 后重试（docx-preview 渲染为异步）
        setTimeout(tryWrap, 100);
        return;
      }
      wrapSentences(paragraphs, cancelled);
    };

    /**
     * 对每个段落 p 的 textContent 按句切分，替换原始 innerHTML 为
     * 多个 <span data-sent-idx="p.s" data-para-idx="p"> 包裹的句子。
     *
     * 为何替换 innerHTML 而非操作 TextNode：
     * docx-preview 段落内可能有嵌套 span（如字体设定），直接操作 TextNode 需要
     * 递归遍历、分裂节点，实现复杂且易遗漏 CSS。替换 innerHTML 虽损失了嵌套
     * span 的内联样式，但对于字段属性读取场景（样式来自 python-docx XML API，
     * 不依赖前端 CSS），这是可接受的权衡。
     */
    function wrapSentences(paragraphs: NodeListOf<HTMLElement>, isCancelled: boolean) {
      if (isCancelled) return;
      paragraphs.forEach((p) => {
        const pIdx = p.getAttribute('data-para-idx') ?? '0';
        const rawText = p.textContent ?? '';
        const sentences = splitIntoSentences(rawText);

        if (sentences.length <= 1) {
          // 单句段落：整段可点击，无需拆分 span；保留 data-para-idx 即可
          return;
        }

        // 多句段落：用 span 包裹每句，保留整段 data-para-idx 用于回退逻辑
        const spans = sentences
          .map((text, sIdx) => {
            // 对 data-sent-text 做 HTML 属性转义，避免引号注入
            const escaped = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            return `<span data-para-idx="${pIdx}" data-sent-idx="${pIdx}.${sIdx}" data-sent-text="${escaped}">${text}</span>`;
          })
          .join('');
        p.innerHTML = spans;
      });
    }

    tryWrap();

    return () => {
      cancelled = true;
    };
  }, [file]);

  // ============================================
  // Effect 3：将外部 selectedSentenceIds 同步到 DOM .docx-sent-selected class
  //
  // 为何由父组件持有而非内部 state：
  // shift 多选需要跨多次点击积累，RuleTemplateWorkspace 需要持有选中集合来决定
  // 何时 flush sidecar 调用；若 DocxPreview 内部持有则需要 ref 透传或 context，
  // 还不如直接提升到父组件，组件只负责 class 同步（单向数据流）。
  // ============================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 清除所有已有选中 class
    container.querySelectorAll('.docx-sent-selected').forEach((el) => {
      el.classList.remove('docx-sent-selected');
    });

    if (!selectedSentenceIds || selectedSentenceIds.size === 0) return;

    selectedSentenceIds.forEach((sentId) => {
      const el = container.querySelector(`[data-sent-idx="${sentId}"]`);
      if (el) el.classList.add('docx-sent-selected');
    });
  }, [selectedSentenceIds]);

  // ============================================
  // 事件委托：监听容器 click，优先找 [data-sent-idx]，回退到 [data-para-idx]
  // ============================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: Event) => {
      const me = e as MouseEvent;
      const target = e.target as HTMLElement;

      // 优先按句子粒度匹配
      const sentEl = target.closest<HTMLElement>('[data-sent-idx]');
      if (sentEl) {
        const sentIdx = sentEl.getAttribute('data-sent-idx') ?? '';
        const paraIdx = parseInt(sentEl.getAttribute('data-para-idx') ?? '-1', 10);
        const text = sentEl.getAttribute('data-sent-text') ?? sentEl.textContent ?? '';
        if (paraIdx >= 0 && sentIdx) {
          onSelectionClick?.({
            paraIdx,
            sentenceIdx: sentIdx,
            text,
            shiftKey: me.shiftKey,
          });
        }
        return;
      }

      // 回退：整段点击（段落未被拆分为句子的情况）
      const paraEl = target.closest<HTMLElement>('[data-para-idx]');
      if (paraEl) {
        const paraIdx = parseInt(paraEl.getAttribute('data-para-idx') ?? '-1', 10);
        if (paraIdx >= 0) {
          onSelectionClick?.({
            paraIdx,
            text: paraEl.textContent ?? '',
            shiftKey: me.shiftKey,
          });
        }
      }
    };

    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [onSelectionClick]);

  return (
    <div
      ref={containerRef}
      className="docx-preview-container"
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--c-bg)',
        padding: 20,
      }}
    />
  );
}

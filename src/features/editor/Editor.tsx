/**
 * @file Editor.tsx - CodeMirror 6 编辑器组件
 * @description 多标签文件编辑器：根据 activeFilePath 渲染对应文件的 CodeMirror 6 实例
 *              支持语法高亮（Lezer 动态加载）、暗/亮双主题（跟随 themeStore）、Cmd/Ctrl+S 保存快捷键
 *              对 binary/large/error 类型文件展示对应的占位状态
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import type { LanguageSupport } from '@codemirror/language';
import { useEditorStore } from './editorStore';
import { useThemeStore } from '../../shared/stores/themeStore';
import { WordPreview } from './WordPreview';
import { SpreadsheetPreview } from './SpreadsheetPreview';

/** 根据文件路径后缀判断是否为 Word 文档 */
const WORD_EXTS = new Set(['docx', 'doc']);
/** 根据文件路径后缀判断是否为 Excel 表格 */
const SHEET_EXTS = new Set(['xlsx', 'xls']);

/** 语言包动态映射表 - 按需 import 避免打包体积过大 */
const LANG_MAP: Record<string, () => Promise<LanguageSupport>> = {
  js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  ts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then((m) =>
    m.javascript({ jsx: true, typescript: true })
  ),
  rs: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
};

/** 语言隔间 - 用于运行时动态切换语法高亮，无需重建整个编辑器状态 */
const langCompartment = new Compartment();

/**
 * 主题隔间 - 用于运行时动态切换 dark/light 主题
 * 通过 dispatch(themeCompartment.reconfigure(...)) 切换，不重建 editor，不丢失撤销历史
 */
const themeCompartment = new Compartment();

/**
 * GhostTerm 浅色主题 — 匹配 Obsidian Forge light 设计令牌
 * 不使用第三方 light 主题包，手写令牌覆盖以匹配 var(--c-*) 体系
 */
const ghosttermLight = EditorView.theme({
  '&': { backgroundColor: '#f7f4ef', color: '#1e2038' },
  '.cm-content': { caretColor: '#9b6e00' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#9b6e00' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#9b6e0026',
  },
  '.cm-gutters': { backgroundColor: '#ede9e3', color: '#8090b0', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: '#d4cfc7' },
  '.cm-activeLine': { backgroundColor: '#ede9e340' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: '#9b6e0022' },
}, { dark: false });

/**
 * 图片预览组件
 *
 * 业务逻辑：
 * 1. 通过 invoke 读取图片原始字节（Base64）
 * 2. 拼接 data URL 作为 <img> src，无需配置 asset 协议权限
 * 3. 加载中/失败分别显示对应状态
 */
function ImagePreview({ path, mimeHint }: { path: string; mimeHint: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    setError(null);
    invoke<string>('read_image_bytes_cmd', { path })
      .then((b64) => setSrc(`data:${mimeHint};base64,${b64}`))
      .catch((e) => setError(String(e)));
  }, [path, mimeHint]);

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#f7768e',
          fontSize: '14px',
        }}
      >
        {error}
      </div>
    );
  }

  if (!src) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#565f89',
          fontSize: '14px',
        }}
      >
        加载中...
      </div>
    );
  }

  return (
    <div
      data-testid="editor-image"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        overflow: 'auto',
        padding: '16px',
      }}
    >
      <img
        src={src}
        alt={path.split('/').pop()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          borderRadius: '4px',
        }}
      />
    </div>
  );
}

export default function Editor() {
  const { openFiles, activeFilePath, saveFile, updateContent } = useEditorStore();
  // 订阅已解析的主题模式（dark/light），驱动 CodeMirror 主题切换
  const mode = useThemeStore((s) => s.mode);

  // CodeMirror 挂载 DOM 容器引用
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // CodeMirror EditorView 实例引用，用于销毁和更新
  const viewRef = useRef<EditorView | null>(null);
  // 追踪上一次渲染的文件路径，用于判断是否需要重建编辑器
  const prevPathRef = useRef<string | null>(null);

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;

  // ============================================
  // Cmd/Ctrl+S 保存快捷键
  // 挂载到 document 以捕获焦点在 CodeMirror 内部时的按键事件
  // ============================================
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeFilePath) {
          saveFile(activeFilePath);
        }
      }
    },
    [activeFilePath, saveFile]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // ============================================
  // CodeMirror 编辑器生命周期管理
  // 切换文件时销毁旧实例，重建新实例
  // ============================================
  useEffect(() => {
    // 非 text 类型文件不需要 CodeMirror 实例
    if (!activeFile || activeFile.kind !== 'text') {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      return;
    }

    if (!editorContainerRef.current) return;

    // 切换文件时销毁旧实例
    if (viewRef.current && prevPathRef.current !== activeFilePath) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    prevPathRef.current = activeFilePath;

    // 创建新的 EditorView 实例
    const state = EditorState.create({
      doc: activeFile.content,
      extensions: [
        basicSetup,
        // 主题隔间：根据当前 mode 初始化，后续由独立 effect 热切换
        themeCompartment.of(mode === 'dark' ? oneDark : ghosttermLight),
        // 语言隔间初始为空，异步加载后通过 dispatch 更新
        langCompartment.of([]),
        // 监听内容变化，更新 editorStore
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            if (activeFilePath) {
              updateContent(activeFilePath, newContent);
            }
          }
        }),
        // 编辑器基本样式
        EditorView.theme({
          '&': { height: '100%', minWidth: '0', minHeight: '0', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'JetBrains Mono, Menlo, monospace' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    viewRef.current = view;

    // 异步加载语言包并注入
    const langLoader = LANG_MAP[activeFile.language];
    if (langLoader) {
      langLoader().then((lang) => {
        if (viewRef.current && prevPathRef.current === activeFilePath) {
          viewRef.current.dispatch({
            effects: langCompartment.reconfigure(lang),
          });
        }
      });
    }

    return () => {
      // cleanup：组件卸载时销毁实例
    };
  }, [activeFilePath, activeFile?.kind]);

  // ============================================
  // 主题热切换：mode 变化时通过 Compartment.reconfigure 更新
  // 不重建 editor，不丢失撤销历史
  // ============================================
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.reconfigure(mode === 'dark' ? oneDark : ghosttermLight),
    });
  }, [mode]);

  // ============================================
  // 组件卸载时销毁 CodeMirror 实例
  // ============================================
  useEffect(() => {
    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []);

  // ============================================
  // 渲染：根据文件类型展示不同 UI
  // ============================================

  // 无激活文件：空白欢迎状态
  if (!activeFile) {
    return (
      <div
        data-testid="editor-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#565f89',
          fontSize: '14px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span>打开文件以开始编辑</span>
      </div>
    );
  }

  // 二进制文件：按扩展名路由到图片/Word/Excel 预览，其他类型展示占位符
  if (activeFile.kind === 'binary') {
    const ext = activeFile.path.split('.').pop()?.toLowerCase() ?? '';
    const isImage = activeFile.mimeHint?.startsWith('image/') ?? false;

    if (WORD_EXTS.has(ext)) {
      return <WordPreview path={activeFile.path} />;
    }

    if (SHEET_EXTS.has(ext)) {
      return <SpreadsheetPreview path={activeFile.path} />;
    }

    if (isImage) {
      return (
        <ImagePreview path={activeFile.path} mimeHint={activeFile.mimeHint!} />
      );
    }
    return (
      <div
        data-testid="editor-binary"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#565f89',
          fontSize: '14px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span>二进制文件，无法编辑</span>
        {activeFile.mimeHint && (
          <span style={{ fontSize: '12px', opacity: 0.7 }}>{activeFile.mimeHint}</span>
        )}
      </div>
    );
  }

  // 大文件只读提示
  if (activeFile.kind === 'large') {
    return (
      <div
        data-testid="editor-large"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#e0af68',
          fontSize: '14px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span>文件过大，无法在编辑器中打开</span>
        <span style={{ fontSize: '12px', color: '#565f89' }}>
          建议使用系统默认程序打开
        </span>
      </div>
    );
  }

  // 错误状态
  if (activeFile.kind === 'error') {
    const isEncodingError = activeFile.errorMessage?.includes('Detected encoding:') ?? false;
    return (
      <div
        data-testid="editor-error"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#f7768e',
          fontSize: '14px',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <span>{activeFile.errorMessage}</span>
        {isEncodingError && (
          <button
            style={{
              padding: '6px 16px',
              borderRadius: '4px',
              border: '1px solid #565f89',
              background: 'transparent',
              color: '#c0caf5',
              cursor: 'pointer',
              fontSize: '13px',
            }}
            onClick={() => {
              // TODO: PBI-2 扩展：以 latin1 只读模式重新打开
              // 当前仅作为 UI 占位，点击无操作
            }}
          >
            以只读模式打开
          </button>
        )}
      </div>
    );
  }

  // text 文件：CodeMirror 编辑器
  return (
    <div
      data-testid="editor-container"
      ref={editorContainerRef}
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
    />
  );
}

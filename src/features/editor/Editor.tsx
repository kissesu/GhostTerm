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
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { openSearchPanel, gotoLine, selectNextOccurrence, searchKeymap } from '@codemirror/search';
import {
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  selectLine,
  deleteLine,
  insertBlankLine,
  indentWithTab,
} from '@codemirror/commands';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import type { LanguageSupport } from '@codemirror/language';
import { useEditorStore } from './editorStore';
import { useThemeStore } from '../../shared/stores/themeStore';
import { useGitStore } from '../sidebar/gitStore';
import { useProjectStore } from '../sidebar/projectStore';
import { WordPreview } from './WordPreview';
import { SpreadsheetPreview } from './SpreadsheetPreview';
import EditorStatusbar from './EditorStatusbar';
import { urlHyperlinkPlugin, urlLinkTheme } from './urlPlugin';
import { gitGutterExtension, gitDiffField, setGitDiffEffect, parseDiffToLineMap } from './gitGutter';

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

/**
 * 未注册语言包的扩展名 → 注释标记（line / block）映射
 *
 * 业务逻辑说明：
 * CodeMirror 的 Cmd+/（toggleLineComment）依赖语言数据中的 commentTokens；
 * 对未在 LANG_MAP 中注册的常见配置/脚本/标记型文件，通过 EditorState.languageData
 * 直接注入 commentTokens，使快捷键即时可用，无需引入完整语言包。
 *
 * 选择规则：
 * - YAML / TOML / Shell / Bash / Python-style 配置 → '#'
 * - INI → ';'
 * - Markdown / XML / SVG → 块注释 '<!-- -->'
 * - SCSS / LESS / SQL → C-style 行 + 块注释（SQL 用 '--' 行）
 */
const FALLBACK_COMMENT_TOKENS: Record<string, { line?: string; block?: { open: string; close: string } }> = {
  md: { block: { open: '<!--', close: '-->' } },
  markdown: { block: { open: '<!--', close: '-->' } },
  yaml: { line: '#' },
  yml: { line: '#' },
  toml: { line: '#' },
  sh: { line: '#' },
  bash: { line: '#' },
  zsh: { line: '#' },
  fish: { line: '#' },
  ini: { line: ';' },
  conf: { line: '#' },
  xml: { block: { open: '<!--', close: '-->' } },
  svg: { block: { open: '<!--', close: '-->' } },
  // CSS 预处理器：lang-css 仅注册了 .css，scss/less 走 fallback
  scss: { line: '//', block: { open: '/*', close: '*/' } },
  less: { line: '//', block: { open: '/*', close: '*/' } },
  // SQL 行注释为 '--'，块注释 '/* */'
  sql: { line: '--', block: { open: '/*', close: '*/' } },
};

/**
 * CodeMirror 内置 panel 文案中文化字典
 *
 * 业务说明：
 * search panel (Cmd+F) + goto-line panel (Cmd+G) 内文案默认英文，
 * 通过 EditorState.phrases.of() 注入英文 key → 中文映射，
 * 所有走 phrase() 的内置文案自动汉化（无 key 命中的项保持英文兜底）。
 *
 * key 来源：@codemirror/search 源码中 phrase('xxx') 调用点全集
 */
const CN_PHRASES: Record<string, string> = {
  // search panel
  'Find': '查找',
  'Replace': '替换',
  'next': '下一处',
  'previous': '上一处',
  'all': '全部',
  'match case': '区分大小写',
  'by word': '全词匹配',
  'regexp': '正则',
  'replace': '替换',
  'replace all': '全部替换',
  'close': '关闭',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行匹配',
  'on line': '在行',
  // goto-line panel
  'Go to line': '跳转到行',
  'go': '跳转',
};

/** 语言隔间 - 用于运行时动态切换语法高亮，无需重建整个编辑器状态 */
const langCompartment = new Compartment();

/**
 * 主题隔间 - 用于运行时动态切换 dark/light 主题
 * 通过 dispatch(themeCompartment.reconfigure(...)) 切换，不重建 editor，不丢失撤销历史
 */
const themeCompartment = new Compartment();

/**
 * 软换行隔间 - toggle 长行不滚动横向（EditorView.lineWrapping）
 * React 层用 lineWrap 状态驱动，dispatch reconfigure 切换
 */
const wrapCompartment = new Compartment();

/**
 * 增强 keymap：补 basicSetup 没有的 IDE 高频功能 + Cmd+F 强优先级（避免外层吞键）
 *
 * 业务说明：
 * - Mod-f 用 Prec.highest 显式注册 openSearchPanel，防止全局 keydown 监听器（如
 *   useKeyboardShortcuts）或 WKWebView 默认行为屏蔽编辑器内置 searchKeymap
 * - Mod-d / Mod-l / Mod-Shift-k / Alt-Up/Down / Cmd-Enter 等 VSCode 同款行为
 *   通过 @codemirror/commands + @codemirror/search 内置命令直接挂载
 * - basicSetup 已有 historyKeymap/foldKeymap/closeBracketsKeymap/lintKeymap，
 *   不要重复加避免冲突；searchKeymap 也已有但 Mod-f 单独提优先级
 */
const enhancedKeymap = Prec.highest(
  keymap.of([
    // ============================================
    // 搜索 / 跳转
    // ============================================
    { key: 'Mod-f', run: openSearchPanel, preventDefault: true },
    { key: 'Mod-g', run: gotoLine, preventDefault: true },
    { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
    // 包含整套 searchKeymap 兜底（next/prev/replace 等）— 高优先级让其不被外层覆盖
    ...searchKeymap,
    // ============================================
    // 行操作（VSCode 风格）
    // ============================================
    { key: 'Alt-ArrowUp', run: moveLineUp, preventDefault: true },
    { key: 'Alt-ArrowDown', run: moveLineDown, preventDefault: true },
    { key: 'Shift-Alt-ArrowUp', run: copyLineUp, preventDefault: true },
    { key: 'Shift-Alt-ArrowDown', run: copyLineDown, preventDefault: true },
    { key: 'Mod-l', run: selectLine, preventDefault: true },
    { key: 'Mod-Shift-k', run: deleteLine, preventDefault: true },
    { key: 'Mod-Enter', run: insertBlankLine, preventDefault: true },
    // Tab/Shift-Tab 缩进 - CM6 默认不绑（a11y 让 Tab 切焦点），IDE 风格必须显式启用
    // 副作用：编辑器内 Tab 不再切焦点；用户切焦点请用 Cmd+B/Cmd+`
    indentWithTab,
  ]),
);

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
          color: 'var(--c-danger)',
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
          color: 'var(--c-fg-subtle)',
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
  const { openFiles, activeFilePath, saveFile, updateContent, pendingScrollLine, clearPendingScroll } = useEditorStore();
  // 订阅已解析的主题模式（dark/light），驱动 CodeMirror 主题切换
  const mode = useThemeStore((s) => s.mode);

  // CodeMirror 挂载 DOM 容器引用
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // CodeMirror EditorView 实例引用，用于销毁和更新
  const viewRef = useRef<EditorView | null>(null);
  // 追踪上一次渲染的文件路径，用于判断是否需要重建编辑器
  const prevPathRef = useRef<string | null>(null);

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;

  // 当前项目根路径 + git changes 用于驱动 git gutter 刷新
  const currentProjectPath = useProjectStore((s) => s.currentProject?.path);
  const gitChanges = useGitStore((s) => s.changes);

  // 状态栏数据：每次 selectionSet/docChanged 时由 updateListener 同步
  const [statusInfo, setStatusInfo] = useState({
    cursorLine: 1,
    cursorCol: 1,
    selChars: 0,
    selLines: 0,
    totalLines: 1,
    eol: 'LF' as 'LF' | 'CRLF',
    indent: { type: 'spaces' as 'spaces' | 'tabs', size: 2 },
  });
  // 软换行 toggle - 默认关，由 wrapCompartment 控制 EditorView.lineWrapping
  const [lineWrap, setLineWrap] = useState(false);

  // 探测 doc 缩进 + EOL（仅在文件挂载时算一次，不随光标移动重算）
  // 简化：扫前 30 个非空行，统计 \t 与开头空格数最频繁项
  const detectDocMeta = useCallback((text: string) => {
    const eol: 'LF' | 'CRLF' = text.includes('\r\n') ? 'CRLF' : 'LF';
    const lines = text.split(/\r?\n/).slice(0, 30);
    let tabs = 0;
    const spaceCounts = new Map<number, number>();
    for (const l of lines) {
      if (!l.trim()) continue;
      if (l.startsWith('\t')) {
        tabs++;
      } else {
        const m = /^( +)/.exec(l);
        if (m) {
          const n = m[1].length;
          spaceCounts.set(n, (spaceCounts.get(n) ?? 0) + 1);
        }
      }
    }
    let indent: { type: 'spaces' | 'tabs'; size: number } = { type: 'spaces', size: 2 };
    if (tabs > [...spaceCounts.values()].reduce((a, b) => a + b, 0)) {
      indent = { type: 'tabs', size: 1 };
    } else {
      // 取最小公约数风格的最常见缩进（2 / 4 优先）
      const best = [...spaceCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) indent = { type: 'spaces', size: best[0] };
    }
    return { eol, indent };
  }, []);

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

    // 计算 fallback commentTokens：仅对未在 LANG_MAP 注册的扩展名生效
    // 已加载语言包的文件使用其自带 commentTokens，避免冲突
    const fallbackTokens = LANG_MAP[activeFile.language]
      ? null
      : FALLBACK_COMMENT_TOKENS[activeFile.language] ?? null;

    // 创建新的 EditorView 实例
    const initialMeta = detectDocMeta(activeFile.content);
    const state = EditorState.create({
      doc: activeFile.content,
      extensions: [
        // 增强 keymap 顶置 Prec.highest：保证 Cmd+F 等不被外层 keydown 监听器吞键
        enhancedKeymap,
        // CM 内置 panel 文案中文化（search/goto-line 等）
        EditorState.phrases.of(CN_PHRASES),
        basicSetup,
        // 主题隔间：根据当前 mode 初始化，后续由独立 effect 热切换
        // dark 模式叠加 bgOverride 覆盖 oneDark 背景色，对齐终端锚点
        themeCompartment.of(mode === 'dark' ? oneDark : ghosttermLight),
        // 语言隔间初始为空，异步加载后通过 dispatch 更新
        langCompartment.of([]),
        // 软换行隔间 - lineWrap state 切换时 reconfigure
        wrapCompartment.of(lineWrap ? EditorView.lineWrapping : []),
        // 缩进辅助线：可视化对齐 yaml/json/python 等深嵌套结构
        indentationMarkers(),
        // URL/路径超链接 + Cmd/Ctrl+点击打开
        urlHyperlinkPlugin,
        urlLinkTheme,
        // Git 行级 gutter（gitDiffField 由独立 effect 拉 git_diff_cmd 后 dispatch 写入）
        gitGutterExtension,
        // Fallback commentTokens：让 Cmd+/ 在 .md/.yaml/.toml/.sh/.ini 等
        // 未注册语言包的常见配置/脚本/标记型文件上立即可用
        ...(fallbackTokens
          ? [EditorState.languageData.of(() => [{ commentTokens: fallbackTokens }])]
          : []),
        // 监听内容变化，更新 editorStore + 状态栏数据
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            if (activeFilePath) {
              updateContent(activeFilePath, newContent);
            }
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            const headLine = update.state.doc.lineAt(sel.head);
            const selChars = Math.abs(sel.to - sel.from);
            const selFromLine = update.state.doc.lineAt(sel.from).number;
            const selToLine = update.state.doc.lineAt(sel.to).number;
            setStatusInfo((prev) => ({
              ...prev,
              cursorLine: headLine.number,
              cursorCol: sel.head - headLine.from + 1,
              selChars,
              selLines: selChars > 0 ? selToLine - selFromLine + 1 : 0,
              totalLines: update.state.doc.lines,
            }));
          }
        }),
        // 编辑器基本样式 + 搜索/跳转弹窗样式 + 行号鼠标手势
        // CM6 panels 默认 inherit 浏览器 input/button 样式（极小+无圆角），必须 theme 显式提升
        EditorView.theme({
          '&': { height: '100%', minWidth: '0', minHeight: '0', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'JetBrains Mono, Menlo, monospace' },
          '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer' },
          // ============================================
          // Search panel (Cmd+F) + Goto-line panel (Cmd+G) 样式提升
          // 用 CSS token 跟随 dark/light 主题
          // ============================================
          '.cm-panels': { fontSize: '13px', fontFamily: 'var(--font-ui)' },
          '.cm-panel.cm-search': {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            background: 'var(--c-bg-2, transparent)',
            borderTop: '1px solid var(--c-border-sub, transparent)',
          },
          '.cm-panel.cm-search input.cm-textfield': {
            padding: '6px 10px',
            minHeight: '30px',
            fontSize: '13px',
            border: '1px solid var(--c-border-sub)',
            borderRadius: '6px',
            background: 'var(--c-bg)',
            color: 'var(--c-fg)',
            outline: 'none',
          },
          '.cm-panel.cm-search input.cm-textfield:focus': {
            borderColor: 'var(--c-accent)',
            boxShadow: '0 0 0 2px var(--c-accent-dim)',
          },
          '.cm-panel.cm-search button': {
            padding: '6px 12px',
            minHeight: '30px',
            fontSize: '12px',
            border: '1px solid var(--c-border-sub)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--c-fg)',
            cursor: 'pointer',
          },
          '.cm-panel.cm-search button:hover': { background: 'var(--c-hover)' },
          '.cm-panel.cm-search label': {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            color: 'var(--c-fg-muted)',
          },
          '.cm-panel.cm-search [name="close"]': {
            border: 'none',
            background: 'transparent',
            color: 'var(--c-fg-muted)',
            fontSize: '16px',
            padding: '4px 8px',
          },
          '.cm-panel.cm-gotoLine': {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            background: 'var(--c-bg-2, transparent)',
            borderTop: '1px solid var(--c-border-sub, transparent)',
          },
          '.cm-panel.cm-gotoLine input': {
            flex: '1',
            padding: '6px 10px',
            minHeight: '30px',
            fontSize: '13px',
            border: '1px solid var(--c-border-sub)',
            borderRadius: '6px',
            background: 'var(--c-bg)',
            color: 'var(--c-fg)',
            outline: 'none',
          },
          '.cm-panel.cm-gotoLine input:focus': {
            borderColor: 'var(--c-accent)',
            boxShadow: '0 0 0 2px var(--c-accent-dim)',
          },
          '.cm-panel.cm-gotoLine button': {
            padding: '6px 12px',
            minHeight: '30px',
            fontSize: '12px',
            border: '1px solid var(--c-border-sub)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--c-fg)',
            cursor: 'pointer',
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    viewRef.current = view;

    // 应用初始 EOL/缩进/总行 到状态栏（光标信息由首次 selectionSet 触发后写入）
    setStatusInfo((prev) => ({
      ...prev,
      eol: initialMeta.eol,
      indent: initialMeta.indent,
      totalLines: state.doc.lines,
    }));
    // 文件打开后立即 focus 编辑器，确保 Cmd+/ Cmd+F Cmd+Z 等 CodeMirror
    // 内置快捷键无需用户先点击编辑区域即可触发。
    //
    // a11y：当前焦点位于标签页列表（role="tablist"）时不抢焦，
    // 否则会破坏屏幕阅读器/键盘用户的标签页导航流（Tab 键切换 tab 后焦点立即被夺走）。
    // - 用户从 FileTree 点击文件：activeElement 在 tree button → 抢焦（预期）
    // - 用户点击编辑器 tab 切标签：activeElement 在 tablist 内 → 不抢焦（保留 tab 焦点）
    // - 启动/Open With 时 activeElement 为 body：抢焦（预期）
    //
    // 测试环境（vitest mock）下 view.focus 可能不存在，typeof 守卫即可
    if (typeof view.focus === 'function') {
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const isOnTablist = activeEl instanceof Element && activeEl.closest('[role="tablist"]') !== null;
      if (!isOnTablist) {
        view.focus();
      }
    }

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
      // dark 模式叠加 bgOverride，对齐终端锚点；light 模式用独立主题
      effects: themeCompartment.reconfigure(mode === 'dark' ? oneDark : ghosttermLight),
    });
  }, [mode]);

  // ============================================
  // 占位文件 hydrate：activeFile.content 与 view 中 doc 不一致时同步替换
  //
  // 业务逻辑说明：
  // 1. 启动 GhostTerm 时 loadPersistedSession 构造 content='' 的占位文件，
  //    restoreSession 同步设置 openFiles + activeFilePath，
  //    Editor 主 useEffect 立刻用空 doc 创建 EditorView。
  // 2. 随后 openProject 异步触发 openFile，从磁盘读取真实内容并替换占位。
  // 3. 但主 useEffect 依赖只有 [activeFilePath, activeFile?.kind]，
  //    content 变化不会触发重建。因此需独立 effect 把 activeFile.content
  //    通过 dispatch 替换到 EditorView，避免编辑器永远显示空白。
  //
  // 用户输入路径下：updateListener 把 doc → store content 同步，
  // effect 触发时 doc 与 content 已一致，比较后跳过 dispatch，无副作用。
  //
  // handleExternalChange 路径下：外部修改文件且用户无脏改时，
  // 此 effect 同步把新磁盘内容刷新到编辑器（顺带修复了原本不刷新的小坑）。
  // ============================================
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeFile || activeFile.kind !== 'text') return;
    // 测试环境（vitest mock）下 view.state / view.dispatch 可能不存在，typeof 守卫即可
    if (!view.state?.doc || typeof view.dispatch !== 'function') return;
    const current = view.state.doc.toString();
    if (current === activeFile.content) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: activeFile.content },
    });
  }, [activeFile?.content, activeFile?.kind]);

  // ============================================
  // Effect：监听 pendingScrollLine，滚动编辑器到指定行
  // 由 searchStore.confirmSelection() 写入 pendingScrollLine，
  // Editor 检测到后滚动到对应行并清除记录
  // ============================================
  useEffect(() => {
    if (!viewRef.current || !activeFilePath) return;
    const line = pendingScrollLine[activeFilePath];
    if (line == null) return;

    const doc = viewRef.current.state.doc;
    // line 是 1-based，CodeMirror doc.line() 也是 1-based
    if (line < 1 || line > doc.lines) return;

    const lineObj = doc.line(line);
    viewRef.current.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
    });
    clearPendingScroll(activeFilePath);
  }, [pendingScrollLine, activeFilePath, clearPendingScroll]);

  // ============================================
  // 行号点击选中整行 - native mousedown capture handler
  //
  // 业务说明：CodeMirror 6 的 lineNumbers gutter 在 gutter dom 上 directly-attached
  // mousedown listener 做 cursor placement，**不通过** EditorView.domEventHandlers 链路，
  // 因此 view-level handler return true 无法阻止。escape hatch：在 React ref 容器上
  // 用 native addEventListener capture: true，先于 CM 内部处理拦截，
  // event.preventDefault() + stopPropagation() 截停 + dispatch 行选区。
  // ============================================
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const gutter = target.closest('.cm-gutter');
      if (!gutter || !gutter.classList.contains('cm-lineNumbers')) return;
      const gutterEl = target.closest('.cm-gutterElement') as HTMLElement | null;
      if (!gutterEl) return;
      const lineNum = Number.parseInt(gutterEl.textContent ?? '', 10);
      if (!Number.isFinite(lineNum) || lineNum < 1) return;
      const view = viewRef.current;
      if (!view) return;
      if (lineNum > view.state.doc.lines) return;
      const line = view.state.doc.line(lineNum);
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: line.from, head: line.to },
        scrollIntoView: true,
      });
      view.focus();
    };
    // capture: true 让我们先于 CM 内部 listener 触发，preventDefault 才能截停默认 cursor 落点
    container.addEventListener('mousedown', handler, true);
    return () => container.removeEventListener('mousedown', handler, true);
  }, [activeFilePath]);

  // ============================================
  // Git 行级 gutter：拉 git_diff_cmd 解析 hunks → dispatch setGitDiffEffect
  //
  // 业务逻辑：
  // 1. 仅当有项目根 + 当前文件路径在项目内时拉 diff
  // 2. gitChanges 变化（如保存后 refreshGitStatus）触发重拉，保持 gutter 与文件树同步
  // 3. invoke 失败（非 git 仓库 / 命令异常）静默清空 line map
  // ============================================
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeFilePath || !currentProjectPath) return;
    if (!activeFilePath.startsWith(`${currentProjectPath}/`)) return;
    const relPath = activeFilePath.slice(currentProjectPath.length + 1);
    let cancelled = false;
    invoke<string>('git_diff_cmd', { repoPath: currentProjectPath, filePath: relPath })
      .then((diff) => {
        if (cancelled) return;
        const map = parseDiffToLineMap(diff ?? '');
        // 仅当 view 仍 alive 且 gitDiffField 存在（extension 已加载）才 dispatch
        if (view.state.field(gitDiffField, false) === undefined) return;
        view.dispatch({ effects: setGitDiffEffect.of(map) });
      })
      .catch(() => {
        // 静默：非 git 仓库、文件未跟踪等情形不报错，仅清空 gutter
        if (cancelled) return;
        if (view.state.field(gitDiffField, false) === undefined) return;
        view.dispatch({ effects: setGitDiffEffect.of(new Map()) });
      });
    return () => {
      cancelled = true;
    };
  }, [activeFilePath, currentProjectPath, gitChanges]);

  // ============================================
  // 状态栏交互：软换行 toggle + 跳转到行
  // ============================================
  const handleToggleWrap = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    setLineWrap((prev) => {
      const next = !prev;
      view.dispatch({
        effects: wrapCompartment.reconfigure(next ? EditorView.lineWrapping : []),
      });
      return next;
    });
  }, []);

  const handleGotoLine = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    gotoLine(view);
  }, []);

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
          color: 'var(--c-fg-subtle)',
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
          color: 'var(--c-fg-subtle)',
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
          color: 'var(--c-warning)',
          fontSize: '14px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span>文件过大，无法在编辑器中打开</span>
        <span style={{ fontSize: '12px', color: 'var(--c-fg-subtle)' }}>
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
          color: 'var(--c-danger)',
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
              border: '1px solid var(--c-border-sub)',
              background: 'transparent',
              color: 'var(--c-fg)',
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

  // text 文件：CodeMirror 编辑器 + 底部状态栏（flex column 让 statusbar 不挤占编辑区）
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        data-testid="editor-container"
        ref={editorContainerRef}
        style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}
      />
      <EditorStatusbar
        cursorLine={statusInfo.cursorLine}
        cursorCol={statusInfo.cursorCol}
        selChars={statusInfo.selChars}
        selLines={statusInfo.selLines}
        totalLines={statusInfo.totalLines}
        eol={statusInfo.eol}
        indent={statusInfo.indent}
        lineWrap={lineWrap}
        onToggleWrap={handleToggleWrap}
        onGotoLine={handleGotoLine}
        filePath={activeFile.path}
      />
    </div>
  );
}

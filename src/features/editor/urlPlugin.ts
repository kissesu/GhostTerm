/**
 * @file urlPlugin.ts
 * @description CodeMirror 6 URL/路径 超链接装饰 + Cmd/Ctrl+点击打开。
 *              扫描 doc 中的 http(s)/ftp/file URL 与 POSIX 绝对路径，加 underline + cursor:pointer 样式；
 *              捕获 mousedown 时若按住 Cmd/Ctrl，调用 tauri opener 打开。
 *              路径中 ~ 通过 Tauri path.homeDir 异步展开，无 Tauri 环境降级原样传 OS。
 * @author Atlas.oi
 * @date 2026-05-04
 */

import { EditorView, ViewPlugin, Decoration, MatchDecorator } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { homeDir } from '@tauri-apps/api/path';

// 单一组匹配：5 种形态全部作为 match[0] 直接装饰
// - http(s)://、ftp://、file:// URL（终止于空白/HTML 标签符）
// - ~/... 用户家目录路径（前置必须空白或行首避免吞噬中划线）
// - /... POSIX 绝对路径
// - C:\foo\bar / C:/foo/bar — Windows 盘符绝对路径（兼容反斜杠+正斜杠混合）
// - \\server\share — Windows UNC 网络路径
const URL_PATTERN =
  /\b(?:https?|ftp|file):\/\/[^\s<>"')]+|(?:^|(?<=\s))~?\/[A-Za-z0-9._\-/]+|(?:^|(?<=\s))[A-Za-z]:[\\/][A-Za-z0-9._\-\\/ ]*[A-Za-z0-9._\-\\/]|(?:^|(?<=\s))\\\\[A-Za-z0-9._\-\\/]+/g;

const linkDecoration = Decoration.mark({
  class: 'cm-url-link',
  attributes: { 'data-cm-url': 'true' },
});

const matcher = new MatchDecorator({
  regexp: URL_PATTERN,
  decoration: () => linkDecoration,
});

/**
 * 提取目标位置上的 URL 字符串
 * 在所属行的文本上重跑正则，找包含 pos 的 match
 */
function extractUrlAtPos(view: EditorView, pos: number): string | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  for (const match of line.text.matchAll(URL_PATTERN)) {
    const start = line.from + (match.index ?? 0);
    const end = start + match[0].length;
    if (pos >= start && pos <= end) {
      return match[0].trim();
    }
  }
  return null;
}

/**
 * URL 高亮 + Cmd/Ctrl+Click 打开 ViewPlugin
 *
 * 业务流程：
 * 1. 装饰：每次 doc/viewport 变化重计算 MatchDecorator
 * 2. 交互：mousedown 时若 metaKey/ctrlKey 按下，提取目标位置 URL，
 *    走 tauri opener（http/file/路径分流）。
 *    路径中 ~ 通过 Tauri path.homeDir 异步展开后传给 openPath。
 */
export const urlHyperlinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = matcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event: MouseEvent, view: EditorView) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const url = extractUrlAtPos(view, pos);
        if (!url) return false;
        event.preventDefault();
        // 协议路由：http(s)/ftp 走 openUrl；file:// 与裸路径走 openPath
        // 异步执行不阻塞 mousedown，错误仅 log 不冒泡（不影响后续编辑器状态）
        void (async () => {
          try {
            if (/^(?:https?|ftp):/i.test(url)) {
              await openUrl(url);
              return;
            }
            let target = url.startsWith('file://') ? url.replace(/^file:\/\//, '') : url;
            if (target.startsWith('~/') || target.startsWith('~\\')) {
              try {
                // homeDir 在 Windows 返回 C:\Users\foo\，移除末尾任何分隔符
                // 然后拼接剩余路径片段 — Tauri openPath 接受混合斜杠故无需归一
                const home = (await homeDir()).replace(/[\\/]+$/, '');
                target = target.replace(/^~/, home);
              } catch {
                // homeDir 失败时保留原 ~/ 让 OS 自己处理
              }
            }
            await openPath(target);
          } catch (err) {
            console.error('[urlPlugin] 打开链接失败:', err);
          }
        })();
        return true;
      },
    },
  },
);

/** URL 链接的 CSS 主题（注入到 EditorView.theme） */
export const urlLinkTheme = EditorView.theme({
  '.cm-url-link': {
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
});

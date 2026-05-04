/**
 * @file gitGutter.ts
 * @description 编辑器左侧 Git 行级状态 gutter。
 *              通过 StateField + StateEffect 持有 line→status 映射，gutter 渲染对应颜色条。
 *              数据来源：React 层 useEffect 调 invoke('git_diff_cmd') 拿 unified diff，
 *              本模块导出的 parseDiffToLineMap 把 diff 解析为 line→status，
 *              dispatch setGitDiffEffect 写入 StateField，gutter 自动重渲。
 *              status 三态：added/modified/deleted —— VSCode 同款 gutter 风格。
 * @author Atlas.oi
 * @date 2026-05-04
 */

import { gutter, GutterMarker, EditorView } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

export type GitLineStatus = 'added' | 'modified' | 'deleted';

/** line(1-based) → status 映射 */
export type GitLineMap = Map<number, GitLineStatus>;

/**
 * 解析 git unified diff 为 line→status 映射
 *
 * 算法：
 * 1. 逐 hunk 扫描，识别 @@ -a,b +c,d @@ 头拿到 newStart
 * 2. 该 hunk 内若同时含 + 与 -：所有 + 行标 modified
 * 3. 该 hunk 内仅含 + 无 -：所有 + 行标 added
 * 4. 该 hunk 内仅含 - 无 +：在 newStart 行标 deleted（指示该位置上方有删除）
 * 5. ' ' 行 newLine++，'+' 行 newLine++
 *
 * @param diff - git diff 命令返回的 unified diff 文本
 * @returns line→status 映射；空 diff 或解析失败返回空 Map
 */
export function parseDiffToLineMap(diff: string): GitLineMap {
  const map: GitLineMap = new Map();
  if (!diff) return map;

  const lines = diff.split('\n');
  let inHunk = false;
  let hunkBuffer: string[] = [];
  let hunkStart = 0;

  const flushHunk = () => {
    if (!hunkBuffer.length) return;
    const hasAdd = hunkBuffer.some((l) => l.startsWith('+') && !l.startsWith('+++'));
    const hasRm = hunkBuffer.some((l) => l.startsWith('-') && !l.startsWith('---'));
    let cursor = hunkStart;
    if (!hasAdd && hasRm) {
      // 纯删除：在 hunk 起始行标 deleted
      map.set(hunkStart, 'deleted');
    }
    for (const l of hunkBuffer) {
      const c = l[0];
      if (c === '+') {
        map.set(cursor, hasRm ? 'modified' : 'added');
        cursor++;
      } else if (c === ' ') {
        cursor++;
      }
      // '-' 不前进 newLine
    }
    hunkBuffer = [];
  };

  for (const line of lines) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      flushHunk();
      inHunk = true;
      hunkStart = Number.parseInt(m[1] ?? '1', 10);
      continue;
    }
    if (!inHunk) continue;
    // file header 行（--- / +++）跳过
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    // diff/index 元数据行：退出 hunk 状态
    if (line.startsWith('diff ') || line.startsWith('index ')) {
      flushHunk();
      inHunk = false;
      continue;
    }
    hunkBuffer.push(line);
  }
  flushHunk();
  return map;
}

/** 触发 line map 更新的 StateEffect */
export const setGitDiffEffect = StateEffect.define<GitLineMap>();

/** 持有当前文件 line→status 的 StateField */
export const gitDiffField = StateField.define<GitLineMap>({
  create: () => new Map(),
  update: (value, tr) => {
    for (const e of tr.effects) {
      if (e.is(setGitDiffEffect)) return e.value;
    }
    return value;
  },
});

class StatusMarker extends GutterMarker {
  constructor(private readonly status: GitLineStatus) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof StatusMarker && other.status === this.status;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = `cm-git-marker cm-git-${this.status}`;
    return el;
  }
}

const ADDED_MARKER = new StatusMarker('added');
const MODIFIED_MARKER = new StatusMarker('modified');
const DELETED_MARKER = new StatusMarker('deleted');

/** Git gutter extension - 装入 EditorState extensions 即可显示 */
export const gitGutterExtension = [
  gitDiffField,
  gutter({
    class: 'cm-git-gutter',
    lineMarker(view, line) {
      const map = view.state.field(gitDiffField, false);
      if (!map || map.size === 0) return null;
      const lineNum = view.state.doc.lineAt(line.from).number;
      const status = map.get(lineNum);
      if (!status) return null;
      if (status === 'added') return ADDED_MARKER;
      if (status === 'modified') return MODIFIED_MARKER;
      if (status === 'deleted') return DELETED_MARKER;
      return null;
    },
    initialSpacer: () => ADDED_MARKER,
  }),
  EditorView.theme({
    '.cm-git-gutter': {
      width: '3px',
      padding: '0',
    },
    '.cm-git-marker': {
      width: '3px',
      height: '100%',
      // marker 自身居中铺满 gutter 行
    },
    '.cm-git-added': { background: 'var(--c-git-added, #4ade80)' },
    '.cm-git-modified': { background: 'var(--c-git-modified, #fbbf24)' },
    '.cm-git-deleted': { background: 'var(--c-git-deleted, #f87171)' },
  }),
];

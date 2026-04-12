/**
 * @file 前端共享类型定义
 * @description 定义前端使用的所有数据类型，与 Rust src-tauri/src/types.rs 一一对应。
 *              这些类型通过 Tauri Commands invoke 从后端接收。
 * @author Atlas.oi
 * @date 2026-04-12
 */

/** 文件系统条目 - 代表目录列表中的单个文件或目录 */
export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified?: number;
}

/** 文件树节点 - 支持懒加载，children 为 undefined 表示未展开 */
export interface FileNode {
  entry: FileEntry;
  /** undefined=未展开目录, null=不可展开, []=空目录 */
  children?: FileNode[] | null;
}

/** Git 状态条目 */
export interface StatusEntry {
  path: string;
  /** 已暂存状态: M=修改 A=新增 D=删除 R=重命名 ?=未跟踪 */
  staged?: string;
  /** 未暂存状态 */
  unstaged?: string;
}

/** Git Worktree 信息 */
export interface Worktree {
  path: string;
  /** detached HEAD 时为 undefined */
  branch?: string;
  is_current: boolean;
}

/** 项目基本信息 */
export interface ProjectInfo {
  name: string;
  path: string;
  /** Unix 时间戳毫秒，用于最近项目排序 */
  last_opened: number;
}

/** 完整项目运行时状态 */
export interface Project {
  info: ProjectInfo;
  active_path: string;
}

/** 文件读取结果 - 判别联合类型（对应 Rust enum ReadFileResult） */
export type ReadFileResult =
  | { kind: 'text'; content: string }
  | { kind: 'binary'; mime_hint: string }
  | { kind: 'large'; size: number }
  | { kind: 'error'; message: string };

/** 前端编辑器中打开的文件状态 */
export interface OpenFile {
  path: string;
  /** 编辑器中当前内容（含未保存修改） */
  content: string;
  /** 磁盘上的内容，用于冲突检测 */
  diskContent: string;
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 文件语言，用于选择 CodeMirror 语法包 */
  language: string;
  /** 文件类型标记，binary/large 类型不可编辑 */
  kind: 'text' | 'binary' | 'large' | 'error';
  /** binary 文件的 MIME 类型提示 */
  mimeHint?: string;
  /** 错误信息 */
  errorMessage?: string;
}

/** 文件系统事件（从 Rust watcher 通过 Tauri Event 推送） */
export type FsEvent =
  | { type: 'created'; path: string }
  | { type: 'modified'; path: string }
  | { type: 'deleted'; path: string }
  | { type: 'renamed'; old_path: string; new_path: string };

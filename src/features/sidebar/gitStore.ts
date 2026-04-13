/**
 * @file gitStore.ts
 * @description Git 状态管理 - 管理暂存区/工作区文件状态、当前分支、worktree 列表。
 *              通过 invoke 调用 Rust 后端的 git_status_cmd / git_stage_cmd 等命令，
 *              为 Changes 和 Worktrees 面板提供响应式数据源。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { StatusEntry, Worktree } from '../../shared/types';

/** Git 状态 Store 接口 */
interface GitState {
  /** 所有文件变更（staged + unstaged 混合，由 statusEntry.staged/unstaged 区分） */
  changes: StatusEntry[];
  /** 当前 git 分支名，非 git 目录时为空字符串 */
  currentBranch: string;
  /** worktree 列表 */
  worktrees: Worktree[];

  /**
   * 刷新 git 状态（changes + currentBranch）
   * @param repoPath - 仓库根目录绝对路径
   */
  refreshGitStatus: (repoPath: string) => Promise<void>;

  /**
   * 刷新 worktree 列表
   * @param repoPath - 仓库根目录绝对路径
   */
  refreshWorktrees: (repoPath: string) => Promise<void>;

  /**
   * 暂存指定文件
   * @param repoPath - 仓库根目录绝对路径
   * @param filePath - 相对于仓库根目录的文件路径
   */
  stageFile: (repoPath: string, filePath: string) => Promise<void>;

  /**
   * 取消暂存指定文件
   * @param repoPath - 仓库根目录绝对路径
   * @param filePath - 相对于仓库根目录的文件路径
   */
  unstageFile: (repoPath: string, filePath: string) => Promise<void>;
}

/**
 * Git 状态 Store
 *
 * 使用说明：
 * - refreshGitStatus 在项目打开、文件保存后调用，保持状态同步
 * - stageFile/unstageFile 操作完成后自动调用 refreshGitStatus 更新 UI
 */
export const useGitStore = create<GitState>((set, get) => ({
  changes: [],
  currentBranch: '',
  worktrees: [],

  // ============================================
  // 刷新 git 状态（文件变更列表 + 当前分支）
  // 两个 invoke 并行执行，减少等待时间
  // ============================================
  refreshGitStatus: async (repoPath: string) => {
    const [changes, currentBranch] = await Promise.all([
      invoke<StatusEntry[]>('git_status_cmd', { repoPath }),
      invoke<string>('git_current_branch_cmd', { repoPath }),
    ]);
    set({ changes, currentBranch });
  },

  // ============================================
  // 刷新 worktree 列表
  // ============================================
  refreshWorktrees: async (repoPath: string) => {
    const worktrees = await invoke<Worktree[]>('worktree_list_cmd', { repoPath });
    set({ worktrees });
  },

  // ============================================
  // 暂存文件：invoke stage 后自动刷新状态
  // ============================================
  stageFile: async (repoPath: string, filePath: string) => {
    await invoke('git_stage_cmd', { repoPath, filePath });
    // 操作完成后刷新状态，确保 UI 同步
    await get().refreshGitStatus(repoPath);
  },

  // ============================================
  // 取消暂存：invoke unstage 后自动刷新状态
  // ============================================
  unstageFile: async (repoPath: string, filePath: string) => {
    await invoke('git_unstage_cmd', { repoPath, filePath });
    await get().refreshGitStatus(repoPath);
  },
}));

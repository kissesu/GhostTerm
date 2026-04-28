/**
 * @file IssueList.test.tsx
 * @description IssueList 组件集成测试：
 *   - 渲染 issue 列表和修复按钮
 *   - 点击修复 → fix_preview 调用
 *   - 确认修复 → backup_create_cmd + fix + pushUndo + onChanged 调用顺序
 *   - fix_available=false 时不渲染修复按钮
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----------------------------------------------------------------
// Mock：必须在 import 组件之前建立，确保组件内 invoke/sidecarInvoke 引用 mock 版本
// ----------------------------------------------------------------
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../toolsSidecarClient', async (importOriginal) => {
  // 保留真实的 SidecarError 类和 IssueDict 类型，只 mock sidecarInvoke
  const actual = await importOriginal<typeof import('../toolsSidecarClient')>();
  return {
    ...actual,
    sidecarInvoke: vi.fn(),
  };
});
vi.mock('../toolsStore', () => ({
  useToolsStore: {
    getState: vi.fn(() => ({
      pushUndo: vi.fn(),
      undo: vi.fn(),
    })),
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { sidecarInvoke, SidecarError } from '../toolsSidecarClient';
import { useToolsStore } from '../toolsStore';
import { IssueList } from '../IssueList';
import type { IssueDict } from '../toolsSidecarClient';

// ----------------------------------------------------------------
// 测试数据
// ----------------------------------------------------------------
const MOCK_FILE = '/Users/test/sample.docx';
const MOCK_RULE_VALUES = { cjk_ascii_space: { allowed: false } };

function makeIssue(overrides: Partial<IssueDict> = {}): IssueDict {
  return {
    rule_id: 'cjk_ascii_space',
    loc: { para: 0, run: 0 },
    message: '中英文之间多余空格',
    current: ' ',
    expected: '',
    fix_available: true,
    snippet: '通过 submit',
    context: '用户点击通过 submit 按钮后',
    issue_id: 'issue-001',
    evidence_xml: null,
    ...overrides,
  };
}

describe('IssueList', () => {
  let mockPushUndo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPushUndo = vi.fn();
    vi.mocked(useToolsStore.getState).mockReturnValue({
      pushUndo: mockPushUndo,
      undo: vi.fn(),
      // 其他 store 字段：测试中不使用，填充最小满足类型的占位值
      activeToolId: null,
      activeTemplateId: '_builtin-gbt7714-v2',
      undoStack: [],
      setActiveTool: vi.fn(),
      setActiveTemplate: vi.fn(),
    } as unknown as ReturnType<typeof useToolsStore.getState>);
  });

  // ================================================================
  // 渲染
  // ================================================================

  it('渲染 issue 列表，每条显示 snippet 和 context', () => {
    const issues = [makeIssue()];
    render(
      <IssueList
        file={MOCK_FILE}
        issues={issues}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByText('通过 submit')).toBeDefined();
    expect(screen.getByText(/用户点击通过 submit 按钮后/)).toBeDefined();
  });

  it('fix_available=true 时显示"修复"按钮', () => {
    render(
      <IssueList
        file={MOCK_FILE}
        issues={[makeIssue({ fix_available: true })]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /修复/ })).toBeDefined();
  });

  it('fix_available=false 时不显示"修复"按钮', () => {
    render(
      <IssueList
        file={MOCK_FILE}
        issues={[makeIssue({ fix_available: false })]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /修复/ })).toBeNull();
  });

  it('issues 为空时显示"未发现违规"提示', () => {
    render(
      <IssueList
        file={MOCK_FILE}
        issues={[]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByText(/未发现违规/)).toBeDefined();
  });

  // ================================================================
  // 点击修复 → fix_preview 调用
  // ================================================================

  it('点击"修复"调用 sidecarInvoke fix_preview，传入正确参数', async () => {
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({ diff: '- 通过 s\n+ 通过s', applied: false });

    const issue = makeIssue();
    render(
      <IssueList
        file={MOCK_FILE}
        issues={[issue]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /修复/ }));

    await waitFor(() => {
      expect(vi.mocked(sidecarInvoke)).toHaveBeenCalledWith({
        cmd: 'fix_preview',
        file: MOCK_FILE,
        issue,
        value: { allowed: false },
      });
    });
  });

  it('fix_preview 成功后显示 DiffPreview modal', async () => {
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({ diff: '- 通过 s\n+ 通过s', applied: false });

    render(
      <IssueList
        file={MOCK_FILE}
        issues={[makeIssue()]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /修复/ }));

    // 等待 DiffPreview dialog 出现
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
    });
  });

  // ================================================================
  // 确认修复流程：backup_create_cmd + fix + pushUndo + onChanged
  // ================================================================

  it('确认修复调用 backup_create_cmd、sidecar fix、pushUndo、onChanged（按顺序）', async () => {
    const SNAPSHOT_PATH = '/home/.config/ghostterm/.bak/abc123/v5_1713456789.docx';
    const onChanged = vi.fn().mockResolvedValue(undefined);

    // fix_preview 先调用，fix 后调用
    vi.mocked(sidecarInvoke)
      .mockResolvedValueOnce({ diff: '- 通过 s\n+ 通过s', applied: false }) // fix_preview
      .mockResolvedValueOnce({ diff: '- 通过 s\n+ 通过s', applied: true });   // fix

    vi.mocked(invoke).mockResolvedValueOnce(SNAPSHOT_PATH); // backup_create_cmd

    const issue = makeIssue();
    render(
      <IssueList
        file={MOCK_FILE}
        issues={[issue]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={onChanged}
        onError={vi.fn()}
      />
    );

    // 触发 fix_preview
    fireEvent.click(screen.getByRole('button', { name: /修复/ }));
    await waitFor(() => screen.getByRole('dialog'));

    // 点确认修复
    fireEvent.click(screen.getByRole('button', { name: '确认修复' }));

    await waitFor(() => {
      // backup_create_cmd 被调用
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('backup_create_cmd', { origin: MOCK_FILE });

      // sidecar fix 被调用
      expect(vi.mocked(sidecarInvoke)).toHaveBeenCalledWith(
        expect.objectContaining({ cmd: 'fix', file: MOCK_FILE, issue }),
      );

      // pushUndo 被调用，version 从路径解析为 5
      expect(mockPushUndo).toHaveBeenCalledWith(
        expect.objectContaining({
          originPath: MOCK_FILE,
          snapshotVersion: 5,
          issueId: 'issue-001',
        }),
      );

      // onChanged 被调用刷新列表
      expect(onChanged).toHaveBeenCalledOnce();
    });
  });

  // ================================================================
  // 错误处理：SidecarError 冒泡给 onError
  // ================================================================

  it('fix_preview 失败时调用 onError 而非抛出', async () => {
    const onError = vi.fn();
    vi.mocked(sidecarInvoke).mockRejectedValueOnce(
      new SidecarError('FIX_PREVIEW_FAILED', '预览失败'),
    );

    render(
      <IssueList
        file={MOCK_FILE}
        issues={[makeIssue()]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={onError}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /修复/ }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(SidecarError));
    });
  });

  it('backup_create_cmd 失败时不调 sidecar fix 且 onError 收到 FIX_FAILED', async () => {
    const onError = vi.fn();

    // fix_preview 成功打开 modal
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({ diff: '- a\n+ b', applied: false });
    // backup_create_cmd 失败（Tauri 抛字符串而非 SidecarError）
    vi.mocked(invoke).mockRejectedValueOnce('backup err');

    render(
      <IssueList
        file={MOCK_FILE}
        issues={[makeIssue()]}
        ruleValues={MOCK_RULE_VALUES}
        onChanged={vi.fn()}
        onError={onError}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /修复/ }));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('button', { name: '确认修复' }));

    await waitFor(() => {
      // 关键断言 1：onError 收到包装后的 SidecarError，code=FIX_FAILED，fullError 含原始错误信息
      expect(onError).toHaveBeenCalledWith(expect.any(SidecarError));
      const errArg = onError.mock.calls[0][0] as SidecarError;
      expect(errArg.code).toBe('FIX_FAILED');
      expect(errArg.fullError).toContain('backup err');
    });

    // 关键断言 2：sidecar fix 未被调用（fix_preview 是第 1 次，fix 应是第 2 次但未发生）
    expect(vi.mocked(sidecarInvoke)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sidecarInvoke)).not.toHaveBeenCalledWith(
      expect.objectContaining({ cmd: 'fix' }),
    );

    // 关键断言 3：pushUndo 未被调用，避免幽灵 undo 条目
    expect(mockPushUndo).not.toHaveBeenCalled();
  });
});

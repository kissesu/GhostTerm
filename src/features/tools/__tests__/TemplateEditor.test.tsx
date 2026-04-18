/**
 * @file TemplateEditor.test.tsx
 * @description TemplateEditor + TemplateManager + RuleValueEditor 组件测试
 *   1. TemplateEditor enabled checkbox → onSave 收到正确 patch
 *   2. TemplateManager 渲染 templates 列表
 *   3. TemplateManager 点击"编辑" → TemplateEditor 出现
 *   4. RuleValueEditor font shape 渲染 family + size_pt 输入框
 *   5. RuleValueEditor allowed shape 渲染 toggle
 *   6. 新建模板：点击按钮 → NamePromptModal 弹出 → 输入名称 → store.create
 *   7. 导入 JSON → invoke template_import_cmd
 *   8. 从 docx 创建：选文件 → NamePromptModal 弹出 → 输入名称 → TemplateExtractor
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Tauri invoke ───────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ─── Mock dialog 插件（open/save） ───────────
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// ─── Mock sidecarClient ───────────────────────
vi.mock('../toolsSidecarClient', () => ({
  sidecarInvoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import * as dialog from '@tauri-apps/plugin-dialog';
import { useTemplateStore } from '../templates/TemplateStore';
import { TemplateEditor } from '../templates/TemplateEditor';
import { TemplateManager } from '../templates/TemplateManager';
import { RuleValueEditor } from '../templates/RuleValueEditor';
import type { TemplateJson } from '../templates/TemplateStore';

// ─── 测试用模板 fixture ───────────────────────

const builtinTpl: TemplateJson = {
  schema_version: 2,
  id: '_builtin-gbt7714',
  name: 'GB/T 7714 内置',
  source: { type: 'builtin' },
  updated_at: '2026-01-01T00:00:00.000Z',
  rules: {
    'font.body':       { enabled: true,  value: { family: '宋体', size_pt: 12 } },
    'citation.format': { enabled: true,  value: { style: 'gbt7714', marker: 'superscript' } },
    'cjk_ascii_space': { enabled: false, value: { allowed: false } },
    'chapter.new_page':{ enabled: true,  value: true },
  },
};

const userTpl: TemplateJson = {
  schema_version: 2,
  id: 'user-apa',
  name: 'APA 用户模板',
  source: { type: 'manual' },
  updated_at: '2026-01-02T00:00:00.000Z',
  rules: {
    'font.body': { enabled: true, value: { family: 'Times New Roman', size_pt: 11 } },
  },
};

// ─────────────────────────────────────────────
// TemplateEditor 测试组
// ─────────────────────────────────────────────

describe('TemplateEditor', () => {
  it('改 enabled checkbox → onSave 收到包含正确 enabled 值的 draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<TemplateEditor template={builtinTpl} onSave={onSave} onCancel={onCancel} />);

    // font.body 行的 enabled checkbox（初始 true）
    const checkbox = screen.getByTestId('rule-enabled-font.body') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // 取消勾选
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    // 点击保存
    const saveBtn = screen.getByTestId('editor-save-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const saved = onSave.mock.calls[0][0] as TemplateJson;
    // font.body 的 enabled 应该变为 false
    expect(saved.rules['font.body'].enabled).toBe(false);
    // citation.format 不变
    expect(saved.rules['citation.format'].enabled).toBe(true);
  });

  it('点击取消调用 onCancel', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<TemplateEditor template={builtinTpl} onSave={onSave} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId('editor-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('改 value 后 onSave 收到更新后的 value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<TemplateEditor template={builtinTpl} onSave={onSave} onCancel={vi.fn()} />);

    // 修改 font.body family 输入框
    const familyInput = screen.getByTestId('font-family') as HTMLInputElement;
    fireEvent.change(familyInput, { target: { value: '黑体' } });

    fireEvent.click(screen.getByTestId('editor-save-btn'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as TemplateJson;
    expect((saved.rules['font.body'].value as { family: string }).family).toBe('黑体');
  });
});

// ─────────────────────────────────────────────
// TemplateManager 测试组
// ─────────────────────────────────────────────

describe('TemplateManager', () => {
  beforeEach(() => {
    useTemplateStore.setState({
      templates: [builtinTpl, userTpl],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      restoreBuiltin: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('渲染所有模板行', () => {
    render(<TemplateManager isOpen onClose={vi.fn()} />);
    // 两个模板都应出现
    expect(screen.getByTestId('template-row-_builtin-gbt7714')).toBeTruthy();
    expect(screen.getByTestId('template-row-user-apa')).toBeTruthy();
  });

  it('isOpen=false 时不渲染任何内容', () => {
    render(<TemplateManager isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('template-manager')).toBeNull();
  });

  it('点击"编辑"按钮后显示 TemplateEditor', async () => {
    render(<TemplateManager isOpen onClose={vi.fn()} />);

    // 点击内置模板行的编辑按钮
    const editBtn = screen.getByTestId('edit-btn-_builtin-gbt7714');
    fireEvent.click(editBtn);

    // TemplateEditor 出现
    await waitFor(() => {
      expect(screen.getByTestId('template-editor')).toBeTruthy();
    });
  });

  it('内置模板不显示删除按钮，显示恢复默认', () => {
    render(<TemplateManager isOpen onClose={vi.fn()} />);
    expect(screen.queryByTestId('delete-btn-_builtin-gbt7714')).toBeNull();
    expect(screen.getByTestId('restore-btn-_builtin-gbt7714')).toBeTruthy();
  });

  it('非内置模板显示删除按钮，不显示恢复默认', () => {
    render(<TemplateManager isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('delete-btn-user-apa')).toBeTruthy();
    expect(screen.queryByTestId('restore-btn-user-apa')).toBeNull();
  });

  it('保存失败时停留在编辑器并弹 alert', async () => {
    // store.update 注入 reject，模拟磁盘写入失败
    const updateFail = vi.fn().mockRejectedValueOnce(new Error('boom'));
    useTemplateStore.setState({
      templates: [builtinTpl, userTpl],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      update: updateFail,
      remove: vi.fn().mockResolvedValue(undefined),
      restoreBuiltin: vi.fn().mockResolvedValue(undefined),
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<TemplateManager isOpen onClose={vi.fn()} />);

    // 进入编辑视图
    fireEvent.click(screen.getByTestId('edit-btn-user-apa'));
    await waitFor(() => expect(screen.getByTestId('template-editor')).toBeTruthy());

    // 触发保存（会 reject）
    fireEvent.click(screen.getByTestId('editor-save-btn'));

    // 等 update 被调，alert 弹出
    await waitFor(() => {
      expect(updateFail).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    // 编辑器仍在屏幕上，editing 没被清空（key 重置不应触发，因为 editing 没改）
    expect(screen.getByTestId('template-editor')).toBeTruthy();

    alertSpy.mockRestore();
  });

  // ─── Task 10 / Bug Fix 新增测试 ────────────────────────

  it('点击「新建模板」→ NamePromptModal 弹出 → 输入名称 → store.create 被调用', async () => {
    const createMock = vi.fn().mockResolvedValue('new-tpl-id');
    useTemplateStore.setState({
      templates: [builtinTpl, userTpl],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      restoreBuiltin: vi.fn().mockResolvedValue(undefined),
      create: createMock,
    });

    render(<TemplateManager isOpen onClose={vi.fn()} />);

    // 点击「新建模板」→ NamePromptModal 应出现
    fireEvent.click(screen.getByTestId('create-template-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('name-prompt-modal')).toBeTruthy();
    });

    // 在输入框输入名称
    const input = screen.getByTestId('name-prompt-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '我的新模板' } });

    // 点击确定
    fireEvent.click(screen.getByTestId('name-prompt-submit'));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith('我的新模板');
    });
  });

  it('点击「导入 JSON」选择文件 → invoke template_import_cmd 被调用', async () => {
    const loadMock = vi.fn().mockResolvedValue(undefined);
    useTemplateStore.setState({
      templates: [builtinTpl, userTpl],
      loading: false,
      load: loadMock,
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      restoreBuiltin: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue('id'),
    });
    // dialog.open 返回选中的文件路径
    vi.mocked(dialog.open).mockResolvedValue('/path/to/my-template.json');
    vi.mocked(invoke).mockResolvedValue(undefined);

    render(<TemplateManager isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('import-json-btn'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('template_import_cmd', {
        jsonPath: '/path/to/my-template.json',
      });
      // 导入成功后应 reload
      expect(loadMock).toHaveBeenCalled();
    });
  });

  it('点击「从 docx 创建」选文件 → NamePromptModal 弹出 → 输入名称 → 打开 TemplateExtractor modal', async () => {
    // sidecarInvoke 在 TemplateExtractor mount 时会被调，mock 返回空结果
    const { sidecarInvoke: si } = await import('../toolsSidecarClient');
    vi.mocked(si).mockResolvedValue({ rules: {}, evidence: [] });

    useTemplateStore.setState({
      templates: [builtinTpl, userTpl],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      restoreBuiltin: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue('id'),
    });
    // 模拟选中 docx 文件路径
    vi.mocked(dialog.open).mockResolvedValue('/docs/thesis.docx');

    render(<TemplateManager isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('create-from-docx-btn'));

    // 先等 NamePromptModal 弹出（选文件是异步的）
    await waitFor(() => {
      expect(screen.getByTestId('name-prompt-modal')).toBeTruthy();
    });

    // defaultValue 应预填去扩展名的文件名 "thesis"
    const input = screen.getByTestId('name-prompt-input') as HTMLInputElement;
    expect(input.value).toBe('thesis');

    // 输入模板名后确认
    fireEvent.change(input, { target: { value: '论文模板' } });
    fireEvent.click(screen.getByTestId('name-prompt-submit'));

    // TemplateExtractor modal 应弹出
    await waitFor(() => {
      expect(screen.getByTestId('template-extractor')).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────
// RuleValueEditor 测试组
// ─────────────────────────────────────────────

describe('RuleValueEditor', () => {
  it('font shape 渲染 family 和 size_pt 两个输入框', () => {
    const onChange = vi.fn();
    render(
      <RuleValueEditor
        shape={{ kind: 'font' }}
        value={{ family: '宋体', size_pt: 12 }}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId('font-family')).toBeTruthy();
    expect(screen.getByTestId('font-size')).toBeTruthy();
  });

  it('font shape 输入 family 触发 onChange', () => {
    const onChange = vi.fn();
    render(
      <RuleValueEditor
        shape={{ kind: 'font' }}
        value={{ family: '宋体', size_pt: 12 }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByTestId('font-family'), { target: { value: '黑体' } });
    expect(onChange).toHaveBeenCalledWith({ family: '黑体', size_pt: 12 });
  });

  it('allowed shape 渲染 toggle，切换触发 onChange({allowed})', () => {
    const onChange = vi.fn();
    render(
      <RuleValueEditor
        shape={{ kind: 'allowed' }}
        value={{ allowed: false }}
        onChange={onChange}
      />
    );
    const toggle = screen.getByTestId('allowed-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ allowed: true });
  });

  it('bool shape 渲染 toggle', () => {
    const onChange = vi.fn();
    render(
      <RuleValueEditor
        shape={{ kind: 'bool' }}
        value={true}
        onChange={onChange}
      />
    );
    const toggle = screen.getByTestId('bool-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

/**
 * @file CustomerEditDialog.test.tsx
 * @description Phase 4 客户编辑对话框测试：
 *              - 编辑模式：初始草稿 = 现有客户字段；保存调 store.update；onSave 被回调
 *              - 新建模式：初始草稿空；保存调 store.create
 *              - 校验：空 nameWechat 不调 store + 显示错误提示
 *              - 权限守卫：customer:create 缺失时保存按钮不渲染（新建模式）
 *              - 权限守卫：customer:update 缺失时保存按钮不渲染（编辑模式）
 *              - 取消按钮：触发 onCancel
 *              - update 仅传变化的字段（不发无谓 PATCH）
 *
 *              mock 策略：
 *              - mock customersStore：拦截 create/update 调用
 *              - mock progressPermissionStore：通过 hydrate 模拟权限码集合
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ============================================
// 必须 hoist 的 mock
// ============================================
vi.mock('../../stores/customersStore', () => {
  const create = vi.fn();
  const update = vi.fn();
  const useCustomersStore = vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      customers: [],
      loading: false,
      error: null,
      create,
      update,
      fetchAll: vi.fn(),
      clear: vi.fn(),
    };
    return selector ? selector(state) : state;
  });
  return {
    useCustomersStore,
    __mockedCreate: create,
    __mockedUpdate: update,
  };
});

import { CustomerEditDialog } from '../CustomerEditDialog';
import { useProgressPermissionStore } from '../../stores/progressPermissionStore';
// 通过 mock factory 挂的 __mockedCreate / __mockedUpdate 拿到 vi.fn 引用
import * as customersStoreModule from '../../stores/customersStore';
const mockedCreate = (customersStoreModule as unknown as { __mockedCreate: ReturnType<typeof vi.fn> }).__mockedCreate;
const mockedUpdate = (customersStoreModule as unknown as { __mockedUpdate: ReturnType<typeof vi.fn> }).__mockedUpdate;

import type { CustomerPayload } from '../../api/schemas';

const sampleCustomer: CustomerPayload = {
  id: 42,
  nameWechat: '李四',
  remark: '老客户',
  createdBy: 100,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

beforeEach(() => {
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  // 默认给"客服可写"的权限集；具体测试用例会根据需要 override
  useProgressPermissionStore.getState().hydrate(['customer:create', 'customer:update']);
});

// ============================================
// 渲染：根据模式决定标题
// ============================================
describe('CustomerEditDialog 渲染', () => {
  it('编辑模式：标题显示"编辑客户" + 草稿初始化为现有字段', () => {
    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId('customer-edit-dialog');
    expect(dialog).toHaveAttribute('aria-label', '编辑客户');
    expect((screen.getByTestId('customer-name-input') as HTMLInputElement).value).toBe('李四');
    expect((screen.getByTestId('customer-remark-input') as HTMLTextAreaElement).value).toBe('老客户');
  });

  it('新建模式：标题显示"新建客户" + 草稿空', () => {
    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId('customer-edit-dialog');
    expect(dialog).toHaveAttribute('aria-label', '新建客户');
    expect((screen.getByTestId('customer-name-input') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('customer-remark-input') as HTMLTextAreaElement).value).toBe('');
  });
});

// ============================================
// 校验
// ============================================
describe('CustomerEditDialog 校验', () => {
  it('空 nameWechat 不调 store，显示校验错误', async () => {
    const onSave = vi.fn();
    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('customer-save-btn'));
    expect(await screen.findByTestId('customer-validation-error')).toHaveTextContent('客户名称不能为空');
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('仅空白字符的 nameWechat 也算空（trim 后判定）', async () => {
    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('customer-name-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('customer-save-btn'));
    expect(await screen.findByTestId('customer-validation-error')).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

// ============================================
// 新建：调 store.create 并 onSave
// ============================================
describe('CustomerEditDialog 新建', () => {
  it('保存调 store.create 并把结果传给 onSave', async () => {
    const created: CustomerPayload = {
      id: 99,
      nameWechat: '新客户',
      remark: 'r1',
      createdBy: 100,
      createdAt: '2026-04-29T00:00:00Z',
      updatedAt: '2026-04-29T00:00:00Z',
    };
    mockedCreate.mockResolvedValueOnce(created);
    const onSave = vi.fn();

    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('customer-name-input'), { target: { value: '新客户' } });
    fireEvent.change(screen.getByTestId('customer-remark-input'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByTestId('customer-save-btn'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(created));
    expect(mockedCreate).toHaveBeenCalledWith({ nameWechat: '新客户', remark: 'r1' });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('新建模式：remark 为空则不传 remark 字段（避免发送空串）', async () => {
    const created: CustomerPayload = { ...sampleCustomer, id: 100, remark: null };
    mockedCreate.mockResolvedValueOnce(created);

    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('customer-name-input'), { target: { value: '只有名字' } });
    fireEvent.click(screen.getByTestId('customer-save-btn'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate).toHaveBeenCalledWith({ nameWechat: '只有名字' });
  });
});

// ============================================
// 编辑：仅传变化的字段
// ============================================
describe('CustomerEditDialog 编辑', () => {
  it('改名后保存：仅传 nameWechat（remark 没变 → 不传）', async () => {
    mockedUpdate.mockResolvedValueOnce({ ...sampleCustomer, nameWechat: '李四（更名）' });

    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('customer-name-input'), { target: { value: '李四（更名）' } });
    fireEvent.click(screen.getByTestId('customer-save-btn'));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate).toHaveBeenCalledWith(42, { nameWechat: '李四（更名）' });
  });

  it('清空 remark：传 remark=null（显式清空，区别于 undefined "不变"）', async () => {
    mockedUpdate.mockResolvedValueOnce({ ...sampleCustomer, remark: null });

    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('customer-remark-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('customer-save-btn'));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate).toHaveBeenCalledWith(42, { remark: null });
  });

  it('什么都没改也点保存：调 store.update({}) 由后端容忍空 PATCH', async () => {
    mockedUpdate.mockResolvedValueOnce(sampleCustomer);

    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('customer-save-btn'));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate).toHaveBeenCalledWith(42, {});
  });
});

// ============================================
// 权限守卫
// ============================================
describe('CustomerEditDialog 权限守卫', () => {
  it('缺 customer:create 权限：新建模式保存按钮不渲染', () => {
    useProgressPermissionStore.getState().hydrate([]); // 清空所有权限
    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('customer-save-btn')).toBeNull();
    expect(screen.getByTestId('customer-cancel-btn')).toBeInTheDocument();
  });

  it('缺 customer:update 权限：编辑模式保存按钮不渲染', () => {
    useProgressPermissionStore.getState().hydrate(['customer:create']); // 只有 create
    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('customer-save-btn')).toBeNull();
  });

  it('通配 *:* 权限：保存按钮渲染', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('customer-save-btn')).toBeInTheDocument();
  });
});

// ============================================
// 取消按钮
// ============================================
describe('CustomerEditDialog 取消', () => {
  it('点击取消触发 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <CustomerEditDialog
        projectCustomer={sampleCustomer}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('customer-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ============================================
// 错误回调
// ============================================
describe('CustomerEditDialog 错误', () => {
  it('store.create 失败时调 onError 并保留弹窗', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('网络错误'));
    const onError = vi.fn();
    const onSave = vi.fn();

    render(
      <CustomerEditDialog
        projectCustomer={null}
        onSave={onSave}
        onCancel={vi.fn()}
        onError={onError}
      />,
    );
    fireEvent.change(screen.getByTestId('customer-name-input'), { target: { value: '失败客户' } });
    fireEvent.click(screen.getByTestId('customer-save-btn'));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('网络错误'));
    expect(onSave).not.toHaveBeenCalled();
    // 弹窗仍在
    expect(screen.getByTestId('customer-edit-dialog')).toBeInTheDocument();
  });
});

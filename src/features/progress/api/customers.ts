/**
 * @file customers.ts
 * @description 进度模块客户 CRUD API 调用层（Phase 4 - Worker A）。
 *
 *              所有函数都基于 client.ts 的 apiFetch + zod schemas，统一遵守：
 *              - 自动注入 Authorization Bearer header（progressAuthStore）
 *              - 自动剥 DataEnvelope 壳，返回纯数据
 *              - 响应不符合 schema 抛 ProgressApiError(code='schema_drift')
 *              - 网络/HTTP 错误透传 ProgressApiError，调用方自行处理
 *
 *              后端约定（openapi.yaml /api/customers）：
 *                GET    /api/customers       → CustomerListResponse
 *                POST   /api/customers       → CustomerResponse (201)
 *                GET    /api/customers/{id}  → CustomerResponse / 404
 *                PATCH  /api/customers/{id}  → CustomerResponse / 404 / 422
 *
 *              UpdateCustomer 入参对 remark 做"三态"区分：
 *                - undefined / 字段不存在 = "不修改 remark"
 *                - null                  = "清空 remark（设为 SQL NULL）"
 *                - string                = "设为该值"
 *              对应 openapi 的 OptNilString 语义；前端调用方传哪种就走哪条路径。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { apiFetch } from './client';
import {
  CustomerSchema,
  CustomerListSchema,
  type CustomerPayload,
} from './schemas';

// ============================================
// 入参类型
// ============================================

/**
 * 创建客户入参。
 * 对应 openapi components.schemas.CustomerCreateRequest
 */
export interface CreateCustomerInput {
  nameWechat: string;
  /** 可选；缺省 = 不填备注 */
  remark?: string;
}

/**
 * 更新客户入参（PATCH 语义：仅传需要变更的字段）。
 * 对应 openapi components.schemas.CustomerUpdateRequest
 *
 * remark 三态：
 *   - undefined：不修改
 *   - null：清空
 *   - string：覆盖为该值
 */
export interface UpdateCustomerInput {
  nameWechat?: string;
  remark?: string | null;
}

// ============================================
// API 调用
// ============================================

/**
 * 列出当前用户可见的客户（行级可见性由后端 RLS 决定）。
 *
 * @returns 客户数组（按 created_at DESC 排序）
 * @throws ProgressApiError —— 401/网络错误/schema 漂移
 */
export async function listCustomers(): Promise<CustomerPayload[]> {
  return apiFetch<CustomerPayload[]>('/api/customers', { method: 'GET' }, CustomerListSchema);
}

/**
 * 按 id 获取单个客户。
 *
 * @param id 客户 id
 * @returns Customer
 * @throws ProgressApiError(status=404) 当客户不存在或无权限
 */
export async function getCustomer(id: number): Promise<CustomerPayload> {
  return apiFetch<CustomerPayload>(
    `/api/customers/${id}`,
    { method: 'GET' },
    CustomerSchema,
  );
}

/**
 * 创建客户。当前登录用户自动成为 created_by。
 *
 * @param input 至少包含 nameWechat
 * @returns 新创建的 Customer
 * @throws ProgressApiError(code='validation_failed') nameWechat 为空
 */
export async function createCustomer(
  input: CreateCustomerInput,
): Promise<CustomerPayload> {
  return apiFetch<CustomerPayload>(
    '/api/customers',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    CustomerSchema,
  );
}

/**
 * 更新客户。仅传需要变更的字段（PATCH 语义）。
 *
 * @param id    客户 id
 * @param input 仅包含需要修改的字段；空对象语义 = "what？" 不应发起请求
 * @returns 更新后的 Customer
 * @throws ProgressApiError(404) id 不存在或无权限
 * @throws ProgressApiError(422) nameWechat 显式空字符串
 */
export async function updateCustomer(
  id: number,
  input: UpdateCustomerInput,
): Promise<CustomerPayload> {
  return apiFetch<CustomerPayload>(
    `/api/customers/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    CustomerSchema,
  );
}

// ============================================
// 命名空间导出（与 plan 中 customers.update / customers.create 引用对齐）
// ============================================

/**
 * 客户 API 集合命名空间。
 *
 * 业务用法：
 *   import { customers } from '@/features/progress/api/customers';
 *   await customers.list();
 *   await customers.create({ nameWechat: 'X' });
 */
export const customers = {
  list: listCustomers,
  get: getCustomer,
  create: createCustomer,
  update: updateCustomer,
};

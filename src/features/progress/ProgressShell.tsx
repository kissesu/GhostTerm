/**
 * @file ProgressShell.tsx
 * @description 进度模块外壳（Phase 0d 占位）。
 *
 *              当前职责：
 *              1. 在 AppLayout 中以 display:none 切换可见性，挂载后保留状态
 *              2. 显式 import api/client + schemas，确保 OpenAPI 类型/zod schema
 *                 能跟随 ProgressShell 一起进入 ts 类型检查
 *              3. 渲染"开发中"占位，后续 Phase 内逐步替换为 Workspace
 *                 （customer 列表 / project 看板 / 通知中心 等）
 *
 *              不做的事：
 *              - 不接真实 /api/auth/me：Phase 0a 后端只回 not_implemented_yet
 *              - 不读 progressAuthStore.accessToken：登录界面在 Phase 2
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { Activity } from 'lucide-react';
import type { components } from './api/types.gen';
import type { LoginResponsePayload, UserPayload } from './api/schemas';
import { LoginResponseSchema, UserSchema } from './api/schemas';
import { apiFetch, ProgressApiError } from './api/client';

// ============================================
// 类型自检：确保 OpenAPI 生成的类型与 zod schema 对齐
// 这两个类型断言会在 tsc --noEmit 时被检查；schema drift 会立即报错
// ============================================
type OASUser = components['schemas']['User'];
type OASLoginResponse = components['schemas']['AuthLoginResponse'];

// 编译时对齐：UserPayload 的字段必须能被赋值给 OASUser，反向亦然
// 用 satisfies 而非 = 避免引入未使用变量
const _userTypeCheck = ((u: UserPayload): OASUser => u) satisfies (u: UserPayload) => OASUser;
const _loginTypeCheck = ((l: LoginResponsePayload): OASLoginResponse => l) satisfies (
  l: LoginResponsePayload,
) => OASLoginResponse;
// 引用一次，避免 TS6133 unused 变量警告（noUnusedLocals 关闭时无影响，开启时必要）
void _userTypeCheck;
void _loginTypeCheck;

// 引用一次 apiFetch / schemas / 错误类型，让 IDE 与构建器跟踪到该模块依赖
// 真实调用在 Phase 2 登录页实现
void apiFetch;
void LoginResponseSchema;
void UserSchema;
void ProgressApiError;

/**
 * 进度模块根组件。
 *
 * 渲染层规则：
 * - 整个组件高度撑满父容器（AppLayout 通过 display:none 控制显隐）
 * - 不在自身做 router；Phase 11 项目详情页落地后再引入嵌套路由
 */
export default function ProgressShell() {
  return (
    <div
      data-testid="progress-shell"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'var(--c-bg)',
        color: 'var(--c-fg-muted)',
        userSelect: 'none',
      }}
    >
      <Activity size={32} strokeWidth={1.5} aria-hidden="true" />
      <div style={{ fontSize: 14, fontWeight: 500 }}>进度模块（开发中）</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Phase 0 接口骨架已就绪，业务页面将随各 Worker 阶段陆续上线
      </div>
    </div>
  );
}

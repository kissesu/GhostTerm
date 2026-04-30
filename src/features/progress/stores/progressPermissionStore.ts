/**
 * @file progressPermissionStore.ts
 * @description 兼容性 re-export：原 progress 模块的权限 store 已提升为全局
 *              `useGlobalPermissionStore`（位于 src/shared/stores/globalPermissionStore.ts）。
 *
 *              本文件保留作为向后兼容入口；新代码请直接 import useGlobalPermissionStore。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

export { useGlobalPermissionStore as useProgressPermissionStore } from '../../../shared/stores/globalPermissionStore';

/**
 * @file progressAuthStore.ts
 * @description 兼容性 re-export：原 progress 模块的 auth store 已提升为全局
 *              `useGlobalAuthStore`（位于 src/shared/stores/globalAuthStore.ts），
 *              所有模块（work / progress / atlas）共享同一份登录态。
 *
 *              本文件保留作为向后兼容入口，避免一次性改动所有 import 路径；
 *              内部直接 alias 到全局 store。新代码请直接使用 useGlobalAuthStore。
 *
 *              localStorage key 仍是 'progress_refresh_token'（不破坏既有用户登录态）。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

export {
  useGlobalAuthStore as useProgressAuthStore,
  getAccessToken,
} from '../../../shared/stores/globalAuthStore';

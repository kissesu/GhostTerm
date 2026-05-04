/**
 * @file useNow.ts
 * @description 返回当前时间戳的 hook；不用 setInterval（避免持续 tick 增加 CPU/GPU 开销），
 *              用 visibilitychange + focus 事件触发更新。
 *
 *              业务背景（用户反馈 2026-05-03）：
 *                  "时间线和时间线详情中的停留时间不自动更新"
 *                  + "不能使用 setInterval, 这会增加负担"
 *              StatusChangeRenderer 显示"已在 X 阶段停留 Y" 需要 now-occurredAt 实时差。
 *              setInterval 60s tick 虽小但用户明确拒绝；改用：
 *                  - 用户切回页面/窗口聚焦时刷新 now（最常见的"看一眼"场景）
 *                  - 期间静态显示，不消耗任何 CPU
 *
 *              何时不刷新：
 *                  - 用户挂着窗口持续看（罕见，可接受短暂滞后）
 *                  - 后台 tab（用户根本看不到，刷新无意义）
 *
 *              如未来要严格"每分钟跳" 可选 CSS @property + counter（纯 CSS 无 JS 重渲染）。
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import { useEffect, useState } from 'react';

export function useNow(): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return now;
}

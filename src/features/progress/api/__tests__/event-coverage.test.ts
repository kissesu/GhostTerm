/**
 * @file event-coverage.test.ts
 * @description 验证 EventCodeEnum 与 NBA_CONFIG 配置覆盖完整。
 *              FRONTEND_TRIGGERED 必须能在 NBA primaryAction/secondary 找到对应事件；
 *              BACKEND_ONLY 是前端不通过 NbaPanel 触发的事件（E0 由创建对话框直接触发）。
 * @author Atlas.oi
 * @date 2026-04-30
 */
import { describe, it, expect } from 'vitest';
import { EventCodeEnum } from '../projects';
import { NBA_CONFIG } from '../../config/nbaConfig';
import type { EventCode } from '../projects';

const FRONTEND_TRIGGERED_EVENTS: EventCode[] = [
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7',
  'E8', 'E9', 'E10', 'E11', 'E12', 'E13',
  'E_AS1', 'E_AS3',
];

const BACKEND_ONLY_EVENTS: EventCode[] = ['E0'];

// 收集 NBA_CONFIG 中所有出现的 eventCode（primary + secondary）
function collectNbaEventCodes(): Set<string> {
  const codes = new Set<string>();
  for (const cfg of Object.values(NBA_CONFIG)) {
    codes.add(cfg.primaryAction.eventCode);
    cfg.secondary.forEach((s) => codes.add(s.eventCode));
  }
  return codes;
}

describe('EventCode 覆盖完整性', () => {
  it('FRONTEND_TRIGGERED + BACKEND_ONLY 必须等于 EventCodeEnum 全集', () => {
    const enumValues = [...EventCodeEnum.options].sort();
    const allHandled = [...FRONTEND_TRIGGERED_EVENTS, ...BACKEND_ONLY_EVENTS].sort();
    expect(enumValues).toEqual(allHandled);
  });

  it('每个 FRONTEND_TRIGGERED 事件都能在 NBA_CONFIG 找到对应配置', () => {
    const allNbaEventCodes = collectNbaEventCodes();
    FRONTEND_TRIGGERED_EVENTS.forEach((code) => {
      expect(allNbaEventCodes.has(code), `事件 ${code} 在 NBA_CONFIG 缺配置`).toBe(true);
    });
  });

  it('BACKEND_ONLY 事件不在 NBA_CONFIG 中（避免误暴露 UI）', () => {
    const allNbaEventCodes = collectNbaEventCodes();
    BACKEND_ONLY_EVENTS.forEach((code) => {
      expect(allNbaEventCodes.has(code), `BACKEND_ONLY 事件 ${code} 不应在 NBA_CONFIG`).toBe(false);
    });
  });

  it('NBA_CONFIG 不应引入 FRONTEND_TRIGGERED 之外的事件（防止 BACKEND_ONLY 漏入 UI）', () => {
    const allNbaEventCodes = collectNbaEventCodes();
    const allowed = new Set<string>(FRONTEND_TRIGGERED_EVENTS);
    for (const code of allNbaEventCodes) {
      expect(allowed.has(code), `事件 ${code} 在 NBA_CONFIG 出现但不在 FRONTEND_TRIGGERED_EVENTS 清单`).toBe(true);
    }
  });

  it('NBA_CONFIG 不应在同一状态内同时将 eventCode 列为 primaryAction 和 secondary（避免歧义）', () => {
    // 跨状态的 E12（取消项目）等通用事件在多个 status 的 secondary 复用是有意为之
    // 此测试仅检测同一 NbaConfig 条目内 primary 与 secondary 的重叠
    for (const cfg of Object.values(NBA_CONFIG)) {
      const secondaryCodes = new Set(cfg.secondary.map((s) => s.eventCode));
      expect(secondaryCodes.has(cfg.primaryAction.eventCode),
        `${cfg.primaryAction.eventCode} 同时出现在 primaryAction 和 secondary，应该选一处`).toBe(false);
    }
  });
});

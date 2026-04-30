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

describe('EventCode 覆盖完整性', () => {
  it('FRONTEND_TRIGGERED + BACKEND_ONLY 必须等于 EventCodeEnum 全集', () => {
    const enumValues = [...EventCodeEnum.options].sort();
    const allHandled = [...FRONTEND_TRIGGERED_EVENTS, ...BACKEND_ONLY_EVENTS].sort();
    expect(enumValues).toEqual(allHandled);
  });

  it('每个 FRONTEND_TRIGGERED 事件都能在 NBA_CONFIG 找到对应配置', () => {
    const allNbaEventCodes = new Set<string>();
    for (const cfg of Object.values(NBA_CONFIG)) {
      allNbaEventCodes.add(cfg.primaryAction.eventCode);
      cfg.secondary.forEach((s) => allNbaEventCodes.add(s.eventCode));
    }
    FRONTEND_TRIGGERED_EVENTS.forEach((code) => {
      expect(allNbaEventCodes.has(code), `事件 ${code} 在 NBA_CONFIG 缺配置`).toBe(true);
    });
  });

  it('BACKEND_ONLY 事件不在 NBA_CONFIG 中（避免误暴露 UI）', () => {
    const allNbaEventCodes = new Set<string>();
    for (const cfg of Object.values(NBA_CONFIG)) {
      allNbaEventCodes.add(cfg.primaryAction.eventCode);
      cfg.secondary.forEach((s) => allNbaEventCodes.add(s.eventCode));
    }
    BACKEND_ONLY_EVENTS.forEach((code) => {
      expect(allNbaEventCodes.has(code), `BACKEND_ONLY 事件 ${code} 不应在 NBA_CONFIG`).toBe(false);
    });
  });
});

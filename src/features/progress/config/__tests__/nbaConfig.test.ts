/**
 * @file nbaConfig.test.ts
 * @description NBA 配置完整性 + reason 派生函数行为
 * @author Atlas.oi
 * @date 2026-04-30
 */
import { describe, it, expect } from 'vitest';
import { NBA_CONFIG, deriveReason, getPrimaryAction } from '../nbaConfig';
import type { ProjectStatus } from '../../api/projects';

describe('NBA_CONFIG 完整性', () => {
  it('9 个 ProjectStatus 都有配置', () => {
    const expected: ProjectStatus[] = [
      'dealing', 'quoting', 'developing', 'confirming',
      'delivered', 'paid', 'archived', 'after_sales', 'cancelled',
    ];
    expected.forEach((s) => {
      expect(NBA_CONFIG[s]).toBeDefined();
      expect(NBA_CONFIG[s].primaryAction).toBeDefined();
    });
  });

  it('terminal status (archived/cancelled) primaryAction 标 informational=true', () => {
    expect(NBA_CONFIG.archived.informational).toBe(true);
    expect(NBA_CONFIG.cancelled.informational).toBe(true);
  });

  it('非 terminal status informational 缺省为 false/undefined', () => {
    expect(NBA_CONFIG.developing.informational).toBeFalsy();
  });
});

describe('getPrimaryAction', () => {
  it('returns primary event for active status', () => {
    const action = getPrimaryAction('developing');
    expect(action.eventCode).toBe('E7');
    expect(action.transitionTo).toBe('confirming');
  });
});

describe('deriveReason', () => {
  it('default 文案在缺活动时间时也可用', () => {
    const reason = deriveReason('developing', { daysSinceLastActivity: null });
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
  });

  it('developing + 久无反馈触发"建议催进"文案', () => {
    const reason = deriveReason('developing', { daysSinceLastActivity: 5 });
    expect(reason).toContain('建议');
    expect(reason).toContain('5 天');  // 区分 default reason 同样含'建议'
  });

  it('developing days=4 边界：未到 5 天阈值，返回 default', () => {
    const reason = deriveReason('developing', { daysSinceLastActivity: 4 });
    expect(reason).toBe(NBA_CONFIG.developing.defaultReason);
  });

  it('confirming + 3 天无回复触发"建议提醒"文案', () => {
    const reason = deriveReason('confirming', { daysSinceLastActivity: 3 });
    expect(reason).toContain('提醒');
    expect(reason).toContain('3 天');
  });

  it('delivered + 3 天未收款触发"建议催收"文案', () => {
    const reason = deriveReason('delivered', { daysSinceLastActivity: 3 });
    expect(reason).toContain('催收');
  });

  it('NaN 视同 null 走 defaultReason（防御 Date 算术失败）', () => {
    const reason = deriveReason('developing', { daysSinceLastActivity: NaN });
    expect(reason).toBe(NBA_CONFIG.developing.defaultReason);
  });

  it('getPrimaryAction 未知 status 抛错', () => {
    expect(() => getPrimaryAction('unknown_status' as any)).toThrow(/未知 status/);
  });
});

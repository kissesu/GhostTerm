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
  });
});

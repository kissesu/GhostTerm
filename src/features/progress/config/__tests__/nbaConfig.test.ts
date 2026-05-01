/**
 * @file nbaConfig.test.ts
 * @description nbaConfig 单测：覆盖 9 status × 15 frontend-triggerable EventCode 不变量、
 *              informational 标记、helper 反查、deriveReason 各分支边界。
 *
 *              event-coverage 不变量：所有 15 个前端可触发的 EventCode（E1-E13 + E_AS1 + E_AS3，
 *              不含后端独占的 E0）必须在 NBA_CONFIG 的 primary 或 secondary 中至少出现一次；
 *              否则前端无入口触发该事件，与 spec §6.2 状态机契约不一致。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect } from 'vitest';

import type { EventCode, ProjectStatus } from '../../api/projects';
import {
  NBA_CONFIG,
  KANBAN_STAGES,
  PIPELINE_STAGES,
  STATUS_LABEL,
  getPrimaryAction,
  findActionMeta,
  deriveReason,
} from '../nbaConfig';

// 9 个 ProjectStatus 全集
const ALL_STATUSES: ProjectStatus[] = [
  'dealing', 'quoting', 'developing', 'confirming', 'delivered',
  'paid', 'archived', 'after_sales', 'cancelled',
];

// 前端可触发的 EventCode（E0 由后端 createProject 自动 fire，不在 NBA UI 暴露）
const FRONTEND_TRIGGERABLE_EVENTS: EventCode[] = [
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8',
  'E9', 'E10', 'E11', 'E12', 'E13', 'E_AS1', 'E_AS3',
];

describe('NBA_CONFIG - 9 status 完整性', () => {
  it('所有 9 个 ProjectStatus 都有 primaryAction', () => {
    for (const status of ALL_STATUSES) {
      const cfg = NBA_CONFIG[status];
      expect(cfg, `status=${status} 缺失配置`).toBeDefined();
      expect(cfg.primaryAction).toBeDefined();
      expect(cfg.primaryAction.eventCode).toBeTruthy();
      expect(cfg.primaryAction.label).toBeTruthy();
      expect(cfg.defaultReason).toBeTruthy();
    }
  });

  it('archived 与 cancelled informational=true，其它 7 个 status 不为 true', () => {
    expect(NBA_CONFIG.archived.informational).toBe(true);
    expect(NBA_CONFIG.cancelled.informational).toBe(true);
    const activeStatuses: ProjectStatus[] = [
      'dealing', 'quoting', 'developing', 'confirming', 'delivered', 'paid', 'after_sales',
    ];
    for (const status of activeStatuses) {
      expect(NBA_CONFIG[status].informational, `status=${status} 不应 informational`).not.toBe(true);
    }
  });

  it('5 个活跃 status (dealing/quoting/developing/confirming/delivered) 的 secondary 必须包含 E12 取消', () => {
    const activeStatuses: ProjectStatus[] = ['dealing', 'quoting', 'developing', 'confirming', 'delivered'];
    for (const status of activeStatuses) {
      const codes = NBA_CONFIG[status].secondary.map((a) => a.eventCode);
      expect(codes, `status=${status} secondary 缺 E12`).toContain('E12');
    }
  });

  it('paid/archived/after_sales/cancelled 的 secondary 为空数组（这些 status 仅有单一线性出口）', () => {
    expect(NBA_CONFIG.paid.secondary).toEqual([]);
    expect(NBA_CONFIG.archived.secondary).toEqual([]);
    expect(NBA_CONFIG.after_sales.secondary).toEqual([]);
    expect(NBA_CONFIG.cancelled.secondary).toEqual([]);
  });
});

describe('NBA_CONFIG - event-coverage 不变量', () => {
  it('15 个前端可触发的 EventCode 都在某个 status 的 primary 或 secondary 中至少出现一次', () => {
    const seen = new Set<EventCode>();
    for (const cfg of Object.values(NBA_CONFIG)) {
      seen.add(cfg.primaryAction.eventCode);
      for (const sec of cfg.secondary) seen.add(sec.eventCode);
    }
    const missing = FRONTEND_TRIGGERABLE_EVENTS.filter((code) => !seen.has(code));
    expect(missing, `缺失的 EventCode: ${missing.join(',')}`).toEqual([]);
  });

  it('NBA_CONFIG 不包含 E0（E0 是后端独占，由 createProject 自动 fire）', () => {
    for (const cfg of Object.values(NBA_CONFIG)) {
      expect(cfg.primaryAction.eventCode).not.toBe('E0');
      for (const sec of cfg.secondary) {
        expect(sec.eventCode).not.toBe('E0');
      }
    }
  });

  it('每个 status 的 primary + secondary 内 eventCode 不重复（同一 status 不应出现两次相同事件）', () => {
    for (const [status, cfg] of Object.entries(NBA_CONFIG)) {
      const codes = [cfg.primaryAction.eventCode, ...cfg.secondary.map((a) => a.eventCode)];
      const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
      expect(dup, `status=${status} 出现重复 eventCode: ${dup.join(',')}`).toEqual([]);
    }
  });
});

describe('NBA_CONFIG - 关键 status 主推映射（plan §1.1 决策表）', () => {
  it('dealing→E1, quoting→E4, developing→E7, confirming→E9, delivered→E10', () => {
    expect(NBA_CONFIG.dealing.primaryAction.eventCode).toBe('E1');
    expect(NBA_CONFIG.quoting.primaryAction.eventCode).toBe('E4');
    expect(NBA_CONFIG.developing.primaryAction.eventCode).toBe('E7');
    expect(NBA_CONFIG.confirming.primaryAction.eventCode).toBe('E9');
    expect(NBA_CONFIG.delivered.primaryAction.eventCode).toBe('E10');
  });

  it('paid→E11, archived→E_AS1, after_sales→E_AS3, cancelled→E13', () => {
    expect(NBA_CONFIG.paid.primaryAction.eventCode).toBe('E11');
    expect(NBA_CONFIG.archived.primaryAction.eventCode).toBe('E_AS1');
    expect(NBA_CONFIG.after_sales.primaryAction.eventCode).toBe('E_AS3');
    expect(NBA_CONFIG.cancelled.primaryAction.eventCode).toBe('E13');
  });

  it('primary action 的 transitionTo 与状态机决策表一致', () => {
    expect(NBA_CONFIG.dealing.primaryAction.transitionTo).toBe('quoting');
    expect(NBA_CONFIG.quoting.primaryAction.transitionTo).toBe('developing');
    expect(NBA_CONFIG.developing.primaryAction.transitionTo).toBe('confirming');
    expect(NBA_CONFIG.confirming.primaryAction.transitionTo).toBe('delivered');
    expect(NBA_CONFIG.delivered.primaryAction.transitionTo).toBe('paid');
    expect(NBA_CONFIG.paid.primaryAction.transitionTo).toBe('archived');
    expect(NBA_CONFIG.archived.primaryAction.transitionTo).toBe('after_sales');
    expect(NBA_CONFIG.after_sales.primaryAction.transitionTo).toBe('archived');
    expect(NBA_CONFIG.cancelled.primaryAction.transitionTo).toBe('dealing');
  });
});

describe('getPrimaryAction', () => {
  it('返回对应 status 的 primaryAction', () => {
    expect(getPrimaryAction('developing').eventCode).toBe('E7');
    expect(getPrimaryAction('developing').label).toBe('标记开发完成');
  });

  it('未知 status 抛错（防止静默 fallback）', () => {
    expect(() => getPrimaryAction('unknown' as ProjectStatus)).toThrow(/未知 status/);
  });
});

describe('findActionMeta - eventCode 反查', () => {
  it('E12 命中（在 5 个 status 的 secondary 都出现，返回首个匹配）', () => {
    const meta = findActionMeta('E12');
    expect(meta).not.toBeNull();
    expect(meta!.eventCode).toBe('E12');
    expect(meta!.kind).toBe('critical');
    expect(meta!.transitionTo).toBe('cancelled');
  });

  it('E1 命中（dealing primary）', () => {
    const meta = findActionMeta('E1');
    expect(meta).not.toBeNull();
    expect(meta!.eventCode).toBe('E1');
    expect(meta!.kind).toBe('primary');
  });

  it('E_AS1 命中（archived primary）', () => {
    const meta = findActionMeta('E_AS1');
    expect(meta).not.toBeNull();
    expect(meta!.transitionTo).toBe('after_sales');
  });

  it('15 个前端可触发 EventCode 全部能反查到非 null', () => {
    for (const code of FRONTEND_TRIGGERABLE_EVENTS) {
      expect(findActionMeta(code), `findActionMeta(${code}) 返回 null`).not.toBeNull();
    }
  });

  it('E0 反查为 null（NBA UI 不暴露 E0）', () => {
    expect(findActionMeta('E0')).toBeNull();
  });
});

describe('deriveReason - 时间敏感分支', () => {
  it('days=null → defaultReason', () => {
    const text = deriveReason('developing', { daysSinceLastActivity: null });
    expect(text).toBe(NBA_CONFIG.developing.defaultReason);
  });

  it('days=NaN → defaultReason', () => {
    const text = deriveReason('developing', { daysSinceLastActivity: NaN });
    expect(text).toBe(NBA_CONFIG.developing.defaultReason);
  });

  it('days=Infinity → defaultReason（不会因 >=5 误进分支）', () => {
    const text = deriveReason('developing', { daysSinceLastActivity: Infinity });
    expect(text).toBe(NBA_CONFIG.developing.defaultReason);
  });

  it('developing + days=5（边界）→ 催进度文案', () => {
    const text = deriveReason('developing', { daysSinceLastActivity: 5 });
    expect(text).toContain('已 5 天无新反馈');
    expect(text).toContain('催进度');
  });

  it('developing + days=4（边界下方）→ defaultReason', () => {
    const text = deriveReason('developing', { daysSinceLastActivity: 4 });
    expect(text).toBe(NBA_CONFIG.developing.defaultReason);
  });

  it('confirming + days=3（边界）→ 提醒验收文案', () => {
    const text = deriveReason('confirming', { daysSinceLastActivity: 3 });
    expect(text).toContain('已交客户验收 3 天');
    expect(text).toContain('提醒');
  });

  it('confirming + days=2（边界下方）→ defaultReason', () => {
    const text = deriveReason('confirming', { daysSinceLastActivity: 2 });
    expect(text).toBe(NBA_CONFIG.confirming.defaultReason);
  });

  it('delivered + days=3（边界）→ 催收尾款文案', () => {
    const text = deriveReason('delivered', { daysSinceLastActivity: 3 });
    expect(text).toContain('已交付 3 天');
    expect(text).toContain('催收');
  });

  it('delivered + days=2（边界下方）→ defaultReason', () => {
    const text = deriveReason('delivered', { daysSinceLastActivity: 2 });
    expect(text).toBe(NBA_CONFIG.delivered.defaultReason);
  });

  it('其它 status (dealing) 任意 days 都返回 defaultReason', () => {
    const text = deriveReason('dealing', { daysSinceLastActivity: 100 });
    expect(text).toBe(NBA_CONFIG.dealing.defaultReason);
  });
});

describe('视图常量', () => {
  it('KANBAN_STAGES 5 个元素', () => {
    expect(KANBAN_STAGES).toHaveLength(5);
    expect(KANBAN_STAGES).toEqual(['dealing', 'quoting', 'developing', 'confirming', 'delivered']);
  });

  it('PIPELINE_STAGES 7 个元素，包含 paid + archived', () => {
    expect(PIPELINE_STAGES).toHaveLength(7);
    expect(PIPELINE_STAGES).toContain('paid');
    expect(PIPELINE_STAGES).toContain('archived');
  });

  it('STATUS_LABEL 覆盖全部 9 个 ProjectStatus', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_LABEL[status], `${status} 缺中文 label`).toBeTruthy();
    }
  });
});

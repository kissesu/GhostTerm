/**
 * @file TemplateStore.ts
 * @description 模板 Zustand store。负责：
 *   1. 通过 Tauri invoke 读写磁盘上的模板 JSON（template_*_cmd）
 *   2. create() 强制深拷贝内置规则，保证用户模板与内置模板完全隔离
 *   3. migrateNewRules() 为所有现有模板追加新规则（disabled 默认）
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { BUILTIN_TEMPLATE_ID } from './builtinTemplate';

// ─────────────────────────────────────────────
// 类型定义（与 Rust TemplateJson 字段对齐）
// ─────────────────────────────────────────────

export interface TemplateSource {
  type: 'builtin' | 'manual' | 'extracted';
  origin_docx?: string | null;
  extracted_at?: string | null;
}

export interface TemplateJson {
  schema_version: 2;
  id: string;
  name: string;
  source: TemplateSource;
  updated_at: string;
  rules: Record<string, { enabled: boolean; value: unknown }>;
}

// ─────────────────────────────────────────────
// 内部工具函数
// ─────────────────────────────────────────────

/**
 * 将模板名称 slug 化，用于生成模板 ID。
 *
 * 策略：
 * - 全部小写、空格→连字符、去除非 a-z0-9- 字符
 * - 中文等字符会被完全去除，回退到 'template'（Rust validate_id 只允许 a-z0-9-）
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'template';
}

// ─────────────────────────────────────────────
// Store 接口
// ─────────────────────────────────────────────

interface TemplateStoreState {
  templates: TemplateJson[];
  loading: boolean;
  /**
   * 本次启动检测到的新规则数量（尚未追加到模板的规则）
   * 大于 0 时 MigrationBanner 显示提示；用户点"知道了"后清零
   */
  pendingMigrationCount: number;

  /** 从 Rust 端全量读取模板列表 */
  load(): Promise<void>;

  /** 用户确认 migration 提示，清零 pendingMigrationCount */
  acknowledgeMigration(): void;

  /** 按 id 查找模板，不存在返回 null */
  get(id: string): TemplateJson | null;

  /**
   * 创建新模板（从内置模板深拷贝 rules）
   *
   * 业务逻辑：
   * 1. 找到内置模板 _builtin-gbt7714（必须存在）
   * 2. JSON.parse(JSON.stringify(...)) 强制值复制，确保与内置模板完全隔离
   * 3. 若传入 explicitRules，直接使用而非拷贝内置规则（P4 Workspace 流程）
   * 4. 调用 template_save_cmd 持久化，再 load() 重读
   */
  create(
    name: string,
    options?: {
      // P4 Workspace 流程：直接传入用户逐字段确认后的规则 map，不再从内置拷贝
      explicitRules?: Record<string, { enabled: boolean; value: Record<string, unknown> }>;
    },
  ): Promise<string>;

  /** 更新模板（write 后 reload） */
  update(id: string, patch: Partial<TemplateJson>): Promise<void>;

  /** 删除模板（write 后 reload） */
  remove(id: string): Promise<void>;

  /** 恢复内置模板到初始状态 */
  restoreBuiltin(): Promise<void>;

  /**
   * 为所有现有模板追加尚未存在的新规则（enabled: false, value: null）
   *
   * 用途：规则集版本升级时，确保旧模板文件包含所有新规则键，
   * 避免 detect 时漏检。只追加缺失项，不覆盖已有配置。
   */
  migrateNewRules(newRuleIds: string[]): Promise<void>;
}

// ─────────────────────────────────────────────
// Store 实现
// ─────────────────────────────────────────────

export const useTemplateStore = create<TemplateStoreState>((set, get) => ({
  templates: [],
  loading: false,
  // 初始为 0，load 时若检测到新规则才更新
  pendingMigrationCount: 0,

  async load() {
    set({ loading: true });
    try {
      const templates = await invoke<TemplateJson[]>('template_list_cmd');
      set({ templates });

    } finally {
      set({ loading: false });
    }
  },

  acknowledgeMigration() {
    // 用户点"知道了"后清零，隐藏 banner
    set({ pendingMigrationCount: 0 });
  },

  get(id) {
    return get().templates.find((t) => t.id === id) ?? null;
  },

  async create(name: string, options?: { explicitRules?: Record<string, { enabled: boolean; value: Record<string, unknown> }> }) {
    // ============================================
    // 第一步：确定 rules 来源
    // P4 Workspace 流程：explicitRules 直接来自用户逐字段确认，深拷贝后使用
    // 其他流程：从内置模板深拷贝（必须用 JSON 序列化/反序列化确保值层面独立）
    // ============================================
    let deepCloned: TemplateJson['rules'];

    if (options?.explicitRules) {
      deepCloned = JSON.parse(JSON.stringify(options.explicitRules)) as TemplateJson['rules'];
    } else {
      const builtin = get().templates.find((t) => t.id === BUILTIN_TEMPLATE_ID);
      if (!builtin) throw new Error('Builtin template missing');
      deepCloned = JSON.parse(JSON.stringify(builtin.rules)) as TemplateJson['rules'];
    }

    // ============================================
    // 第二步：构造新模板对象
    // id = slug(name) + base36 时间戳，保证唯一且 Rust validate_id 兼容
    // ============================================
    const newId = slugify(name) + '-' + Date.now().toString(36);
    const newTpl: TemplateJson = {
      schema_version: 2,
      id: newId,
      name,
      // P4 Workspace 流程用 extracted source，普通新建用 manual
      source: options?.explicitRules ? { type: 'extracted' } : { type: 'manual' },
      updated_at: new Date().toISOString(),
      rules: deepCloned,
    };

    await invoke('template_save_cmd', { template: newTpl });
    await get().load();
    return newId;
  },

  async update(id, patch) {
    const cur = get().get(id);
    if (!cur) throw new Error(`template ${id} not found`);
    const updated: TemplateJson = {
      ...cur,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await invoke('template_save_cmd', { template: updated });
    await get().load();
  },

  async remove(id) {
    await invoke('template_delete_cmd', { id });
    await get().load();
  },

  async restoreBuiltin() {
    await invoke('template_restore_builtin_cmd');
    await get().load();
  },

  async migrateNewRules(newRuleIds) {
    const all = get().templates;
    for (const tpl of all) {
      let changed = false;
      const newRules = { ...tpl.rules };
      for (const rid of newRuleIds) {
        if (!(rid in newRules)) {
          newRules[rid] = { enabled: false, value: null };
          changed = true;
        }
      }
      // 只在确实有新规则追加时才写盘，避免无意义的 updated_at 更新
      if (changed) {
        const updated: TemplateJson = {
          ...tpl,
          rules: newRules,
          updated_at: new Date().toISOString(),
        };
        await invoke('template_save_cmd', { template: updated });
      }
    }
    // 全部写完后一次性重读，保持 store 与磁盘一致
    await get().load();
  },
}));

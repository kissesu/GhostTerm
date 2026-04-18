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
import { sidecarInvoke } from '../toolsSidecarClient';

// ─────────────────────────────────────────────
// 类型定义（与 Rust TemplateJson 字段对齐）
// ─────────────────────────────────────────────

export interface TemplateSource {
  type: 'builtin' | 'manual' | 'extracted';
  origin_docx?: string | null;
  extracted_at?: string | null;
}

export interface TemplateJson {
  schema_version: number;
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
   * 3. 若传入 fromDocx，调用 sidecar extract_template 覆盖对应 rule value
   * 4. 调用 template_save_cmd 持久化，再 load() 重读
   */
  create(name: string, options?: { fromDocx?: string }): Promise<string>;

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

      // ============================================
      // Migration check：向 sidecar 获取支持的规则列表，
      // 与内置模板已有规则 diff，追加新规则（enabled:false）
      // 若 sidecar 不可用，静默跳过，不阻断模板加载
      // ============================================
      try {
        const { rules: supported } = await sidecarInvoke<{ rules: string[] }>({ cmd: 'list_rules' });
        const builtin = templates.find((t) => t.id === '_builtin-gbt7714');
        if (builtin) {
          const newRuleIds = supported.filter((id) => !(id in builtin.rules));
          if (newRuleIds.length > 0) {
            // 记录新规则数量，MigrationBanner 据此显示提示
            set({ pendingMigrationCount: newRuleIds.length });
            await get().migrateNewRules(newRuleIds);
          }
        }
      } catch (e) {
        // sidecar 未启动或网络异常：跳过 migration，不影响模板加载
        console.warn('[TemplateStore] migration check skipped:', e);
      }
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

  async create(name, options) {
    // ============================================
    // 第一步：找内置模板并深拷贝 rules
    // 必须用 JSON 序列化/反序列化，确保值层面完全独立
    // ============================================
    const builtin = get().templates.find((t) => t.id === '_builtin-gbt7714');
    if (!builtin) throw new Error('Builtin template missing');

    const deepCloned = JSON.parse(JSON.stringify(builtin.rules)) as TemplateJson['rules'];

    // ============================================
    // 第二步：构造新模板对象
    // id = slug(name) + base36 时间戳，保证唯一且 Rust validate_id 兼容
    // ============================================
    const newId = slugify(name) + '-' + Date.now().toString(36);
    const newTpl: TemplateJson = {
      schema_version: 1,
      id: newId,
      name,
      source: { type: 'manual' },
      updated_at: new Date().toISOString(),
      rules: deepCloned,
    };

    // ============================================
    // 第三步（可选）：从 docx 提取规则值覆盖
    // Task 21 实现 sidecar extract_template 后才可用
    // ============================================
    if (options?.fromDocx) {
      const extracted = await sidecarInvoke<{ rules: Record<string, { value: unknown }> }>({
        cmd: 'extract_template',
        file: options.fromDocx,
      });
      Object.entries(extracted.rules).forEach(([k, v]) => {
        if (newTpl.rules[k]) {
          newTpl.rules[k].value = v.value;
        }
      });
      newTpl.source = {
        type: 'extracted',
        origin_docx: options.fromDocx,
        extracted_at: new Date().toISOString(),
      };
    }

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

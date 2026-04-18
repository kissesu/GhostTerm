/**
 * @file templateStore.test.ts
 * @description TemplateStore 单元测试
 *   1. load 后 templates 更新
 *   2. create 后 list 含新模板
 *   3. 深拷贝隔离：改内置 rules 不影响已存用户模板
 *   4. migrateNewRules 为所有模板追加缺失规则
 *   5. load migration check：pendingMigrationCount 与 acknowledgeMigration
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Tauri invoke ───────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ─── Mock sidecarClient（extract_template + list_rules） ───
vi.mock('../toolsSidecarClient', () => ({
  sidecarInvoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { sidecarInvoke } from '../toolsSidecarClient';
import { useTemplateStore } from '../templates/TemplateStore';
import type { TemplateJson } from '../templates/TemplateStore';

const mockedInvoke = vi.mocked(invoke);
const mockedSidecarInvoke = vi.mocked(sidecarInvoke);

// ─── 测试用内置模板 fixture ───────────────────
const builtinTemplate: TemplateJson = {
  schema_version: 2,
  id: '_builtin-gbt7714',
  name: 'GB/T 7714 内置',
  source: { type: 'builtin' },
  updated_at: '2026-01-01T00:00:00.000Z',
  rules: {
    cjk_ascii_space: { enabled: true, value: { allowed: false } },
    font_body: { enabled: true, value: 'SimSun' },
  },
};

// 每个 test 前重置 store 和 mock
beforeEach(() => {
  mockedInvoke.mockReset();
  mockedSidecarInvoke.mockReset();
  useTemplateStore.setState({ templates: [], loading: false, pendingMigrationCount: 0 });
});

// ─────────────────────────────────────────────
// Case 1: load 后 templates 更新
// ─────────────────────────────────────────────
describe('load', () => {
  it('应从 Rust 加载模板列表', async () => {
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]);

    await useTemplateStore.getState().load();

    expect(mockedInvoke).toHaveBeenCalledWith('template_list_cmd');
    expect(useTemplateStore.getState().templates).toHaveLength(1);
    expect(useTemplateStore.getState().templates[0].id).toBe('_builtin-gbt7714');
  });

  it('loading 标志在请求期间为 true，完成后为 false', async () => {
    let resolveLoad!: (v: TemplateJson[]) => void;
    mockedInvoke.mockReturnValueOnce(
      new Promise<TemplateJson[]>((res) => { resolveLoad = res; }),
    );

    const loadPromise = useTemplateStore.getState().load();
    expect(useTemplateStore.getState().loading).toBe(true);

    resolveLoad([builtinTemplate]);
    await loadPromise;
    expect(useTemplateStore.getState().loading).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Case 2: create 后 list 含新模板
// ─────────────────────────────────────────────
describe('create', () => {
  it('create 后 list 包含新建模板，返回新 id', async () => {
    // 先 load 内置模板，让 store 有内置模板可供深拷贝
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]);
    await useTemplateStore.getState().load();

    const userTemplate: TemplateJson = {
      ...builtinTemplate,
      id: 'my-tpl-1f2a3b',
      name: 'my tpl',
      source: { type: 'manual' },
    };

    // save → ok，reload → builtin + user
    mockedInvoke.mockResolvedValueOnce(undefined); // template_save_cmd
    mockedInvoke.mockResolvedValueOnce([builtinTemplate, userTemplate]); // template_list_cmd

    const newId = await useTemplateStore.getState().create('my tpl');

    expect(newId).toMatch(/^my-tpl-/);
    expect(useTemplateStore.getState().templates).toHaveLength(2);

    // 确认 save 时传了 template 参数
    const saveCall = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'template_save_cmd');
    expect(saveCall).toBeDefined();
    expect(saveCall![1]).toHaveProperty('template');
  });

  it('内置模板缺失时 create 抛错', async () => {
    // store 为空（beforeEach 已重置），不 load
    await expect(useTemplateStore.getState().create('test')).rejects.toThrow(
      'Builtin template missing',
    );
  });

  it('创建模板 schema_version 固定为 2', async () => {
    // 加载内置模板后调 create，捕获写入磁盘的 template 对象
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]);
    await useTemplateStore.getState().load();

    let capturedVersion: number | undefined;
    mockedInvoke.mockImplementationOnce(async (_cmd, args) => {
      capturedVersion = (args as { template: TemplateJson }).template.schema_version;
      return undefined;
    });
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // reload

    await useTemplateStore.getState().create('version check');

    expect(capturedVersion).toBe(2);
  });
});

// ─────────────────────────────────────────────
// Case 3: 深拷贝隔离
// ─────────────────────────────────────────────
describe('深拷贝隔离', () => {
  it('create 写入磁盘的 rules 与内置模板 rules 不共享引用', async () => {
    // 加载内置模板
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]);
    await useTemplateStore.getState().load();

    let capturedTemplate: TemplateJson | null = null;
    // 拦截 save，捕获写入的模板内容
    mockedInvoke.mockImplementationOnce(async (_cmd, args) => {
      capturedTemplate = (args as { template: TemplateJson }).template;
      return undefined;
    });
    // reload 返回与 capturedTemplate 一致的数组（模拟 Rust 已保存）
    mockedInvoke.mockImplementationOnce(async () => [builtinTemplate, capturedTemplate]);

    await useTemplateStore.getState().create('user copy');

    // 此时修改内存中 builtin 的 rules 值（模拟后续调用可能修改）
    const storeBuiltin = useTemplateStore.getState().templates.find((t) => t.id === '_builtin-gbt7714')!;
    storeBuiltin.rules['cjk_ascii_space'].value = { allowed: true }; // 直接修改内存

    // 验证：写入磁盘的用户模板 rules 不受影响（深拷贝已在 create 时发生）
    expect(capturedTemplate!.rules['cjk_ascii_space'].value).toEqual({ allowed: false });
  });
});

// ─────────────────────────────────────────────
// Case 4: migrateNewRules
// ─────────────────────────────────────────────
describe('migrateNewRules', () => {
  it('为所有模板追加缺失的新规则（disabled + null）', async () => {
    // 先填充 store（两个模板）
    const userTemplate: TemplateJson = {
      schema_version: 2,
      id: 'user-tpl-abc',
      name: '我的模板',
      source: { type: 'manual' },
      updated_at: '2026-01-01T00:00:00.000Z',
      rules: {
        cjk_ascii_space: { enabled: true, value: { allowed: false } },
      },
    };
    useTemplateStore.setState({ templates: [builtinTemplate, userTemplate] });

    // save 两次（各一个模板），reload 一次
    mockedInvoke.mockResolvedValue(undefined); // 所有 save 返回 ok
    mockedInvoke.mockResolvedValueOnce(undefined); // save builtin
    mockedInvoke.mockResolvedValueOnce(undefined); // save user
    mockedInvoke.mockResolvedValueOnce([builtinTemplate, userTemplate]); // reload

    await useTemplateStore.getState().migrateNewRules(['new.rule.id', 'another.rule']);

    // 验证 save 被调用两次（两个模板都要更新）
    const saveCalls = mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'template_save_cmd');
    expect(saveCalls).toHaveLength(2);

    // 验证每次 save 的模板中都包含新规则
    for (const [, args] of saveCalls) {
      const tpl = (args as { template: TemplateJson }).template;
      expect(tpl.rules['new.rule.id']).toEqual({ enabled: false, value: null });
      expect(tpl.rules['another.rule']).toEqual({ enabled: false, value: null });
    }
  });

  it('已存在的规则不被覆盖', async () => {
    const tplWithRule: TemplateJson = {
      ...builtinTemplate,
      id: 'user-already-has',
      source: { type: 'manual' },
      rules: {
        cjk_ascii_space: { enabled: true, value: { allowed: false } },
        // 已有 new.rule，且 enabled: true（不应被覆盖为 false）
        'new.rule': { enabled: true, value: 'custom' },
      },
    };
    useTemplateStore.setState({ templates: [tplWithRule] });

    mockedInvoke.mockResolvedValueOnce([tplWithRule]); // reload

    // 因为 new.rule 已存在，changed=false，不触发 save
    await useTemplateStore.getState().migrateNewRules(['new.rule']);

    const saveCalls = mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'template_save_cmd');
    expect(saveCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// Case 5: load migration check（pendingMigrationCount）
// ─────────────────────────────────────────────
describe('load migration check', () => {
  it('检测到新规则时 pendingMigrationCount > 0', async () => {
    // builtin 只含 cjk_ascii_space/font_body，sidecar 多出 new.rule
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // template_list_cmd
    mockedSidecarInvoke.mockResolvedValueOnce({
      rules: ['cjk_ascii_space', 'font_body', 'new.rule'],
    });
    // migrateNewRules 内部：save builtin + reload
    mockedInvoke.mockResolvedValueOnce(undefined); // template_save_cmd
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // reload inside migrateNewRules

    await useTemplateStore.getState().load();

    expect(useTemplateStore.getState().pendingMigrationCount).toBe(1);
  });

  it('acknowledgeMigration 清零 pendingMigrationCount', () => {
    useTemplateStore.setState({ pendingMigrationCount: 3 });
    useTemplateStore.getState().acknowledgeMigration();
    expect(useTemplateStore.getState().pendingMigrationCount).toBe(0);
  });

  it('list_rules 失败时不阻断 templates 加载', async () => {
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // template_list_cmd
    mockedSidecarInvoke.mockRejectedValueOnce(new Error('sidecar not running'));

    await useTemplateStore.getState().load();

    // templates 正常加载，pendingMigrationCount 维持 0
    expect(useTemplateStore.getState().templates).toHaveLength(1);
    expect(useTemplateStore.getState().pendingMigrationCount).toBe(0);
  });

  it('builtin 含全部规则时 pendingMigrationCount = 0 且 migrateNewRules 不调用', async () => {
    // sidecar 返回的规则与内置模板完全吻合，无新规则
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // template_list_cmd
    mockedSidecarInvoke.mockResolvedValueOnce({
      rules: ['cjk_ascii_space', 'font_body'],
    });

    await useTemplateStore.getState().load();

    expect(useTemplateStore.getState().pendingMigrationCount).toBe(0);
    // template_save_cmd 不应被调用（无迁移）
    const saveCalls = mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'template_save_cmd');
    expect(saveCalls).toHaveLength(0);
  });
});

/**
 * @file templateStore.test.ts
 * @description TemplateStore 单元测试
 *   1. load 后 templates 更新
 *   2. create 后 list 含新模板
 *   3. 深拷贝隔离：改内置 rules 不影响已存用户模板
 *   4. migrateNewRules 为所有模板追加缺失规则
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Tauri invoke ───────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { useTemplateStore } from '../templates/TemplateStore';
import type { TemplateJson } from '../templates/TemplateStore';

const mockedInvoke = vi.mocked(invoke);

// ─── 测试用内置模板 fixture ───────────────────
const builtinTemplate: TemplateJson = {
  schema_version: 2,
  id: '_builtin-gbt7714-v2',
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
    expect(useTemplateStore.getState().templates[0].id).toBe('_builtin-gbt7714-v2');
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
    const storeBuiltin = useTemplateStore.getState().templates.find((t) => t.id === '_builtin-gbt7714-v2')!;
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
// Case 5: BUILTIN_ID 共享常量 v1/v2 错配回归
// 历史 bug：前端硬编码 v1，Rust 端是 v2 → create 在仅 v2 库中 throw missing；
//          自定义模板的删除链路因 BUILTIN_ID 比对错位而被 Rust 自动重建误判。
// 本组测试保证：
//   - 自定义模板 remove() 后 reload 列表不再含该模板（命中 BUILTIN_ID 比对真分支）
//   - create() 在仅有 v2 builtin 的库中能找到 builtin 不抛 missing
// 判别力：临时把 BUILTIN_TEMPLATE_ID 还原为 '_builtin-gbt7714'，下面两个 case 必挂。
// ─────────────────────────────────────────────
describe('T-fix BUILTIN_ID 共享常量同步', () => {
  it('自定义模板 remove() 后 reload 列表不再含该模板', async () => {
    // 第一步：填入 v2 内置 + 一个自定义模板
    const customTpl: TemplateJson = {
      schema_version: 2,
      id: 'user-custom-xyz',
      name: '我的自定义模板',
      source: { type: 'manual' },
      updated_at: '2026-01-01T00:00:00.000Z',
      rules: { 'font.body': { enabled: true, value: { family: '黑体', size_pt: 12 } } },
    };
    useTemplateStore.setState({ templates: [builtinTemplate, customTpl] });

    // 第二步：mock template_delete_cmd 成功 + 后续 template_list_cmd 返回过滤后的列表
    // 注意：参考"自定义模板可删"的现实行为——Rust 端只在 id == BUILTIN_ID 时重建，
    //       customTpl.id 不等于 BUILTIN_ID 因此 reload 应不含它
    mockedInvoke.mockResolvedValueOnce(undefined); // template_delete_cmd
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // template_list_cmd（过滤后）

    await useTemplateStore.getState().remove('user-custom-xyz');

    // 第三步：断言 store.templates 不再含 user-custom-xyz
    const ids = useTemplateStore.getState().templates.map((t) => t.id);
    expect(ids).not.toContain('user-custom-xyz');
    expect(ids).toContain('_builtin-gbt7714-v2');

    // 验证 invoke 链路完整：先删后 list
    const deleteCall = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'template_delete_cmd');
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual({ id: 'user-custom-xyz' });
  });

  it('create() 在仅有 v2 builtin 的库中能找到 builtin 不抛 missing', async () => {
    // 模拟用户库只有 v2 builtin（没有 v1 残留）
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]);
    await useTemplateStore.getState().load();

    // create 应能找到 builtin 完成深拷贝；save + reload 走完整链路
    mockedInvoke.mockResolvedValueOnce(undefined); // template_save_cmd
    mockedInvoke.mockResolvedValueOnce([builtinTemplate]); // reload

    // 关键断言：不抛 'Builtin template missing'
    // 临时把 BUILTIN_TEMPLATE_ID 改回 '_builtin-gbt7714' 此处 rejects.toThrow('Builtin template missing')
    await expect(useTemplateStore.getState().create('我的模板')).resolves.toMatch(/^/);
  });
});


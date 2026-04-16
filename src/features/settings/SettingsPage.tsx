/**
 * @file SettingsPage - 设置中心页面
 * @description 完整重设计的设置页面。
 *              外观分区：界面主题（dark/light/system）控制整体应用 UI 样式 + 终端配色。
 *              终端分区：shell 路径、字体大小、字体家族、光标样式。
 *              主题控制的是整个程序的视觉风格，而非单独的终端配色。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { type ChangeEvent, useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import WindowTitleBar from '../../shared/components/WindowTitleBar';
import { useSettingsStore, type AppTheme } from '../../shared/stores/settingsStore';
import type { UpdaterState, UpdaterActions } from '../updater/useUpdater';

/* ================================================================
   组件：更新分区
   ================================================================ */
function UpdateSection({
  state,
  actions,
}: {
  state: UpdaterState;
  actions: UpdaterActions;
}) {
  const [appVersion, setAppVersion] = useState<string>('...');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    await actions.checkNow();
    setChecking(false);
  };

  const btnStyle: React.CSSProperties = {
    height: 34,
    padding: '0 16px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--c-border)',
    background: 'var(--c-raised)',
    color: 'var(--c-fg)',
    fontSize: 13,
    fontFamily: 'var(--font-ui)',
    cursor: checking || state.installing ? 'not-allowed' : 'pointer',
    opacity: checking || state.installing ? 0.5 : 1,
    transition: 'opacity var(--dur-fast)',
    whiteSpace: 'nowrap' as const,
  };

  const primaryBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: 'var(--c-accent)',
    border: '1px solid var(--c-accent)',
    color: 'var(--c-bg)',
    fontWeight: 600,
    cursor: state.installing ? 'not-allowed' : 'pointer',
    opacity: state.installing ? 0.5 : 1,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 当前版本行 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-border)',
        background: 'var(--c-raised)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-fg)' }}>
            当前版本
          </div>
          <div style={{ fontSize: 12, color: 'var(--c-fg-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
            v{appVersion}
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking || state.installing}
          style={btnStyle}
        >
          {checking ? '检测中...' : '检查更新'}
        </button>
      </div>

      {/* 状态提示区 */}
      {state.available && (
        <div style={{
          padding: '16px',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--c-accent)',
          background: 'var(--c-card-active)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-accent)' }}>
              发现新版本 v{state.version}
            </div>
            {state.notes && (
              <div style={{ fontSize: 12, color: 'var(--c-fg-muted)', marginTop: 6, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {state.notes}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={actions.applyUpdate} disabled={state.installing} style={primaryBtnStyle}>
              {state.installing
                ? state.progress !== null && state.progress > 0
                  ? `下载中 ${state.progress}%`
                  : '准备中...'
                : '立即安装'}
            </button>
            <button type="button" onClick={actions.dismiss} disabled={state.installing} style={btnStyle}>
              稍后
            </button>
          </div>
        </div>
      )}

      {/* 无更新 / 错误提示 */}
      {!state.available && state.error && (
        <div style={{
          fontSize: 12,
          color: state.error === '已是最新版本' ? 'var(--c-fg-muted)' : 'var(--c-danger)',
          padding: '10px 14px',
          borderRadius: 'var(--r-md)',
          background: 'var(--c-raised)',
          border: '1px solid var(--c-border)',
        }}>
          {state.error}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   图标
   ================================================================ */
function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 1 0 9.79 9.79Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function AutoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/* ================================================================
   组件：Section — 带分割线的内容块
   ================================================================ */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <h2 style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--c-fg-subtle)',
          margin: 0,
          whiteSpace: 'nowrap',
        }}>
          {title}
        </h2>
        <div style={{ flex: 1, height: 1, background: 'var(--c-border-sub)' }} />
      </div>
      {children}
    </section>
  );
}

/* ================================================================
   组件：FormField — 标签 + 输入控件
   ================================================================ */
function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-fg)' }}>
        {label}
      </label>
      {hint && (
        <span style={{ fontSize: 11, color: 'var(--c-fg-subtle)', marginTop: -3, lineHeight: 1.4 }}>
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}

/* ================================================================
   通用 input/select 样式
   ================================================================ */
const inputStyle: React.CSSProperties = {
  height: 36,
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--c-border)',
  background: 'var(--c-input)',
  color: 'var(--c-fg)',
  padding: '0 12px',
  fontSize: 13,
  fontFamily: 'var(--font-ui)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color var(--dur-fast) var(--ease-out)',
};

/* ================================================================
   组件：主题选择卡片
   ================================================================ */
interface ThemeCardProps {
  value: AppTheme;
  current: AppTheme;
  label: string;
  description: string;
  icon: React.ReactNode;
  onSelect: (v: AppTheme) => void;
}

function ThemeCard({ value, current, label, description, icon, onSelect }: ThemeCardProps) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '18px 10px 14px',
        border: active
          ? '1.5px solid var(--c-accent)'
          : '1.5px solid var(--c-border)',
        borderRadius: 'var(--r-lg)',
        background: active ? 'var(--c-card-active)' : 'var(--c-raised)',
        color: active ? 'var(--c-accent)' : 'var(--c-fg-muted)',
        cursor: 'pointer',
        transition: 'border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out)',
        fontFamily: 'var(--font-ui)',
      }}
      data-testid={`theme-card-${value}`}
    >
      {icon}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: active ? 600 : 500, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 10, color: active ? 'var(--c-accent)' : 'var(--c-fg-subtle)', marginTop: 3, opacity: 0.85 }}>{description}</div>
      </div>
      {/* 选中指示器：底部圆点 */}
      <div style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: active ? 'var(--c-accent)' : 'transparent',
        border: active ? 'none' : '1px solid var(--c-border)',
        transition: 'background var(--dur-base) var(--ease-out)',
        flexShrink: 0,
      }} />
    </button>
  );
}

/* ================================================================
   侧边导航按钮（复用 sidebar-nav-item CSS 类）
   ================================================================ */
type SettingSection = 'appearance' | 'terminal' | 'update';

const NAV_ITEMS: { key: SettingSection; label: string; icon: React.ReactNode }[] = [
  {
    key: 'appearance',
    label: '外观',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'terminal',
    label: '终端',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 4l5 4-5 4M9 12h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'update',
    label: '更新',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 2v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

/* ================================================================
   主组件
   ================================================================ */
export default function SettingsPage({
  updateState,
  updateActions,
}: {
  updateState: UpdaterState;
  updateActions: UpdaterActions;
}) {
  const closeSettings          = useSettingsStore((s) => s.closeSettings);
  const appTheme               = useSettingsStore((s) => s.appTheme);
  const terminal               = useSettingsStore((s) => s.terminal);
  const updateAppTheme         = useSettingsStore((s) => s.updateAppTheme);
  const updateTerminalSettings = useSettingsStore((s) => s.updateTerminalSettings);

  const [activeSection, setActiveSection] = useState<SettingSection>('appearance');

  const onSystemShellChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateTerminalSettings({ useSystemShell: e.target.checked });
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 标题栏 */}
      <WindowTitleBar
        showBrand={false}
        left={
          <button
            type="button"
            onClick={closeSettings}
            className="btn-icon"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '0 10px',
              fontSize: 12,
              fontFamily: 'var(--font-ui)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--c-fg-muted)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              width: 'auto',
            }}
            data-testid="settings-back-button"
          >
            <BackIcon />
            返回
          </button>
        }
        center={
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-fg-muted)', letterSpacing: '0.04em' }}>
            设置
          </span>
        }
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧导航栏 */}
        <aside style={{
          width: 192,
          flexShrink: 0,
          padding: '12px 8px',
          borderRight: '1px solid var(--c-border-sub)',
          background: 'var(--c-panel)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {NAV_ITEMS.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveSection(key)}
              data-testid={`settings-nav-${key}`}
              data-active={activeSection === key ? 'true' : 'false'}
              className="sidebar-nav-item"
              style={{ display: 'flex', alignItems: 'center', gap: 9 }}
            >
              <span style={{ opacity: activeSection === key ? 1 : 0.65, display: 'inline-flex' }}>
                {icon}
              </span>
              {label}
            </button>
          ))}
        </aside>

        {/* 主内容区 */}
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: '32px 36px' }}>
          <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 36 }}>

            {/* ===================== 外观分区 ===================== */}
            {activeSection === 'appearance' && (
              <>
                {/* 页头 */}
                <div>
                  <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>外观</h1>
                  <p style={{ margin: '7px 0 0', color: 'var(--c-fg-muted)', fontSize: 13, lineHeight: 1.55 }}>
                    选择界面主题。主题同时控制整个应用的 UI 配色和终端配色。
                  </p>
                </div>

                {/* 界面主题 */}
                <Section title="界面主题">
                  <div style={{ display: 'flex', gap: 10 }} data-testid="app-theme-selector">
                    <ThemeCard
                      value="dark"
                      current={appTheme}
                      label="深色"
                      description="深夜工坊风格"
                      icon={<MoonIcon />}
                      onSelect={updateAppTheme}
                    />
                    <ThemeCard
                      value="light"
                      current={appTheme}
                      label="浅色"
                      description="暖白纸张风格"
                      icon={<SunIcon />}
                      onSelect={updateAppTheme}
                    />
                    <ThemeCard
                      value="system"
                      current={appTheme}
                      label="跟随系统"
                      description="自动匹配系统"
                      icon={<AutoIcon />}
                      onSelect={updateAppTheme}
                    />
                  </div>

                  <p style={{ fontSize: 11, color: 'var(--c-fg-subtle)', margin: 0, lineHeight: 1.55 }}>
                    主题影响整个应用界面：侧边栏、编辑器、终端及所有 UI 元素。
                  </p>
                </Section>
              </>
            )}

            {/* ===================== 更新分区 ===================== */}
            {activeSection === 'update' && (
              <>
                <div>
                  <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>更新</h1>
                  <p style={{ margin: '7px 0 0', color: 'var(--c-fg-muted)', fontSize: 13, lineHeight: 1.55 }}>
                    检查并安装 GhostTerm 的最新版本，程序每小时自动检测一次。
                  </p>
                </div>
                <Section title="版本管理">
                  <UpdateSection state={updateState} actions={updateActions} />
                </Section>
              </>
            )}

            {/* ===================== 终端分区 ===================== */}
            {activeSection === 'terminal' && (
              <>
                <div>
                  <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>终端</h1>
                  <p style={{ margin: '7px 0 0', color: 'var(--c-fg-muted)', fontSize: 13, lineHeight: 1.55 }}>
                    配置 shell 与终端显示，修改后新建的会话生效。
                  </p>
                </div>

                {/* 启动行为 */}
                <Section title="启动行为">
                  <FormField label="Shell 来源">
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 13,
                      color: 'var(--c-fg)',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}>
                      <input
                        type="checkbox"
                        checked={terminal.useSystemShell}
                        onChange={onSystemShellChange}
                        data-testid="terminal-use-system-shell"
                        style={{ width: 14, height: 14, accentColor: 'var(--c-accent)', cursor: 'pointer' }}
                      />
                      使用系统默认 shell
                    </label>
                  </FormField>

                  <FormField
                    label="自定义 shell 路径"
                    hint={terminal.useSystemShell ? '已启用系统默认 shell，此字段不生效' : undefined}
                  >
                    <input
                      type="text"
                      value={terminal.customShellPath}
                      onChange={(e) => updateTerminalSettings({ customShellPath: e.target.value })}
                      disabled={terminal.useSystemShell}
                      placeholder="/opt/homebrew/bin/fish"
                      style={{
                        ...inputStyle,
                        opacity: terminal.useSystemShell ? 0.4 : 1,
                        cursor: terminal.useSystemShell ? 'not-allowed' : 'text',
                        fontFamily: 'var(--font-mono)',
                      }}
                      data-testid="terminal-custom-shell"
                    />
                  </FormField>
                </Section>

                {/* 外观 */}
                <Section title="外观">
                  <FormField label="字体大小">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <input
                        type="range"
                        min={10}
                        max={24}
                        value={terminal.fontSize}
                        onChange={(e) => updateTerminalSettings({ fontSize: Number(e.target.value) })}
                        style={{ flex: 1, accentColor: 'var(--c-accent)' }}
                        data-testid="terminal-font-size"
                      />
                      <span style={{
                        minWidth: 40,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid var(--c-border)',
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--c-input)',
                        fontSize: 13,
                        color: 'var(--c-fg)',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 500,
                      }}>
                        {terminal.fontSize}
                      </span>
                    </div>
                  </FormField>

                  <FormField label="字体家族">
                    <input
                      type="text"
                      value={terminal.fontFamily}
                      onChange={(e) => updateTerminalSettings({ fontFamily: e.target.value })}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                      data-testid="terminal-font-family"
                    />
                  </FormField>

                  <FormField label="光标样式">
                    <select
                      value={terminal.cursorStyle}
                      onChange={(e) => updateTerminalSettings({
                        cursorStyle: e.target.value as typeof terminal.cursorStyle,
                      })}
                      style={inputStyle}
                      data-testid="terminal-cursor-style"
                    >
                      <option value="block">块状（Block）</option>
                      <option value="underline">下划线（Underline）</option>
                      <option value="bar">竖线（Bar）</option>
                    </select>
                  </FormField>
                </Section>
              </>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}

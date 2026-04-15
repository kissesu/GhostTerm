/**
 * @file SettingsPage - 设置中心页面
 * @description 独立设置页面，首版只开放“终端”分组。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import type { ChangeEvent } from 'react';
import WindowTitleBar from '../../shared/components/WindowTitleBar';
import { useSettingsStore } from '../../shared/stores/settingsStore';
import { DARK_APP_COLORS } from '../../shared/stores/themeStore';

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2a1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9a1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1a1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6a1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9a1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1V9c0 .4.2.8.6.9H20a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 18l-6-6l6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const sectionTitleStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: DARK_APP_COLORS.foreground,
  margin: 0,
};

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
};

const inputStyle = {
  height: 36,
  borderRadius: 8,
  border: `1px solid ${DARK_APP_COLORS.border}`,
  background: DARK_APP_COLORS.backgroundSecondary,
  color: DARK_APP_COLORS.foreground,
  padding: '0 12px',
  fontSize: 13,
};

const selectStyle = {
  ...inputStyle,
  paddingRight: 36,
};

export default function SettingsPage() {
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const terminal = useSettingsStore((s) => s.terminal);
  const updateTerminalSettings = useSettingsStore((s) => s.updateTerminalSettings);

  const onCheckboxChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateTerminalSettings({ useSystemShell: e.target.checked });
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: DARK_APP_COLORS.background,
        color: DARK_APP_COLORS.foreground,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <WindowTitleBar
        left={
          <button
            type="button"
            onClick={closeSettings}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '0 10px',
              border: 'none',
              background: 'transparent',
              color: DARK_APP_COLORS.foregroundMuted,
              cursor: 'pointer',
              borderRadius: 6,
            }}
            data-testid="settings-back-button"
          >
            <BackIcon />
            <span style={{ fontSize: 12 }}>返回</span>
          </button>
        }
        center={<span style={{ fontSize: 12, color: DARK_APP_COLORS.foregroundMuted }}>设置</span>}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            padding: 20,
            borderRight: `1px solid ${DARK_APP_COLORS.border}`,
            background: DARK_APP_COLORS.backgroundSecondary,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <GearIcon />
            <span style={{ fontSize: 15, fontWeight: 600 }}>设置中心</span>
          </div>

          <button
            type="button"
            style={{
              height: 36,
              borderRadius: 8,
              border: 'none',
              background: DARK_APP_COLORS.accent,
              color: DARK_APP_COLORS.background,
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'left',
              padding: '0 12px',
              cursor: 'default',
            }}
            data-testid="settings-nav-terminal"
          >
            终端
          </button>
        </aside>

        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            padding: 28,
          }}
        >
          <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>终端</h1>
              <p style={{ margin: '8px 0 0', color: DARK_APP_COLORS.foregroundMuted, fontSize: 13 }}>
                配置终端 shell 与显示效果。shell 修改只影响之后新建的终端实例。
              </p>
            </div>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <h2 style={sectionTitleStyle}>启动行为</h2>

              <label style={{ ...fieldStyle, gap: 10 }}>
                <span style={{ fontSize: 13 }}>Shell 来源</span>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    color: DARK_APP_COLORS.foreground,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={terminal.useSystemShell}
                    onChange={onCheckboxChange}
                    data-testid="terminal-use-system-shell"
                  />
                  使用系统默认 shell
                </label>
              </label>

              <label style={fieldStyle}>
                <span style={{ fontSize: 13 }}>自定义 shell 路径</span>
                <input
                  type="text"
                  value={terminal.customShellPath}
                  onChange={(e) => updateTerminalSettings({ customShellPath: e.target.value })}
                  disabled={terminal.useSystemShell}
                  placeholder="/opt/homebrew/bin/fish"
                  style={{
                    ...inputStyle,
                    opacity: terminal.useSystemShell ? 0.55 : 1,
                    cursor: terminal.useSystemShell ? 'not-allowed' : 'text',
                  }}
                  data-testid="terminal-custom-shell"
                />
              </label>
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <h2 style={sectionTitleStyle}>外观</h2>

              <label style={fieldStyle}>
                <span style={{ fontSize: 13 }}>终端字体大小</span>
                <input
                  type="number"
                  min={10}
                  max={24}
                  value={terminal.fontSize}
                  onChange={(e) => updateTerminalSettings({ fontSize: Number(e.target.value) || 13 })}
                  style={inputStyle}
                  data-testid="terminal-font-size"
                />
              </label>

              <label style={fieldStyle}>
                <span style={{ fontSize: 13 }}>终端字体家族</span>
                <input
                  type="text"
                  value={terminal.fontFamily}
                  onChange={(e) => updateTerminalSettings({ fontFamily: e.target.value })}
                  style={inputStyle}
                  data-testid="terminal-font-family"
                />
              </label>

              <label style={fieldStyle}>
                <span style={{ fontSize: 13 }}>光标样式</span>
                <select
                  value={terminal.cursorStyle}
                  onChange={(e) => updateTerminalSettings({ cursorStyle: e.target.value as typeof terminal.cursorStyle })}
                  style={selectStyle}
                  data-testid="terminal-cursor-style"
                >
                  <option value="block">块状</option>
                  <option value="underline">下划线</option>
                  <option value="bar">竖线</option>
                </select>
              </label>

              <label style={fieldStyle}>
                <span style={{ fontSize: 13 }}>终端主题</span>
                <select
                  value={terminal.theme}
                  onChange={(e) => updateTerminalSettings({ theme: e.target.value as typeof terminal.theme })}
                  style={selectStyle}
                  data-testid="terminal-theme"
                >
                  <option value="ghostterm-dark">GhostTerm Dark</option>
                  <option value="ghostterm-light">GhostTerm Light</option>
                </select>
              </label>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

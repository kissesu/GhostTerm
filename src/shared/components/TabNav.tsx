/**
 * @file TabNav.tsx
 * @description 标题栏三 tab 导航。读写 tabStore
 *              设计：未激活 --c-fg-muted；激活 --c-accent + 2px 下划线
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useTabStore, type Tab } from '../stores/tabStore';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'project',  label: '项目' },
  { id: 'tools',    label: '工具' },
  { id: 'progress', label: '进度' },
];

export function TabNav() {
  const activeTab = useTabStore((s) => s.activeTab);
  const setActive = useTabStore((s) => s.setActive);

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', alignItems: 'stretch' }}>
      {TABS.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            data-active={active ? 'true' : 'false'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--c-accent)' : 'var(--c-fg-muted)',
              padding: '0 2px',
              borderBottom: active ? '2px solid var(--c-accent)' : '2px solid transparent',
              transition: 'color var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out)',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-fg)';
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-fg-muted)';
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

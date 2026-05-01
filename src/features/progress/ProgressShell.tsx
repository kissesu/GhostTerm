/**
 * @file ProgressShell.tsx
 * @description 进度模块入口（重构中 stub）。原实现已清空，等待按
 *              docs/progress-module-stepper-nba-combined.html 设计稿重构。
 *              新实施详见 docs/superpowers/plans/2026-05-01-progress-module-rebuild.md。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';

export default function ProgressShell(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '40px',
        color: '#8c857a',
        fontSize: '13px',
        lineHeight: 1.6,
        textAlign: 'center',
      }}
    >
      进度模块正在按设计稿重构。请见
      <code style={{ marginLeft: 6, color: '#b8ff6a' }}>
        docs/superpowers/plans/2026-05-01-progress-module-rebuild.md
      </code>
    </div>
  );
}

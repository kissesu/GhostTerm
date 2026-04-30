/**
 * @file SystemConfigPanel.test.tsx
 * @description Atlas SystemConfigPanel 测试：渲染所有配置规范条目。
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../progress/api/client', () => ({
  apiFetch: vi.fn(),
  getBaseUrl: () => 'http://localhost:8080',
  ProgressApiError: class extends Error {},
}));

import { SystemConfigPanel } from '../SystemConfigPanel';

describe('SystemConfigPanel', () => {
  it('渲染 API base URL 与所有配置项', () => {
    render(<SystemConfigPanel />);
    expect(screen.getByText('http://localhost:8080')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-config-HTTP_ADDR')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-config-JWT_ACCESS_TTL')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-config-JWT_REFRESH_TTL')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-config-BCRYPT_COST')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-config-FILE_STORAGE_PATH')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-config-FILE_MAX_SIZE_MB')).toBeInTheDocument();
  });
});

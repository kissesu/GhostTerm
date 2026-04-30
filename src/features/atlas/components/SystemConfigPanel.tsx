/**
 * @file SystemConfigPanel.tsx
 * @description 系统配置只读面板（Atlas 第三视图）。
 *
 *              v1 实现策略：
 *                后端没有 GET /api/system/config endpoint（不在 oas spec 内），
 *                直接通过环境变量 + 编译时常量在前端展示运行时端点 + 当前已知配置项。
 *                这是只读面板（读规范），不让超管在 UI 改 server config。
 *
 *              展示项（来自 server/internal/config/config.go）：
 *                - HTTP_ADDR             默认 :8080
 *                - JWT_ACCESS_TTL        默认 15m
 *                - JWT_REFRESH_TTL       默认 168h
 *                - BCRYPT_COST           默认 12
 *                - FILE_STORAGE_PATH     默认 ./data/files
 *                - FILE_MAX_SIZE_MB      默认 100
 *
 *              业务取舍：
 *                - 不调后端：v1 不开放 config 修改面板（保持配置只能通过 env 变量 / 部署时改）
 *                - 信息来自 client 端的 BASE_URL（apiFetch.getBaseUrl）+ 静态文档
 *                - 若需要真实运行时值（用户修改了 env），后续加 /api/system/config endpoint
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { getBaseUrl } from '../../progress/api/client';
import styles from '../atlas.module.css';

interface ConfigEntry {
  key: string;
  defaultValue: string;
  description: string;
}

const CONFIG_ENTRIES: ConfigEntry[] = [
  { key: 'HTTP_ADDR', defaultValue: ':8080', description: 'HTTP 服务监听地址（host:port）' },
  { key: 'JWT_ACCESS_TTL', defaultValue: '15m', description: 'access token 有效期' },
  { key: 'JWT_REFRESH_TTL', defaultValue: '168h', description: 'refresh token 有效期（默认 7 天）' },
  { key: 'BCRYPT_COST', defaultValue: '12', description: '密码哈希成本（OWASP 2024 推荐 ≥10）' },
  { key: 'FILE_STORAGE_PATH', defaultValue: './data/files', description: '上传文件存储根目录' },
  { key: 'FILE_MAX_SIZE_MB', defaultValue: '100', description: '单文件大小上限（MB）' },
];

export function SystemConfigPanel() {
  const apiBase = getBaseUrl();

  return (
    <div data-testid="atlas-system-config">
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>系统配置</h2>
          <p className={styles.pageSubtitle}>
            服务端配置规范（默认值，实际值由部署环境变量决定）。修改请联系运维更新部署 env。
          </p>
        </div>
      </div>

      <div className={styles.configList}>
        <div className={styles.configKey}>API base URL</div>
        <div className={styles.configValue}>{apiBase}</div>
        {CONFIG_ENTRIES.map((entry) => (
          // 不用 React.Fragment，使其在 grid 内自然布局；用 data-testid 便于测试断言
          <span style={{ display: 'contents' }} key={entry.key} data-testid={`atlas-config-${entry.key}`}>
            <div className={styles.configKey} title={entry.description}>
              {entry.key}
            </div>
            <div className={styles.configValue}>
              {entry.defaultValue}
              <span style={{ marginLeft: 10, color: 'var(--faint)', fontSize: 11 }}>
                {entry.description}
              </span>
            </div>
          </span>
        ))}
      </div>
    </div>
  );
}

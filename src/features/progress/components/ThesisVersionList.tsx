/**
 * @file ThesisVersionList.tsx
 * @description 论文版本列表 - 调用 listThesisVersions API，按 versionNo 倒序展示
 *              refresh prop 变化时重新拉取（FileUploadButton onUploadSuccess 后父组件 bump ref）
 *
 *              设计取舍：
 *              - 不经 filesStore（byProject 存 ProjectFile 不含 ThesisVersion）
 *              - 直接调 listThesisVersions(projectId) 避免引入新 store
 *              - 与 DetailTimeline 同一惯例：本地 state + useEffect
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { ThesisVersion } from '../api/files';
import { listThesisVersions } from '../api/files';

interface ThesisVersionListProps {
  projectId: number;
  /**
   * refresh 值变化时重新拉取列表。
   * 调用方（ProjectDetailPage thesis tab）在上传成功后 setRefreshTick((n) => n + 1)。
   */
  refreshTick?: number;
}

export function ThesisVersionList({
  projectId,
  refreshTick = 0,
}: ThesisVersionListProps): ReactElement {
  const [versions, setVersions] = useState<ThesisVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listThesisVersions(projectId)
      .then((list) => {
        // 后端按 version_no ASC，倒序后最新版本在顶
        setVersions([...list].sort((a, b) => b.versionNo - a.versionNo));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId, refreshTick]);

  if (loading) {
    return <p style={{ color: 'var(--muted)', fontSize: 13 }}>加载中…</p>;
  }
  if (error) {
    return <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>;
  }
  if (versions.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无版本</p>;
  }

  return (
    <div>
      {versions.map((v) => (
        <div
          key={v.id}
          style={{
            borderBottom: '1px solid var(--line)',
            padding: '10px 0',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--accent)', fontWeight: 800 }}>
            v{v.versionNo}
          </span>
          <span style={{ flex: 1 }}>{v.file.filename}</span>
          {v.remark && (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{v.remark}</span>
          )}
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
            {new Date(v.uploadedAt).toLocaleDateString('zh-CN')}
          </span>
        </div>
      ))}
    </div>
  );
}

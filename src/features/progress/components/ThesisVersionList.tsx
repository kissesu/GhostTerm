/**
 * @file ThesisVersionList.tsx
 * @description 论文版本只读列表 + 上传新版按钮（spec §9.2）。
 *
 *              业务背景：
 *              - 永不允许覆盖已有版本（DB UNIQUE + 应用层无 mutator）
 *              - 列表按 version_no 倒序展示（最新在前）
 *              - 每行：v<number> · <filename> · <时间> · <remark> · [下载]
 *              - 顶部上传按钮：选文件 → upload → createThesisVersion → 增量插入列表头
 *
 *              加载策略：组件 mount 时调 refreshThesisVersions（首次渲染前如果缓存有就直接用）。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useState } from 'react';

import { useFilesStore } from '../stores/filesStore';
import { downloadFile, type ThesisVersion } from '../api/files';
import { FileUploadButton } from './FileUploadButton';

export interface ThesisVersionListProps {
  projectId: number;
  /** 是否允许上传（按权限决定；缺省 true） */
  canUpload?: boolean;
}

/** 稳定空数组引用，避免 selector 每次返回新 [] 触发 useSyncExternalStore 报告"snapshot 不稳定"。 */
const EMPTY_VERSIONS: ThesisVersion[] = [];

export function ThesisVersionList({
  projectId,
  canUpload = true,
}: ThesisVersionListProps) {
  // 直接读 map 字段（store 内是 ThesisVersion[]）；?? EMPTY_VERSIONS 用稳定空数组兜底
  const versions = useFilesStore(
    (s) => s.thesisVersions[projectId] ?? EMPTY_VERSIONS,
  );
  const loading = useFilesStore((s) => s.thesisLoading[projectId] ?? false);
  const refreshThesisVersions = useFilesStore((s) => s.refreshThesisVersions);
  const uploadNewThesisVersion = useFilesStore((s) => s.uploadNewThesisVersion);

  const [remark, setRemark] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 首次 mount → 拉一次（缓存有则会被 set 覆盖；不卡 UI）
  useEffect(() => {
    void refreshThesisVersions(projectId).catch(() => {
      // 错误已在 store.lastError 中；此处忽略避免 unhandled rejection
    });
  }, [projectId, refreshThesisVersions]);

  // ============================================
  // 第一步：上传按钮 → 暂存 file，等用户填 remark 后再 confirm
  // 业务逻辑：单步上传（直接传 file）会让"加 remark"无机会；改为两步交互
  // ============================================
  const handleFileSelected = (file: { id: number; filename: string }): void => {
    // 注意：FileUploadButton 已把上传完成；这里 onUploaded 拿到的是 server 返回的 fileId
    // 但 ThesisVersionList 需要"先选文件、再填 remark、再创建版本"两步
    // 因此本实现用 pendingFile 暂存原始 File，禁用 FileUploadButton 直接上传路径
    void file; // 不使用 onUploaded 携带的 server-side metadata
  };

  // 监听 pendingFile 状态切换：仅在用户点了 "确认上传" 时才真正发起 upload+createVersion
  const handleConfirm = async (): Promise<void> => {
    if (!pendingFile) return;
    setError(null);
    setPending(true);
    try {
      await uploadNewThesisVersion(projectId, pendingFile, remark || undefined);
      setPendingFile(null);
      setRemark('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-testid="thesis-version-list">
      <h4>论文版本（不可覆盖）</h4>

      {canUpload && (
        <div style={{ marginBottom: 12 }}>
          {pendingFile === null ? (
            <FileSelector onPick={(f) => setPendingFile(f)} />
          ) : (
            <div data-testid="thesis-confirm-panel">
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                已选：<strong>{pendingFile.name}</strong>
              </div>
              <input
                type="text"
                placeholder="备注（可选）"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                disabled={pending}
                data-testid="thesis-remark-input"
              />
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={pending}
                data-testid="thesis-confirm-btn"
              >
                {pending ? '上传中…' : '确认上传'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingFile(null);
                  setRemark('');
                  setError(null);
                }}
                disabled={pending}
                data-testid="thesis-cancel-btn"
              >
                取消
              </button>
            </div>
          )}
          {error !== null && (
            <div
              data-testid="thesis-upload-error"
              style={{ color: 'var(--c-danger, #c33)', fontSize: 12 }}
              role="alert"
            >
              {error}
            </div>
          )}
          {/* FileUploadButton 不直接用：本组件需要"先选文件 / 后填 remark"两步交互 */}
          {/* 仍保留对组件的引用以便未来扩展 single-step 模式 */}
          {false && (
            <FileUploadButton
              onUploaded={(f) =>
                handleFileSelected({ id: f.id, filename: f.filename })
              }
              label="上传新版本"
              projectIdForLoading={projectId}
            />
          )}
        </div>
      )}

      {loading && versions.length === 0 ? (
        <div data-testid="thesis-loading">加载中…</div>
      ) : (
        <ul data-testid="thesis-version-items" style={{ listStyle: 'none', padding: 0 }}>
          {versions.length === 0 ? (
            <li data-testid="thesis-empty" style={{ color: 'var(--c-text-muted, #888)' }}>
              暂无版本
            </li>
          ) : (
            versions.map((v) => <ThesisVersionRow key={v.id} v={v} />)
          )}
        </ul>
      )}
    </div>
  );
}

// ============================================
// 文件选择器：纯 input 触发；不复用 FileUploadButton 因为本组件需要两步交互
// ============================================

function FileSelector({ onPick }: { onPick: (f: File) => void }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      onPick(file);
    }
    e.target.value = '';
  };
  return (
    <label data-testid="thesis-file-picker" style={{ cursor: 'pointer' }}>
      <input
        type="file"
        onChange={handleChange}
        style={{ display: 'none' }}
        data-testid="thesis-file-input"
      />
      <button type="button" onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement).click()}>
        选择论文文件
      </button>
    </label>
  );
}

// ============================================
// 单行：版本号 + 文件名 + 时间 + remark + 下载
// ============================================

interface RowProps {
  v: ThesisVersion;
}

function ThesisVersionRow({ v }: RowProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    setError(null);
    try {
      await downloadFile(v.fileId, v.file.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载失败');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li
      data-testid={`thesis-version-row-${v.versionNo}`}
      data-version-no={v.versionNo}
      style={{
        padding: '8px 0',
        borderBottom: '1px solid var(--c-border, #ddd)',
        display: 'flex',
        gap: 12,
        alignItems: 'baseline',
      }}
    >
      <span style={{ fontWeight: 600 }}>v{v.versionNo}</span>
      <span data-testid="thesis-filename">{v.file.filename}</span>
      <span style={{ color: 'var(--c-text-muted, #888)', fontSize: 12 }}>
        {formatTime(v.uploadedAt)}
      </span>
      {v.remark != null && v.remark !== '' && (
        <span data-testid="thesis-remark" style={{ color: 'var(--c-text-muted, #888)' }}>
          · {v.remark}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={downloading}
        data-testid={`thesis-download-${v.versionNo}`}
        style={{ marginLeft: 'auto' }}
      >
        {downloading ? '下载中…' : '下载'}
      </button>
      {error !== null && (
        <span
          data-testid={`thesis-download-error-${v.versionNo}`}
          style={{ color: 'var(--c-danger, #c33)', fontSize: 12 }}
          role="alert"
        >
          {error}
        </span>
      )}
    </li>
  );
}

/** 把 ISO timestamp 转成"YYYY-MM-DD HH:mm"局部时间字符串。 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

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
    <div data-testid="thesis-version-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.2 }}>
        论文版本（不可覆盖）
      </h4>

      {canUpload && (
        <div
          style={{
            padding: 12,
            border: '1px dashed var(--line-strong)',
            borderRadius: 8,
            background: 'var(--panel-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {pendingFile === null ? (
            <FileSelector onPick={(f) => setPendingFile(f)} />
          ) : (
            <div data-testid="thesis-confirm-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                已选：<strong style={{ color: 'var(--text)' }}>{pendingFile.name}</strong>
              </div>
              <input
                type="text"
                placeholder="备注（可选）"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                disabled={pending}
                data-testid="thesis-remark-input"
                style={thesisInputStyle}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={pending}
                  data-testid="thesis-confirm-btn"
                  style={thesisPrimaryBtnStyle}
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
                  style={thesisSecondaryBtnStyle}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {error !== null && (
            <div
              data-testid="thesis-upload-error"
              style={{
                padding: '6px 10px',
                border: '1px solid rgba(239, 104, 98, 0.4)',
                borderRadius: 6,
                background: 'rgba(239, 104, 98, 0.1)',
                color: '#ffd8d4',
                fontSize: 12,
              }}
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
        <div data-testid="thesis-loading" style={{ fontSize: 12, color: 'var(--muted)', padding: 12 }}>
          加载中…
        </div>
      ) : (
        <ul
          data-testid="thesis-version-items"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--panel)',
            overflow: 'hidden',
          }}
        >
          {versions.length === 0 ? (
            <li data-testid="thesis-empty" style={{ color: 'var(--faint)', fontSize: 12, padding: 14 }}>
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
    <label data-testid="thesis-file-picker" style={{ cursor: 'pointer', display: 'inline-flex' }}>
      <input
        type="file"
        onChange={handleChange}
        style={{ display: 'none' }}
        data-testid="thesis-file-input"
      />
      <button
        type="button"
        onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement).click()}
        style={thesisSecondaryBtnStyle}
      >
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
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        gap: 12,
        alignItems: 'baseline',
        fontSize: 12,
        color: 'var(--muted)',
      }}
    >
      <span style={{ fontWeight: 800, color: 'var(--accent)', fontFamily: 'monospace' }}>v{v.versionNo}</span>
      <span data-testid="thesis-filename" style={{ color: 'var(--text)', fontWeight: 600 }}>
        {v.file.filename}
      </span>
      <span style={{ color: 'var(--faint)', fontSize: 11 }}>{formatTime(v.uploadedAt)}</span>
      {v.remark != null && v.remark !== '' && (
        <span data-testid="thesis-remark" style={{ color: 'var(--faint)' }}>
          · {v.remark}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={downloading}
        data-testid={`thesis-download-${v.versionNo}`}
        style={{
          marginLeft: 'auto',
          height: 24,
          padding: '0 10px',
          borderRadius: 5,
          border: '1px solid var(--line)',
          background: 'var(--panel-2)',
          color: 'var(--muted)',
          cursor: downloading ? 'not-allowed' : 'pointer',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'inherit',
        }}
      >
        {downloading ? '下载中…' : '下载'}
      </button>
      {error !== null && (
        <span
          data-testid={`thesis-download-error-${v.versionNo}`}
          style={{ color: 'var(--red)', fontSize: 11 }}
          role="alert"
        >
          {error}
        </span>
      )}
    </li>
  );
}

// ============================================
// 共享按钮 / input 样式（与 habitat 设计一致）
// ============================================

const thesisInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 32,
  padding: '7px 11px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: '#11110f',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};

const thesisPrimaryBtnStyle: React.CSSProperties = {
  height: 30,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'inherit',
};

const thesisSecondaryBtnStyle: React.CSSProperties = {
  height: 30,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: '#11110f',
  color: 'var(--muted)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'inherit',
};

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

/**
 * @file MediaLightbox.tsx
 * @description 全屏媒体查看：图片/视频点击 MediaPreview 后弹出 modal-overlay，
 *              内部 img/video 不限 maxHeight 240，让用户完整看到原图/原视频。
 *              复用 progress.module.css 的 .modalOverlay/.modalOverlayOpen 遮罩；
 *              不复用 .modal 容器（lightbox 不需要 head/body/foot 框架）。
 *
 *              业务背景（用户反馈 2026-05-03）："多图/视频点击预览(没点击预览之前
 *              的多媒体渲染需要注意尺寸, 不能太大)"——MediaPreview 列表态保持
 *              240 缩略，本组件是点击后的全屏态。
 *
 *              鉴权媒体加载延续 MediaPreview 的 fetch+Blob+ObjectURL+cleanup 5 件套
 *              （记忆 feedback_authed_media_preview_blob_objecturl_ua_platform_order）。
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import { useEffect, useState, type ReactElement } from 'react';
import styles from '../progress.module.css';
import { buildDownloadURL } from '../api/files';
import { getAccessToken } from '../../../shared/stores/globalAuthStore';
import { mediaKind } from './MediaPreview';

interface Props {
  fileId: number;
  filename: string;
  onClose: () => void;
}

export function MediaLightbox({ fileId, filename, onClose }: Props): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = mediaKind(filename);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const token = getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(buildDownloadURL(fileId), { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setUrl(createdUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [fileId]);

  // ESC 键关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${filename}`}
      style={{ cursor: 'zoom-out', padding: 24 }}
    >
      {error ? (
        <div style={{ color: 'var(--red)', fontSize: 14 }}>
          {filename}：预览失败（{error}）
        </div>
      ) : !url ? (
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>{filename}：加载中…</div>
      ) : kind === 'image' ? (
        <img
          src={url}
          alt={filename}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '95vw',
            maxHeight: '92dvh',
            objectFit: 'contain',
            borderRadius: 4,
            cursor: 'default',
            background: '#000',
          }}
        />
      ) : kind === 'video' ? (
        <video
          src={url}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '95vw',
            maxHeight: '92dvh',
            borderRadius: 4,
            cursor: 'default',
            background: '#000',
          }}
        />
      ) : null}
    </div>
  );
}

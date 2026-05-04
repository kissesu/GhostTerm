/**
 * @file MediaPreview.tsx
 * @description 媒体附件内嵌预览：图片用 <img>，视频用 <video controls>，
 *              其它扩展名 fallback 下载链接（FileDownload 由 caller 路由）。
 *
 *              业务背景（用户反馈 2026-05-03）："媒体不需要下载, 多图/多视频预览就可以了"
 *              之前所有附件都走 FileDownload，图片视频也只能点下载。改为媒体类附件
 *              直接 inline 预览。
 *
 *              技术约束：
 *              - <img src> / <video src> 不能加 Authorization header
 *              - 必须 fetch + Bearer token + Blob → ObjectURL → 渲染
 *              - useEffect cleanup 中 URL.revokeObjectURL 防内存泄漏
 *              - cancelled flag 处理 fileId 切换时旧请求竞态
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import { useEffect, useState, type ReactElement } from 'react';
import { buildDownloadURL } from '../api/files';
import { getAccessToken } from '../../../shared/stores/globalAuthStore';
import { MediaLightbox } from './MediaLightbox';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);
// HEIC/HEIF Safari 原生支持，Chromium 不支持；放进 image 试试，浏览器自决
const HEIC_EXTS = new Set(['heic', 'heif']);

interface Props {
  fileId: number;
  filename: string;
}

function fileExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx >= filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/** 推断媒体类型：返回 'image' / 'video' / null（非媒体） */
export function mediaKind(filename: string): 'image' | 'video' | null {
  const ext = fileExt(filename);
  if (IMAGE_EXTS.has(ext) || HEIC_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function MediaPreview({ fileId, filename }: Props): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // lightbox 受控开关：点击缩略图触发，ESC / 点遮罩关闭
  // 用户反馈 2026-05-03"多图/视频点击预览"
  const [showLightbox, setShowLightbox] = useState(false);
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

  if (error) {
    return (
      <div style={{ color: 'var(--red)', fontSize: 12 }}>
        {filename}：预览失败（{error}）
      </div>
    );
  }
  if (!url) {
    return <div style={{ color: 'var(--muted)', fontSize: 12 }}>{filename}：加载中…</div>;
  }
  // lightbox 关闭 callback 抽出避免重复
  const closeLightbox = () => setShowLightbox(false);

  if (kind === 'image') {
    return (
      <>
        <img
          src={url}
          alt={filename}
          onClick={() => setShowLightbox(true)}
          style={{
            maxWidth: '100%',
            maxHeight: 240,
            objectFit: 'contain',
            borderRadius: 4,
            border: '1px solid var(--line)',
            cursor: 'zoom-in',
          }}
        />
        {showLightbox && (
          <MediaLightbox fileId={fileId} filename={filename} onClose={closeLightbox} />
        )}
      </>
    );
  }
  if (kind === 'video') {
    // 视频缩略：用 controls 让用户预览不强制 lightbox，但仍可点击 poster 区域全屏
    // 视频元素 onClick 与 native controls 冲突 — 改为底部加 "全屏预览" 文字按钮
    return (
      <>
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
          <video
            src={url}
            controls
            style={{
              maxWidth: '100%',
              maxHeight: 240,
              borderRadius: 4,
              border: '1px solid var(--line)',
              background: '#000',
              display: 'block',
            }}
          />
          <button
            type="button"
            onClick={() => setShowLightbox(true)}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              padding: '4px 8px',
              fontSize: 11,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            aria-label={`全屏预览 ${filename}`}
          >
            全屏
          </button>
        </div>
        {showLightbox && (
          <MediaLightbox fileId={fileId} filename={filename} onClose={closeLightbox} />
        )}
      </>
    );
  }
  // 不应到达：caller 应在 mediaKind != null 时才用本组件
  return <div style={{ color: 'var(--muted)' }}>{filename}</div>;
}

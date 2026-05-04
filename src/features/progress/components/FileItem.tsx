/**
 * @file FileItem.tsx
 * @description 智能附件渲染：媒体（图片/视频）走 MediaPreview 内嵌缩略 + 点击 lightbox 全屏；
 *              非媒体（文档）走 FileDownload 链接（fetch+Blob+a.download，记忆
 *              feedback_tauri_download_blob_pattern_dual_normalization）。
 *
 *              用户反馈 2026-05-03"反馈、论文版本、源码、收款的tab的媒体附件都应该可以
 *              多图/视频点击预览, 文档附件应该都可以点击下载"——本组件抽出 ActivityDetailDialog
 *              内部 FileItem，让 4 处 tab 共用同一附件呈现规则。
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import { downloadFile } from '../api/files';
import { MediaPreview, mediaKind } from './MediaPreview';

interface Props {
  fileId: number;
  filename: string;
}

/** 文档下载链接：用 downloadFile 触发浏览器保存对话框（fetch+Blob+a.download）。
 *  Tauri WKWebView 中 a href 下载会被 SPA 路由拦截，必须 Blob 模式（记忆
 *  feedback_tauri_download_blob_pattern_dual_normalization）。 */
function FileDownload({ fileId, name }: { fileId: number; name: string }): ReactElement {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    void downloadFile(fileId, name).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('downloadFile failed', err);
    });
  };
  return (
    <a href="#" onClick={handleClick} className={styles.detailLink}>
      {name}
    </a>
  );
}

export function FileItem({ fileId, filename }: Props): ReactElement {
  if (mediaKind(filename) !== null) {
    return <MediaPreview fileId={fileId} filename={filename} />;
  }
  return <FileDownload fileId={fileId} name={filename} />;
}

/**
 * @file FeedbackInput.tsx
 * @description 反馈录入组件 —— textarea + 多文件附件上传 + 提交。
 *
 *              业务流程（用户反馈 2026-05-03）：
 *              1. 删除 source 来源下拉框（"微信/电话/邮件/面谈/其他" 在录入时区分价值低，
 *                 后端 source 字段保留为 schema 可选，缺省由 DB DEFAULT 兜底）
 *              2. 新增多文件上传：图片 / 视频 / 文档 / 压缩包等通用格式
 *                 - <input type="file" multiple> 隐藏，由 "+ 附件" 按钮触发
 *                 - 每个 file 调用 uploadFile，成功后把 fileId 累入 attachments 数组
 *                 - chip 列表显示文件名 + 删除按钮（仅前端剔除 fileId，不真删服务端文件）
 *              3. 提交 createFeedback，payload 含 content + attachmentIds
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { Paperclip } from 'lucide-react';
import styles from '../progress.module.css';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import { useActivitiesStore } from '../stores/activitiesStore';
import { uploadFile } from '../api/files';
import { ProgressApiError } from '../api/client';

/**
 * 把上传失败错误翻成中文 + 附文件名上下文。
 * 后端 ErrorEnvelope.code 优先（稳定契约）；fallback 到 err.message。
 */
function friendlyUploadError(filename: string, err: unknown): string {
  if (err instanceof ProgressApiError) {
    switch (err.code) {
      case 'mime_not_allowed':
        return `${filename}：文件类型不被支持（请用图片/视频/PDF/Office 文档/压缩包）`;
      case 'file_too_large':
        return `${filename}：文件超过大小上限`;
      case 'file_empty':
        return `${filename}：文件为空`;
      case 'file_name_invalid':
        return `${filename}：文件名包含非法字符`;
      default:
        return `${filename}：上传失败（${err.message}）`;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `${filename}：上传失败（${msg}）`;
}

interface FeedbackInputProps {
  projectId: number;
}

/** 已上传附件的轻量视图（fileId + 显示名）；不持久化，提交后清空 */
interface AttachmentLite {
  id: number;
  filename: string;
}

export function FeedbackInput({ projectId }: FeedbackInputProps): ReactElement {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<AttachmentLite[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 上传失败的文件错误列表（多文件时按 file 维度报告，避免"哪个失败了"歧义） */
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const add = useFeedbacksStore((s) => s.add);
  const invalidateActivities = useActivitiesStore((s) => s.invalidate);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const attachmentIds = attachments.map((a) => a.id);
      await add(projectId, {
        content: content.trim(),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
      setContent('');
      setAttachments([]);
      // 提交成功后让进度时间线重新拉取以包含新反馈
      void invalidateActivities(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFilesPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // 重置 input value 让同一个文件可重复选择（删了再加）
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadErrors([]);

    // 用 allSettled：单文件失败不阻断其它，分别报告
    const results = await Promise.allSettled(files.map((f) => uploadFile(f)));
    const ok: { id: number; filename: string }[] = [];
    const fail: string[] = [];
    results.forEach((r, idx) => {
      const f = files[idx];
      if (r.status === 'fulfilled') {
        ok.push({ id: r.value.id, filename: r.value.filename });
      } else {
        fail.push(friendlyUploadError(f.name, r.reason));
      }
    });
    if (ok.length > 0) {
      setAttachments((prev) => [...prev, ...ok]);
    }
    if (fail.length > 0) {
      setUploadErrors(fail);
    }
    setUploading(false);
  };

  const removeAttachment = (id: number) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const disabled = !content.trim() || submitting || uploading;

  return (
    <form onSubmit={handleSubmit} className={styles.feedbackForm}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="客户反馈内容…"
        aria-label="反馈内容"
        className={styles.feedbackTextarea}
      />
      {attachments.length > 0 && (
        <div className={styles.docUploadList} aria-label="附件列表">
          {attachments.map((a) => (
            <span key={a.id} className={styles.docUploadChip}>
              {a.filename}
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label={`移除 ${a.filename}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {uploadErrors.length > 0 && (
        <div className={styles.feedbackUploadErrors} role="alert">
          <div className={styles.feedbackUploadErrorsHead}>
            <span>{uploadErrors.length} 个文件上传失败</span>
            <button
              type="button"
              onClick={() => setUploadErrors([])}
              aria-label="清除错误提示"
            >
              ×
            </button>
          </div>
          <ul className={styles.feedbackUploadErrorList}>
            {uploadErrors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.feedbackBar}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.zip,.rar,.7z"
          aria-label="选择附件"
          style={{ display: 'none' }}
          onChange={handleFilesPicked}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || submitting}
          className={styles.feedbackAttachBtn}
        >
          <Paperclip size={14} />
          {uploading ? '上传中…' : '附件（图片/视频/文档）'}
        </button>
        <button
          type="submit"
          disabled={disabled}
          className={styles.btnPrimary + ' ' + styles.btn}
          style={{ padding: '6px 16px', fontSize: 13 }}
        >
          {submitting ? '提交中…' : '提交'}
        </button>
        {error && <span className={styles.feedbackError}>{error}</span>}
      </div>
    </form>
  );
}

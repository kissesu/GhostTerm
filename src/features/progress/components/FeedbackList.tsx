/**
 * @file FeedbackList.tsx
 * @description 反馈列表 - 最新在顶（reverse byProject ASC）；空态文案
 *              source 字段回显中文标签（映射同 FeedbackInput）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import { FileItem } from './FileItem';

// 用户反馈 2026-05-03"不要显示微信"——删除 source 文案拼接，仅展示日期
// （source 信息保留在 API 中供未来筛选/统计用）

interface FeedbackListProps {
  projectId: number;
}

export function FeedbackList({ projectId }: FeedbackListProps): ReactElement {
  const raw = useFeedbacksStore((s) => s.byProject.get(projectId));
  const load = useFeedbacksStore((s) => s.loadByProject);
  // byProject 存储为 ASC 时间序，reverse 后最新在顶
  const items = useMemo(() => [...(raw ?? [])].reverse(), [raw]);

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  if (items.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无反馈</p>;
  }

  return (
    <div>
      {items.map((f) => (
        <div
          key={f.id}
          style={{
            // 用户反馈 2026-05-03"记录与记录之间分辨不清晰"——加 panel-2 卡片背景 + padding + 圆角
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 6 }}>
            {new Date(f.recordedAt).toLocaleString('zh-CN')}
          </div>
          <div>{f.content}</div>
          {/* 附件渲染：用户反馈 2026-05-03"反馈 tab 中的记录的媒体应该一行显示多个缩略图"
           *  flex wrap + 每 item 限宽 160 让多媒体横向排列；FileItem 智能路由保持不变 */}
          {f.attachments && f.attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {f.attachments.map((a) => (
                <div key={a.id} style={{ width: 160, maxWidth: '100%' }}>
                  <FileItem fileId={a.id} filename={a.filename} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * @file ActivityItem.tsx
 * @description 进度时间线单条活动路由器 —— 按 kind 派发到对应渲染器
 *
 *              业务逻辑说明：
 *              1. switch 写完 7 个 case 后用 default 配合 `_exhaustive: never`
 *                 让 TS 在新增 kind 但忘记加 case 时编译不过
 *              2. 不用 map 表达式做 dispatch，因为 discriminated union
 *                 narrow 在 switch 里更精确，map 写法会丢类型
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import type { Activity } from '../api/activities';
import { ProjectCreatedRenderer } from './activityRenderers/ProjectCreatedRenderer';
import { FeedbackRenderer } from './activityRenderers/FeedbackRenderer';
import { StatusChangeRenderer } from './activityRenderers/StatusChangeRenderer';
import { QuoteChangeRenderer } from './activityRenderers/QuoteChangeRenderer';
import { PaymentRenderer } from './activityRenderers/PaymentRenderer';
import { ThesisVersionRenderer } from './activityRenderers/ThesisVersionRenderer';
import { ProjectFileRenderer } from './activityRenderers/ProjectFileRenderer';

export function ActivityItem({ activity }: { activity: Activity }): ReactElement | null {
  switch (activity.kind) {
    case 'project_created':
      return <ProjectCreatedRenderer activity={activity} />;
    case 'feedback':
      return <FeedbackRenderer activity={activity} />;
    case 'status_change':
      return <StatusChangeRenderer activity={activity} />;
    case 'quote_change':
      return <QuoteChangeRenderer activity={activity} />;
    case 'payment':
      return <PaymentRenderer activity={activity} />;
    case 'thesis_version':
      return <ThesisVersionRenderer activity={activity} />;
    case 'project_file_added':
      return <ProjectFileRenderer activity={activity} />;
    default: {
      // 穷尽性检查：新增 kind 时 TS 在此处编译失败
      const _exhaustive: never = activity;
      void _exhaustive;
      return null;
    }
  }
}

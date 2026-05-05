/**
 * @file renderers.test.tsx
 * @description 7 类活动渲染器单测：每个 kind 一组断言（chip 文本 + payload 关键字段）
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { Activity } from '../../../api/activities';
import { ProjectCreatedRenderer } from '../ProjectCreatedRenderer';
import { FeedbackRenderer } from '../FeedbackRenderer';
import { StatusChangeRenderer } from '../StatusChangeRenderer';
import { QuoteChangeRenderer } from '../QuoteChangeRenderer';
import { PaymentRenderer } from '../PaymentRenderer';
import { ThesisVersionRenderer } from '../ThesisVersionRenderer';
import { ProjectFileRenderer } from '../ProjectFileRenderer';

// 共享 fixture 基础字段，缩短各 case 样板
const base = {
  sourceId: 1,
  projectId: 1,
  occurredAt: '2026-05-01T08:00:00Z',
  actorId: 1,
  actorName: '小明',
  actorRoleName: '客服',
};

describe('ProjectCreatedRenderer', () => {
  it('渲染 创建 chip + 初始报价 toFixed(2)', () => {
    const activity: Extract<Activity, { kind: 'project_created' }> = {
      ...base,
      id: 'project_created:1',
      kind: 'project_created',
      payload: {
        // 2026-05-04 删 dealing 后：项目创建即进入 quoting
        name: 'P1',
        status: 'quoting',
        priority: 'normal',
        deadline: '2026-06-01',
        originalQuote: '8000',
        wechatChats: [],
        developers: [],
      },
    };
    render(<ProjectCreatedRenderer activity={activity} />);
    expect(screen.getByText('创建')).toBeInTheDocument();
    expect(screen.getByText(/小明（客服）/)).toBeInTheDocument();
    expect(screen.getByText(/初始报价 ¥8000\.00/)).toBeInTheDocument();
  });
});

describe('FeedbackRenderer', () => {
  it('渲染 反馈 chip + 来源 label + content', () => {
    const activity: Extract<Activity, { kind: 'feedback' }> = {
      ...base,
      id: 'feedback:1',
      kind: 'feedback',
      payload: {
        content: '客户问进度',
        source: 'wechat',
        status: 'pending',
        attachmentCount: 0,
        attachments: [],
      },
    };
    render(<FeedbackRenderer activity={activity} />);
    expect(screen.getByText('反馈')).toBeInTheDocument();
    // source label 已删（用户反馈 2026-05-03"不需要来源字段"）
    expect(screen.getByText('客户问进度')).toBeInTheDocument();
  });
});

describe('StatusChangeRenderer', () => {
  it('渲染 目标流程名 chip + from→to label + eventName · remark', () => {
    const activity: Extract<Activity, { kind: 'status_change' }> = {
      ...base,
      id: 'status_change:1',
      kind: 'status_change',
      payload: {
        // 2026-05-04 删 dealing 后：典型转换 quoting → developing
        eventCode: 'E4',
        eventName: '客户接受报价',
        fromStatus: 'quoting',
        toStatus: 'developing',
        remark: '走加急通道',
      },
    };
    render(<StatusChangeRenderer activity={activity} />);
    // chip 显示 toStatus 对应的流程名 "开发"（用户反馈"状态 tag 应该使用实际的流程名"）
    expect(screen.getByText('开发')).toBeInTheDocument();
    expect(screen.getByText(/项目从「报价」进入「开发」/)).toBeInTheDocument();
    expect(screen.getByText(/客户接受报价 · 走加急通道/)).toBeInTheDocument();
  });

  it('fromStatus=null 时回退到 初始', () => {
    const activity: Extract<Activity, { kind: 'status_change' }> = {
      ...base,
      id: 'status_change:2',
      kind: 'status_change',
      payload: {
        // 2026-05-04 删 dealing 后：项目创建即进入 quoting
        eventCode: 'E_INIT',
        eventName: '建项',
        fromStatus: null,
        toStatus: 'quoting',
        remark: '',
      },
    };
    render(<StatusChangeRenderer activity={activity} />);
    expect(screen.getByText(/项目从「初始」进入「报价」/)).toBeInTheDocument();
  });
});

describe('QuoteChangeRenderer', () => {
  it('渲染 报价 chip + 类型/差额/新报价/原因', () => {
    const activity: Extract<Activity, { kind: 'quote_change' }> = {
      ...base,
      id: 'quote_change:1',
      kind: 'quote_change',
      payload: {
        changeType: 'append',
        delta: '500',
        oldQuote: '8000',
        newQuote: '8500',
        reason: '加新模块',
        phase: 'developing',
      },
    };
    render(<QuoteChangeRenderer activity={activity} />);
    expect(screen.getByText('报价')).toBeInTheDocument();
    expect(screen.getByText(/追加 ¥500\.00 · 新报价 ¥8500\.00 · 加新模块/)).toBeInTheDocument();
  });
});

describe('PaymentRenderer', () => {
  it('渲染 款项 chip + 方向 label + 金额', () => {
    const activity: Extract<Activity, { kind: 'payment' }> = {
      ...base,
      id: 'payment:1',
      kind: 'payment',
      payload: {
        direction: 'customer_in',
        amount: '2000',
        paidAt: '2026-05-01T03:00:00Z',
        remark: '首款',
        attachments: [],
      },
    };
    render(<PaymentRenderer activity={activity} />);
    // 用户反馈"结算的时间线 tag 应该显示为结算而不是款项"——chip 用 STATUS_LABEL.paid='结算'
    expect(screen.getByText('结算')).toBeInTheDocument();
    expect(screen.getByText(/录入客户收款 ¥2000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/首款 · 实际/)).toBeInTheDocument();
  });
});

describe('ThesisVersionRenderer', () => {
  it('渲染 论文 chip + 版本号 + remark', () => {
    const activity: Extract<Activity, { kind: 'thesis_version' }> = {
      ...base,
      id: 'thesis_version:1',
      kind: 'thesis_version',
      payload: { fileId: 1, versionNo: 3, remark: '终稿', filename: 'thesis_v3.pdf' },
    };
    render(<ThesisVersionRenderer activity={activity} />);
    expect(screen.getByText('论文')).toBeInTheDocument();
    expect(screen.getByText(/上传论文 V3/)).toBeInTheDocument();
    expect(screen.getByText('终稿')).toBeInTheDocument();
  });

  it('remark 为空时不渲染 meta', () => {
    const activity: Extract<Activity, { kind: 'thesis_version' }> = {
      ...base,
      id: 'thesis_version:2',
      kind: 'thesis_version',
      payload: { fileId: 1, versionNo: 1, remark: '', filename: 'thesis_v1.pdf' },
    };
    const { container } = render(<ThesisVersionRenderer activity={activity} />);
    expect(container.querySelector('.meta')).toBeNull();
  });
});

describe('ProjectFileRenderer', () => {
  it('渲染 附件 chip + 类别 label（无 meta）', () => {
    const activity: Extract<Activity, { kind: 'project_file_added' }> = {
      ...base,
      id: 'project_file_added:1',
      kind: 'project_file_added',
      payload: { fileId: 1, category: 'sample_doc', filename: 'sample.pdf' },
    };
    render(<ProjectFileRenderer activity={activity} />);
    // 用户反馈"源码的时间线 tag 应该显示为源码而不是附件"——chip 用 categoryLabel 动态化
    expect(screen.getByText('参考样稿')).toBeInTheDocument();
    expect(screen.getByText(/上传参考样稿/)).toBeInTheDocument();
  });
});

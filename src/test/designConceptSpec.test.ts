import { describe, expect, it } from 'vitest';
import html from '../../designs/ghostterm-ui-concepts.html?raw';
import workspaceHtml from '../../designs/habitat-grid-workspace.html?raw';
import toolsHtml from '../../designs/habitat-grid-tools.html?raw';
import progressHtml from '../../designs/habitat-grid-progress.html?raw';

describe('GhostTerm 设计稿交付物', () => {
  it('应存在包含三套高保真方案的静态设计页', () => {
    expect(html).toContain('Atlas Chamber');
    expect(html).toContain('Loom Engine');
    expect(html).toContain('Habitat Grid');
    expect(html).toContain('Workspace');
    expect(html).toContain('Tools');
    expect(html).toContain('Settings');
  });

  it('应存在 Habitat Grid 三个独立功能设计稿页面', () => {
    expect(workspaceHtml).toContain('Habitat Grid / Workspace');
    expect(workspaceHtml).toContain('当前项目');
    expect(workspaceHtml).toContain('项目目录');
    expect(workspaceHtml).toContain('文件入口');
    expect(workspaceHtml).toContain('代码工作区');
    expect(workspaceHtml).toContain('终端任务');
    expect(workspaceHtml).toContain('工作状态');
    expect(toolsHtml).toContain('Habitat Grid / Tools');
    expect(toolsHtml).toContain('Forensic Tool Lab');
    expect(progressHtml).toContain('Habitat Grid / Progress');
    expect(progressHtml).toContain('GhostTerm · 进度模块');
    expect(progressHtml).toContain('看板视图');
    expect(progressHtml).toContain('列表视图');
    expect(progressHtml).toContain('Gantt视图');
    expect(progressHtml).toContain('S1');
    expect(progressHtml).toContain('S6');
    expect(progressHtml).toContain('洽谈中');
    expect(progressHtml).toContain('报价中');
    expect(progressHtml).toContain('开发中');
    expect(progressHtml).toContain('待验收');
    expect(progressHtml).toContain('已交付');
    expect(progressHtml).toContain('已收款');
    expect(progressHtml).not.toContain('state-mark');
  });
});

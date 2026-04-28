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
    expect(workspaceHtml).toContain('Project Bays');
    expect(workspaceHtml).toContain('Directory Spine');
    expect(workspaceHtml).toContain('File Dock');
    expect(workspaceHtml).toContain('Code Slabs');
    expect(workspaceHtml).toContain('Command Channels');
    expect(toolsHtml).toContain('Habitat Grid / Tools');
    expect(toolsHtml).toContain('Forensic Tool Lab');
    expect(progressHtml).toContain('Habitat Grid / Progress');
    expect(progressHtml).toContain('Expedition Map');
  });
});

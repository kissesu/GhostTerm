"""
@file: test_cjk_ascii_space.py
@description: cjk_ascii_space 规则 detect + fix + reopen 硬测试
@author: Atlas.oi
@date: 2026-04-17
"""
import tempfile
import shutil
from pathlib import Path
from docx import Document

from thesis_worker.rules.cjk_ascii_space import CjkAsciiSpaceRule

FIXTURES = Path(__file__).parent.parent / 'fixtures'
CONFIG_FORBID = {'allowed': False}  # 院校要求：不允许空格


class TestDetect:
    def test_detect_finds_violations_in_bad_doc(self):
        doc = Document(FIXTURES / 'cjk_space_bad.docx')
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        # "这是 AI 工具" 有两处违规（中-空-英 + 英-空-中）
        # "版本 2.1.1 已发布" 有两处违规（中-空-数 + 数-空-中）
        # "无违规段落。" 0 处
        assert len(issues) == 4
        for i in issues:
            assert i.rule_id == 'cjk_ascii_space'
            assert i.fix_available is True

    def test_detect_returns_empty_on_clean_doc(self):
        doc = Document(FIXTURES / 'cjk_space_clean.docx')
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        assert issues == []

    def test_detect_skip_when_allowed_true(self):
        """config 设为 allowed:true（允许空格）→ 不检测"""
        doc = Document(FIXTURES / 'cjk_space_bad.docx')
        issues = CjkAsciiSpaceRule.detect(doc, {'allowed': True})
        assert issues == []


class TestFix:
    def test_fix_and_reopen_produces_no_issues(self, tmp_path):
        """关键硬测试：修复后重开跑 detect 必须返回空"""
        origin = FIXTURES / 'cjk_space_bad.docx'
        tmp = tmp_path / 'copy.docx'
        shutil.copy(origin, tmp)

        doc = Document(tmp)
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        assert len(issues) == 4

        # 逐条修复
        for issue in issues:
            CjkAsciiSpaceRule.fix(doc, issue, CONFIG_FORBID)
        doc.save(tmp)

        # 重开验证
        reopened = Document(tmp)
        remaining = CjkAsciiSpaceRule.detect(reopened, CONFIG_FORBID)
        assert remaining == []

    def test_fix_marks_blue_color(self, tmp_path):
        from docx.shared import RGBColor
        origin = FIXTURES / 'cjk_space_bad.docx'
        tmp = tmp_path / 'copy.docx'
        shutil.copy(origin, tmp)

        doc = Document(tmp)
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        assert issues  # 非空

        CjkAsciiSpaceRule.fix(doc, issues[0], CONFIG_FORBID)
        doc.save(tmp)

        reopened = Document(tmp)
        # 第 0 段第 0 run（修改发生处）应有蓝色标记 #0070C0
        first_run = reopened.paragraphs[0].runs[0]
        assert first_run.font.color.rgb == RGBColor(0x00, 0x70, 0xC0)

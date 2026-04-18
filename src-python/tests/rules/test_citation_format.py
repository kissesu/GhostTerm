"""
@file: test_citation_format.py
@description: citation.format 规则检测测试（只检测，不 fix）
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from docx import Document

from thesis_worker.rules.citation_format import CitationFormatRule

# 标准 GB/T 7714 + bracket 配置
CONFIG = {'style': 'gbt7714', 'marker': 'bracket'}


def _make_doc(text: str) -> Document:
    """创建含单段落的内存 docx，方便各 case 快速构造测试文档"""
    doc = Document()
    doc.add_paragraph(text)
    return doc


class TestDetect:
    def test_detect_finds_fullwidth_bracket(self, tmp_path):
        """全角方括号 ［1］ 应被检出"""
        doc = _make_doc('引用处见文献［1］所述。')
        issues = CitationFormatRule.detect(doc, CONFIG)
        assert len(issues) == 1
        assert issues[0].rule_id == 'citation.format'
        assert '全角方括号' in issues[0].message
        assert issues[0].current == '［1］'
        assert issues[0].fix_available is False

    def test_detect_finds_fullwidth_paren(self, tmp_path):
        """全角圆括号 （1） 应被检出"""
        doc = _make_doc('引用处见文献（1）所述。')
        issues = CitationFormatRule.detect(doc, CONFIG)
        assert len(issues) == 1
        assert '全角圆括号' in issues[0].message
        assert issues[0].current == '（1）'

    def test_detect_finds_harvard(self, tmp_path):
        """哈佛格式 (张三, 2023) 应被检出"""
        doc = _make_doc('此方法见(张三, 2023)所述。')
        issues = CitationFormatRule.detect(doc, CONFIG)
        assert len(issues) == 1
        assert '哈佛格式' in issues[0].message
        assert issues[0].current == '(张三, 2023)'

    def test_detect_finds_paren_numeric(self, tmp_path):
        """半角圆括号数字 (1) 应被检出"""
        doc = _make_doc('引用(1)和(2)的结论。')
        issues = CitationFormatRule.detect(doc, CONFIG)
        assert len(issues) == 2
        assert all('半角圆括号数字' in i.message for i in issues)

    def test_detect_returns_empty_for_correct_brackets(self, tmp_path):
        """合规的 [1]、[1,2]、[1-3] 不应产生 issue"""
        doc = _make_doc('引用文献[1]和[1,2]以及[1-3]的数据。')
        issues = CitationFormatRule.detect(doc, CONFIG)
        assert issues == []

    def test_detect_skips_when_style_not_gbt7714(self, tmp_path):
        """style != gbt7714 时直接跳过，即使文档有违规格式"""
        doc = _make_doc('引用（1）和（2）的结论。')
        issues = CitationFormatRule.detect(doc, {'style': 'apa', 'marker': 'bracket'})
        assert issues == []

    def test_detect_skips_when_marker_not_bracket(self, tmp_path):
        """marker != bracket 时直接跳过"""
        doc = _make_doc('引用（1）和（2）的结论。')
        issues = CitationFormatRule.detect(doc, {'style': 'gbt7714', 'marker': 'superscript'})
        assert issues == []


class TestFixUnavailable:
    def test_fix_raises_not_implemented(self, tmp_path):
        """fix 必须 raise NotImplementedError，确保 fix_available=False 语义一致"""
        doc = _make_doc('引用（1）的结论。')
        issues = CitationFormatRule.detect(doc, CONFIG)
        assert len(issues) == 1

        with pytest.raises(NotImplementedError):
            CitationFormatRule.fix(doc, issues[0], CONFIG)

"""
@file: test_gazetteer.py
@description: Gazetteer 词典匹配测试
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.extractor.gazetteer import (
    CJK_FONTS, ASCII_FONTS, ALIGN_MAP, BOLD_KEYWORDS,
    find_font, find_align, is_bold_keyword,
)


class TestFonts:
    def test_cjk_fonts_contain_common(self):
        assert '宋体' in CJK_FONTS
        assert '黑体' in CJK_FONTS
        assert '楷体' in CJK_FONTS
        assert '仿宋' in CJK_FONTS

    def test_ascii_fonts_contain_tnr(self):
        assert 'Times New Roman' in ASCII_FONTS
        assert 'Arial' in ASCII_FONTS


class TestFindFont:
    def test_find_cjk(self):
        text = '小四号宋体加粗'
        result = find_font(text)
        assert result == ('cjk', '宋体')

    def test_find_ascii(self):
        text = 'Times New Roman 加粗'
        result = find_font(text)
        assert result == ('ascii', 'Times New Roman')

    def test_find_both_returns_cjk_priority(self):
        text = '宋体或 Times New Roman'
        # 先匹配到的胜出（此处是宋体）
        result = find_font(text)
        assert result[1] == '宋体'

    def test_no_match(self):
        assert find_font('一段普通文字') is None


class TestFindAlign:
    def test_center(self):
        assert find_align('居中显示') == 'center'

    def test_left(self):
        assert find_align('顶格左对齐') == 'left'

    def test_justify(self):
        assert find_align('两端对齐') == 'justify'

    def test_no_match(self):
        assert find_align('没有对齐词') is None

    def test_align_priority_order(self):
        # 居中 排在 顶格 之前，ALIGN_MAP 插入顺序使 居中 先命中
        assert find_align('居中顶格') == 'center'


class TestBoldKeyword:
    def test_bold(self):
        assert is_bold_keyword('加粗') is True
        assert is_bold_keyword('粗体') is True

    def test_no_bold(self):
        assert is_bold_keyword('斜体') is False

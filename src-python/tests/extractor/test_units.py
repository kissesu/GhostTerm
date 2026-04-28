"""
@file: test_units.py
@description: 长度单位 → pt 转换 + 自然语言长度抽取测试
@author: Atlas.oi
@date: 2026-04-28
"""
import pytest
from thesis_worker.extractor.units import LENGTH_UNIT_TO_PT, length_to_pt, extract_length_with_unit


class TestLengthUnitToPt:
    """5 种长度单位转 pt 的精确度"""

    def test_pt_passthrough(self):
        assert length_to_pt(12.0, '磅') == 12.0
        assert length_to_pt(12.0, 'pt') == 12.0
        assert length_to_pt(12.0, '点') == 12.0

    def test_inch_to_pt(self):
        assert length_to_pt(1.0, '英寸') == 72.0
        assert length_to_pt(1.0, 'in') == 72.0
        assert length_to_pt(1.0, 'inch') == 72.0

    def test_cm_to_pt(self):
        assert length_to_pt(1.0, '厘米') == pytest.approx(28.3464, abs=0.001)
        assert length_to_pt(0.5, 'cm') == pytest.approx(14.1732, abs=0.001)

    def test_mm_to_pt(self):
        assert length_to_pt(1.0, '毫米') == pytest.approx(2.8346, abs=0.001)
        assert length_to_pt(10.0, 'mm') == pytest.approx(28.3464, abs=0.001)

    def test_unknown_unit_returns_none(self):
        assert length_to_pt(1.0, '光年') is None
        assert length_to_pt(1.0, '') is None


class TestExtractLengthWithUnit:
    """从自然语言文本抽取数值 + 单位"""

    def test_extract_simple_pt(self):
        assert extract_length_with_unit('字号 12 磅') == (12.0, '磅')

    def test_extract_decimal_cm(self):
        assert extract_length_with_unit('上边距 1.5 厘米') == (1.5, '厘米')

    def test_extract_with_fullwidth_space(self):
        """全角空格 [\\s　] 必须支持"""
        assert extract_length_with_unit('段前　6　磅') == (6.0, '磅')

    def test_no_match_returns_none(self):
        assert extract_length_with_unit('居中对齐') is None

    def test_picks_first_match(self):
        result = extract_length_with_unit('段前 6 磅，段后 3 磅')
        assert result == (6.0, '磅')

    def test_chinese_and_ascii_units_equivalent(self):
        a = extract_length_with_unit('1 cm')
        b = extract_length_with_unit('1 厘米')
        assert a == (1.0, 'cm')
        assert b == (1.0, '厘米')
        assert length_to_pt(*a) == length_to_pt(*b)

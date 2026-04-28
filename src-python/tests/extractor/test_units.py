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


class TestChineseSizeNames:
    """T1.2: 中文字号补全到 八号"""

    def test_qihao_returns_5_5pt(self):
        from thesis_worker.utils.size import name_to_pt
        assert name_to_pt('七号') == 5.5

    def test_bahao_returns_5_0pt(self):
        from thesis_worker.utils.size import name_to_pt
        assert name_to_pt('八号') == 5.0

    def test_existing_entries_unchanged(self):
        """既有 14 项不变（确保不破坏 backward compat）"""
        from thesis_worker.utils.size import name_to_pt
        # 既有 14 项数据快照（T1.2 之前），任一项 pt 值漂移会立即挂
        # 数据来源：src-python/thesis_worker/utils/size.py CHINESE_SIZE_MAP
        existing = {
            '初号': 42.0,
            '小初': 36.0,
            '一号': 26.0,
            '小一': 24.0,
            '二号': 22.0,
            '小二': 18.0,
            '三号': 16.0,
            '小三': 15.0,
            '四号': 14.0,
            '小四': 12.0,
            '五号': 10.5,
            '小五': 9.0,
            '六号': 7.5,
            '小六': 6.5,
        }
        for name, expected_pt in existing.items():
            assert name_to_pt(name) == expected_pt, \
                f'{name} pt 漂移：实际 {name_to_pt(name)} ≠ 期望 {expected_pt}'

    def test_reverse_lookup_qihao(self):
        from thesis_worker.utils.size import pt_to_name
        assert pt_to_name(5.5) == '七号'
        assert pt_to_name(5.0) == '八号'


class TestAsciiUnitBoundary:
    """T-fix1: ASCII 单位词边界保护，避免英文上下文误匹配"""

    def test_in_inside_input_no_match(self):
        from thesis_worker.extractor.units import extract_length_with_unit
        # "1 input" 不应匹配 (1, 'in')
        assert extract_length_with_unit('1 input') is None

    def test_in_inside_word_no_match(self):
        from thesis_worker.extractor.units import extract_length_with_unit
        assert extract_length_with_unit('click 1 in form') is None

    def test_pt_attached_to_letter_no_match(self):
        from thesis_worker.extractor.units import extract_length_with_unit
        # '1cmm' 中 cm 后跟 m → 在词内 → 应不匹配
        # 旧逻辑无 \b 会误匹配 (1, 'cm')
        result = extract_length_with_unit('1cmm')
        assert result is None or result[1] != 'cm'

    def test_legitimate_uses_still_work(self):
        from thesis_worker.extractor.units import extract_length_with_unit
        # 词界改造不应破坏合法 case
        assert extract_length_with_unit('1 cm') == (1.0, 'cm')
        assert extract_length_with_unit('1 in') == (1.0, 'in')
        assert extract_length_with_unit('1 inch') == (1.0, 'inch')
        assert extract_length_with_unit('1pt') == (1.0, 'pt')  # 紧贴数字 OK
        assert extract_length_with_unit('段前 6 磅') == (6.0, '磅')

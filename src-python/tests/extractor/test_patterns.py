"""
@file: test_patterns.py
@description: 正则 pattern 抽取字号/字体等属性
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.extractor.patterns import (
    extract_size_name, extract_size_pt_raw,
    find_parens_annotation, find_quoted_field,
)


class TestExtractSize:
    def test_size_name(self):
        assert extract_size_name('小三号宋体') == '小三'
        assert extract_size_name('三号黑体') == '三号'
        assert extract_size_name('小四') == '小四'

    def test_pt_raw(self):
        assert extract_size_pt_raw('12pt 宋体') == 12.0
        assert extract_size_pt_raw('字号 15 磅') == 15.0
        assert extract_size_pt_raw('10.5pt') == 10.5
        assert extract_size_pt_raw('10.5点') == 10.5

    def test_no_size(self):
        assert extract_size_name('无字号描述') is None
        assert extract_size_pt_raw('无字号描述') is None


class TestAnnotation:
    def test_parens_capture(self):
        text = '摘要（小三号宋体加粗，居中）'
        result = find_parens_annotation(text)
        assert result is not None
        field_name, annotation = result
        assert field_name.strip() == '摘要'
        assert '小三号' in annotation

    def test_multiple_parens(self):
        text = '关键词：（无缩进，小四宋体加粗）内容（3-5 个）'
        result = find_parens_annotation(text)
        assert result is not None
        assert result[0].strip() == '关键词：'


class TestQuoted:
    def test_quoted_field(self):
        text = '"摘要"二字为黑体小四号'
        result = find_quoted_field(text)
        assert result is not None
        field_name, rest = result
        assert field_name == '摘要'
        assert '黑体' in rest

    def test_chinese_quotes(self):
        text = '\u201cAbstract\u201d为 Times New Roman 小四号'
        result = find_quoted_field(text)
        assert result is not None
        assert result[0] == 'Abstract'


class TestPatternConstants:
    """T1.3: patterns 模块导出的 5 单位正则常量复用"""

    def test_length_pattern_matches_all_5_units(self):
        from thesis_worker.extractor.patterns import _LENGTH_UNIT_PATTERN
        import re
        rx = re.compile(rf'\d+(?:\.\d+)?[\s　]*({_LENGTH_UNIT_PATTERN})')
        for unit in ('磅', 'pt', '点', '英寸', 'in', 'inch', '厘米', 'cm', '毫米', 'mm'):
            assert rx.search(f'1 {unit}'), f'failed for unit={unit!r}'

    def test_length_pattern_does_not_match_unrelated(self):
        from thesis_worker.extractor.patterns import _LENGTH_UNIT_PATTERN
        import re
        rx = re.compile(rf'\d+(?:\.\d+)?[\s　]*({_LENGTH_UNIT_PATTERN})')
        # "光年" 不在 5 单位内
        assert rx.search('1 光年') is None
        # 单纯数字无单位也不应匹配
        assert rx.search('数字 100 无单位') is None

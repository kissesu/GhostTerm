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

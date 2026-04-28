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


class TestExtractParaSpacing:
    """T3.1: 段前/段后多单位自然语言抽取"""

    def test_space_before_6_pt(self):
        from thesis_worker.extractor.patterns import extract_para_spacing
        # "段前 6 磅" → ('para.space_before_pt', 6.0)
        assert extract_para_spacing('段前 6 磅') == ('para.space_before_pt', 6.0)

    def test_space_before_1_line(self):
        from thesis_worker.extractor.patterns import extract_para_spacing
        # "段前 1 行" → ('para.space_before_lines', 1.0)
        assert extract_para_spacing('段前 1 行') == ('para.space_before_lines', 1.0)

    def test_space_after_0_5_cm(self):
        import pytest
        from thesis_worker.extractor.patterns import extract_para_spacing
        # "段后 0.5 厘米" → ('para.space_after_pt', 14.17)
        out = extract_para_spacing('段后 0.5 厘米')
        assert out is not None
        assert out[0] == 'para.space_after_pt'
        assert out[1] == pytest.approx(14.17, abs=0.01)

    def test_fullwidth_space_supported(self):
        """全角空格兼容"""
        from thesis_worker.extractor.patterns import extract_para_spacing
        assert extract_para_spacing('段前　6　磅') == ('para.space_before_pt', 6.0)

    def test_no_space_keyword_returns_none(self):
        from thesis_worker.extractor.patterns import extract_para_spacing
        assert extract_para_spacing('居中对齐') is None

    def test_discriminating_before_vs_after(self):
        """同样的数值在 before/after 不同 sink；删 prefix 判定逻辑两 case 互换"""
        from thesis_worker.extractor.patterns import extract_para_spacing
        assert extract_para_spacing('段前 12 磅')[0] == 'para.space_before_pt'
        assert extract_para_spacing('段后 12 磅')[0] == 'para.space_after_pt'


class TestExtractIndent:
    """T3.2: 首行/悬挂缩进多单位（含字符）"""

    def test_first_line_indent_2_chars(self):
        from thesis_worker.extractor.patterns import extract_indent
        assert extract_indent('首行缩进 2 字符') == ('para.first_line_indent_chars', 2.0)

    def test_first_line_indent_0_74_cm(self):
        import pytest
        from thesis_worker.extractor.patterns import extract_indent
        out = extract_indent('首行缩进 0.74 厘米')
        assert out[0] == 'para.first_line_indent_pt'
        assert out[1] == pytest.approx(20.97, abs=0.05)

    def test_hanging_indent_14_pt(self):
        from thesis_worker.extractor.patterns import extract_indent
        assert extract_indent('悬挂缩进 14 磅') == ('para.hanging_indent_pt', 14.0)

    def test_first_line_priority_over_hanging(self):
        """同一文本同时出现首行+悬挂时，优先首行（先扫描到的）"""
        from thesis_worker.extractor.patterns import extract_indent
        out = extract_indent('首行缩进 2 字符；悬挂缩进 1 字符')
        assert out == ('para.first_line_indent_chars', 2.0)

    def test_no_indent_keyword_returns_none(self):
        from thesis_worker.extractor.patterns import extract_indent
        assert extract_indent('段前 6 磅') is None


class TestExtractLineSpacing:
    """T3.3: 行距 6 类型识别"""

    def test_single(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        assert extract_line_spacing('单倍行距') == {
            'para.line_spacing_type': 'single',
            'para.line_spacing': 1.0,
        }

    def test_one_and_half(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        out = extract_line_spacing('1.5 倍行距')
        assert out == {'para.line_spacing_type': 'oneAndHalf', 'para.line_spacing': 1.5}

    def test_double(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        out = extract_line_spacing('2 倍行距')
        assert out == {'para.line_spacing_type': 'double', 'para.line_spacing': 2.0}

    def test_at_least_28pt(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        out = extract_line_spacing('最小值 28 磅')
        assert out == {'para.line_spacing_type': 'atLeast', 'para.line_spacing_pt': 28.0}

    def test_exactly_28pt(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        out = extract_line_spacing('固定值 28 磅')
        assert out == {'para.line_spacing_type': 'exactly', 'para.line_spacing_pt': 28.0}

    def test_multiple_2_5(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        out = extract_line_spacing('多倍行距 2.5')
        assert out == {'para.line_spacing_type': 'multiple', 'para.line_spacing': 2.5}

    def test_no_spacing_keyword_returns_none(self):
        from thesis_worker.extractor.patterns import extract_line_spacing
        assert extract_line_spacing('居中对齐') is None

    def test_priority_single_before_multiple(self):
        """单倍行距 vs 多倍行距互斥，删一处必挂"""
        from thesis_worker.extractor.patterns import extract_line_spacing
        out = extract_line_spacing('单倍行距')
        assert out['para.line_spacing_type'] == 'single'
        out2 = extract_line_spacing('多倍行距 1.5')
        assert out2['para.line_spacing_type'] == 'multiple'


class TestExtractLetterSpacing:
    """T3.4a: 字符间距多单位"""

    def test_letter_spacing_1_pt(self):
        from thesis_worker.extractor.patterns import extract_letter_spacing
        # "字符间距 加宽 1 磅" → ('para.letter_spacing_pt', 1.0)
        assert extract_letter_spacing('字符间距 加宽 1 磅') == ('para.letter_spacing_pt', 1.0)

    def test_letter_spacing_2_chars(self):
        from thesis_worker.extractor.patterns import extract_letter_spacing
        assert extract_letter_spacing('字符间距 2 字符') == ('para.letter_spacing_chars', 2.0)

    def test_no_keyword_returns_none(self):
        from thesis_worker.extractor.patterns import extract_letter_spacing
        assert extract_letter_spacing('段前 6 磅') is None


class TestExtractTableBordersText:
    """T3.4b: 表线 / 三线表自然语言"""

    def test_three_line_table_keyword(self):
        from thesis_worker.extractor.patterns import extract_table_borders_text
        out = extract_table_borders_text('表格使用三线表')
        assert out['table.is_three_line'] is True

    def test_top_bottom_border_combined(self):
        from thesis_worker.extractor.patterns import extract_table_borders_text
        out = extract_table_borders_text('上下表线 1.5 磅')
        assert out['table.border_top_pt'] == 1.5
        assert out['table.border_bottom_pt'] == 1.5

    def test_header_border(self):
        from thesis_worker.extractor.patterns import extract_table_borders_text
        out = extract_table_borders_text('表头下线 0.5 磅')
        assert out['table.header_border_pt'] == 0.5

    def test_combined_3_borders(self):
        from thesis_worker.extractor.patterns import extract_table_borders_text
        out = extract_table_borders_text('三线表，上下表线 1.5 磅，表头下线 0.5 磅')
        assert out['table.is_three_line'] is True
        assert out['table.border_top_pt'] == 1.5
        assert out['table.border_bottom_pt'] == 1.5
        assert out['table.header_border_pt'] == 0.5

    def test_no_keyword_returns_empty(self):
        from thesis_worker.extractor.patterns import extract_table_borders_text
        assert extract_table_borders_text('居中对齐') == {}

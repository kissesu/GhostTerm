"""
@file: test_field_matcher.py
@description: 字段 id ← 关键词 关联
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.extractor.field_matcher import (
    FIELD_KEYWORDS, match_field, match_all_fields,
)


class TestKeywords:
    def test_all_33_fields_have_keywords(self):
        # T2.1 新增 table_header 后，共 33 个字段都必须有关键词列表（哪怕是空 list）
        assert len(FIELD_KEYWORDS) == 33

    def test_abstract_zh_keywords(self):
        assert '摘要' in FIELD_KEYWORDS['abstract_zh_title']
        assert '摘 要' in FIELD_KEYWORDS['abstract_zh_title']

    def test_title_zh_keywords(self):
        assert '毕业论文题目' in FIELD_KEYWORDS['title_zh'] or '论文题目' in FIELD_KEYWORDS['title_zh']


class TestMatchField:
    def test_single_match(self):
        text = '摘要（小三号宋体加粗，居中）'
        assert match_field(text) == 'abstract_zh_title'

    def test_keywords_match(self):
        text = '参考文献另起一页'
        assert match_field(text) == 'references_title'

    def test_no_match(self):
        text = '一段普通正文，无字段关键词'
        assert match_field(text) is None

    # --- table_header 行为匹配测试（T2.1 review 补充）---

    def test_table_header_match_bold(self):
        # "表头" 是 table_header 的核心关键词，规范文本常见表述
        text = '表头行加粗'
        assert match_field(text) == 'table_header'

    def test_table_header_match_center(self):
        # "表格标题行" 是 table_header 的第二关键词
        text = '表格标题行居中对齐'
        assert match_field(text) == 'table_header'

    def test_table_header_not_match_table_caption(self):
        # "表题" 触发 table_caption，而非 table_header；
        # 确认 '表头' 关键词不会误命中含 "表题" 的文本
        text = '表题（五号黑体居中）'
        assert match_field(text) == 'table_caption'
        assert match_field(text) != 'table_header'


class TestMatchAllFields:
    def test_multiple_paragraphs(self):
        paras = [
            '毕业论文题目（三号黑体）',
            '摘要（小三号宋体加粗）',
            '其他段',
            '关键词：（小四宋体加粗）',
        ]
        results = match_all_fields(paras)
        # 返回 [(para_idx, field_id, confidence), ...]
        field_ids = [r[1] for r in results if r[1] is not None]
        assert 'title_zh' in field_ids
        assert 'abstract_zh_title' in field_ids
        assert 'keywords_zh_label' in field_ids

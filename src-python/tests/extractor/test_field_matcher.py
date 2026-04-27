"""
@file: test_field_matcher.py
@description: 字段 id ← 关键词 关联（T2.2: toc_entry 拆分 l1/l2/l3）
@author: Atlas.oi
@date: 2026-04-27
"""
import pytest
from thesis_worker.extractor.field_matcher import (
    FIELD_KEYWORDS, match_field, match_all_fields,
)


class TestKeywords:
    def test_all_35_fields_have_keywords(self):
        # T2.2 拆分 toc_entry 为 l1/l2/l3 后，共 35 个字段都必须有关键词列表
        assert len(FIELD_KEYWORDS) == 35

    def test_toc_entry_removed_from_keywords(self):
        # 旧 toc_entry 关键词条目已删除
        assert 'toc_entry' not in FIELD_KEYWORDS

    def test_toc_entry_l1_keywords_exist(self):
        # l1 关键词列表不为空
        assert len(FIELD_KEYWORDS.get('toc_entry_l1', [])) > 0

    def test_toc_entry_l2_keywords_exist(self):
        assert len(FIELD_KEYWORDS.get('toc_entry_l2', [])) > 0

    def test_toc_entry_l3_keywords_exist(self):
        assert len(FIELD_KEYWORDS.get('toc_entry_l3', [])) > 0

    def test_toc_entry_l_before_toc_title_in_dict(self):
        """toc_title 含短子串"目录"，l1/l2/l3 必须排在其前面，
        否则含"目录"的 l* 文本会先命中 toc_title。
        本测试把字典顺序约束转化为可执行断言，靠注释维持的顺序是不可信的。"""
        keys = list(FIELD_KEYWORDS.keys())
        assert keys.index('toc_entry_l1') < keys.index('toc_title')
        assert keys.index('toc_entry_l2') < keys.index('toc_title')
        assert keys.index('toc_entry_l3') < keys.index('toc_title')

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

    # --- toc_entry_l1/l2/l3 匹配测试（T2.2）---

    def test_toc_entry_l1_match_primary(self):
        # "一级目录条目" 是 l1 的核心关键词
        text = '一级目录条目：黑体四号顶格'
        assert match_field(text) == 'toc_entry_l1'

    def test_toc_entry_l1_match_secondary(self):
        # "目录一级条目" 是 l1 的第二关键词
        text = '目录一级条目格式说明'
        assert match_field(text) == 'toc_entry_l1'

    def test_toc_entry_l2_match_primary(self):
        # "二级目录条目" 是 l2 的核心关键词
        text = '二级目录条目：宋体小四缩进2字符'
        assert match_field(text) == 'toc_entry_l2'

    def test_toc_entry_l2_match_secondary(self):
        # "目录二级条目" 是 l2 的第二关键词
        text = '目录二级条目右缩2字符'
        assert match_field(text) == 'toc_entry_l2'

    def test_toc_entry_l3_match_primary(self):
        # "三级目录条目" 是 l3 的核心关键词
        text = '三级目录条目：宋体小四缩进4字符'
        assert match_field(text) == 'toc_entry_l3'

    def test_toc_entry_l3_match_secondary(self):
        # "目录三级条目" 是 l3 的第二关键词
        text = '目录三级条目缩进4字符'
        assert match_field(text) == 'toc_entry_l3'

    def test_toc_entry_l1_not_match_chapter_title(self):
        # "一级标题" 触发 chapter_title，"一级目录条目" 不应触发 chapter_title
        # 边界：chapter_title 关键词含 "第一章"，不含 "一级目录"
        text = '第一章 绪论'
        assert match_field(text) == 'chapter_title'
        assert match_field(text) != 'toc_entry_l1'

    def test_toc_entry_l1_keyword_exists_and_matches(self):
        # 判别力测试：确认 toc_entry_l1 关键词"一级目录条目"存在且能命中
        # 删除 toc_entry_l1 关键词后此 case 会挂 → 具有判别力
        assert match_field('一级目录条目：黑体四号') == 'toc_entry_l1'
        assert match_field('目录一级条目对应格式') == 'toc_entry_l1'

    def test_toc_entry_l2_keyword_exists_and_matches(self):
        # 判别力测试：确认 toc_entry_l2 关键词"二级目录条目"存在且能命中
        # 删除 toc_entry_l2 关键词后此 case 会挂 → 具有判别力
        assert match_field('二级目录条目宋体小四') == 'toc_entry_l2'
        assert match_field('目录二级条目缩进格式') == 'toc_entry_l2'

    def test_toc_entry_l3_keyword_exists_and_matches(self):
        # 判别力测试：确认 toc_entry_l3 关键词"三级目录条目"存在且能命中
        # 删除 toc_entry_l3 关键词后此 case 会挂 → 具有判别力
        assert match_field('三级目录条目缩进4字符') == 'toc_entry_l3'
        assert match_field('目录三级条目字体格式') == 'toc_entry_l3'

    def test_toc_entry_l1_priority_over_toc_title(self):
        # 字典顺序保护：含"目录"子串时 l1 应先命中而非 toc_title
        # "目录一级条目格式" 同时含 "目录"（toc_title 关键词）和 "目录一级条目"（l1 关键词）
        # 删除 toc_entry_l1 关键词后此 case 会挂（退化为 toc_title）→ 具有判别力
        assert match_field('目录一级条目格式') == 'toc_entry_l1'

    def test_toc_entry_l2_priority_over_toc_title(self):
        # 字典顺序保护：含"目录"子串时 l2 应先命中而非 toc_title
        assert match_field('目录二级条目格式') == 'toc_entry_l2'

    def test_toc_entry_l3_priority_over_toc_title(self):
        # 字典顺序保护：含"目录"子串时 l3 应先命中而非 toc_title
        assert match_field('目录三级条目格式') == 'toc_entry_l3'

    def test_toc_title_still_matches(self):
        # 拆分操作不影响 toc_title（"目录"）的匹配
        text = '目录（黑体三号居中）'
        assert match_field(text) == 'toc_title'


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

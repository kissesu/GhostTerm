"""
@file: test_field_defs.py
@description: 32 字段定义测试
@author: Atlas.oi
@date: 2026-04-18
"""
from thesis_worker.engine_v2.field_defs import FIELD_DEFS, get_field, applicable_attrs


class TestFieldDefs:
    def test_count_32(self):
        assert len(FIELD_DEFS) == 32

    def test_groups(self):
        groups = {f['group'] for f in FIELD_DEFS}
        assert groups == {'front', 'body', 'back', 'global'}

    def test_orders_sequential(self):
        orders = [f['order'] for f in FIELD_DEFS]
        assert orders == list(range(1, 33))

    def test_get_field(self):
        f = get_field('abstract_zh_title')
        assert f['label'] == '中文「摘要」标题'

    def test_applicable_attrs_title_zh(self):
        attrs = applicable_attrs('title_zh')
        assert 'font.cjk' in attrs
        assert 'font.size_pt' in attrs
        assert 'content.char_count_max' in attrs

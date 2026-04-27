"""
@file: test_field_defs.py
@description: 33 字段定义测试（T2.1 新增 table_header 字段）
@author: Atlas.oi
@date: 2026-04-18
"""
from thesis_worker.engine_v2.field_defs import FIELD_DEFS, get_field, applicable_attrs


class TestFieldDefs:
    def test_count_33(self):
        # T2.1 新增 table_header 字段后总数由 32 升为 33
        assert len(FIELD_DEFS) == 33

    def test_groups(self):
        groups = {f['group'] for f in FIELD_DEFS}
        assert groups == {'front', 'body', 'back', 'global'}

    def test_orders_sequential(self):
        # 33 字段 order 必须连续 1-33
        orders = [f['order'] for f in FIELD_DEFS]
        assert orders == list(range(1, 34))

    def test_get_field(self):
        f = get_field('abstract_zh_title')
        assert f['label'] == '中文「摘要」标题'

    def test_applicable_attrs_title_zh(self):
        attrs = applicable_attrs('title_zh')
        assert 'font.cjk' in attrs
        assert 'font.size_pt' in attrs
        assert 'content.char_count_max' in attrs

    # ─────────────────────────────────────────────
    # T2.1: table_header 字段存在性断言
    # ─────────────────────────────────────────────

    def test_table_header_exists(self):
        # 表头字段必须存在，且 id 正确
        f = get_field('table_header')
        assert f is not None
        assert f['id'] == 'table_header'
        assert f['label'] == '表头'
        assert f['group'] == 'body'

    def test_table_header_order_20(self):
        # table_header 插入 table_caption(19) 与 table_inner_text(21) 之间，order=20
        f = get_field('table_header')
        assert f['order'] == 20

    def test_table_header_applicable_attributes(self):
        # 白名单精确：规范层对表头的约束仅 4 项，不多不少
        attrs = applicable_attrs('table_header')
        assert set(attrs) == {'font.cjk', 'font.size_pt', 'font.bold', 'para.align'}
        assert len(attrs) == 4

    def test_table_inner_text_order_is_21(self):
        # table_inner_text 被 table_header 推后，order 由 20 → 21
        f = get_field('table_inner_text')
        assert f['order'] == 21

"""
@file: test_field_defs.py
@description: 37 字段定义测试（T2.1 新增 table_header / T2.2 拆分 toc_entry 为 l1/l2/l3 /
              T2.3 新增 formula_block / T2.4 新增 footnote / T3.1 追加 6 个 attr key /
              T3.2 table_header 追加 4 个 table.* attr /
              T3.3 figure_caption +2 numbering attr / formula_block +1 numbering attr）
@author: Atlas.oi
@date: 2026-04-28
"""
from thesis_worker.engine_v2.field_defs import FIELD_DEFS, get_field, applicable_attrs


class TestFieldDefs:
    def test_count_37(self):
        # T2.4 新增 footnote 后总数由 36 升为 37
        assert len(FIELD_DEFS) == 37

    def test_groups(self):
        groups = {f['group'] for f in FIELD_DEFS}
        assert groups == {'front', 'body', 'back', 'global'}

    def test_orders_sequential(self):
        # 37 字段 order 必须连续 1-37
        orders = [f['order'] for f in FIELD_DEFS]
        assert orders == list(range(1, 38))

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

    def test_table_header_order_22(self):
        # T2.2 后 toc_entry 拆分 +2，table_header 由 20 → 22
        f = get_field('table_header')
        assert f['order'] == 22

    def test_table_header_applicable_attributes(self):
        # T3.2: table_header 追加 4 个 table.* attr 后共 8 个，白名单精确
        attrs = applicable_attrs('table_header')
        assert set(attrs) == {
            'font.cjk', 'font.size_pt', 'font.bold', 'para.align',
            'table.is_three_line', 'table.border_top_pt', 'table.border_bottom_pt', 'table.header_border_pt',
        }
        assert len(attrs) == 8

    def test_table_inner_text_order_is_23(self):
        # T2.2 后 table_inner_text 由 21 → 23
        f = get_field('table_inner_text')
        assert f['order'] == 23

    # ─────────────────────────────────────────────
    # T2.2: toc_entry 拆分为 l1/l2/l3 断言
    # ─────────────────────────────────────────────

    def test_toc_entry_removed(self):
        # 旧的 toc_entry 合并字段不再存在
        assert get_field('toc_entry') is None

    def test_toc_entry_l1_exists(self):
        # 一级目录条目字段
        f = get_field('toc_entry_l1')
        assert f is not None
        assert f['label'] == '目录一级条目'
        assert f['group'] == 'front'
        assert f['order'] == 12

    def test_toc_entry_l2_exists(self):
        # 二级目录条目字段
        f = get_field('toc_entry_l2')
        assert f is not None
        assert f['label'] == '目录二级条目'
        assert f['group'] == 'front'
        assert f['order'] == 13

    def test_toc_entry_l3_exists(self):
        # 三级目录条目字段
        f = get_field('toc_entry_l3')
        assert f is not None
        assert f['label'] == '目录三级条目'
        assert f['group'] == 'front'
        assert f['order'] == 14

    def test_toc_entry_l1_applicable_attributes(self):
        # 三个分级字段共享相同的 applicable_attributes（4 项）
        # 规范层对各级条目的约束维度相同：字体/字号/加粗/缩进
        expected = {'font.cjk', 'font.size_pt', 'font.bold', 'para.first_line_indent_chars'}
        attrs = applicable_attrs('toc_entry_l1')
        assert set(attrs) == expected
        assert len(attrs) == 4

    def test_toc_entry_l2_applicable_attributes(self):
        # l2 与 l1 共享相同属性集
        assert set(applicable_attrs('toc_entry_l2')) == set(applicable_attrs('toc_entry_l1'))

    def test_toc_entry_l3_applicable_attributes(self):
        # l3 与 l1 共享相同属性集
        assert set(applicable_attrs('toc_entry_l3')) == set(applicable_attrs('toc_entry_l1'))

    def test_chapter_title_order_15(self):
        # T2.2 后 chapter_title 由 13 → 15
        f = get_field('chapter_title')
        assert f['order'] == 15

    def test_mixed_script_global_order_37(self):
        # T2.4 新增 footnote 后末位字段 order 由 36 → 37
        f = get_field('mixed_script_global')
        assert f['order'] == 37

    # ─────────────────────────────────────────────
    # T2.3: formula_block 字段存在性断言
    # ─────────────────────────────────────────────

    def test_formula_block_exists(self):
        # 公式字段必须存在，id/label/group 正确
        f = get_field('formula_block')
        assert f is not None
        assert f['id'] == 'formula_block'
        assert f['label'] == '公式'
        assert f['group'] == 'body'

    def test_formula_block_order_24(self):
        # formula_block 紧接正文末尾（body 原 order 15-23），插入 order=24
        f = get_field('formula_block')
        assert f['order'] == 24

    def test_formula_block_applicable_attributes(self):
        # T3.3: formula_block 包含 para.align（T2.3）+ numbering.formula_style（T3.3）
        attrs = applicable_attrs('formula_block')
        assert 'para.align' in attrs
        assert 'numbering.formula_style' in attrs
        assert len(attrs) == 2

    def test_references_title_order_26(self):
        # T2.4 新增 footnote(order=25) 后 references_title 由 25 → 26
        f = get_field('references_title')
        assert f['order'] == 26

    def test_appendix_body_order_31(self):
        # T2.4 后 back 组末位字段 appendix_body 由 30 → 31
        f = get_field('appendix_body')
        assert f['order'] == 31

    # ─────────────────────────────────────────────
    # T2.4: footnote 字段存在性断言
    # ─────────────────────────────────────────────

    def test_footnote_exists(self):
        # 脚注字段必须存在，id/label/group 正确
        f = get_field('footnote')
        assert f is not None
        assert f['id'] == 'footnote'
        assert f['label'] == '脚注'
        assert f['group'] == 'body'

    def test_footnote_order_25(self):
        # footnote 紧接 formula_block(24) 之后，order=25
        f = get_field('footnote')
        assert f['order'] == 25

    def test_footnote_applicable_attributes(self):
        # 白名单精确：规范只规定脚注字体和字号 2 项，不多不少
        attrs = applicable_attrs('footnote')
        assert set(attrs) == {'font.cjk', 'font.size_pt'}
        assert len(attrs) == 2

    # ─────────────────────────────────────────────
    # T3.1: 6 个新 attr key 绑定断言
    # ─────────────────────────────────────────────

    def test_toc_title_has_space_pt_attrs(self):
        # toc_title 追加 para.space_before_pt / para.space_after_pt
        attrs = applicable_attrs('toc_title')
        assert 'para.space_before_pt' in attrs
        assert 'para.space_after_pt' in attrs
        # 原有 _lines 系列保留，与新 _pt 系列共存
        assert 'para.space_before_lines' in attrs
        assert 'para.space_after_lines' in attrs

    def test_chapter_title_has_space_pt_attrs(self):
        # chapter_title 追加 para.space_before_pt / para.space_after_pt
        attrs = applicable_attrs('chapter_title')
        assert 'para.space_before_pt' in attrs
        assert 'para.space_after_pt' in attrs
        # 原有 _lines 系列保留
        assert 'para.space_before_lines' in attrs
        assert 'para.space_after_lines' in attrs

    def test_page_margin_has_t31_attrs(self):
        # page_margin 追加装订线/页眉距/页脚距/打印模式 4 项
        attrs = applicable_attrs('page_margin')
        assert 'page.margin_gutter_cm' in attrs
        assert 'page.header_offset_cm' in attrs
        assert 'page.footer_offset_cm' in attrs
        assert 'page.print_mode' in attrs
        # 原有 4 个 margin_*_cm 保留
        assert 'page.margin_top_cm' in attrs
        assert 'page.margin_bottom_cm' in attrs
        assert 'page.margin_left_cm' in attrs
        assert 'page.margin_right_cm' in attrs
        # 总计 8 个 attr
        assert len(attrs) == 8

    def test_section_title_not_changed(self):
        # section_title 未被 T3.1 修改（无 spacing attrs，不对称则不追加）
        attrs = applicable_attrs('section_title')
        assert 'para.space_before_pt' not in attrs
        assert 'para.space_after_pt' not in attrs

    def test_subsection_title_not_changed(self):
        # subsection_title 未被 T3.1 修改
        attrs = applicable_attrs('subsection_title')
        assert 'para.space_before_pt' not in attrs
        assert 'para.space_after_pt' not in attrs

    # ─────────────────────────────────────────────
    # T3.2: table.* namespace 4 attr 绑定断言
    # ─────────────────────────────────────────────

    def test_table_header_has_table_namespace_attrs(self):
        # T3.2: table_header 必须含 4 个 table.* attr
        attrs = applicable_attrs('table_header')
        assert 'table.is_three_line' in attrs
        assert 'table.border_top_pt' in attrs
        assert 'table.border_bottom_pt' in attrs
        assert 'table.header_border_pt' in attrs
        # 原有 4 个 font/para attr 保留
        assert 'font.cjk' in attrs
        assert 'font.size_pt' in attrs
        assert 'font.bold' in attrs
        assert 'para.align' in attrs
        # 总数为 8，确保无多余字段
        assert len(attrs) == 8

    def test_table_caption_not_changed_by_t32(self):
        # table_caption 不受 T3.2 影响：线宽属于表格结构，不挂在表题字段
        attrs = applicable_attrs('table_caption')
        assert 'table.is_three_line' not in attrs
        assert 'table.border_top_pt' not in attrs
        assert set(attrs) == {'font.cjk', 'font.size_pt', 'para.align', 'layout.position'}

    def test_table_inner_text_not_changed_by_t32(self):
        # table_inner_text 不受 T3.2 影响
        attrs = applicable_attrs('table_inner_text')
        assert 'table.is_three_line' not in attrs
        assert 'table.border_top_pt' not in attrs
        assert set(attrs) == {'font.cjk', 'font.size_pt'}

    # ─────────────────────────────────────────────
    # T3.3: numbering.* namespace 绑定断言
    # ─────────────────────────────────────────────

    def test_figure_caption_has_numbering_attrs(self):
        # T3.3: figure_caption 追加 numbering.figure_style + numbering.subfigure_style 后共 6 个
        attrs = applicable_attrs('figure_caption')
        assert 'numbering.figure_style' in attrs
        assert 'numbering.subfigure_style' in attrs
        # 原有 4 个 attr 保留
        assert 'font.cjk' in attrs
        assert 'font.size_pt' in attrs
        assert 'para.align' in attrs
        assert 'layout.position' in attrs
        assert len(attrs) == 6

    def test_formula_block_has_formula_style_attr(self):
        # T3.3: formula_block 追加 numbering.formula_style 后共 2 个
        attrs = applicable_attrs('formula_block')
        assert 'numbering.formula_style' in attrs
        # 原有 para.align 保留
        assert 'para.align' in attrs
        assert len(attrs) == 2

    def test_figure_inner_text_not_changed_by_t33(self):
        # figure_inner_text 不受 T3.3 影响（编号约束挂在 caption，不在图内文字）
        attrs = applicable_attrs('figure_inner_text')
        assert 'numbering.figure_style' not in attrs
        assert 'numbering.subfigure_style' not in attrs

    def test_formula_block_applicable_attributes_exact(self):
        # T3.3 后 formula_block 精确白名单：para.align + numbering.formula_style
        attrs = applicable_attrs('formula_block')
        assert set(attrs) == {'para.align', 'numbering.formula_style'}
        assert len(attrs) == 2

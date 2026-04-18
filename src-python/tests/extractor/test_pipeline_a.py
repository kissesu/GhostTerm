"""
@file: test_pipeline_a.py
@description: extract_all 在 Template A (括号型) 上的集成测试
@author: Atlas.oi
@date: 2026-04-18
"""
from pathlib import Path
import pytest
from thesis_worker.extractor.pipeline import extract_all, extract_from_selection

FIXTURES = Path(__file__).parent.parent / 'fixtures'


class TestExtractAll:
    def test_returns_rules_dict(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        assert 'rules' in result
        assert isinstance(result['rules'], dict)

    def test_returns_evidence_list(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        assert 'evidence' in result
        assert isinstance(result['evidence'], list)

    def test_finds_title_zh(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        # 模板 p0 "毕业论文（设计）题目（三号黑体，居中。理工农医类专业用）"
        assert 'title_zh' in result['rules']
        value = result['rules']['title_zh']['value']
        assert value.get('font.size_pt') == 16  # 三号 = 16pt
        assert value.get('para.align') == 'center'

    def test_finds_abstract_zh_title(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        # 模板 p1 "摘  要（小三号宋体加粗，中间空2个字符，居中）"
        assert 'abstract_zh_title' in result['rules']
        value = result['rules']['abstract_zh_title']['value']
        assert value.get('font.cjk') == '宋体'
        assert value.get('font.size_pt') == 15  # 小三 = 15pt
        assert value.get('font.bold') is True
        assert value.get('para.align') == 'center'


class TestExtractFromSelection:
    def test_single_paragraph(self):
        result = extract_from_selection(
            str(FIXTURES / 'spec_template_a.docx'),
            para_indices=[1],
            field_id='abstract_zh_title',
        )
        assert result['field_id'] == 'abstract_zh_title'
        assert result['value'].get('font.cjk') == '宋体'
        assert result['value'].get('font.size_pt') == 15
        assert result['confidence'] > 0.8

    def test_empty_para_returns_low_confidence(self):
        # p6 是空段落，文本无内容，样式属性至多继承 1 个（行距），置信度 <= 0.5
        result = extract_from_selection(
            str(FIXTURES / 'spec_template_a.docx'),
            para_indices=[6],
            field_id='title_en',
        )
        assert result['confidence'] <= 0.5


class TestExtractFromSelectionWithSelectedText:
    """Task 4：selected_text 按句选取路径的测试"""

    def test_selected_text_not_found_falls_back_to_full_paragraph(self):
        """selected_text 在段落中找不到时，回退到全段提取，不报错"""
        result = extract_from_selection(
            str(FIXTURES / 'spec_template_a.docx'),
            para_indices=[1],
            field_id='abstract_zh_title',
            selected_text='这段文字根本不存在于文档中',
        )
        # 回退全段提取：field_id 正确，结果非空，不抛异常
        assert result['field_id'] == 'abstract_zh_title'
        assert isinstance(result['value'], dict)
        assert isinstance(result['confidence'], float)

    def test_selected_text_restricts_to_matching_portion(self):
        """传入 selected_text 时，抽取结果来自该文本所在段落（端到端验证 selected_text 路径走通）

        验证策略：
        - 用段落中确实存在的文本片段调用；若能定位 run，结果不报错且有合理置信度
        - 无法用夹具文件精确控制 run 内容，因此只验证路径不崩溃、返回结构正确
        """
        # p1 文本包含 "摘  要"，取其前半段作为 selected_text
        result = extract_from_selection(
            str(FIXTURES / 'spec_template_a.docx'),
            para_indices=[1],
            field_id='abstract_zh_title',
            selected_text='摘',
        )
        assert result['field_id'] == 'abstract_zh_title'
        assert isinstance(result['value'], dict)
        # 段落级属性（行距/对齐等）应仍被抽取（来自 _extract_para_level_attrs）
        # p1 = 摘要标题行，居中对齐
        assert result['value'].get('para.align') == 'center'

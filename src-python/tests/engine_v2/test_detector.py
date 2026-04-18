"""
@file: test_detector.py
@description: v2 detector 测试：验证字段路由、属性检查、禁用字段跳过逻辑
@author: Atlas.oi
@date: 2026-04-18
"""
from pathlib import Path
from docx import Document
from docx.shared import Pt
from thesis_worker.engine_v2.detector import detect_v2

FIXTURES = Path(__file__).parent.parent / 'fixtures'


def make_doc_with_wrong_title(tmp_path):
    """创建一个标题字体字号错误的测试 docx
    章节标题用 Calibri 14pt，应该是黑体 16pt
    """
    doc = Document()
    p = doc.add_paragraph('研究课题', style='Heading 1')
    p.runs[0].font.name = 'Calibri'
    p.runs[0].font.size = Pt(14)
    path = tmp_path / 'bad_title.docx'
    doc.save(path)
    return path


class TestDetectV2:
    def test_detects_wrong_font(self, tmp_path):
        """chapter_title 字段规则：字号不符应产生 issue"""
        path = make_doc_with_wrong_title(tmp_path)
        template = {
            'rules': {
                'chapter_title': {
                    'enabled': True,
                    'value': {
                        'font.cjk': '黑体',
                        'font.size_pt': 16,
                    },
                },
            },
        }
        issues = detect_v2(str(path), template)
        assert len(issues) >= 1
        codes = [i['attr'] for i in issues]
        assert 'font.size_pt' in codes or 'font.cjk' in codes

    def test_empty_template_returns_empty(self, tmp_path):
        """空规则集不应产生任何 issue"""
        path = make_doc_with_wrong_title(tmp_path)
        issues = detect_v2(str(path), {'rules': {}})
        assert issues == []

    def test_disabled_field_skipped(self, tmp_path):
        """enabled=False 的字段规则必须被跳过，不产生 issue"""
        path = make_doc_with_wrong_title(tmp_path)
        template = {
            'rules': {
                'chapter_title': {
                    'enabled': False,
                    'value': {'font.size_pt': 999},
                },
            },
        }
        issues = detect_v2(str(path), template)
        assert issues == []

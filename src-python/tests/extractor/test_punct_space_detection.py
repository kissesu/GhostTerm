"""
@file: test_punct_space_detection.py
@description: mixed_script.punct_space_after 全文启发式检测测试
@author: Atlas.oi
@date: 2026-04-18
"""
from docx import Document
from thesis_worker.extractor.pipeline import _detect_punct_space_after


def test_all_punct_followed_by_space_returns_true():
    """规范：所有英文标点后都空格 → True"""
    doc = Document()
    doc.add_paragraph('This is fine. Another sentence; semicolon: colon! exclamation? yes.')
    result = _detect_punct_space_after(doc)
    assert result is True


def test_all_punct_no_space_returns_false():
    """全部无空格 → False"""
    doc = Document()
    doc.add_paragraph('Bad.writing;like:this!everywhere?yes.no.end.')
    result = _detect_punct_space_after(doc)
    assert result is False


def test_mixed_majority_space_returns_true():
    """绝大多数有空格（>= 2:1） → True"""
    doc = Document()
    # 4 个有空格 + 1 个无空格 → 4 >= 2*1 → True
    doc.add_paragraph('Word. More. Lots. Also. Oops.no')
    result = _detect_punct_space_after(doc)
    assert result is True


def test_few_punct_returns_none():
    """样本不足 (< 3) → None"""
    doc = Document()
    doc.add_paragraph('Hello world. Bye.')  # 只有 2 个标点匹配到
    result = _detect_punct_space_after(doc)
    assert result is None


def test_no_ascii_punct_returns_none():
    """纯中文无 ASCII 标点 → None"""
    doc = Document()
    doc.add_paragraph('这是一段纯中文内容，不含任何 ASCII 标点。')
    result = _detect_punct_space_after(doc)
    assert result is None

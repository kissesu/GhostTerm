"""
@file: paragraph_indent.py
@description: 检测和修复段首缩进（first_line_indent）
              config 示例：{"first_line_chars": 2, "body_font_size_pt": 12}
              body_font_size_pt 可选，缺省 12pt
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx.document import Document
from docx.shared import Pt, RGBColor

from ..models import Issue, Location, FixResult


# 蓝色标记：Office 标准"蓝色, 个性色 1" = #0070C0
_MARK_COLOR = RGBColor(0x00, 0x70, 0xC0)

# context 预览长度：段落前 N 字符，供用户 Ctrl-F 定位
_CONTEXT_MAX = 30

# snippet 截断长度：取段落文本前 N 字符
_SNIPPET_MAX = 20

# 允许的缩进误差（磅），避免浮点精度导致误报
_TOLERANCE_PT = 1.0

# Heading style 名称集合：标题不应有首行缩进，跳过检查
_HEADING_STYLES = {
    'Heading 1', 'Heading 2', 'Heading 3',
    'Heading 4', 'Heading 5', 'Heading 6',
}


def _make_context(text: str) -> str:
    """段落预览：首尾 strip 后取前 N 字符"""
    stripped = text.strip()
    if len(stripped) <= _CONTEXT_MAX:
        return stripped
    return stripped[:_CONTEXT_MAX] + '…'


def _is_body_paragraph(para) -> bool:
    """非 Heading 段落视为正文段落，需要检查缩进"""
    style_name = para.style.name if para.style else ''
    return style_name not in _HEADING_STYLES


def _check_indent(actual_emu, expected_pt: float) -> bool:
    """
    校验实际缩进是否符合期望。

    业务逻辑：
    - actual_emu 为 None 表示无首行缩进，直接返回 False
    - python-docx Length 对象通过 .pt 属性转磅，与期望值比较
    - 允许 ±_TOLERANCE_PT 的误差，避免浮点与 EMU 取整导致误报
    """
    if actual_emu is None:
        return False
    actual_pt = actual_emu.pt
    return abs(actual_pt - expected_pt) <= _TOLERANCE_PT


class ParagraphIndentRule:
    id = 'paragraph.indent'
    category = 'format'
    severity = 'warning'
    fix_available = True

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        """
        遍历所有正文段落，检查首行缩进是否等于 first_line_chars * body_font_size_pt。

        业务逻辑：
        1. 从 value 读取期望缩进字数和正文字号（缺省 12pt）
        2. value 缺 first_line_chars 时静默跳过
        3. 遍历段落，跳过 Heading 段和空段落
        4. 检查 paragraph_format.first_line_indent，不符则生成 Issue
        5. 一段只生成一个 Issue，loc.run=0
        """
        if 'first_line_chars' not in value:
            return []

        first_line_chars: int = value['first_line_chars']
        body_size_pt: int = value.get('body_font_size_pt', 12)
        expected_pt = first_line_chars * body_size_pt

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            if not _is_body_paragraph(para):
                continue
            if not para.text.strip():
                # 空段落无内容，缩进无意义，跳过
                continue

            actual = para.paragraph_format.first_line_indent
            if _check_indent(actual, expected_pt):
                continue

            # 构造用户可读的 snippet 和 context
            para_text = para.text
            snippet = para_text[:_SNIPPET_MAX] + ('…' if len(para_text) > _SNIPPET_MAX else '')
            context = _make_context(para_text)

            # 实际缩进值：None 表示无缩进，否则转磅
            actual_pt = actual.pt if actual is not None else None

            issues.append(Issue(
                rule_id='paragraph.indent',
                loc=Location(para=p_idx, run=0),
                message=(
                    f'段首缩进不符：当前 {"无" if actual_pt is None else f"{actual_pt:.1f}"} pt，'
                    f'期望 {expected_pt} pt'
                ),
                current={'first_line_indent_pt': actual_pt},
                expected={'first_line_indent_pt': float(expected_pt)},
                fix_available=True,
                snippet=snippet,
                context=context,
            ))
        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        """
        修复指定段落的首行缩进，并蓝色标记第一个 run 提示用户复核。

        业务逻辑：
        1. 按 loc.para 定位目标段落
        2. 计算期望缩进（EMU 单位），写入 paragraph_format
        3. 蓝色标记第一个 run（如存在），提示人工检查
        """
        para = doc.paragraphs[issue.loc.para]

        first_line_chars: int = value['first_line_chars']
        body_size_pt: int = value.get('body_font_size_pt', 12)
        expected_pt = first_line_chars * body_size_pt

        para.paragraph_format.first_line_indent = Pt(expected_pt)

        # 蓝色标记第一个 run，提示用户已修改
        if para.runs:
            para.runs[0].font.color.rgb = _MARK_COLOR

        return FixResult(
            diff=f'- first_line_indent: 旧值\n+ first_line_indent: {expected_pt}pt',
            applied=True,
            xml_changed=[f'w:p[{issue.loc.para}]/w:pPr'],
        )

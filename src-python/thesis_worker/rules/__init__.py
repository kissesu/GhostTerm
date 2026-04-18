"""
@file: __init__.py
@description: 规则注册表 REGISTRY。新增规则只需 import + 注册到字典
@author: Atlas.oi
@date: 2026-04-17
"""
from .base import Rule
from .cjk_ascii_space import CjkAsciiSpaceRule
from .citation_format import CitationFormatRule
from .font_body import FontBodyRule
from .font_h1 import FontH1Rule
from .paragraph_indent import ParagraphIndentRule

REGISTRY: dict[str, type[Rule]] = {
    'cjk_ascii_space': CjkAsciiSpaceRule,
    'citation.format': CitationFormatRule,
    'font.body': FontBodyRule,
    'font.h1': FontH1Rule,
    'paragraph.indent': ParagraphIndentRule,
    # P4 追加其余规则
}

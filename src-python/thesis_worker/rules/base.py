"""
@file: base.py
@description: 规则 Protocol 定义。每条规则都必须有 id/category/severity/detect，
              fix 可选（None 表示只检测不修复）
@author: Atlas.oi
@date: 2026-04-17
"""
from typing import Protocol, Any
from docx.document import Document
from ..models import Issue, FixResult


class Rule(Protocol):
    id: str                    # 'cjk_ascii_space' 等
    category: str              # 'format' | 'citation' | 'structure' | 'writing' | 'ai'
    severity: str              # 'blocker' | 'warning' | 'info'
    fix_available: bool        # 是否支持 fix

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]: ...

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult: ...

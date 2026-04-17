"""
@file: models.py
@description: sidecar 数据模型 dataclasses：Request / Response / Issue / Location / FixResult
              与前端 TypeScript 接口一一对应（snake_case → camelCase 在 Rust 层转换）
@author: Atlas.oi
@date: 2026-04-17
"""
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class Location:
    """问题在 docx 中的位置"""
    para: int
    run: int
    char: Optional[int] = None  # run 内字符偏移，可选


@dataclass
class Issue:
    """一个检测到的问题"""
    rule_id: str
    loc: Location
    message: str
    current: Any          # 实际值（例如 "字体A"）
    expected: Any         # 期望值（例如 "宋体"）
    fix_available: bool
    issue_id: str = ""    # 由 handler 后分配，稳定引用
    evidence_xml: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


@dataclass
class FixResult:
    """一条修复操作的返回"""
    diff: str
    applied: bool
    xml_changed: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

"""
@file: __init__.py
@description: 规则注册表 REGISTRY。新增规则只需 import + 注册到字典
@author: Atlas.oi
@date: 2026-04-17
"""
from .cjk_ascii_space import CjkAsciiSpaceRule

REGISTRY: dict = {
    'cjk_ascii_space': CjkAsciiSpaceRule,
    # P4 追加其余 10 条
}

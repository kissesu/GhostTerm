"""
@file: size.py
@description: 中文字号名 ↔ pt 值映射
              数值参照 GB/T 9851.3 和实际 Word 使用惯例
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Optional

# 字号名 → pt 值（16 项，静态表；T1.2 补 七号/八号）
CHINESE_SIZE_MAP: dict[str, float] = {
    '初号': 42.0,
    '小初': 36.0,
    '一号': 26.0,
    '小一': 24.0,
    '二号': 22.0,
    '小二': 18.0,
    '三号': 16.0,
    '小三': 15.0,
    '四号': 14.0,
    '小四': 12.0,
    '五号': 10.5,
    '小五': 9.0,
    '六号': 7.5,
    '小六': 6.5,
    '七号': 5.5,
    '八号': 5.0,
}

# 反向查找表
_PT_TO_NAME: dict[float, str] = {v: k for k, v in CHINESE_SIZE_MAP.items()}


def name_to_pt(name: str) -> Optional[float]:
    """字号名 → pt 值；不存在返回 None"""
    return CHINESE_SIZE_MAP.get(name)


def pt_to_name(pt: float) -> Optional[str]:
    """pt 值 → 字号名；不存在返回 None"""
    return _PT_TO_NAME.get(float(pt))

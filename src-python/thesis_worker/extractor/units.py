"""
@file: units.py
@description: 长度单位（磅/英寸/厘米/毫米）↔ pt 统一转换。
              规范文档中常以"装订线 0.5 厘米"、"段前 6 磅"等多单位混用，
              抽取器必须把所有长度统一转 pt 存储，与 OOXML 内部口径一致。
              字符（chars）/行（lines）是相对单位，依赖正文字号 / 行距，不在本表，
              由调用方按字段语义分流到 _chars / _lines 兄弟 attr。
@author: Atlas.oi
@date: 2026-04-28
"""
import re
from typing import Optional

# 长度单位 → pt 转换系数
# PostScript 标准：1 inch = 72 pt；1 inch = 2.54 cm；1 inch = 25.4 mm
LENGTH_UNIT_TO_PT: dict[str, float] = {
    'pt': 1.0,
    '磅': 1.0,
    '点': 1.0,
    'in': 72.0,
    'inch': 72.0,
    '英寸': 72.0,
    'cm': 72.0 / 2.54,        # ≈ 28.3464566929
    '厘米': 72.0 / 2.54,
    'mm': 72.0 / 25.4,        # ≈ 2.8346456693
    '毫米': 72.0 / 25.4,
}

# 可识别的所有长度单位（用于正则枚举）；按长度从长到短排序避免短前缀吞掉长后缀（"英寸" 在 "in" 前）
# ASCII 短单位（inch/in/cm/mm/pt）必须加词界保护，避免在英文上下文中误匹配：
#   - '1 input'        前导英文 input 内 'in' 误匹配 (1, 'in')   → (?<![A-Za-z]) 阻止
#   - '1cmm'           尾随英文 m，cm 多吞 m → 紧贴 (1, 'cm') 误匹配 → (?![A-Za-z]) 阻止
#   - 'click 1 in form' 介词 in 后跟英文小写单词 → 非长度单位语境 → (?![\s　]+[a-z]) 阻止
# 中文单位（磅/点/英寸/厘米/毫米）无英文歧义，保留原写法
# inch 必须排在 in 前，否则 'inch' 会被识别为 'in' + 'ch'
_LENGTH_UNIT_PATTERN = r'(?:磅|点|英寸|厘米|毫米|(?<![A-Za-z])(?:inch|in|cm|mm|pt)(?![A-Za-z])(?![\s　]+[a-z]))'

# 抓取 "数值 + 长度单位" 的通用正则；含全角空格 [\s　] 容忍中文模板
_LENGTH_VALUE_RE = re.compile(
    rf'(\d+(?:\.\d+)?)[\s　]*({_LENGTH_UNIT_PATTERN})',
    re.IGNORECASE,
)


def length_to_pt(value: float, unit: str) -> Optional[float]:
    """长度数值 + 单位 → pt；未知单位返回 None。

    @param value 数值
    @param unit  单位字符串（'磅'/'cm'/'mm'/...）
    @returns pt 值；若 unit 不在 LENGTH_UNIT_TO_PT 中返回 None
    """
    factor = LENGTH_UNIT_TO_PT.get(unit)
    if factor is None:
        return None
    return value * factor


def extract_length_with_unit(text: str) -> Optional[tuple[float, str]]:
    """从文本里抽第一个 "数值 + 长度单位" 模式。

    @param text 任意文本
    @returns (value, unit) 或 None；unit 保留原始字符串供调用方分流
    @example
        extract_length_with_unit('段前 6 磅')   → (6.0, '磅')
        extract_length_with_unit('上边距 1.5 厘米') → (1.5, '厘米')
        extract_length_with_unit('居中对齐')    → None
    """
    m = _LENGTH_VALUE_RE.search(text)
    if not m:
        return None
    return float(m.group(1)), m.group(2)

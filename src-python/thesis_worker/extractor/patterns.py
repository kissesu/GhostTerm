"""
@file: patterns.py
@description: 正则 pattern 库，抽取规范文档里的字号/字体/样式说明
              覆盖两种主流风格：
              - A 型括号：「字段（小三号宋体加粗，居中）」
              - B 型叙述：「"摘要"二字为黑体小四号」
@author: Atlas.oi
@date: 2026-04-18
"""
import re
from typing import Optional

from ..utils.size import CHINESE_SIZE_MAP

# ============================================================
# 字号名正则构建
# 注意：CHINESE_SIZE_MAP 中 "小三" 和 "三号" 均为 2 字键，
# 若按原始顺序生成 alternation，"三号" 会先于 "小三" 匹配
# "小三号宋体" 中位置1的 "三号"，导致结果错误。
# 解决方案：将所有 "小*" 系前缀键排在对应基础键之前，
# 保证最长/最具体的模式优先匹配。
# ============================================================

def _build_size_name_pattern() -> re.Pattern:
    """
    构建字号名正则。
    排序规则：带"小"前缀的键优先，确保"小三号"先匹配"小三"而非"三号"。
    """
    keys = list(CHINESE_SIZE_MAP.keys())
    # 按"小"前缀优先、再按键名长度降序排列
    # 所有键均为 2 字，但"小*"比无前缀的"X号"更具体（因为"小三号"中包含"三号"子串）
    sorted_keys = sorted(keys, key=lambda k: (0 if k.startswith('小') else 1, -len(k)))
    pattern = r'(' + '|'.join(re.escape(k) for k in sorted_keys) + r')(?:号)?'
    return re.compile(pattern)

_SIZE_NAME_RE: re.Pattern = _build_size_name_pattern()

# 共享长度单位正则模式（与 units.py 同步）；按长度从长到短避免短前缀吞掉长后缀
# inch 必须排在 in 前，否则 'inch' 会被识别为 'in' + 'ch'
_LENGTH_UNIT_PATTERN = r'(?:磅|pt|点|英寸|inch|in|厘米|cm|毫米|mm)'

# 纯数字 pt 字号：匹配 "12pt" / "15 磅" / "10.5pt"
_SIZE_PT_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(?:pt|磅|点)', re.IGNORECASE)

# A 型括号说明：匹配 "字段名（括号内描述）"
# 使用中文全角括号 （ ）
# 括号内容 {3,200}：上限防误匹配正文括号；下限 3 同时过滤只有字体名无字号的极短括号
# （如「宋体」2字），这是有意设计，不是 bug
_PARENS_RE = re.compile(r'([^（）\n]{1,40})（([^（）\n]{3,200})）')

# 设计决策：open/close 字符类独立匹配，不强制同类型配对（如 "xxx」 也接受）。
# 真实规范文档混用引号概率极低，强制配对会让复杂度不成比例上升
# B 型引号字段：匹配 "xxx"为... / "xxx"为... / 「xxx」为...
# 支持 ASCII 双引号、中文弯引号（U+201C/U+201D）、ASCII 单引号、
# 中文弯单引号（U+2018/U+2019）、日文角括号（U+300C/U+300D）
# 使用 Unicode 转义构建字符类，避免混合引号导致的字符串语法问题
_OPEN_QUOTES_CLASS = (
    r'['
    r'"'          # ASCII 双引号 U+0022
    r'\u201C'     # 中文左双引号 "
    r"'"          # ASCII 单引号 U+0027
    r'\u2018'     # 中文左单引号 '
    r'\u300C'     # 日文左角括号 「
    r']'
)
_CLOSE_QUOTES_CLASS = (
    r'['
    r'"'          # ASCII 双引号 U+0022
    r'\u201D'     # 中文右双引号 "
    r"'"          # ASCII 单引号 U+0027
    r'\u2019'     # 中文右单引号 '
    r'\u300D'     # 日文右角括号 」
    r']'
)
_QUOTED_RE = re.compile(
    _OPEN_QUOTES_CLASS
    + r'([^"\'"\u201C\u201D\u2018\u2019\u300C\u300D\n]{1,20})'
    + _CLOSE_QUOTES_CLASS
    + r'(\s*(?:二字|三字|四字|字)?(?:为|是)?\s*)'
    + r'(.{0,100})'
)


def extract_size_name(text: str) -> Optional[str]:
    """从文本里找到第一个字号名（如"小三"/"三号"）
    返回字号名（不带"号"后缀，与 CHINESE_SIZE_MAP 键对齐）或 None
    """
    match = _SIZE_NAME_RE.search(text)
    if not match:
        return None
    return match.group(1)


def extract_size_pt_raw(text: str) -> Optional[float]:
    """从文本里找到 pt/磅 数字字号，返回 float 或 None"""
    match = _SIZE_PT_RE.search(text)
    if not match:
        return None
    return float(match.group(1))


def find_parens_annotation(text: str) -> Optional[tuple[str, str]]:
    """
    找 A 型括号说明，返回 (字段名, 括号内说明) 或 None。

    仅当括号内容包含字号或字体/排版关键词时才视为格式说明，
    避免把普通补充说明误判为格式规范。
    """
    match = _PARENS_RE.search(text)
    if not match:
        return None
    field_name = match.group(1)
    annotation = match.group(2)
    # 括号内须含字号或字体/排版关键词才算格式说明
    has_format_hint = (
        extract_size_name(annotation) is not None
        or extract_size_pt_raw(annotation) is not None
        or any(keyword in annotation for keyword in ['体', '粗', '居中', '对齐', '缩进'])
    )
    if not has_format_hint:
        return None
    return (field_name, annotation)


def find_quoted_field(text: str) -> Optional[tuple[str, str]]:
    """找 B 型引号字段描述，返回 (字段名, 描述文本) 或 None"""
    match = _QUOTED_RE.search(text)
    if not match:
        return None
    field_name = match.group(1)
    rest = match.group(3)
    return (field_name, rest)

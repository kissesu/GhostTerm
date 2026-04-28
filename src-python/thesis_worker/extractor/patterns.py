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
# ASCII 短单位（inch/in/cm/mm/pt）加 (?<![A-Za-z]) / (?![A-Za-z]) / (?![\s　]+[a-z]) 三层词界保护，
# 避免在英文上下文（'1 input' / '1cmm' / 'click 1 in form'）误匹配
_LENGTH_UNIT_PATTERN = r'(?:磅|点|英寸|厘米|毫米|(?<![A-Za-z])(?:inch|in|cm|mm|pt)(?![A-Za-z])(?![\s　]+[a-z]))'

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


# ============================================================
# T3.1: 段前/段后多单位自然语言抽取
# 单位枚举：行 + 5 种长度单位（与 _LENGTH_UNIT_PATTERN 对齐）
# 全角空格 U+3000 必须显式纳入，覆盖"段前　6　磅"式中文排版
# ============================================================

# 段前/段后单位枚举：行 + 5 种长度单位
# ASCII 短单位加词界保护，与 _LENGTH_UNIT_PATTERN 同口径
_PARA_SPACING_UNITS = r'(?:行|磅|点|英寸|厘米|毫米|(?<![A-Za-z])(?:inch|in|cm|mm|pt)(?![A-Za-z])(?![\s　]+[a-z]))'
_RE_PARA_SPACING = re.compile(
    r'(段前|段后)[\s　]*(\d+(?:\.\d+)?)[\s　]*(' + _PARA_SPACING_UNITS + r')',
    re.IGNORECASE,
)


def extract_para_spacing(text: str) -> Optional[tuple[str, float]]:
    """从文本里抽段前/段后值 → (sink_attr_key, pt_or_lines_value)。

    业务逻辑：
    1. 正则识别 "段前"/"段后" + 数值 + 单位
    2. 单位为"行" → 走 _lines 兄弟 attr（值保留原始数）
    3. 单位为长度（磅/cm/mm/in/pt）→ 转 pt 走 _pt 兄弟 attr

    @example
        extract_para_spacing('段前 6 磅')   → ('para.space_before_pt', 6.0)
        extract_para_spacing('段前 1 行')   → ('para.space_before_lines', 1.0)
        extract_para_spacing('段后 0.5 厘米') → ('para.space_after_pt', 14.17)
    """
    from .units import length_to_pt
    m = _RE_PARA_SPACING.search(text)
    if not m:
        return None
    prefix = m.group(1)  # '段前' / '段后'
    val = float(m.group(2))
    unit = m.group(3)

    suffix = 'before' if prefix == '段前' else 'after'

    if unit == '行':
        return (f'para.space_{suffix}_lines', val)

    pt = length_to_pt(val, unit)
    if pt is None:
        return None
    return (f'para.space_{suffix}_pt', round(pt, 2))


# ============================================================
# T3.2: 首行/悬挂缩进多单位自然语言抽取
# 单位枚举：字符 + 5 种长度单位（无"行"，缩进不以行为单位）
# 全角空格 U+3000 必须显式纳入，覆盖中文排版式空格
# ============================================================

# 缩进单位：字符 + 5 长度单位（无"行"）
# ASCII 短单位加词界保护，与 _LENGTH_UNIT_PATTERN 同口径
_INDENT_UNITS = r'(?:字符|磅|点|英寸|厘米|毫米|(?<![A-Za-z])(?:inch|in|cm|mm|pt)(?![A-Za-z])(?![\s　]+[a-z]))'
_RE_INDENT = re.compile(
    r'(首行缩进|悬挂缩进)[\s　]*(\d+(?:\.\d+)?)[\s　]*(' + _INDENT_UNITS + r')',
    re.IGNORECASE,
)


def extract_indent(text: str) -> Optional[tuple[str, float]]:
    """抽首行/悬挂缩进值 → (sink_attr_key, chars_or_pt_value)。

    业务逻辑：
    1. 正则识别 "首行缩进"/"悬挂缩进" + 数值 + 单位
    2. 单位"字符" → _chars 兄弟 attr
    3. 长度单位 → _pt 兄弟 attr（转 pt）

    @example
        extract_indent('首行缩进 2 字符')   → ('para.first_line_indent_chars', 2.0)
        extract_indent('悬挂缩进 14 磅')    → ('para.hanging_indent_pt', 14.0)
        extract_indent('首行缩进 0.74 厘米') → ('para.first_line_indent_pt', 20.97)
    """
    from .units import length_to_pt
    m = _RE_INDENT.search(text)
    if not m:
        return None
    kind = m.group(1)  # '首行缩进' / '悬挂缩进'
    val = float(m.group(2))
    unit = m.group(3)

    prefix = 'first_line' if kind == '首行缩进' else 'hanging'

    if unit == '字符':
        return (f'para.{prefix}_indent_chars', val)

    pt = length_to_pt(val, unit)
    if pt is None:
        return None
    return (f'para.{prefix}_indent_pt', round(pt, 2))


# ============================================================
# T3.3: 行距 6 类型识别
# WPS/Word 行距共 6 种：单倍/1.5倍/2倍/最小值/固定值/多倍
# 类型 + 值是绑定语义对，必须返回多 attr dict 同时给出
# ============================================================

# 行距类型识别正则（按从精确到模糊顺序）
# 全角空格 U+3000 显式纳入，覆盖中文排版式空格
_RE_LS_AT_LEAST = re.compile(r'最小值[\s　]*(\d+(?:\.\d+)?)[\s　]*磅?', re.IGNORECASE)
_RE_LS_EXACTLY = re.compile(r'固定值[\s　]*(\d+(?:\.\d+)?)[\s　]*磅?', re.IGNORECASE)
_RE_LS_ONE_AND_HALF = re.compile(r'1[\s　]*\.[\s　]*5[\s　]*倍行距', re.IGNORECASE)
# 负向 lookbehind：避免在 "1.5 倍行距" 或 "12 倍行距" 中错误匹配 "2"
_RE_LS_DOUBLE = re.compile(r'(?<![1-9\.])2[\s　]*倍行距', re.IGNORECASE)
_RE_LS_MULTIPLE = re.compile(r'多倍行距[\s　]*(\d+(?:\.\d+)?)', re.IGNORECASE)


def extract_line_spacing(text: str) -> Optional[dict]:
    """识别 6 种行距类型。

    业务逻辑（按精确度降序匹配）：
    1. 最小值/固定值 N 磅 → atLeast/exactly + line_spacing_pt
    2. 1.5 倍行距 → oneAndHalf + line_spacing=1.5
    3. 2 倍行距 → double + line_spacing=2.0
    4. 多倍行距 N → multiple + line_spacing=N
    5. 单倍行距 → single + line_spacing=1.0
    6. 都不命中 → None

    返回多 attr dict，因为类型 + 值是绑定的语义对，
    必须同时给出才能完整表达"固定值 28 磅"这类规范。

    @example
        extract_line_spacing('单倍行距')
            → {'para.line_spacing_type': 'single', 'para.line_spacing': 1.0}
        extract_line_spacing('固定值 28 磅')
            → {'para.line_spacing_type': 'exactly', 'para.line_spacing_pt': 28.0}
        extract_line_spacing('多倍行距 2.5')
            → {'para.line_spacing_type': 'multiple', 'para.line_spacing': 2.5}
    """
    if m := _RE_LS_AT_LEAST.search(text):
        return {'para.line_spacing_type': 'atLeast', 'para.line_spacing_pt': float(m.group(1))}
    if m := _RE_LS_EXACTLY.search(text):
        return {'para.line_spacing_type': 'exactly', 'para.line_spacing_pt': float(m.group(1))}
    if _RE_LS_ONE_AND_HALF.search(text):
        return {'para.line_spacing_type': 'oneAndHalf', 'para.line_spacing': 1.5}
    if _RE_LS_DOUBLE.search(text):
        return {'para.line_spacing_type': 'double', 'para.line_spacing': 2.0}
    if m := _RE_LS_MULTIPLE.search(text):
        return {'para.line_spacing_type': 'multiple', 'para.line_spacing': float(m.group(1))}
    if '单倍行距' in text:
        return {'para.line_spacing_type': 'single', 'para.line_spacing': 1.0}
    return None


# ============================================================
# T3.4a: 字符间距多单位
# 单位：字符 + 4 长度单位（无"行"）
# 与缩进类似，但 sink 走 letter_spacing 而非 first_line/hanging
# ============================================================

# 字符间距单位：字符 + 4 长度单位（无"行"）
# ASCII 短单位加词界保护，与 _LENGTH_UNIT_PATTERN 同口径
_LS_UNITS = r'(?:字符|磅|点|英寸|厘米|毫米|(?<![A-Za-z])(?:inch|in|cm|mm|pt)(?![A-Za-z])(?![\s　]+[a-z]))'
_RE_LETTER_SPACING = re.compile(
    r'字符?间距[^\d]*?(\d+(?:\.\d+)?)[\s　]*(' + _LS_UNITS + r')',
    re.IGNORECASE,
)


def extract_letter_spacing(text: str) -> Optional[tuple[str, float]]:
    """抽字符间距 → (sink_attr_key, value)。

    @example
        extract_letter_spacing('字符间距 加宽 1 磅') → ('para.letter_spacing_pt', 1.0)
        extract_letter_spacing('字符间距 2 字符')    → ('para.letter_spacing_chars', 2.0)
    """
    from .units import length_to_pt
    m = _RE_LETTER_SPACING.search(text)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2)
    if unit == '字符':
        return ('para.letter_spacing_chars', val)
    pt = length_to_pt(val, unit)
    if pt is None:
        return None
    return ('para.letter_spacing_pt', round(pt, 2))


# ============================================================
# T3.4b: 表线规范关键词抽取
# 三线表 / 上下表线 / 表头下线 三类关键词
# 上下表线一次设两 attr（顶+底），表头下线设独立 attr
# ============================================================

# 表线规范关键词正则
_RE_TABLE_THREE_LINE = re.compile(r'三线表', re.IGNORECASE)
_RE_TABLE_TOP_BOTTOM = re.compile(r'上下表线[\s　]*(\d+(?:\.\d+)?)[\s　]*磅', re.IGNORECASE)
_RE_TABLE_HEADER_LINE = re.compile(r'表头下线[\s　]*(\d+(?:\.\d+)?)[\s　]*磅', re.IGNORECASE)


def extract_table_borders_text(text: str) -> dict:
    """抽表格规范关键词与线宽。

    返回的字典含已识别的 attr；无任何关键词时返回 {}。

    @example
        extract_table_borders_text('三线表，上下表线 1.5 磅，表头下线 0.5 磅')
          → {'table.is_three_line': True, 'table.border_top_pt': 1.5, 'table.border_bottom_pt': 1.5, 'table.header_border_pt': 0.5}
    """
    out: dict = {}
    if _RE_TABLE_THREE_LINE.search(text):
        out['table.is_three_line'] = True
    if m := _RE_TABLE_TOP_BOTTOM.search(text):
        val = float(m.group(1))
        out['table.border_top_pt'] = val
        out['table.border_bottom_pt'] = val
    if m := _RE_TABLE_HEADER_LINE.search(text):
        out['table.header_border_pt'] = float(m.group(1))
    return out

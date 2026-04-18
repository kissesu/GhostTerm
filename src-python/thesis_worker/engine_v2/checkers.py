"""
@file: checkers.py
@description: 属性 key → checker 函数映射
              每个 checker 接收段落对象（或 Document 对象）和期望值，
              返回 None（符合规范）或 dict（违规描述）。
              分三类：
                A — 段落级 (para, expected) -> Optional[dict]
                B — 文档级 (doc, expected) -> Optional[dict]
                C — 延后存根，暂不支持，固定返回 None
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any, Optional

from docx.document import Document
from docx.text.paragraph import Paragraph

# ───────────────────────────────────────────────
# 内部工具函数
# ───────────────────────────────────────────────

# OOXML 命名空间 — Word 主命名空间 URI
_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def _w(tag: str) -> str:
    """生成带命名空间的 OOXML 标签，避免反复拼接字符串"""
    return f'{{{_W_NS}}}{tag}'


def _first_nonempty_run(para: Paragraph):
    """返回段落第一个有可见文字的 run；没有则返回 None"""
    for run in para.runs:
        if run.text.strip():
            return run
    return None


def _read_cjk_font(para: Paragraph) -> Optional[str]:
    """读段落第一个非空 run 的 eastAsia 字体名（中文字体）"""
    run = _first_nonempty_run(para)
    if run is None:
        return None
    rpr = run._element.rPr
    if rpr is None:
        return None
    rfonts = rpr.find(_w('rFonts'))
    if rfonts is None:
        return None
    return rfonts.get(_w('eastAsia'))


def _read_ascii_font(para: Paragraph) -> Optional[str]:
    """读段落第一个非空 run 的 ASCII/西文字体名"""
    run = _first_nonempty_run(para)
    if run is None:
        return None
    # python-docx 的 run.font.name 读的是 w:ascii 属性
    name = run.font.name
    if name:
        return name
    # 兜底：直接读 XML
    rpr = run._element.rPr
    if rpr is None:
        return None
    rfonts = rpr.find(_w('rFonts'))
    if rfonts is None:
        return None
    return rfonts.get(_w('ascii'))


# ───────────────────────────────────────────────
# 类别 A：段落级 checker
# ───────────────────────────────────────────────

def check_font_cjk(para: Paragraph, expected: str) -> Optional[dict]:
    """检查段落中文字体（eastAsia）是否符合预期"""
    actual = _read_cjk_font(para)
    if actual == expected:
        return None
    return {'attr': 'font.cjk', 'actual': actual, 'expected': expected}


def check_font_ascii(para: Paragraph, expected: str) -> Optional[dict]:
    """检查段落西文/ASCII 字体是否符合预期"""
    actual = _read_ascii_font(para)
    if actual == expected:
        return None
    return {'attr': 'font.ascii', 'actual': actual, 'expected': expected}


def check_font_size_pt(para: Paragraph, expected: float) -> Optional[dict]:
    """检查段落字号（pt），容差 0.1pt，取第一个非空 run"""
    run = _first_nonempty_run(para)
    if run is None:
        return None
    if run.font.size is None:
        return {'attr': 'font.size_pt', 'actual': None, 'expected': expected}
    actual = float(run.font.size.pt)
    if abs(actual - expected) < 0.1:
        return None
    return {'attr': 'font.size_pt', 'actual': actual, 'expected': expected}


def check_font_bold(para: Paragraph, expected: bool) -> Optional[dict]:
    """检查段落第一个非空 run 是否加粗；None 视为 False"""
    run = _first_nonempty_run(para)
    if run is None:
        return None
    actual = bool(run.font.bold)
    if actual == expected:
        return None
    return {'attr': 'font.bold', 'actual': actual, 'expected': expected}


def check_font_italic(para: Paragraph, expected: bool) -> Optional[dict]:
    """检查段落第一个非空 run 是否斜体；None 视为 False"""
    run = _first_nonempty_run(para)
    if run is None:
        return None
    # run.font.italic 三值：None / True / False，None 视为 False
    actual = bool(run.font.italic)
    if actual == expected:
        return None
    return {'attr': 'font.italic', 'actual': actual, 'expected': expected}


def check_para_align(para: Paragraph, expected: str) -> Optional[dict]:
    """检查段落对齐方式；expected: 'left'/'center'/'right'/'justify'"""
    # python-docx WD_ALIGN_PARAGRAPH 枚举值：LEFT=0,CENTER=1,RIGHT=2,JUSTIFY=3
    align_map = {0: 'left', 1: 'center', 2: 'right', 3: 'justify'}
    val = para.paragraph_format.alignment
    actual = align_map.get(int(val), 'left') if val is not None else 'left'
    if actual == expected:
        return None
    return {'attr': 'para.align', 'actual': actual, 'expected': expected}


def check_para_first_line_indent_chars(
    para: Paragraph,
    expected: int,
    body_size_pt: float = 12,
) -> Optional[dict]:
    """
    检查首行缩进字符数；body_size_pt 用于将 pt 换算为字符数（默认 12pt）。
    first_line_indent > 0 为首行缩进；< 0 为悬挂缩进（不属于本检查器）。
    """
    fli = para.paragraph_format.first_line_indent
    if fli is None:
        actual_chars = 0
    else:
        # 四舍五入：1 个字宽 = body_size_pt pt
        actual_chars = round(fli.pt / body_size_pt)
    if actual_chars == expected:
        return None
    return {'attr': 'para.first_line_indent_chars', 'actual': actual_chars, 'expected': expected}


def check_para_hanging_indent_chars(
    para: Paragraph,
    expected: int,
    body_size_pt: float = 12,
) -> Optional[dict]:
    """
    检查悬挂缩进字符数（参考文献条目）。
    python-docx 用 first_line_indent < 0 表示悬挂缩进，abs 后换算为字符数。
    """
    fli = para.paragraph_format.first_line_indent
    if fli is None:
        actual_chars = 0
    elif fli.pt >= 0:
        # 首行缩进而非悬挂缩进，字符数记为 0
        actual_chars = 0
    else:
        actual_chars = round(abs(fli.pt) / body_size_pt)
    if actual_chars == expected:
        return None
    return {'attr': 'para.hanging_indent_chars', 'actual': actual_chars, 'expected': expected}


def check_para_line_spacing(para: Paragraph, expected: float) -> Optional[dict]:
    """
    检查行距倍数（如 1.5、2.0）。
    line_spacing 为 None 时视为 1.0（单倍）；容差 0.05。
    """
    ls = para.paragraph_format.line_spacing
    if ls is None:
        actual = 1.0
    else:
        # line_spacing 可能是 float（倍数）也可能是 Length（固定值，单位 emu）
        # 若为 Length 对象则取 pt 值再除以字号 12 近似换算
        try:
            actual = float(ls)
        except (TypeError, AttributeError):
            actual = 1.0
    if abs(actual - expected) < 0.05:
        return None
    return {'attr': 'para.line_spacing', 'actual': actual, 'expected': expected}


def check_para_space_before_lines(
    para: Paragraph,
    expected: int,
    body_size_pt: float = 12,
) -> Optional[dict]:
    """检查段前间距（行数）；space_before 为 None 时视为 0"""
    sb = para.paragraph_format.space_before
    if sb is None:
        actual = 0
    else:
        actual = round(sb.pt / body_size_pt)
    if actual == expected:
        return None
    return {'attr': 'para.space_before_lines', 'actual': actual, 'expected': expected}


def check_para_space_after_lines(
    para: Paragraph,
    expected: int,
    body_size_pt: float = 12,
) -> Optional[dict]:
    """检查段后间距（行数）；space_after 为 None 时视为 0"""
    sa = para.paragraph_format.space_after
    if sa is None:
        actual = 0
    else:
        actual = round(sa.pt / body_size_pt)
    if actual == expected:
        return None
    return {'attr': 'para.space_after_lines', 'actual': actual, 'expected': expected}


def check_para_letter_spacing_chars(
    para: Paragraph,
    expected: int,
    body_size_pt: float = 12,
) -> Optional[dict]:
    """
    检查字符间距（字符数）。
    OOXML w:spacing 在 run 的 rPr 中，单位为"二十分之一磅"（1/20 pt）。
    换算：actual_chars = round(spacing_pt / body_size_pt)。
    """
    run = _first_nonempty_run(para)
    if run is None:
        return None
    rpr = run._element.rPr
    if rpr is None:
        spacing_pt = 0.0
    else:
        spacing_el = rpr.find(_w('spacing'))
        if spacing_el is None:
            spacing_pt = 0.0
        else:
            val = spacing_el.get(_w('val'))
            # val 单位：twip (1/20 pt)
            spacing_pt = int(val) / 20.0 if val is not None else 0.0
    actual = round(spacing_pt / body_size_pt)
    if actual == expected:
        return None
    return {'attr': 'para.letter_spacing_chars', 'actual': actual, 'expected': expected}


def check_page_new_page_before(para: Paragraph, expected: bool) -> Optional[dict]:
    """检查段前分页（一级标题/参考文献/致谢等需要另起一页）"""
    val = para.paragraph_format.page_break_before
    # python-docx 返回 None/True/False，None 视为 False
    actual = bool(val)
    if actual == expected:
        return None
    return {'attr': 'page.new_page_before', 'actual': actual, 'expected': expected}


# page_break_after 不在 python-docx ParagraphFormat API 中，
# 需要直接读 XML pPr/pageBreakAfter 元素（deferred to v3，实际不在 spec）


def check_content_max_chars(para: Paragraph, expected: int) -> Optional[dict]:
    """检查段落字符总数不超过上限（适用于中文题目等）"""
    actual = len(para.text)
    if actual <= expected:
        return None
    return {'attr': 'content.max_chars', 'actual': actual, 'expected': expected}


def check_content_char_count_min(para: Paragraph, expected: int) -> Optional[dict]:
    """检查段落字符数不少于下限（适用于摘要正文最少字数）"""
    actual = len(para.text)
    if actual >= expected:
        return None
    return {'attr': 'content.char_count_min', 'actual': actual, 'expected': expected}


def check_content_char_count_max(para: Paragraph, expected: int) -> Optional[dict]:
    """检查段落字符数不超过上限（适用于摘要正文最多字数）"""
    actual = len(para.text)
    if actual <= expected:
        return None
    return {'attr': 'content.char_count_max', 'actual': actual, 'expected': expected}


def check_content_item_count_min(
    para: Paragraph,
    expected: int,
    separator: str = '；',
) -> Optional[dict]:
    """
    检查段落以分隔符划分的条目数不少于下限（如关键词至少 3 个）。
    默认分隔符为中文分号。
    """
    actual = len(para.text.split(separator))
    if actual >= expected:
        return None
    return {'attr': 'content.item_count_min', 'actual': actual, 'expected': expected}


def check_content_item_count_max(
    para: Paragraph,
    expected: int,
    separator: str = '；',
) -> Optional[dict]:
    """检查段落条目数不超过上限（如关键词最多 8 个）"""
    actual = len(para.text.split(separator))
    if actual <= expected:
        return None
    return {'attr': 'content.item_count_max', 'actual': actual, 'expected': expected}


def check_content_item_separator(para: Paragraph, expected: str) -> Optional[dict]:
    """检查段落内是否使用了规定的分隔符（如中文分号）"""
    if expected in para.text:
        return None
    return {'attr': 'content.item_separator', 'actual': None, 'expected': expected}


def check_content_specific_text(para: Paragraph, expected: str) -> Optional[dict]:
    """检查段落是否包含特定文本（如「摘要」、「关键词：」等固定标题词）"""
    if expected in para.text:
        return None
    return {'attr': 'content.specific_text', 'actual': para.text, 'expected': expected}


# ───────────────────────────────────────────────
# 类别 B：文档级 checker（接收 docx.Document）
# ───────────────────────────────────────────────

# A4 页面尺寸（英寸），容差 0.05 英寸
_PAGE_SIZES = {
    'A4':     (8.27, 11.69),
    'Letter': (8.50, 11.00),
}


def check_page_size(doc: Document, expected: str) -> Optional[dict]:
    """
    检查页面大小是否符合预期（'A4' 或 'Letter'）。
    通过 sections[0] 的宽高（英寸）与已知规格比对，容差 0.05 英寸。
    """
    section = doc.sections[0]
    w_in = section.page_width.inches
    h_in = section.page_height.inches
    for name, (sw, sh) in _PAGE_SIZES.items():
        if abs(w_in - sw) < 0.05 and abs(h_in - sh) < 0.05:
            actual = name
            break
    else:
        actual = f'{w_in:.2f}x{h_in:.2f}in'
    if actual == expected:
        return None
    return {'attr': 'page.size', 'actual': actual, 'expected': expected}


def check_page_margin_top_cm(doc: Document, expected: float) -> Optional[dict]:
    """检查页面上边距（cm），容差 0.05cm"""
    actual = doc.sections[0].top_margin.cm
    if abs(actual - expected) < 0.05:
        return None
    return {'attr': 'page.margin_top_cm', 'actual': round(actual, 2), 'expected': expected}


def check_page_margin_bottom_cm(doc: Document, expected: float) -> Optional[dict]:
    """检查页面下边距（cm），容差 0.05cm"""
    actual = doc.sections[0].bottom_margin.cm
    if abs(actual - expected) < 0.05:
        return None
    return {'attr': 'page.margin_bottom_cm', 'actual': round(actual, 2), 'expected': expected}


def check_page_margin_left_cm(doc: Document, expected: float) -> Optional[dict]:
    """检查页面左边距（cm），容差 0.05cm"""
    actual = doc.sections[0].left_margin.cm
    if abs(actual - expected) < 0.05:
        return None
    return {'attr': 'page.margin_left_cm', 'actual': round(actual, 2), 'expected': expected}


def check_page_margin_right_cm(doc: Document, expected: float) -> Optional[dict]:
    """检查页面右边距（cm），容差 0.05cm"""
    actual = doc.sections[0].right_margin.cm
    if abs(actual - expected) < 0.05:
        return None
    return {'attr': 'page.margin_right_cm', 'actual': round(actual, 2), 'expected': expected}


def check_mixed_script_ascii_is_tnr(doc: Document, expected: bool) -> Optional[dict]:
    """
    检查文档西文/数字字体是否全局使用 Times New Roman（TNR）。
    遍历正文段落 run，统计 ASCII 字体名，多数为 TNR 则视为满足。
    [延后 v3：当前仅做简单多数决；未来接入精确 field 过滤]
    """
    tnr_count = 0
    total_count = 0
    for para in doc.paragraphs:
        for run in para.runs:
            if not run.text.strip():
                continue
            name = run.font.name
            if name is None:
                continue
            total_count += 1
            if 'Times New Roman' in name or name.lower() == 'tnr':
                tnr_count += 1
    if total_count == 0:
        # 文档无有效 run，无法判断，视为符合
        return None
    actual = (tnr_count / total_count) >= 0.5
    if actual == expected:
        return None
    return {'attr': 'mixed_script.ascii_is_tnr', 'actual': actual, 'expected': expected}


# ───────────────────────────────────────────────
# 类别 C：延后存根（deferred to v3）
# ───────────────────────────────────────────────

def check_layout_position(para: Paragraph, expected: str) -> None:
    """
    [延后 v3] 检查图题/表题位置（'above'/'below'）。
    需要解析段落与图/表的相对位置关系，当前能力范围之外，固定返回 None（不评判）。
    """
    return None


def check_citation_style(para: Paragraph, expected: str) -> None:
    """
    [延后 v3] 检查参考文献条目是否符合 GB/T 7714 格式。
    需要复杂正则 + 格式解析，当前固定返回 None（不评判）。
    """
    return None


def check_pagination_front_style(doc: Document, expected: str) -> None:
    """
    [延后 v3] 检查前置页码样式（'roman' 罗马数字 / 'arabic' 阿拉伯数字）。
    需要读取 section 的页码格式 XML，当前固定返回 None（不评判）。
    """
    return None


def check_pagination_body_style(doc: Document, expected: str) -> None:
    """
    [延后 v3] 检查正文页码样式（'arabic' 阿拉伯数字）。
    同 check_pagination_front_style，固定返回 None（不评判）。
    """
    return None


# ───────────────────────────────────────────────
# CHECKER_MAP：属性 key → checker 函数
# ───────────────────────────────────────────────
# 段落级函数签名：(para: Paragraph, expected) -> Optional[dict]
# 文档级函数签名：(doc: Document, expected) -> Optional[dict]
# detector (Task 10) 需要区分两类，约定：
#   - DOC_LEVEL_KEYS 中列出的 key 用文档级调用
#   - 其余均为段落级调用

CHECKER_MAP: dict[str, Any] = {
    # font 字体
    'font.cjk':                       check_font_cjk,
    'font.ascii':                      check_font_ascii,
    'font.size_pt':                    check_font_size_pt,
    'font.bold':                       check_font_bold,
    'font.italic':                     check_font_italic,
    # para 段落格式
    'para.align':                      check_para_align,
    'para.first_line_indent_chars':    check_para_first_line_indent_chars,
    'para.hanging_indent_chars':       check_para_hanging_indent_chars,
    'para.line_spacing':               check_para_line_spacing,
    'para.space_before_lines':         check_para_space_before_lines,
    'para.space_after_lines':          check_para_space_after_lines,
    'para.letter_spacing_chars':       check_para_letter_spacing_chars,
    # page 分页/页面
    'page.new_page_before':            check_page_new_page_before,
    'page.size':                       check_page_size,
    'page.margin_top_cm':              check_page_margin_top_cm,
    'page.margin_bottom_cm':           check_page_margin_bottom_cm,
    'page.margin_left_cm':             check_page_margin_left_cm,
    'page.margin_right_cm':            check_page_margin_right_cm,
    # content 内容
    'content.max_chars':               check_content_max_chars,
    'content.char_count_min':          check_content_char_count_min,
    'content.char_count_max':          check_content_char_count_max,
    'content.item_count_min':          check_content_item_count_min,
    'content.item_count_max':          check_content_item_count_max,
    'content.item_separator':          check_content_item_separator,
    'content.specific_text':           check_content_specific_text,
    # mixed_script 中西混排
    'mixed_script.ascii_is_tnr':       check_mixed_script_ascii_is_tnr,
    # layout / citation / pagination（延后存根）
    'layout.position':                 check_layout_position,
    'citation.style':                  check_citation_style,
    'pagination.front_style':          check_pagination_front_style,
    'pagination.body_style':           check_pagination_body_style,
}

# Task 10 detector 使用：需要传入 Document 而非 Paragraph 的属性 key 集合
DOC_LEVEL_KEYS: frozenset[str] = frozenset({
    'page.size',
    'page.margin_top_cm',
    'page.margin_bottom_cm',
    'page.margin_left_cm',
    'page.margin_right_cm',
    'mixed_script.ascii_is_tnr',
    'pagination.front_style',
    'pagination.body_style',
})

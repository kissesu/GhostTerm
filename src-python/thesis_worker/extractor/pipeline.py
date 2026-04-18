"""
@file: pipeline.py
@description: extract_all / extract_from_selection 主流程
              读段落文本+样式 → 按 field_matcher 关联 → 用 patterns+gazetteer 抽属性
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx import Document

from .gazetteer import find_font, find_align, is_bold_keyword
from .patterns import extract_size_name, extract_size_pt_raw
from .field_matcher import match_all_fields
from ..utils.size import name_to_pt

# OOXML namespace，用于直接读 run 的 rFonts XML 属性
_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
_W_RFONTS = f'{{{_W_NS}}}rFonts'
_W_EAST_ASIA = f'{{{_W_NS}}}eastAsia'
_W_ASCII = f'{{{_W_NS}}}ascii'


def _extract_attributes_from_text(text: str) -> dict[str, Any]:
    """从单段文本里抽取所有可识别的格式属性

    业务逻辑：
    1. 字号：先尝试 pt 数字（如 12pt/15磅），再尝试字号名（如"小三号"）
    2. 字体：从词典中匹配 CJK 或 ASCII 字体名
    3. 加粗：检测"加粗"/"粗体"关键词
    4. 对齐：检测"居中"/"左对齐"等对齐词
    """
    attrs: dict[str, Any] = {}

    # 字号（pt 数字优先，fallback 字号名）
    pt = extract_size_pt_raw(text)
    if pt is None:
        size_name = extract_size_name(text)
        if size_name is not None:
            pt = name_to_pt(size_name)
    if pt is not None:
        attrs['font.size_pt'] = pt

    # 字体（cjk / ascii 分类）
    font_info = find_font(text)
    if font_info is not None:
        kind, name = font_info
        if kind == 'cjk':
            attrs['font.cjk'] = name
        else:
            attrs['font.ascii'] = name

    # 加粗
    if is_bold_keyword(text):
        attrs['font.bold'] = True

    # 对齐
    align = find_align(text)
    if align is not None:
        attrs['para.align'] = align

    return attrs


def _read_paragraph_style_attrs(para) -> dict[str, Any]:
    """从段落 XML 样式里抽取属性

    业务逻辑：
    1. 遍历 runs，跳过空白 run，取第一个有实际文字的 run 的字体/字号/加粗
    2. 通过 OOXML rFonts 读 eastAsia（CJK 字体）属性
    3. 读段落对齐属性
    4. 读首行缩进（换算为字数，用于判断正文段落标准缩进）
    """
    attrs: dict[str, Any] = {}

    # 从第一个非空 run 读字体/字号/加粗
    for run in para.runs:
        if not run.text.strip():
            # 跳过空白 run，避免把段尾换行占位 run 的属性当有效属性
            continue
        if run.font.size is not None:
            attrs['font.size_pt'] = float(run.font.size.pt)
        if run.font.bold is True:
            attrs['font.bold'] = True
        # 直接读 OOXML XML 层的 rFonts 属性（python-docx 高级 API 不暴露 eastAsia）
        rpr = run._element.rPr
        if rpr is not None:
            rfonts = rpr.find(_W_RFONTS)
            if rfonts is not None:
                ea = rfonts.get(_W_EAST_ASIA)
                if ea:
                    attrs['font.cjk'] = ea
                asc = rfonts.get(_W_ASCII)
                if asc and 'font.cjk' not in attrs:
                    # 只有在没读到 CJK 字体时才保存 ascii 字体
                    attrs['font.ascii'] = asc
        break

    # 段落对齐
    if para.paragraph_format.alignment is not None:
        # WD_ALIGN_PARAGRAPH 枚举值：LEFT=0, CENTER=1, RIGHT=2, JUSTIFY=3
        align_map = {0: 'left', 1: 'center', 2: 'right', 3: 'justify'}
        val = para.paragraph_format.alignment
        if val in align_map:
            attrs['para.align'] = align_map[val]

    # 首行缩进（粗略换算为字数，以 12pt 正文为基准）
    fli = para.paragraph_format.first_line_indent
    if fli is not None:
        attrs['para.first_line_indent_chars'] = round(fli.pt / 12)

    return attrs


def _merge_attrs(from_text: dict[str, Any], from_style: dict[str, Any]) -> dict[str, Any]:
    """合并文本抽取和样式抽取的属性

    文本抽取（规范说明括号内容）优先于 XML 样式读取。
    两者取并集，文本结果覆盖样式结果中的同名键。
    """
    merged = {**from_style, **from_text}
    return merged


def _calculate_confidence(attrs: dict[str, Any], text_len: int) -> float:
    """根据属性数量估算置信度

    属性数量越多说明从文本/样式里抽取到的信息越完整，置信度越高。
    text_len 保留为将来扩展用（例如空段落特判）。
    """
    if len(attrs) == 0:
        return 0.0
    if len(attrs) >= 3:
        return 0.9
    if len(attrs) == 2:
        return 0.7
    # len == 1
    return 0.5


def extract_all(file: str) -> dict[str, Any]:
    """全文自动抽取字段规则

    业务逻辑：
    1. 读取 docx 所有段落文本
    2. 调用 field_matcher 关联字段 id
    3. 对每个命中段落，合并文本抽取 + 样式抽取的属性
    4. 同一字段取首次命中（跳过重复）
    5. 返回 rules 字典 + evidence 列表 + unmatched_paragraphs 列表

    @param file - docx 文件路径
    @returns {rules: dict[field_id, {enabled, value}], evidence: list, unmatched_paragraphs: list}
    """
    doc = Document(file)
    paragraphs_text = [p.text for p in doc.paragraphs]

    field_matches = match_all_fields(paragraphs_text)

    rules: dict[str, Any] = {}
    evidence: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    for para_idx, field_id, confidence in field_matches:
        if field_id is None:
            text = paragraphs_text[para_idx].strip()
            if text:
                unmatched.append({
                    'idx': para_idx,
                    'text': text[:60],
                    'reason': 'no_field_keyword',
                })
            continue

        # 同一字段只取首次命中（模板文档中同字段极少出现两次，后出现的通常是示例）
        if field_id in rules:
            continue

        para = doc.paragraphs[para_idx]
        text_attrs = _extract_attributes_from_text(para.text)
        style_attrs = _read_paragraph_style_attrs(para)
        value = _merge_attrs(text_attrs, style_attrs)

        final_conf = _calculate_confidence(value, len(para.text))

        rules[field_id] = {
            'enabled': True,
            'value': value,
        }
        evidence.append({
            'field_id': field_id,
            'source_para_idx': para_idx,
            'source_text': para.text[:100],
            'confidence': final_conf,
        })

    return {
        'rules': rules,
        'evidence': evidence,
        'unmatched_paragraphs': unmatched,
    }


def extract_from_selection(
    file: str,
    para_indices: list[int],
    field_id: str,
) -> dict[str, Any]:
    """从用户选定的段落抽取属性，赋给指定字段

    业务逻辑：
    1. 读取指定索引段落的文本和样式
    2. 合并多段属性（后段覆盖前段同名键，保证取到最多属性）
    3. 返回字段 id + 合并属性 + 置信度 + 证据信息

    @param file - docx 文件路径
    @param para_indices - 用户选定的段落索引列表（可多段）
    @param field_id - 用户指定的字段 id
    @returns {field_id, value, confidence, evidence}
    """
    doc = Document(file)
    all_paras = list(doc.paragraphs)

    combined_text = ''
    combined_style_attrs: dict[str, Any] = {}

    for idx in para_indices:
        if idx < 0 or idx >= len(all_paras):
            continue
        para = all_paras[idx]
        combined_text += '\n' + para.text
        style_attrs = _read_paragraph_style_attrs(para)
        # 后段属性覆盖前段，取到的属性集合更丰富
        combined_style_attrs.update(style_attrs)

    text_attrs = _extract_attributes_from_text(combined_text)
    value = _merge_attrs(text_attrs, combined_style_attrs)

    confidence = _calculate_confidence(value, len(combined_text))

    return {
        'field_id': field_id,
        'value': value,
        'confidence': confidence,
        'evidence': {
            'source_text': combined_text[:200],
            'matched_patterns': list(value.keys()),
        },
    }

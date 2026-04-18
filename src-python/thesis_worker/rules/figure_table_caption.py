"""
@file: figure_table_caption.py
@description: 检测图/表题注（Caption）位置是否符合规范。
              FigureCaptionPosRule (figure.caption_pos): 图题注默认应在图下方 (below)
              TableCaptionPosRule (table.caption_pos): 表题注默认应在表上方 (above)
              两规则均为只检测，不自动 fix（需要重排段落）
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx.document import Document
from docx.oxml.ns import qn

from ..models import Issue, Location, FixResult

# graphic 命名空间，用于检测段落内是否含 drawing
_GFX_NS = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

# caption 位置语义：caption 在图/表之前 = 'above'（题注在图/表上方）
#                   caption 在图/表之后 = 'below'（题注在图/表下方）
_CONTEXT_MAX = 30


def _iter_body_blocks(doc: Document):
    """
    按文档物理顺序遍历 body 直接子元素。
    返回 ('paragraph', elem) 或 ('table', elem)。
    只取 w:p 和 w:tbl，忽略其他元素（如 sectPr）。
    """
    for child in doc.element.body:
        tag = child.tag.split('}', 1)[-1] if '}' in child.tag else child.tag
        if tag == 'p':
            yield 'paragraph', child
        elif tag == 'tbl':
            yield 'table', child


def _is_caption(p_elem) -> bool:
    """判断段落的 pStyle 是否为 'Caption'"""
    pPr = p_elem.find(qn('w:pPr'))
    if pPr is None:
        return False
    pStyle = pPr.find(qn('w:pStyle'))
    if pStyle is None:
        return False
    val = pStyle.get(qn('w:val'))
    return val == 'Caption'


def _has_image(p_elem) -> bool:
    """判断段落 XML 是否含 drawing（内联图片）"""
    return len(p_elem.findall(f'.//{_GFX_NS}graphic')) > 0


def _caption_text(p_elem) -> str:
    """提取题注段落的纯文本，用于 snippet/context"""
    text = ''.join(p_elem.itertext()).strip()
    if len(text) <= _CONTEXT_MAX:
        return text
    return text[:_CONTEXT_MAX] + '...'


class _BaseCaptionPosRule:
    """
    图/表题注位置规则基类。
    detect 逻辑：
    1. 遍历 body 所有直接块（段落 / 表格）
    2. 找到 style=Caption 的段落
    3. 看其紧邻前/后是否有目标类型（figure=含图段落，table=表格）
    4. 推断实际位置：目标在 caption 前 → caption 在 below 位置（题注在图下）
                     目标在 caption 后 → caption 在 above 位置（题注在图上）
    5. 与 value 对比，不符则报 issue
    """
    severity = 'warning'
    category = 'format'
    fix_available = False
    target_kind: str = ''    # 子类必须设置：'figure' 或 'table'
    id: str = ''             # 子类必须设置

    @classmethod
    def detect(cls, doc: Document, value: Any) -> list[Issue]:
        # value 只接受 'above' 或 'below'，其他值直接跳过
        if value not in ('above', 'below'):
            return []

        blocks = list(_iter_body_blocks(doc))
        issues: list[Issue] = []

        for i, (kind, elem) in enumerate(blocks):
            # 只关注 Caption 段落
            if kind != 'paragraph' or not _is_caption(elem):
                continue

            prev_block = blocks[i - 1] if i > 0 else None
            next_block = blocks[i + 1] if i + 1 < len(blocks) else None

            # 根据 target_kind 判断邻接块是否是目标元素
            if cls.target_kind == 'figure':
                # 图：含 graphic 的段落
                def is_target(b) -> bool:
                    return b is not None and b[0] == 'paragraph' and _has_image(b[1])
            else:
                # 表：w:tbl 块
                def is_target(b) -> bool:
                    return b is not None and b[0] == 'table'

            has_target_above = is_target(prev_block)   # 目标在 caption 之前
            has_target_below = is_target(next_block)   # 目标在 caption 之后

            # 既不紧邻图也不紧邻表 → 不属于本规则的题注，跳过
            if not has_target_above and not has_target_below:
                continue

            # 推断题注实际位置语义：
            # 目标在 caption 后（caption 先出现）→ 题注在图/表上方 = 'above'
            # 目标在 caption 前（caption 后出现）→ 题注在图/表下方 = 'below'
            actual_pos = 'above' if has_target_below else 'below'

            if actual_pos != value:
                snippet = _caption_text(elem)
                issues.append(Issue(
                    rule_id=cls.id,
                    loc=Location(para=i, run=0),
                    message=(
                        f'{cls.target_kind} 题注位置应为 {value}（图/表{value}方），'
                        f'实际为 {actual_pos}'
                    ),
                    current=actual_pos,
                    expected=value,
                    fix_available=False,
                    snippet=snippet,
                    # caption 文本通常 <= 30 字，snippet 即 context
                    context=snippet,
                ))

        return issues

    @classmethod
    def fix(cls, doc: Document, issue: Issue, value: Any) -> FixResult:
        # 重排段落顺序风险高，不提供自动修复
        raise NotImplementedError(f'{cls.id} 不支持自动修复，需手动重排段落')


class FigureCaptionPosRule(_BaseCaptionPosRule):
    """图题注位置规则：检测 Caption 段落与图段落的相对位置"""
    id = 'figure.caption_pos'
    target_kind = 'figure'


class TableCaptionPosRule(_BaseCaptionPosRule):
    """表题注位置规则：检测 Caption 段落与表格的相对位置"""
    id = 'table.caption_pos'
    target_kind = 'table'

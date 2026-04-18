"""
@file: chapter_new_page.py
@description: 检测和修复一级标题（Heading 1）前缺少分页符的问题。
              value: bool — true 表示每章必须新页开始；false 表示不要求，跳过检测。
              fix：设置 paragraph_format.page_break_before = True
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx.document import Document
from docx.shared import RGBColor

from ..models import Issue, Location, FixResult


# 蓝色标记：Office 标准"蓝色, 个性色 1" = #0070C0
_MARK_COLOR = RGBColor(0x00, 0x70, 0xC0)

# 一级标题 style 名称集合：兼容两种 python-docx 命名约定
_H1_STYLES = {'Heading 1', 'Heading1'}

# snippet/context 截断长度：取段落文本前 N 字符，供用户定位
_PREVIEW_MAX = 30


def _has_page_break_before(para) -> bool:
    """检测段落是否已设置 page_break_before 属性
    只检测段落属性层面的分页（主流用法），不检测 run 内的 w:br 元素"""
    return bool(para.paragraph_format.page_break_before)


class ChapterNewPageRule:
    id = 'chapter.new_page'
    category = 'structure'
    severity = 'warning'
    fix_available = True

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        """
        扫描所有一级标题段落，检查是否缺少分页符。

        业务逻辑：
        1. value 不为 True 时跳过（用户未要求章节分页）
        2. 遍历所有段落，只处理 Heading 1 段落
        3. 文档首个 Heading 1（p_idx == 0）不需要前置分页符，跳过
        4. 其余 Heading 1 若未设置 page_break_before → 生成 Issue
        """
        # value=False 表示不要求章节分页，直接返回空列表
        if value is not True:
            return []

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            if para.style.name not in _H1_STYLES:
                continue

            # 文档开头的第一个 Heading 1 不需要前置分页
            if p_idx == 0:
                continue

            if _has_page_break_before(para):
                continue

            # 段落文本截断用于 snippet 和 context
            preview = para.text[:_PREVIEW_MAX]

            issues.append(Issue(
                rule_id='chapter.new_page',
                loc=Location(para=p_idx, run=0),
                message='一级标题前应有分页符',
                current=False,
                expected=True,
                fix_available=True,
                snippet=preview,
                context=preview,
            ))

        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        """
        在指定一级标题段落前插入分页符，并用蓝色标记第一个 run。

        业务逻辑：
        1. 按 loc.para 定位目标段落
        2. 设置 paragraph_format.page_break_before = True
        3. 蓝色标记段落第一个 run（提示人工复核）
        """
        para = doc.paragraphs[issue.loc.para]
        para.paragraph_format.page_break_before = True

        # 蓝色标记第一个 run，提示用户此处已被自动修改
        if para.runs:
            para.runs[0].font.color.rgb = _MARK_COLOR

        return FixResult(
            diff='- page_break_before: False\n+ page_break_before: True',
            applied=True,
            xml_changed=[f'w:p[{issue.loc.para}]/w:pPr'],
        )

"""
@file: pagination.py
@description: 检测页眉页脚分页字段（PAGE field）是否存在。
              value: {front_matter: 'roman', body: 'arabic'} — 前置部分罗马数字，正文阿拉伯数字。
              detect：遍历每个 section 的 footer，检查是否含 PAGE field。
              fix：不支持自动修复（页眉页脚 XML 操作复杂，留 P4）。
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx.document import Document
from docx.oxml.ns import qn

from ..models import Issue, Location, FixResult


def _footer_has_page_field(footer) -> bool:
    """检查 footer XML 是否含 PAGE field

    支持两种常见的 Word PAGE field 写法：
    1. w:fldSimple — 简单域，instr 属性直接包含 PAGE 关键字
    2. w:fldChar + w:instrText — 复杂域，指令文本在 instrText 子元素中
    """
    for para in footer.paragraphs:
        # 方法 1: w:fldSimple instr=" PAGE "
        fld_simples = para._element.findall(f'.//{qn("w:fldSimple")}')
        for fs in fld_simples:
            instr = fs.get(qn('w:instr'))
            if instr and 'PAGE' in instr:
                return True

        # 方法 2: w:fldChar + w:instrText 复杂域
        instr_texts = para._element.findall(f'.//{qn("w:instrText")}')
        for it in instr_texts:
            if it.text and 'PAGE' in it.text:
                return True

    return False


class PaginationRule:
    id = 'pagination'
    category = 'structure'
    severity = 'warning'
    fix_available = False

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        """
        检测每个 section 的 footer 是否包含 PAGE field。

        业务逻辑：
        1. value 必须是包含 front_matter 和 body 键的 dict，否则跳过
        2. 遍历 doc.sections，逐个检查 footer 是否含 PAGE field
        3. 缺少 PAGE field 的 section → 生成 Issue，loc.para 存 section index
        4. 暂不检查 numbering style（roman vs arabic），只检测字段存在性
        """
        # value 格式校验：必须是含 front_matter 和 body 的 dict
        if not isinstance(value, dict):
            return []
        front_matter = value.get('front_matter')
        body = value.get('body')
        if not front_matter or not body:
            return []

        issues: list[Issue] = []
        total_sections = len(doc.sections)

        for sec_idx, section in enumerate(doc.sections):
            if _footer_has_page_field(section.footer):
                continue

            issues.append(Issue(
                rule_id='pagination',
                loc=Location(para=sec_idx, run=0),
                message=f'第 {sec_idx + 1} section footer 缺 PAGE 字段',
                current='no PAGE field',
                expected=f'PAGE field ({front_matter}/{body})',
                fix_available=False,
                snippet=f'section[{sec_idx}]/footer',
                context=f'doc 共 {total_sections} sections',
            ))

        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        """pagination 规则不支持自动修复，页眉页脚 XML 操作留 P4 实现"""
        raise NotImplementedError('pagination 不支持自动修复')

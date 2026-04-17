"""
@file: cjk_ascii_space.py
@description: 检测和修复中英/中数之间的空格
              config 示例：{"allowed": false} = 不允许空格（院校特定要求）
                          {"allowed": true}  = 跳过该规则
@author: Atlas.oi
@date: 2026-04-17
"""
import re
from typing import Any
from docx.document import Document
from docx.shared import RGBColor

from ..models import Issue, Location, FixResult


# 中文字符范围 + ASCII 字母数字
_CJK = r'[\u4e00-\u9fa5]'
_ASCII = r'[A-Za-z0-9]'
# 匹配：中-空格+ -英 或 英-空格+ -中（空格 1 个或多个都算违规）
_VIOLATION_RE = re.compile(
    rf'(?:{_CJK} +{_ASCII})|(?:{_ASCII} +{_CJK})'
)

# 蓝色标记：Office 标准 "蓝色, 个性色 1" = #0070C0
_MARK_COLOR = RGBColor(0x00, 0x70, 0xC0)


class CjkAsciiSpaceRule:
    id = 'cjk_ascii_space'
    category = 'writing'
    severity = 'warning'
    fix_available = True

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        # allowed 为 true 或未设 → 跳过；只有明确设为 False 才检测
        if value.get('allowed', True) is not False:
            return []

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            for r_idx, run in enumerate(para.runs):
                text = run.text
                for m in _VIOLATION_RE.finditer(text):
                    current = m.group(0)
                    expected = re.sub(r' +', '', current)
                    issues.append(Issue(
                        rule_id='cjk_ascii_space',
                        loc=Location(para=p_idx, run=r_idx, char=m.start()),
                        message='中英/中数之间不应有空格',
                        current=current,
                        expected=expected,
                        fix_available=True,
                    ))
        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        para = doc.paragraphs[issue.loc.para]
        run = para.runs[issue.loc.run]
        before = run.text
        # 删除所有中英/中数之间的空格
        after = _VIOLATION_RE.sub(
            lambda m: re.sub(r' +', '', m.group(0)),
            before,
        )
        run.text = after
        # 蓝色标记，提示用户已修改
        run.font.color.rgb = _MARK_COLOR

        return FixResult(
            diff=f'- {before}\n+ {after}',
            applied=True,
            xml_changed=[f'w:p[{issue.loc.para}]/w:r[{issue.loc.run}]'],
        )

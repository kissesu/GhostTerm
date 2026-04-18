"""
@file: quote_style.py
@description: 检测和修复文档中的引号风格
              value='cjk'   → 期望中文引号，检测 ASCII 引号 " 和 '
              value='ascii' → 期望 ASCII 引号，检测中文引号 " " ' '
              value='mixed' → 允许混用，跳过检测
@author: Atlas.oi
@date: 2026-04-18
"""
import re
from typing import Any
from docx.document import Document
from docx.shared import RGBColor

from ..models import Issue, Location, FixResult


# ASCII 双引号 / 单引号 — value='cjk' 时应被替换为中文引号
_ASCII_QUOTE_RE = re.compile(r'["\']')

# 中文双/单引号 — value='ascii' 时应被替换为 ASCII 引号
_CJK_QUOTE_RE = re.compile(r'[\u201c\u201d\u2018\u2019]')

# 蓝色标记：Office 标准 "蓝色, 个性色 1" = #0070C0
_MARK_COLOR = RGBColor(0x00, 0x70, 0xC0)

# context 预览长度：段落前 N 字符，供用户定位段落
_CONTEXT_MAX = 30


def _make_context(para_text: str) -> str:
    """段落预览：首尾 strip 后取前 N 字符"""
    stripped = para_text.strip()
    if len(stripped) <= _CONTEXT_MAX:
        return stripped
    return stripped[:_CONTEXT_MAX] + '…'


class QuoteStyleRule:
    id = 'quote.style'
    category = 'writing'
    severity = 'warning'
    fix_available = True

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        # mixed 或其它未知值 → 跳过检测
        if value not in ('cjk', 'ascii'):
            return []

        # 根据期望风格选择检测目标
        target_re = _ASCII_QUOTE_RE if value == 'cjk' else _CJK_QUOTE_RE
        # 期望风格描述，用于 message 提示
        target_kind = 'ASCII 引号' if value == 'cjk' else '中文引号'
        expected_hint = '\u201c/\u201d' if value == 'cjk' else '"/\''

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            if not para.text.strip():
                continue
            context = _make_context(para.text)
            for r_idx, run in enumerate(para.runs):
                text = run.text
                for m in target_re.finditer(text):
                    char = m.group(0)
                    # 前后各取 3 个字符作为 snippet，方便定位
                    snippet = text[max(0, m.start() - 3):m.end() + 3]
                    issues.append(Issue(
                        rule_id='quote.style',
                        loc=Location(para=p_idx, run=r_idx, char=m.start()),
                        message=f'{target_kind}应改为{value}风格：{char!r}',
                        current=char,
                        expected=expected_hint,
                        fix_available=True,
                        snippet=snippet,
                        context=context,
                    ))
        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        para = doc.paragraphs[issue.loc.para]
        run = para.runs[issue.loc.run]
        before = run.text

        if value == 'cjk':
            # ============================================================
            # 双引号配对替换：第奇数个 " 改为 "（左），第偶数个改为 "（右）
            # 单引号同理：奇数 → '（左），偶数 → '（右）
            # 两套引号的开合状态分别独立追踪
            # ============================================================
            result = []
            dq_open = False   # 双引号当前是否处于开启状态
            sq_open = False   # 单引号当前是否处于开启状态
            for ch in before:
                if ch == '"':
                    result.append('\u201c' if not dq_open else '\u201d')
                    dq_open = not dq_open
                elif ch == "'":
                    result.append('\u2018' if not sq_open else '\u2019')
                    sq_open = not sq_open
                else:
                    result.append(ch)
            after = ''.join(result)
        elif value == 'ascii':
            # 中文引号全部替换为对应 ASCII 符号
            after = (before
                     .replace('\u201c', '"').replace('\u201d', '"')
                     .replace('\u2018', "'").replace('\u2019', "'"))
        else:
            # mixed 不做修改
            return FixResult(diff='', applied=False)

        run.text = after
        # 蓝色标记，提示用户此处已被自动修改
        run.font.color.rgb = _MARK_COLOR

        return FixResult(
            diff=f'- {before}\n+ {after}',
            applied=True,
            xml_changed=[f'w:p[{issue.loc.para}]/w:r[{issue.loc.run}]'],
        )

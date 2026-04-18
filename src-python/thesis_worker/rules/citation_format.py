"""
@file: citation_format.py
@description: 检测引用格式是否符合 GB/T 7714（只检测，不自动 fix）
              期望全文使用半角方括号编号格式 [1]、[1,2]、[1-3]
              违规类型：全角方括号、全角圆括号、半角圆括号数字、哈佛格式
@author: Atlas.oi
@date: 2026-04-18
"""
import re
from typing import Any
from docx.document import Document

from ..models import Issue, Location, FixResult

# context 预览长度：段落前 N 字符，供用户 Ctrl-F 搜段落
_CONTEXT_MAX = 30

# 全角方括号引用：［1］、［1,2］、［1-3］
_FULLWIDTH_BRACKET_RE = re.compile(r'［\d+(?:[,，\-]\d+)*］')

# 全角圆括号引用：（1）、（1,2）
_FULLWIDTH_PAREN_RE = re.compile(r'（\d+(?:[,，\-]\d+)*）')

# 半角圆括号数字引用：(1)、(1,2)、(1-3)
# 用于排除哈佛格式前先匹配纯数字形式
_PAREN_NUMERIC_RE = re.compile(r'\(\d+(?:[,\-]\d+)*\)')

# 哈佛格式：(张三, 2023)、(Zhang, 2023)、(张三等, 2023a)
# 覆盖中英文作者名，支持 a-z 年份后缀
_HARVARD_RE = re.compile(
    r'\([\u4e00-\u9fa5A-Za-z]+(?:\s*等)?,\s*\d{4}[a-z]?\)'
)

# 违规类型列表：(正则, 描述)
_PATTERNS = [
    (_FULLWIDTH_BRACKET_RE, '全角方括号'),
    (_FULLWIDTH_PAREN_RE, '全角圆括号'),
    (_PAREN_NUMERIC_RE, '半角圆括号数字'),
    (_HARVARD_RE, '哈佛格式'),
]


def _make_context(para_text: str) -> str:
    """段落预览：首尾 strip 后取前 N 字符"""
    stripped = para_text.strip()
    if len(stripped) <= _CONTEXT_MAX:
        return stripped
    return stripped[:_CONTEXT_MAX] + '…'


class CitationFormatRule:
    id = 'citation.format'
    category = 'citation'
    severity = 'warning'
    # 学术引用改动风险高，不自动 fix，由用户手动修改
    fix_available = False

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        # 只检测 gbt7714 + bracket 组合，其余格式配置跳过
        if value.get('style') != 'gbt7714' or value.get('marker') != 'bracket':
            return []

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            if not para.text.strip():
                continue
            context = _make_context(para.text)
            for r_idx, run in enumerate(para.runs):
                text = run.text
                for pattern, kind in _PATTERNS:
                    for m in pattern.finditer(text):
                        # snippet 取匹配前后各 3 字符，保留违规符号上下文
                        snippet_start = max(0, m.start() - 3)
                        snippet_end = min(len(text), m.end() + 3)
                        snippet = text[snippet_start:snippet_end]
                        issues.append(Issue(
                            rule_id='citation.format',
                            loc=Location(para=p_idx, run=r_idx, char=m.start()),
                            message=f'引用格式不符 GB/T 7714（{kind}）：{m.group(0)}',
                            current=m.group(0),
                            expected='[<编号>]',
                            fix_available=False,
                            snippet=snippet,
                            context=context,
                        ))
        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        # citation.format 不支持自动修复，学术引用需人工核查
        raise NotImplementedError('citation.format 不支持自动修复')

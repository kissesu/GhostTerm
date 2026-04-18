"""
@file: ai_pattern.py
@description: 检测论文中的 AI 化 marker（只检测，不自动修复）
              AI 化 marker 是指 LLM 生成文本中的典型句式，如 "综上所述"、
              "值得注意的是" 等。此类文体改动风险极高，故只标注提示，不执行 fix。
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx.document import Document

from ..models import Issue, Location, FixResult

# context 预览长度：段落前 N 字符，供用户在 WPS 里 Ctrl-F 搜定位
_CONTEXT_MAX = 30

# thesis-default ruleset 的高信号 AI marker 列表
# 仅保留 LLM 写作显著特征词；删除 "首先/其次/最后/本文将/一方面/另一方面" 等
# 在正常论文方法论步骤和转折语境下高频出现的通用词，避免 info 级噪音淹没用户
# 若需检测 "首先...其次..." 这类共现模式应走 composite pattern，超出 P3 范围
_AI_MARKERS = [
    '综上所述', '值得注意的是', '总而言之', '毋庸置疑',
    '显而易见', '深度挖掘', '进一步分析', '至关重要',
    '不容忽视', '本研究旨在',
]


def _make_context(para_text: str) -> str:
    """段落预览：首尾 strip 后取前 N 字符"""
    stripped = para_text.strip()
    if len(stripped) <= _CONTEXT_MAX:
        return stripped
    return stripped[:_CONTEXT_MAX] + '…'


class AiPatternCheckRule:
    id = 'ai_pattern.check'
    category = 'ai'
    severity = 'info'
    fix_available = False

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        # 只支持 thesis-default ruleset，其余一律跳过
        ruleset = value.get('ruleset') if isinstance(value, dict) else None
        if ruleset != 'thesis-default':
            return []

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            if not para.text.strip():
                # 空段落无需检测
                continue
            context = _make_context(para.text)
            for r_idx, run in enumerate(para.runs):
                text = run.text
                for marker in _AI_MARKERS:
                    # 在同一 run 中扫描 marker 的所有出现位置
                    idx = 0
                    while True:
                        pos = text.find(marker, idx)
                        if pos < 0:
                            break
                        # snippet：marker 前后各 3 字符，方便用户阅读上下文
                        snippet = text[max(0, pos - 3):pos + len(marker) + 3]
                        issues.append(Issue(
                            rule_id='ai_pattern.check',
                            loc=Location(para=p_idx, run=r_idx, char=pos),
                            message=f'AI 化 marker 疑似：{marker}',
                            current=marker,
                            expected='（建议改写或删除）',
                            fix_available=False,
                            snippet=snippet,
                            context=context,
                        ))
                        idx = pos + len(marker)
        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        # AI 文体改动风险极高，不提供自动修复
        raise NotImplementedError('ai_pattern.check 不支持自动修复')

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

# 中文标点集合：作为 ASCII 侧扩展的停止符（否则句末句号会被吸进 snippet）
_CJK_PUNCT = set('，。；：！？、、""‘’（）《》【】…—「」『』')

# context 预览长度：段落前 N 字符，供用户 Ctrl-F 搜段落
_CONTEXT_MAX = 30


def _is_cjk(ch: str) -> bool:
    return bool(ch) and '\u4e00' <= ch <= '\u9fa5'


def _is_ascii_token_char(ch: str) -> bool:
    """ASCII 侧扩展接受的字符：非空白、非 CJK、非中文标点
    这样版本号 `2.1.1` 和代码标识 `v2.0-beta` 整块保留"""
    if not ch or ch.isspace():
        return False
    if _is_cjk(ch):
        return False
    if ch in _CJK_PUNCT:
        return False
    return True


def _expand_snippet(text: str, match_start: int, match_end: int) -> str:
    """把正则最小匹配扩展到用户可读的完整片段
    CJK 侧：连续 CJK 字符直到非 CJK 停
    ASCII 侧：连续"非空白非 CJK 非中文标点"字符直到边界停"""
    left = match_start
    right = match_end

    # 左扩展：看 match 左邻字符属于哪个字符族，按同族继续吃
    if left > 0:
        c = text[left - 1]
        if _is_cjk(c):
            while left > 0 and _is_cjk(text[left - 1]):
                left -= 1
        elif _is_ascii_token_char(c):
            while left > 0 and _is_ascii_token_char(text[left - 1]):
                left -= 1

    # 右扩展：同理
    n = len(text)
    if right < n:
        c = text[right]
        if _is_cjk(c):
            while right < n and _is_cjk(text[right]):
                right += 1
        elif _is_ascii_token_char(c):
            while right < n and _is_ascii_token_char(text[right]):
                right += 1

    return text[left:right]


def _make_context(para_text: str) -> str:
    """段落预览：首尾 strip 后取前 N 字符"""
    stripped = para_text.strip()
    if len(stripped) <= _CONTEXT_MAX:
        return stripped
    return stripped[:_CONTEXT_MAX] + '…'


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
            context = _make_context(para.text)
            for r_idx, run in enumerate(para.runs):
                text = run.text
                for m in _VIOLATION_RE.finditer(text):
                    current = m.group(0)
                    expected = re.sub(r' +', '', current)
                    snippet = _expand_snippet(text, m.start(), m.end())
                    issues.append(Issue(
                        rule_id='cjk_ascii_space',
                        loc=Location(para=p_idx, run=r_idx, char=m.start()),
                        message='中英/中数之间不应有空格',
                        current=current,
                        expected=expected,
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

    @staticmethod
    def extract(doc) -> None:
        """
        cjk_ascii_space.allowed 是院校级约束而非 docx 本身的属性，
        无法从文档内容反推，返回 None 让 extractor 走占位分支。
        """
        return None

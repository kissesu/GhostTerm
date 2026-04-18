"""
@file: gazetteer.py
@description: 格式属性关键词词典 + 词典匹配函数
              覆盖规范文档里描述字体/对齐/加粗等格式属性的中英文词
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Optional

# 中文字体名（常见论文字体）
CJK_FONTS: frozenset[str] = frozenset([
    '宋体', '黑体', '楷体', '仿宋', '楷体_GB2312', '仿宋_GB2312',
    '方正仿宋_GBK', '方正黑体_GBK', '隶书', '新宋体', '华文中宋',
    '华文宋体', '华文仿宋', '华文黑体',
])

# 英文字体名
ASCII_FONTS: frozenset[str] = frozenset([
    'Times New Roman', 'Arial', 'Calibri', 'Cambria',
    'Georgia', 'Verdana',
])

# 对齐词 → alignment 值
# 使用 list of tuple 保证遍历顺序，避免 dict 键覆盖歧义
ALIGN_MAP: dict[str, str] = {
    '居中': 'center',
    '左对齐': 'left',
    '顶格': 'left',
    '顶头': 'left',
    '左顶格': 'left',
    '右对齐': 'right',
    '右顶格': 'right',
    '两端对齐': 'justify',
    '分散对齐': 'justify',
}

# 加粗关键词
BOLD_KEYWORDS: frozenset[str] = frozenset(['加粗', '粗体'])


def find_font(text: str) -> Optional[tuple[str, str]]:
    """在文本中找到第一个匹配的字体名

    业务逻辑：
    1. 优先匹配 CJK 字体名（中文论文以中文字体描述为主）
    2. 再匹配 ASCII 字体名
    3. 遇到第一个命中立即返回，不继续扫描

    返回 ('cjk' | 'ascii', 字体名) 或 None
    """
    for font in CJK_FONTS:
        if font in text:
            return ('cjk', font)
    for font in ASCII_FONTS:
        if font in text:
            return ('ascii', font)
    return None


def find_align(text: str) -> Optional[str]:
    """在文本中找到对齐词，返回标准 alignment 值或 None

    按 ALIGN_MAP 插入顺序遍历，Python 3.7+ dict 保证有序
    """
    for keyword, value in ALIGN_MAP.items():
        if keyword in text:
            return value
    return None


def is_bold_keyword(text: str) -> bool:
    """检测文本是否含"加粗"/"粗体"关键词"""
    return any(kw in text for kw in BOLD_KEYWORDS)

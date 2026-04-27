"""
@file: field_matcher.py
@description: 字段 id 与段落文本的关联（关键词定位 + 位置兜底）
              T2.2: 删除 toc_entry，新增 toc_entry_l1/l2/l3 三组关键词；
                    关键词设计原则：用"X级目录条目"而非"X级目录"，避免与 toc_title("目录")
                    及 chapter_title/section_title/subsection_title 的"X级标题"产生子串冲突
              T2.3: 新增 formula_block 关键词；
                    使用"公式格式"/"公式编号"/"数学公式"三个复合词而非光秃秃的"公式"，
                    原因："公式"是短词，极易被含"公式"的其他字段文本误命中；
                    复合词精确定位规范文本中对公式版面的明确表述
@author: Atlas.oi
@date: 2026-04-27
"""
from typing import Optional

# 字段 id → 触发关键词列表
# 关键词必须是字段的显著标志，优先用完整词避免误匹配
# 分组：前置 14 + 正文 10 + 后置 6 + 页面级 6 = 36 个字段（T2.1 新增 table_header，T2.2 拆分 toc_entry，T2.3 新增 formula_block）
FIELD_KEYWORDS: dict[str, list[str]] = {
    # ---- 前置部分（14 个）----
    'title_zh': ['毕业论文题目', '毕业论文（设计）题目', '论文题目', '中文题目'],
    'abstract_zh_title': ['摘  要', '摘 要', '摘要', '中文摘要'],
    'abstract_zh_body': [],  # 依赖 abstract_zh_title 后的段落位置，无独立关键词
    # 关键词标签行通常以"关键词："形式出现，加冒号避免正文中含"关键词"三字的句子误匹配
    'keywords_zh_label': ['关键词：', '关键词:', '关键字：', '关键字:'],
    'keywords_zh_content': [],  # 依赖 keywords_zh_label 后的段落位置
    'title_en': ['英文题目', 'English Title', 'Title'],
    'abstract_en_title': ['Abstract', 'ABSTRACT', '英文摘要'],
    'abstract_en_body': [],
    'keywords_en_label': ['Key words', 'Key Words', 'Keywords', 'KEY WORDS'],
    'keywords_en_content': [],
    # T2.2: 三个分级目录条目关键词必须排在 toc_title 之前。
    # 原因：toc_title 含关键词 "目录"（短子串），任何含"目录"的文本均会先命中 toc_title；
    # 将 l1/l2/l3 排前，使"一级目录条目"等文本先命中具体级别，
    # 而纯"目录"文本不含"一级目录条目"等词，跳过 l* 后正确命中 toc_title。
    # 关键词设计：用"X级目录条目"+"目录X级条目"双形式；
    #   - 不用"X级目录"（被 toc_title 的"目录"包含）
    #   - 不用"X级标题"（属于 chapter/section/subsection_title 语义域）
    #   - 三组词两两无子串包含关系（一/二/三 各异，"条目"尾缀相同）
    'toc_entry_l1': ['一级目录条目', '目录一级条目'],
    'toc_entry_l2': ['二级目录条目', '目录二级条目'],
    'toc_entry_l3': ['三级目录条目', '目录三级条目'],
    'toc_title': ['目  录', '目 录', '目录'],
    # ---- 正文部分（9 个）----
    'chapter_title': ['一级标题', '第一章', '第二章', '第三章', '第1章', '第2章'],
    'section_title': ['二级标题'],
    'subsection_title': ['三级标题'],
    # 正文段落依赖位置推断，无独立关键词（"正文"过于通用，易误匹配）
    'body_para': [],
    'figure_caption': ['图题', '图标题'],
    'figure_inner_text': ['图例', '图内文字', '标目'],
    'table_caption': ['表题', '表标题'],
    # T2.1: 新增表头字段关键词。规范文本通常用"表头"或"表格标题行"描述首行格式要求。
    'table_header': ['表头', '表格标题行'],
    'table_inner_text': ['表内容'],
    # T2.3: 新增公式字段关键词。
    # 关键词选择复合词而非单字"公式"：
    #   - "公式格式"：规范文本典型表述（"公式格式要求另起一行"）
    #   - "公式编号"：规范文本典型表述（"公式编号用圆括号括注"）
    #   - "数学公式"：部分高校规范使用此表述
    # 未使用"公式"单字：太短，"参考文献中含有公式的条目"等文本均含此子串，误命中风险高。
    'formula_block': ['公式格式', '公式编号', '数学公式'],
    # ---- 后置部分（6 个）----
    'references_title': ['参考文献'],
    'reference_entry': ['参考文献格式', '参考文献条目', 'GB/T 7714', 'GB/T7714'],
    'ack_title': ['致  谢', '致 谢', '致谢'],
    'ack_body': [],
    'appendix_title': ['附  录', '附 录', '附录'],
    'appendix_body': [],
    # ---- 页面级（6 个）----
    'page_size': ['A4', '页面', '纸张'],
    'page_margin': ['页边距', '边距', '装订线'],
    'page_header': ['页眉'],
    'page_footer_number': ['页脚', '页码'],
    'line_spacing_global': ['全文行距', '行距'],
    'mixed_script_global': ['数字、西文', '数字/西文', '数字和西文'],
}


def match_field(text: str) -> Optional[str]:
    """给定一段文本，返回匹配到的字段 id
    如果匹配多个，按 FIELD_KEYWORDS 的插入顺序取第一个命中（前置部分优先于正文和页面级字段）。
    都不匹配返回 None。
    匹配策略：子串包含检查（text 含 keyword）

    @param text - 待匹配的段落文本
    @returns 字段 id 字符串，或 None
    """
    text_normalized = text.strip()
    for field_id, keywords in FIELD_KEYWORDS.items():
        # 跳过无关键词的字段（依赖位置推断，不做关键词匹配）
        if not keywords:
            continue
        for keyword in keywords:
            if keyword in text_normalized:
                return field_id
    return None


def match_all_fields(paragraphs: list[str]) -> list[tuple[int, Optional[str], float]]:
    """对一组段落文本做全量字段匹配

    业务逻辑：
    1. 遍历段落列表，对每段调用 match_field
    2. 命中关键词的段落置信度固定为 0.8（关键词命中属于高置信场景）
    3. 未命中段落置信度为 0.0，字段 id 为 None

    @param paragraphs - 段落文本列表
    @returns [(para_idx, field_id_or_none, confidence), ...]
    """
    results: list[tuple[int, Optional[str], float]] = []
    for idx, text in enumerate(paragraphs):
        field = match_field(text)
        # 关键词命中给 0.8 置信度，未命中给 0.0
        confidence = 0.8 if field else 0.0
        results.append((idx, field, confidence))
    return results

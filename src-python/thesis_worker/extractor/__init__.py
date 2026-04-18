"""
@file: __init__.py
@description: 从 docx 文件反推模板规则值。
              遍历 REGISTRY 中每条规则，调用 rule.extract(doc) 反向提取现值，
              返回 {rules: {...}, evidence: [...]} 供前端展示和模板初始化。
@author: Atlas.oi
@date: 2026-04-18
"""
from docx import Document

from ..rules import REGISTRY


def extract_from_docx(file: str) -> dict:
    """
    从 docx 文件中反推模板规则值。

    业务逻辑：
    1. 打开 docx，遍历 REGISTRY 中全部规则
    2. 若规则实现了 extract(doc) 且返回非 None → 写入 rules_draft（enabled=True）
    3. 若规则未实现 extract 或返回 None → 占位（enabled=False，value=None）
    4. 返回 {rules, evidence}，rules 可直接用于构造 TemplateConfig

    @param file: docx 文件路径
    @returns: {
        'rules': {rule_id: {'enabled': bool, 'value': any}},
        'evidence': [{'rule_id': str, 'source_xml': str|None, 'confidence': float}]
    }
    """
    doc = Document(file)
    rules_draft: dict = {}
    evidence: list = []

    for rule_id, rule in REGISTRY.items():
        # 尝试调用 extract：未实现或返回 None 均走占位分支
        extracted = rule.extract(doc) if hasattr(rule, 'extract') else None

        if extracted is not None:
            # 成功提取：记录规则值和提取证据
            rules_draft[rule_id] = {'enabled': True, 'value': extracted['value']}
            evidence.append({
                'rule_id': rule_id,
                'source_xml': extracted.get('source_xml'),
                'confidence': extracted.get('confidence', 0.5),
            })
        else:
            # 未提取：占位，用户手动填写
            rules_draft[rule_id] = {'enabled': False, 'value': None}
            evidence.append({'rule_id': rule_id, 'source_xml': None, 'confidence': 0.0})

    return {'rules': rules_draft, 'evidence': evidence}

"""
@file: handlers.py
@description: NDJSON 请求路由。收到 {id, cmd, ...} → 返回 {id, ok, result?, error?, code?}
              错误处理原则（spec Section 7）：不降级，异常直接抛出成 response
              - 规则异常 → 整批中止，不跳过其它规则
              - 文件错误 → 明确 code (ENOENT / EPERM / PARSE_ERROR)
@author: Atlas.oi
@date: 2026-04-17
"""
import traceback
from pathlib import Path
from docx import Document
from docx.opc.exceptions import PackageNotFoundError

from .rules import REGISTRY


def handle(req: dict) -> dict:
    """顶层路由。任何未捕获异常都转成 code=INTERNAL 的 response（sidecar 进程不崩）"""
    req_id = req.get('id')
    cmd = req.get('cmd')

    try:
        if cmd == 'ping':
            return {'id': req_id, 'ok': True, 'result': 'pong'}

        if cmd == 'detect':
            return _handle_detect(req_id, req)

        if cmd == 'fix':
            return _handle_fix(req_id, req)

        if cmd == 'fix_preview':
            return _handle_fix_preview(req_id, req)

        if cmd == 'list_rules':
            return {'id': req_id, 'ok': True, 'result': {'rules': list(REGISTRY.keys())}}

        if cmd == 'cancel':
            # P3 单线程串行，cancel 只做 ack；真实中断留 P4 实现
            return {'id': req_id, 'ok': True, 'result': {'cancelled': True}}

        if cmd == 'extract_template':
            return _handle_extract_template(req_id, req)

        if cmd == 'extract_all':
            return _handle_extract_all(req_id, req)

        if cmd == 'extract_from_selection':
            return _handle_extract_from_selection(req_id, req)

        if cmd == 'list_fields':
            return _handle_list_fields(req_id)

        return {
            'id': req_id, 'ok': False,
            'error': f'unknown cmd: {cmd}',
            'code': 'UNKNOWN_CMD',
        }
    except Exception as e:
        return {
            'id': req_id, 'ok': False,
            'error': f'{type(e).__name__}: {e}\n{traceback.format_exc()}',
            'code': 'INTERNAL',
        }


def _handle_detect(req_id: str, req: dict) -> dict:
    file = req['file']
    template = req['template']

    # ENOENT 检查必须在 Document() 前，否则 python-docx 的报错信息不统一
    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}

    try:
        doc = Document(file)
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}
    except PermissionError as e:
        return {'id': req_id, 'ok': False, 'error': str(e), 'code': 'EPERM'}

    all_issues: list = []
    for rule_id, rule_cfg in template['rules'].items():
        if not rule_cfg.get('enabled', False):
            continue
        rule = REGISTRY.get(rule_id)
        if rule is None:
            # 未注册的规则跳过（模板 schema 可能比当前 sidecar 新）
            continue

        try:
            found = rule.detect(doc, rule_cfg.get('value'))
        except Exception as e:
            # spec Section 7：单规则抛异常 → 整批中止，不 continue 到下一规则
            return {
                'id': req_id, 'ok': False,
                'error': f'rule {rule_id} raised: {type(e).__name__}: {e}\n{traceback.format_exc()}',
                'code': 'RULE_ERROR',
            }

        # 给每个 issue 分配稳定 id（基于全局偏移，跨规则唯一）
        for idx, issue in enumerate(found):
            issue.issue_id = f'{rule_id}-{len(all_issues) + idx}'
        all_issues.extend(found)

    return {
        'id': req_id, 'ok': True,
        'result': {'issues': [i.to_dict() for i in all_issues]},
    }


def _handle_fix(req_id: str, req: dict) -> dict:
    # P2 简化：fix 接受完整 issue payload（后续 P4 可能改为按 issue_id 查库）
    file = req['file']
    issue_dict = req['issue']
    rule_id = issue_dict['rule_id']
    value = req.get('value', {})

    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}

    try:
        doc = Document(file)
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}

    rule = REGISTRY.get(rule_id)
    if rule is None:
        return {'id': req_id, 'ok': False, 'error': f'unknown rule: {rule_id}', 'code': 'UNKNOWN_RULE'}

    # 把 dict 手动还原成 Issue，loc 用 Location(**) 展开字段
    from .models import Issue, Location
    issue = Issue(
        rule_id=rule_id,
        loc=Location(**issue_dict['loc']),
        message=issue_dict['message'],
        current=issue_dict['current'],
        expected=issue_dict['expected'],
        fix_available=issue_dict['fix_available'],
        issue_id=issue_dict.get('issue_id', ''),
    )

    result = rule.fix(doc, issue, value)
    doc.save(file)

    return {'id': req_id, 'ok': True, 'result': result.to_dict()}


def _handle_fix_preview(req_id: str, req: dict) -> dict:
    """预览模式：执行修复逻辑但不写回文件，返回 diff 供前端展示"""
    file = req['file']
    issue_dict = req['issue']

    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}

    rule_id = issue_dict['rule_id']
    value = req.get('value', {})

    try:
        doc = Document(file)
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}

    rule = REGISTRY.get(rule_id)
    if rule is None:
        return {'id': req_id, 'ok': False, 'error': f'unknown rule: {rule_id}', 'code': 'UNKNOWN_RULE'}

    from .models import Issue, Location
    issue = Issue(
        rule_id=rule_id,
        loc=Location(**issue_dict['loc']),
        message=issue_dict['message'],
        current=issue_dict['current'],
        expected=issue_dict['expected'],
        fix_available=issue_dict['fix_available'],
        issue_id=issue_dict.get('issue_id', ''),
    )

    result = rule.fix(doc, issue, value)
    # 预览模式：不调 doc.save()，并将 applied 标记为 False
    result.applied = False

    return {'id': req_id, 'ok': True, 'result': result.to_dict()}


def _handle_extract_template(req_id: str, req: dict) -> dict:
    """
    从 docx 文件反推模板规则值。

    业务逻辑：
    1. ENOENT 检查必须在 extract_from_docx 前：python-docx 在路径不存在时
       抛出的 PackageNotFoundError 与 malformed docx 相同，无法区分两种错误
    2. 调用 extractor.extract_from_docx(file)，内部自行 Document(file)
    3. PackageNotFoundError 在 extractor 内部触发时向上冒泡，此处捕获转 PARSE_ERROR
    """
    file = req['file']
    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}
    try:
        from .extractor import extract_from_docx
        result = extract_from_docx(file)
        return {'id': req_id, 'ok': True, 'result': result}
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}


def _handle_extract_all(req_id: str, req: dict) -> dict:
    """
    P4 语义字段抽取：扫描整个 docx，返回所有识别到的语义字段规则和证据。

    业务逻辑：
    1. ENOENT 检查先于 pipeline，原因同 _handle_extract_template
    2. 调用 pipeline.extract_all(file)，返回 {rules, evidence}
    3. PackageNotFoundError → PARSE_ERROR，与其它命令保持一致
    """
    file = req['file']
    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}
    try:
        from .extractor.pipeline import extract_all
        result = extract_all(file)
        return {'id': req_id, 'ok': True, 'result': result}
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}


def _handle_extract_from_selection(req_id: str, req: dict) -> dict:
    """
    P4 基于用户选中段落的精确字段抽取。

    业务逻辑：
    1. 接受 para_indices（用户在预览中点选的段落索引列表）和 field_id（目标字段）
    2. ENOENT 检查先于 pipeline
    3. 调用 pipeline.extract_from_selection(file, para_indices, field_id)
    """
    file = req['file']
    para_indices = req['para_indices']
    field_id = req['field_id']
    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}
    try:
        from .extractor.pipeline import extract_from_selection
        result = extract_from_selection(file, para_indices, field_id)
        return {'id': req_id, 'ok': True, 'result': result}
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}


def _handle_list_fields(req_id: str) -> dict:
    from .engine_v2.field_defs import FIELD_DEFS
    return {'id': req_id, 'ok': True, 'result': {'fields': FIELD_DEFS}}

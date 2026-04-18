"""
@file: test_handlers.py
@description: handlers.handle() 命令路由测试
@author: Atlas.oi
@date: 2026-04-17
"""
import pytest
from pathlib import Path
from thesis_worker.handlers import handle

FIXTURES = Path(__file__).parent / 'fixtures'


MIN_TEMPLATE = {
    'rules': {
        'cjk_ascii_space': {'enabled': True, 'value': {'allowed': False}},
    }
}


class TestPing:
    def test_ping_returns_pong(self):
        resp = handle({'id': 'r1', 'cmd': 'ping'})
        assert resp == {'id': 'r1', 'ok': True, 'result': 'pong'}


class TestDetect:
    @pytest.mark.skip(reason="P3 schema (cjk_ascii_space REGISTRY rule); replaced by v2 detector in Task 10; P3 code removed in Task 19")
    def test_detect_returns_issues(self):
        resp = handle({
            'id': 'r2',
            'cmd': 'detect',
            'file': str(FIXTURES / 'cjk_space_bad.docx'),
            'template': MIN_TEMPLATE,
        })
        assert resp['ok'] is True
        assert 'issues' in resp['result']
        assert len(resp['result']['issues']) == 4

    def test_detect_file_not_found_returns_enoent(self):
        resp = handle({
            'id': 'r3',
            'cmd': 'detect',
            'file': '/nonexistent/xxx.docx',
            'template': MIN_TEMPLATE,
        })
        assert resp['ok'] is False
        assert resp['code'] == 'ENOENT'


class TestUnknownCmd:
    def test_unknown_cmd_returns_error(self):
        resp = handle({'id': 'r4', 'cmd': 'nope'})
        assert resp['ok'] is False
        assert resp['code'] == 'UNKNOWN_CMD'


class TestFixPreview:
    @pytest.mark.skip(reason="P3 schema (cjk_ascii_space REGISTRY rule); detect 返回空 issues，issue[0] IndexError；replaced by v2 detector in Task 10; P3 code removed in Task 19")
    def test_fix_preview_returns_diff_no_write(self, tmp_path):
        import shutil
        import os
        origin = FIXTURES / 'cjk_space_bad.docx'
        tmp = tmp_path / 'copy.docx'
        shutil.copy(origin, tmp)
        # 先 detect 拿 issue
        resp = handle({'id': 'r1', 'cmd': 'detect', 'file': str(tmp), 'template': MIN_TEMPLATE})
        assert resp['ok'] is True
        issue = resp['result']['issues'][0]
        # fix_preview 返回 diff 但不写回文件
        mtime_before = os.path.getmtime(tmp)
        resp = handle({'id': 'r2', 'cmd': 'fix_preview', 'file': str(tmp), 'issue': issue, 'value': {'allowed': False}})
        assert resp['ok'] is True
        assert 'diff' in resp['result']
        # applied 字段应为 False（预览模式未写回）
        assert resp['result']['applied'] is False
        assert os.path.getmtime(tmp) == mtime_before  # 文件未被修改

    def test_fix_preview_file_not_found(self):
        resp = handle({'id': 'r3', 'cmd': 'fix_preview', 'file': '/nonexistent/xxx.docx', 'issue': {}, 'value': {}})
        assert resp['ok'] is False
        assert resp['code'] == 'ENOENT'


class TestListRules:
    def test_list_rules_returns_all_registered(self):
        resp = handle({'id': 'r1', 'cmd': 'list_rules'})
        assert resp['ok'] is True
        assert 'rules' in resp['result']
        # 至少包含已注册的规则（不断言 length，Phase C 会扩展）
        assert 'cjk_ascii_space' in resp['result']['rules']


class TestCancel:
    def test_cancel_returns_ack(self):
        # P3 sidecar 单线程串行；cancel 只做 ack（真实中断留 P4）
        resp = handle({'id': 'r1', 'cmd': 'cancel'})
        assert resp['ok'] is True
        assert resp['result']['cancelled'] is True


class TestExtractTemplate:
    def test_extract_template_returns_rules_and_evidence(self, tmp_path):
        """正常 docx → ok=True，result 含所有 REGISTRY 规则 + evidence 列表"""
        from docx import Document as _Doc
        # 创建一个最小合法 docx（含一个段落，使 python-docx 可正常读取正文样式）
        tmp = tmp_path / 'sample.docx'
        doc = _Doc()
        doc.add_paragraph('测试段落 test paragraph')
        doc.save(str(tmp))

        resp = handle({'id': 'e1', 'cmd': 'extract_template', 'file': str(tmp)})
        assert resp['ok'] is True
        result = resp['result']
        # 必须含 rules 和 evidence 两个顶层字段
        assert 'rules' in result
        assert 'evidence' in result
        # rules 应覆盖全部 REGISTRY 条目（当前 11 条）
        from thesis_worker.rules import REGISTRY
        assert set(result['rules'].keys()) == set(REGISTRY.keys())
        # evidence 列表长度与 rules 数量一致
        assert len(result['evidence']) == len(REGISTRY)

    def test_extract_template_file_not_found_returns_enoent(self):
        """不存在文件 → ok=False, code=ENOENT"""
        resp = handle({'id': 'e2', 'cmd': 'extract_template', 'file': '/nonexistent/fake.docx'})
        assert resp['ok'] is False
        assert resp['code'] == 'ENOENT'

    def test_extract_template_malformed_docx_returns_parse_error(self, tmp_path):
        """非合法 docx（纯文本写入）→ ok=False, code=PARSE_ERROR"""
        fake = tmp_path / 'fake.docx'
        fake.write_text('this is not a docx file', encoding='utf-8')
        resp = handle({'id': 'e3', 'cmd': 'extract_template', 'file': str(fake)})
        assert resp['ok'] is False
        assert resp['code'] == 'PARSE_ERROR'


class TestRuleException:
    @pytest.mark.skip(reason="P3 schema (monkeypatches P3 REGISTRY rule); v2 detector 不走 REGISTRY，注入无效；replaced by v2 detector in Task 10; P3 code removed in Task 19")
    def test_rule_raising_exception_aborts_batch(self, monkeypatch):
        """按 spec Section 7：规则异常 → 整批中止，抛 RULE_ERROR"""
        from thesis_worker.rules import REGISTRY

        def boom(doc, value):
            raise RuntimeError('rule boom')

        monkeypatch.setattr(REGISTRY['cjk_ascii_space'], 'detect', staticmethod(boom))

        resp = handle({
            'id': 'r5',
            'cmd': 'detect',
            'file': str(FIXTURES / 'cjk_space_bad.docx'),
            'template': MIN_TEMPLATE,
        })
        assert resp['ok'] is False
        assert resp['code'] == 'RULE_ERROR'
        assert 'cjk_ascii_space' in resp['error']
        assert 'rule boom' in resp['error']

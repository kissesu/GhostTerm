"""
@file: test_handlers.py
@description: handlers.handle() 命令路由测试
@author: Atlas.oi
@date: 2026-04-17
"""
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


class TestRuleException:
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

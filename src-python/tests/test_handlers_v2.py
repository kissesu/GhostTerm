"""
@file: test_handlers_v2.py
@description: P4 新增 sidecar 命令测试：extract_all / extract_from_selection / list_fields
@author: Atlas.oi
@date: 2026-04-18
"""
from pathlib import Path
from thesis_worker.handlers import handle

FIXTURES = Path(__file__).parent / 'fixtures'


class TestExtractAll:
    def test_cmd_returns_rules(self):
        resp = handle({
            'id': 'r1',
            'cmd': 'extract_all',
            'file': str(FIXTURES / 'spec_template_a.docx'),
        })
        assert resp['ok'] is True
        assert 'rules' in resp['result']
        assert 'evidence' in resp['result']

    def test_file_not_found(self):
        resp = handle({
            'id': 'r2',
            'cmd': 'extract_all',
            'file': '/nonexistent.docx',
        })
        assert resp['ok'] is False
        assert resp['code'] == 'ENOENT'


class TestExtractFromSelection:
    def test_cmd(self):
        resp = handle({
            'id': 'r3',
            'cmd': 'extract_from_selection',
            'file': str(FIXTURES / 'spec_template_a.docx'),
            'para_indices': [1],
            'field_id': 'abstract_zh_title',
        })
        assert resp['ok'] is True
        assert resp['result']['field_id'] == 'abstract_zh_title'


class TestListFields:
    def test_returns_placeholder_for_now(self):
        # Task 8 会让这里返回 32 字段；目前占位返回空列表
        resp = handle({'id': 'r4', 'cmd': 'list_fields'})
        assert resp['ok'] is True
        assert resp['result']['fields'] == []

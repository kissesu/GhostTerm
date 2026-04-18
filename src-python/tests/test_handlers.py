"""
@file: test_handlers.py
@description: handlers.handle() 命令路由测试（P4 清理后仅保留 v2 engine 相关测试）
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from pathlib import Path
from thesis_worker.handlers import handle

FIXTURES = Path(__file__).parent / 'fixtures'


class TestPing:
    def test_ping_returns_pong(self):
        resp = handle({'id': 'r1', 'cmd': 'ping'})
        assert resp == {'id': 'r1', 'ok': True, 'result': 'pong'}


class TestDetect:
    def test_detect_file_not_found_returns_enoent(self):
        resp = handle({
            'id': 'r3',
            'cmd': 'detect',
            'file': '/nonexistent/xxx.docx',
            'template': {'rules': {}},
        })
        assert resp['ok'] is False
        assert resp['code'] == 'ENOENT'


class TestUnknownCmd:
    def test_unknown_cmd_returns_error(self):
        resp = handle({'id': 'r4', 'cmd': 'nope'})
        assert resp['ok'] is False
        assert resp['code'] == 'UNKNOWN_CMD'


class TestFixPreview:
    def test_fix_preview_file_not_found(self):
        resp = handle({'id': 'r3', 'cmd': 'fix_preview', 'file': '/nonexistent/xxx.docx', 'issue': {}, 'value': {}})
        assert resp['ok'] is False
        assert resp['code'] == 'ENOENT'


class TestCancel:
    def test_cancel_returns_ack(self):
        # P3 sidecar 单线程串行；cancel 只做 ack（真实中断留 P4）
        resp = handle({'id': 'r1', 'cmd': 'cancel'})
        assert resp['ok'] is True
        assert resp['result']['cancelled'] is True

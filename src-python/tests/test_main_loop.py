"""
@file: test_main_loop.py
@description: sidecar 主循环 stdio NDJSON 测试
@author: Atlas.oi
@date: 2026-04-17
"""
import json
import subprocess
import sys
from pathlib import Path


def test_main_loop_responds_to_ping():
    """启动 sidecar 进程，发 ping，读响应"""
    proc = subprocess.Popen(
        [sys.executable, '-m', 'thesis_worker'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(Path(__file__).parent.parent),  # src-python/
    )
    try:
        proc.stdin.write(json.dumps({'id': 'p1', 'cmd': 'ping'}) + '\n')
        proc.stdin.flush()
        line = proc.stdout.readline()
        resp = json.loads(line)
        assert resp == {'id': 'p1', 'ok': True, 'result': 'pong'}
    finally:
        proc.stdin.close()
        proc.wait(timeout=5)


def test_main_loop_handles_malformed_json():
    """发非法 JSON，应回 PARSE_ERROR 而不是崩"""
    proc = subprocess.Popen(
        [sys.executable, '-m', 'thesis_worker'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(Path(__file__).parent.parent),
    )
    try:
        proc.stdin.write('this is not json\n')
        proc.stdin.flush()
        line = proc.stdout.readline()
        resp = json.loads(line)
        assert resp['ok'] is False
        assert resp['code'] == 'PARSE_ERROR'

        # 错误后仍能处理下一条
        proc.stdin.write(json.dumps({'id': 'p2', 'cmd': 'ping'}) + '\n')
        proc.stdin.flush()
        line = proc.stdout.readline()
        resp = json.loads(line)
        assert resp['ok'] is True
    finally:
        proc.stdin.close()
        proc.wait(timeout=5)


def test_main_loop_exits_on_stdin_close():
    proc = subprocess.Popen(
        [sys.executable, '-m', 'thesis_worker'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(Path(__file__).parent.parent),
    )
    proc.stdin.close()
    exitcode = proc.wait(timeout=5)
    assert exitcode == 0

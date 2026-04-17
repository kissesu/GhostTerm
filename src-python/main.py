"""
@file: main.py
@description: PyInstaller 打包入口（顶层脚本）。
              使用绝对导入调用 thesis_worker，避免相对导入在
              PyInstaller --onefile 模式下触发 ImportError。
              python -m thesis_worker 调用路径不受影响。
@author: Atlas.oi
@date: 2026-04-17
"""
import sys

from thesis_worker.handlers import handle
import json


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            resp = {'id': None, 'ok': False, 'error': str(e), 'code': 'PARSE_ERROR'}
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
            sys.stdout.flush()
            continue

        resp = handle(req)
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
        sys.stdout.flush()

    return 0


if __name__ == '__main__':
    sys.exit(main())

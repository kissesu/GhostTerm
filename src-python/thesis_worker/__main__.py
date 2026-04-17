"""
@file: __main__.py
@description: sidecar 入口。NDJSON over stdin/stdout 主循环。
              - 每行一个 JSON 请求
              - 响应每行一个 JSON
              - stdin EOF -> 正常退出（exitcode 0）
              - 非法 JSON -> 返回 PARSE_ERROR，继续接下一条（不崩）
              - handler 异常 -> 捕获并转 INTERNAL 响应
@author: Atlas.oi
@date: 2026-04-17
"""
import json
import sys

from .handlers import handle


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            # 空行跳过，不产生任何输出
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            # 非法 JSON 返回结构化错误，不中断主循环
            resp = {'id': None, 'ok': False, 'error': str(e), 'code': 'PARSE_ERROR'}
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
            sys.stdout.flush()
            continue

        resp = handle(req)
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
        sys.stdout.flush()

    # stdin EOF 自然退出，exitcode 0
    return 0


if __name__ == '__main__':
    sys.exit(main())

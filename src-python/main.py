"""
@file: main.py
@description: PyInstaller --onefile 打包的顶层入口。委托给 package 内的 main()，
              用绝对 import 绕过 --onefile 下相对 import 失效问题。
@author: Atlas.oi
@date: 2026-04-17
"""
import sys

from thesis_worker.__main__ import main


if __name__ == '__main__':
    sys.exit(main())

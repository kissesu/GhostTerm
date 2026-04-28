"""
@file: test_size.py
@description: 字号名 ↔ pt 映射测试
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.utils.size import CHINESE_SIZE_MAP, name_to_pt, pt_to_name


class TestNameToPt:
    def test_known_sizes(self):
        assert name_to_pt('小四') == 12.0
        assert name_to_pt('小三') == 15.0
        assert name_to_pt('三号') == 16.0

    def test_unknown_returns_none(self):
        assert name_to_pt('不存在') is None


class TestPtToName:
    def test_known_pt(self):
        assert pt_to_name(12) == '小四'
        assert pt_to_name(15) == '小三'

    def test_float_pt(self):
        assert pt_to_name(10.5) == '五号'

    def test_unknown_returns_none(self):
        assert pt_to_name(999) is None


class TestMap:
    def test_has_16_entries(self):
        # T1.2 之后扩展到 16 项（原 14 + 七号 + 八号）；新增字号需同步本断言
        assert len(CHINESE_SIZE_MAP) == 16

    def test_all_values_are_numeric(self):
        for name, pt in CHINESE_SIZE_MAP.items():
            assert isinstance(pt, (int, float))

# P4 - 论文语义字段规则引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P3 的 11 条抽象规则引擎重构为 32 个论文语义字段引擎，支持用户上传任意规范 docx 自动抽取 + 手动补全，实现 Flow C 调整版的 sequential + 📍 临时打断交互。

**Architecture:** Python sidecar 扩展（Gazetteer + 正则 patterns + field_matcher + 3 条新 NDJSON 命令 + v2 rule engine）；Rust 端内置模板替换；前端新建 DocxPreview（docx-preview.js wrapper 注入 para_idx）+ FieldList（sequential 推进）+ RuleTemplateWorkspace（双栏整合）+ TemplateStore v2 升级；复用 P3 90% 架构。

**Tech Stack:** Python 3.12 + python-docx + pytest / Rust 2021 + tauri 2 + cargo test / React + TypeScript + Zustand + docx-preview.js + vitest

**依赖 plan:** P3（milestone-p3-tools @ main HEAD 7360ae2）已 merge main。P4 基于 main 分支 `feat/p4-semantic-fields`（已建好，含 spec commit f55e8d7）。

**依赖 spec:** `docs/superpowers/specs/2026-04-18-p4-semantic-fields-design.md`（564 行，所有决策已定）

**不在本 plan 范围：**

- HanLP NLP 库集成（MVP 先正则 + 词典）
- .doc 格式支持（用户自转 .docx）
- 封面 5 字段格式检查（学校固定模板）
- 四级章节标题 / 公式编号 / AI 化自动改写 / 图表自动重排
- v1 → v2 自动字段映射（硬破坏迁移）
- LibreOffice / Word COM 依赖

---

## File Structure

| 动作 | 路径 | 职责 |
|------|------|------|
| Create | `src-python/thesis_worker/utils/size.py` | 字号名 → pt 映射表（后端） |
| Create | `src-python/thesis_worker/extractor/__init__.py` | extractor 包入口 |
| Create | `src-python/thesis_worker/extractor/gazetteer.py` | 字体/对齐/加粗词典 |
| Create | `src-python/thesis_worker/extractor/patterns.py` | A 型括号 + B 型叙述正则 |
| Create | `src-python/thesis_worker/extractor/field_matcher.py` | 字段 id → 触发关键词 + 定位算法 |
| Create | `src-python/thesis_worker/extractor/pipeline.py` | extract_all / extract_from_selection 主函数 |
| Create | `src-python/thesis_worker/engine_v2/__init__.py` | v2 rule engine 包入口 |
| Create | `src-python/thesis_worker/engine_v2/field_defs.py` | 32 字段定义（id/label/group/order/applicable_attributes） |
| Create | `src-python/thesis_worker/engine_v2/checkers.py` | 按属性 key 的 attribute checker |
| Create | `src-python/thesis_worker/engine_v2/detector.py` | v2 detect 实现 |
| Create | `src-python/thesis_worker/engine_v2/fixer.py` | v2 fix 实现 + 蓝色标记 |
| Modify | `src-python/thesis_worker/handlers.py` | 接入 extract_all / extract_from_selection / list_fields 命令 + detect/fix dispatch 到 v2 |
| Create | `src-python/tests/extractor/test_gazetteer.py` | 词典单元测试 |
| Create | `src-python/tests/extractor/test_patterns.py` | 正则 pattern 测试 |
| Create | `src-python/tests/extractor/test_field_matcher.py` | 字段关联测试 |
| Create | `src-python/tests/extractor/test_pipeline_a.py` | Template A 型全流程 |
| Create | `src-python/tests/extractor/test_pipeline_b.py` | Template B 型全流程 |
| Create | `src-python/tests/engine_v2/test_checkers.py` | attribute checker 单元测试 |
| Create | `src-python/tests/engine_v2/test_detector.py` | v2 detector 测试 |
| Create | `src-python/tests/engine_v2/test_fixer.py` | v2 fixer reopen 硬测试 |
| Create | `src-python/tests/fixtures/spec_template_a.docx` | A 型小样本 fixture |
| Create | `src-python/tests/fixtures/spec_template_b.docx` | B 型小样本 fixture |
| Create | `src-tauri/templates/_builtin-gbt7714-v2.json` | 32 字段起点模板 |
| Modify | `src-tauri/src/template_cmd.rs` | BUILTIN_JSON 指向 v2 文件 + `_builtin-gbt7714-v2` 为新 BUILTIN_ID |
| Modify | `src-tauri/tests/template_cmd.rs` | 测试 BUILTIN_ID 常量 + v2 schema 可序列化 |
| Create | `src/features/tools/templates/chineseSizeMap.ts` | 前端字号名 → pt |
| Modify | `src/features/tools/templates/TemplateStore.ts` | TemplateJson v2 类型扩展（TemplateSource/rules 保留不变，rules key 改为 field_id） |
| Create | `src/features/tools/templates/fieldDefs.ts` | 32 字段定义 + applicable_attributes |
| Modify | `src/features/tools/templates/ruleSchemas.ts` | 改为按属性 key 分发 RuleValueEditor（而非按旧 rule_id） |
| Modify | `src/features/tools/templates/RuleValueEditor.tsx` | 支持新属性 key（font.cjk / para.align 等 22 项） |
| Modify | `src/features/tools/templates/TemplateEditor.tsx` | 渲染 32 字段（从 fieldDefs.ts 读取） |
| Create | `src/features/tools/templates/DocxPreview.tsx` | docx-preview.js wrapper，每段落注入 data-para-idx + hover/click |
| Create | `src/features/tools/templates/FieldList.tsx` | 32 字段表 + sequential + 📍 + 跳过 |
| Create | `src/features/tools/templates/RuleTemplateWorkspace.tsx` | 双栏整合 + extract_all 预抓 + sequential 推进 |
| Modify | `src/features/tools/templates/TemplateManager.tsx` | 从 docx 新建走 RuleTemplateWorkspace（替代 P3 的 TemplateExtractor） |
| Delete | `src/features/tools/templates/TemplateExtractor.tsx` | P3 的表格式 extractor 废弃 |
| Modify | `src/features/tools/toolsSidecarClient.ts` | 加 ExtractAllRequest / ExtractFromSelectionRequest / ListFieldsRequest 类型 |
| Create | `src/features/tools/__tests__/DocxPreview.test.tsx` | para_idx 注入 + click handler |
| Create | `src/features/tools/__tests__/FieldList.test.tsx` | sequential + 📍 + 跳过 |
| Create | `src/features/tools/__tests__/RuleTemplateWorkspace.test.tsx` | 整合流程 |
| Create | `src/features/tools/__tests__/fieldDefs.test.ts` | 32 字段断言 |
| Modify | `src/features/tools/__tests__/templateStore.test.ts` | v2 schema 测试 |

---

## Phase A — Python sidecar 基础设施（Task 1-5）

### Task 1：字号名 → pt 映射（后端 + 前端）

**Files:**
- Create: `src-python/thesis_worker/utils/__init__.py`（空）
- Create: `src-python/thesis_worker/utils/size.py`
- Create: `src-python/tests/utils/__init__.py`（空）
- Create: `src-python/tests/utils/test_size.py`
- Create: `src/features/tools/templates/chineseSizeMap.ts`

- [ ] **Step 1: 写失败测试 test_size.py**

```python
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
    def test_has_14_entries(self):
        assert len(CHINESE_SIZE_MAP) == 14

    def test_all_values_are_numeric(self):
        for name, pt in CHINESE_SIZE_MAP.items():
            assert isinstance(pt, (int, float))
```

- [ ] **Step 2: 运行看红**

```bash
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm/src-python
uv run pytest tests/utils/test_size.py -v
```
Expected: FAIL `ModuleNotFoundError: No module named 'thesis_worker.utils.size'`

- [ ] **Step 3: 实现 size.py**

```python
"""
@file: size.py
@description: 中文字号名 ↔ pt 值映射
              数值参照 GB/T 9851.3 和实际 Word 使用惯例
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Optional

# 字号名 → pt 值（14 项，静态表）
CHINESE_SIZE_MAP: dict[str, float] = {
    '初号': 42.0,
    '小初': 36.0,
    '一号': 26.0,
    '小一': 24.0,
    '二号': 22.0,
    '小二': 18.0,
    '三号': 16.0,
    '小三': 15.0,
    '四号': 14.0,
    '小四': 12.0,
    '五号': 10.5,
    '小五': 9.0,
    '六号': 7.5,
    '小六': 6.5,
}

# 反向查找表
_PT_TO_NAME: dict[float, str] = {v: k for k, v in CHINESE_SIZE_MAP.items()}


def name_to_pt(name: str) -> Optional[float]:
    """字号名 → pt 值；不存在返回 None"""
    return CHINESE_SIZE_MAP.get(name)


def pt_to_name(pt: float) -> Optional[str]:
    """pt 值 → 字号名；不存在返回 None"""
    return _PT_TO_NAME.get(float(pt))
```

- [ ] **Step 4: 测试全绿**

```bash
uv run pytest tests/utils/test_size.py -v
```
Expected: `8 passed`

- [ ] **Step 5: 写前端 chineseSizeMap.ts**

```typescript
/**
 * @file chineseSizeMap.ts
 * @description 中文字号名 ↔ pt 值映射（与后端 src-python/thesis_worker/utils/size.py 同步）
 * @author Atlas.oi
 * @date 2026-04-18
 */

export const CHINESE_SIZE_MAP: Record<string, number> = {
  '初号': 42,
  '小初': 36,
  '一号': 26,
  '小一': 24,
  '二号': 22,
  '小二': 18,
  '三号': 16,
  '小三': 15,
  '四号': 14,
  '小四': 12,
  '五号': 10.5,
  '小五': 9,
  '六号': 7.5,
  '小六': 6.5,
};

/** 字号名 → pt 值；不存在返回 null */
export function nameToPt(name: string): number | null {
  return CHINESE_SIZE_MAP[name] ?? null;
}

/** pt 值 → 字号名；不存在返回 null */
export function ptToName(pt: number): string | null {
  for (const [name, value] of Object.entries(CHINESE_SIZE_MAP)) {
    if (value === pt) return name;
  }
  return null;
}
```

- [ ] **Step 6: 提交**

```bash
git add src-python/thesis_worker/utils/ src-python/tests/utils/ src/features/tools/templates/chineseSizeMap.ts
git commit -m "feat(p4): 中文字号名 ↔ pt 映射（前后端各一份）"
```

---

### Task 2：Gazetteer 词典

**Files:**
- Create: `src-python/thesis_worker/extractor/__init__.py`（空）
- Create: `src-python/thesis_worker/extractor/gazetteer.py`
- Create: `src-python/tests/extractor/__init__.py`（空）
- Create: `src-python/tests/extractor/test_gazetteer.py`

- [ ] **Step 1: 写失败测试**

```python
"""
@file: test_gazetteer.py
@description: Gazetteer 词典匹配测试
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.extractor.gazetteer import (
    CJK_FONTS, ASCII_FONTS, ALIGN_MAP, BOLD_KEYWORDS,
    find_font, find_align, is_bold_keyword,
)


class TestFonts:
    def test_cjk_fonts_contain_common(self):
        assert '宋体' in CJK_FONTS
        assert '黑体' in CJK_FONTS
        assert '楷体' in CJK_FONTS
        assert '仿宋' in CJK_FONTS

    def test_ascii_fonts_contain_tnr(self):
        assert 'Times New Roman' in ASCII_FONTS
        assert 'Arial' in ASCII_FONTS


class TestFindFont:
    def test_find_cjk(self):
        text = '小四号宋体加粗'
        result = find_font(text)
        assert result == ('cjk', '宋体')

    def test_find_ascii(self):
        text = 'Times New Roman 加粗'
        result = find_font(text)
        assert result == ('ascii', 'Times New Roman')

    def test_find_both_returns_cjk_priority(self):
        text = '宋体或 Times New Roman'
        # 先匹配到的胜出（此处是宋体）
        result = find_font(text)
        assert result[1] == '宋体'

    def test_no_match(self):
        assert find_font('一段普通文字') is None


class TestFindAlign:
    def test_center(self):
        assert find_align('居中显示') == 'center'

    def test_left(self):
        assert find_align('顶格左对齐') == 'left'

    def test_justify(self):
        assert find_align('两端对齐') == 'justify'

    def test_no_match(self):
        assert find_align('没有对齐词') is None


class TestBoldKeyword:
    def test_bold(self):
        assert is_bold_keyword('加粗') is True
        assert is_bold_keyword('粗体') is True

    def test_no_bold(self):
        assert is_bold_keyword('斜体') is False
```

- [ ] **Step 2: 运行看红**

```bash
uv run pytest tests/extractor/test_gazetteer.py -v
```
Expected: FAIL `ModuleNotFoundError`

- [ ] **Step 3: 实现 gazetteer.py**

```python
"""
@file: gazetteer.py
@description: 格式属性关键词词典 + 词典匹配函数
              覆盖规范文档里描述字体/对齐/加粗等格式属性的中英文词
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Optional

# 中文字体名（常见论文字体）
CJK_FONTS: frozenset[str] = frozenset([
    '宋体', '黑体', '楷体', '仿宋', '楷体_GB2312', '仿宋_GB2312',
    '方正仿宋_GBK', '方正黑体_GBK', '隶书', '新宋体', '华文中宋',
    '华文宋体', '华文仿宋', '华文黑体',
])

# 英文字体名
ASCII_FONTS: frozenset[str] = frozenset([
    'Times New Roman', 'Arial', 'Calibri', 'Cambria',
    'Georgia', 'Verdana',
])

# 对齐词 → alignment 值
ALIGN_MAP: dict[str, str] = {
    '居中': 'center',
    '左对齐': 'left',
    '顶格': 'left',
    '顶头': 'left',
    '左顶格': 'left',
    '右对齐': 'right',
    '右顶格': 'right',
    '两端对齐': 'justify',
    '分散对齐': 'justify',
}

# 加粗关键词
BOLD_KEYWORDS: frozenset[str] = frozenset(['加粗', '粗体'])


def find_font(text: str) -> Optional[tuple[str, str]]:
    """在文本中找到第一个匹配的字体名
    返回 ('cjk' | 'ascii', 字体名) 或 None
    按 CJK 优先，遇到就返回"""
    for font in CJK_FONTS:
        if font in text:
            return ('cjk', font)
    for font in ASCII_FONTS:
        if font in text:
            return ('ascii', font)
    return None


def find_align(text: str) -> Optional[str]:
    """在文本中找到对齐词，返回标准 alignment 值或 None"""
    for keyword, value in ALIGN_MAP.items():
        if keyword in text:
            return value
    return None


def is_bold_keyword(text: str) -> bool:
    """检测文本是否含"加粗"/"粗体"关键词"""
    return any(kw in text for kw in BOLD_KEYWORDS)
```

- [ ] **Step 4: 测试全绿**

```bash
uv run pytest tests/extractor/test_gazetteer.py -v
```
Expected: 约 14 passed

- [ ] **Step 5: 提交**

```bash
git add src-python/thesis_worker/extractor/ src-python/tests/extractor/
git commit -m "feat(p4): Gazetteer 词典（字体/对齐/加粗关键词匹配）"
```

---

### Task 3：正则 Pattern 库

**Files:**
- Create: `src-python/thesis_worker/extractor/patterns.py`
- Create: `src-python/tests/extractor/test_patterns.py`

- [ ] **Step 1: 写失败测试**

```python
"""
@file: test_patterns.py
@description: 正则 pattern 抽取字号/字体等属性
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.extractor.patterns import (
    extract_size_name, extract_size_pt_raw,
    find_parens_annotation, find_quoted_field,
)


class TestExtractSize:
    def test_size_name(self):
        assert extract_size_name('小三号宋体') == '小三'
        assert extract_size_name('三号黑体') == '三号'
        assert extract_size_name('小四') == '小四'

    def test_pt_raw(self):
        assert extract_size_pt_raw('12pt 宋体') == 12.0
        assert extract_size_pt_raw('字号 15 磅') == 15.0
        assert extract_size_pt_raw('10.5pt') == 10.5

    def test_no_size(self):
        assert extract_size_name('无字号描述') is None
        assert extract_size_pt_raw('无字号描述') is None


class TestAnnotation:
    def test_parens_capture(self):
        text = '摘要（小三号宋体加粗，居中）'
        result = find_parens_annotation(text)
        assert result is not None
        field_name, annotation = result
        assert field_name.strip() == '摘要'
        assert '小三号' in annotation

    def test_multiple_parens(self):
        text = '关键词：（无缩进，小四宋体加粗）内容（3-5 个）'
        result = find_parens_annotation(text)
        assert result is not None
        assert result[0].strip() == '关键词：'


class TestQuoted:
    def test_quoted_field(self):
        text = '"摘要"二字为黑体小四号'
        result = find_quoted_field(text)
        assert result is not None
        field_name, rest = result
        assert field_name == '摘要'
        assert '黑体' in rest

    def test_chinese_quotes(self):
        text = '“Abstract”为 Times New Roman 小四号'
        result = find_quoted_field(text)
        assert result is not None
        assert result[0] == 'Abstract'
```

- [ ] **Step 2: 运行看红**

```bash
uv run pytest tests/extractor/test_patterns.py -v
```

- [ ] **Step 3: 实现 patterns.py**

```python
"""
@file: patterns.py
@description: 正则 pattern 库，抽取规范文档里的字号/字体/样式说明
              覆盖两种主流风格：
              - A 型括号：「字段（小三号宋体加粗，居中）」
              - B 型叙述：「"摘要"二字为黑体小四号」
@author: Atlas.oi
@date: 2026-04-18
"""
import re
from typing import Optional

from ..utils.size import CHINESE_SIZE_MAP

# 字号名正则：匹配 "小三" / "三号" / "小三号" 等
_SIZE_NAME_RE = re.compile(
    r'(' + '|'.join(re.escape(k) for k in CHINESE_SIZE_MAP) + r')(?:号)?'
)

# 纯数字 pt 字号：匹配 "12pt" / "15 磅" / "10.5pt"
_SIZE_PT_RE = re.compile(r'(\d+(?:\.\d+)?)\s*(?:pt|磅|点)', re.IGNORECASE)

# A 型括号说明：匹配 "字段名（括号内描述）"
# 注意：用中文全角括号 （ ）
_PARENS_RE = re.compile(r'([^（）\n]{1,40})（([^（）]{3,200})）')

# B 型引号字段：匹配 "'xxx'为..." / "\"xxx\"为..." / "「xxx」为..."
# 支持中英文引号和括号对
_QUOTED_RE = re.compile(
    r'["""''‘’「]([^""""''‘’」\n]{1,20})["""''‘’」](\s*(?:二字|三字|四字|字)?(?:为|是)?\s*)(.{0,100})'
)


def extract_size_name(text: str) -> Optional[str]:
    """从文本里找到第一个字号名（如"小三"/"三号"）
    返回字号名（不带"号"）或 None"""
    match = _SIZE_NAME_RE.search(text)
    if not match:
        return None
    name = match.group(1)
    # 规范化：把 "三号" → "三号" 保持一致，"小三" 可能也接"号"
    return name


def extract_size_pt_raw(text: str) -> Optional[float]:
    """从文本里找到 pt/磅 数字字号"""
    match = _SIZE_PT_RE.search(text)
    if not match:
        return None
    return float(match.group(1))


def find_parens_annotation(text: str) -> Optional[tuple[str, str]]:
    """找 A 型括号说明，返回 (字段名, 括号内说明) 或 None"""
    match = _PARENS_RE.search(text)
    if not match:
        return None
    field_name = match.group(1)
    annotation = match.group(2)
    # 括号内至少含一个字号关键词或字体关键词才视为格式说明
    if not (
        extract_size_name(annotation)
        or extract_size_pt_raw(annotation)
        or any(f in annotation for f in ['体', '粗', '居中', '对齐', '缩进'])
    ):
        return None
    return (field_name, annotation)


def find_quoted_field(text: str) -> Optional[tuple[str, str]]:
    """找 B 型引号字段描述，返回 (字段名, 描述文本) 或 None"""
    match = _QUOTED_RE.search(text)
    if not match:
        return None
    field_name = match.group(1)
    rest = match.group(3)
    return (field_name, rest)
```

- [ ] **Step 4: 测试全绿**

```bash
uv run pytest tests/extractor/test_patterns.py -v
```
Expected: 10 passed

- [ ] **Step 5: 提交**

```bash
git add src-python/thesis_worker/extractor/patterns.py src-python/tests/extractor/test_patterns.py
git commit -m "feat(p4): 正则 pattern 库（A 型括号 + B 型叙述 + 字号/磅值）"
```

---

### Task 4：Field Matcher 字段关联

**Files:**
- Create: `src-python/thesis_worker/extractor/field_matcher.py`
- Create: `src-python/tests/extractor/test_field_matcher.py`

- [ ] **Step 1: 写失败测试**

```python
"""
@file: test_field_matcher.py
@description: 字段 id ← 关键词 关联
@author: Atlas.oi
@date: 2026-04-18
"""
import pytest
from thesis_worker.extractor.field_matcher import (
    FIELD_KEYWORDS, match_field, match_all_fields,
)


class TestKeywords:
    def test_all_32_fields_have_keywords(self):
        # 必须 32 个字段都有关键词列表（哪怕是空 list）
        assert len(FIELD_KEYWORDS) == 32

    def test_abstract_zh_keywords(self):
        assert '摘要' in FIELD_KEYWORDS['abstract_zh_title']
        assert '摘 要' in FIELD_KEYWORDS['abstract_zh_title']

    def test_title_zh_keywords(self):
        assert '毕业论文题目' in FIELD_KEYWORDS['title_zh'] or '论文题目' in FIELD_KEYWORDS['title_zh']


class TestMatchField:
    def test_single_match(self):
        text = '摘要（小三号宋体加粗，居中）'
        assert match_field(text) == 'abstract_zh_title'

    def test_keywords_match(self):
        text = '参考文献另起一页'
        assert match_field(text) == 'references_title'

    def test_no_match(self):
        text = '一段普通正文，无字段关键词'
        assert match_field(text) is None


class TestMatchAllFields:
    def test_multiple_paragraphs(self):
        paras = [
            '毕业论文题目（三号黑体）',
            '摘要（小三号宋体加粗）',
            '其他段',
            '关键词：（小四宋体加粗）',
        ]
        results = match_all_fields(paras)
        # 返回 [(para_idx, field_id, confidence), ...]
        field_ids = [r[1] for r in results if r[1] is not None]
        assert 'title_zh' in field_ids
        assert 'abstract_zh_title' in field_ids
        assert 'keywords_zh_label' in field_ids
```

- [ ] **Step 2: 运行看红 + 实现 field_matcher.py**

```python
"""
@file: field_matcher.py
@description: 字段 id 与段落文本的关联（关键词定位 + 位置兜底）
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Optional

# 字段 id → 触发关键词列表
# 关键词必须是字段的显著标志，优先用完整词避免误匹配
FIELD_KEYWORDS: dict[str, list[str]] = {
    # 前置部分
    'title_zh': ['毕业论文题目', '毕业论文（设计）题目', '论文题目', '中文题目'],
    'abstract_zh_title': ['摘  要', '摘 要', '摘要', '中文摘要'],
    'abstract_zh_body': [],  # 依赖 abstract_zh_title 后的段落位置
    'keywords_zh_label': ['关键词', '关键字'],
    'keywords_zh_content': [],  # 依赖 keywords_zh_label 后的段落位置
    'title_en': ['英文题目', 'English Title', 'Title'],
    'abstract_en_title': ['Abstract', 'ABSTRACT', '英文摘要'],
    'abstract_en_body': [],
    'keywords_en_label': ['Key words', 'Key Words', 'Keywords', 'KEY WORDS'],
    'keywords_en_content': [],
    'toc_title': ['目  录', '目 录', '目录'],
    'toc_entry': [],
    # 正文部分
    'chapter_title': ['一级标题', '第X章', '第1章', '第2章'],
    'section_title': ['二级标题'],
    'subsection_title': ['三级标题'],
    'body_para': ['正文', '正文段落', '正文内容'],
    'figure_caption': ['图题', '图标题'],
    'figure_inner_text': ['图例', '图内文字', '标目'],
    'table_caption': ['表题', '表标题'],
    'table_inner_text': ['表内容'],
    # 后置部分
    'references_title': ['参考文献'],
    'reference_entry': ['参考文献格式', '参考文献条目', 'GB/T7714'],
    'ack_title': ['致  谢', '致 谢', '致谢'],
    'ack_body': [],
    'appendix_title': ['附  录', '附 录', '附录'],
    'appendix_body': [],
    # 页面级
    'page_size': ['A4', '页面', '纸张'],
    'page_margin': ['页边距', '边距', '装订线'],
    'page_header': ['页眉'],
    'page_footer_number': ['页脚', '页码'],
    'line_spacing_global': ['全文行距', '行距'],
    'mixed_script_global': ['数字、西文', '数字/西文', '数字和西文'],
}


def match_field(text: str) -> Optional[str]:
    """给定一段文本，返回匹配到的字段 id
    如果匹配多个，返回第一个找到的；都不匹配返回 None
    匹配策略：子串包含检查（text 含 keyword）"""
    text_normalized = text.strip()
    for field_id, keywords in FIELD_KEYWORDS.items():
        if not keywords:
            continue
        for keyword in keywords:
            if keyword in text_normalized:
                return field_id
    return None


def match_all_fields(paragraphs: list[str]) -> list[tuple[int, Optional[str], float]]:
    """对一组段落文本做全量字段匹配
    返回 [(para_idx, field_id_or_none, confidence), ...]
    其中 confidence 现在给固定值 0.8（关键词匹配到的都是高置信）
    未匹配段落给 0.0 + None"""
    results: list[tuple[int, Optional[str], float]] = []
    for idx, text in enumerate(paragraphs):
        field = match_field(text)
        confidence = 0.8 if field else 0.0
        results.append((idx, field, confidence))
    return results
```

- [ ] **Step 3: 测试全绿**

```bash
uv run pytest tests/extractor/test_field_matcher.py -v
```

- [ ] **Step 4: 提交**

```bash
git add src-python/thesis_worker/extractor/field_matcher.py src-python/tests/extractor/test_field_matcher.py
git commit -m "feat(p4): 字段关联（32 field_id ← 关键词列表定位算法）"
```

---

### Task 5：extract_all / extract_from_selection pipeline

**Files:**
- Create: `src-python/thesis_worker/extractor/pipeline.py`
- Create: `src-python/tests/extractor/test_pipeline_a.py`

- [ ] **Step 1: 准备 Template A fixture**

手工创建或从现有模板复制小样本：
```bash
cp /Users/oi/CodeCoding/Code/毕设/毕设-茶园生态管理系统/docs/论文格式模板.docx \
   src-python/tests/fixtures/spec_template_a.docx
```

- [ ] **Step 2: 写 pipeline 测试**

```python
"""
@file: test_pipeline_a.py
@description: extract_all 在 Template A (括号型) 上的集成测试
@author: Atlas.oi
@date: 2026-04-18
"""
from pathlib import Path
import pytest
from thesis_worker.extractor.pipeline import extract_all, extract_from_selection

FIXTURES = Path(__file__).parent.parent / 'fixtures'


class TestExtractAll:
    def test_returns_rules_dict(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        assert 'rules' in result
        assert isinstance(result['rules'], dict)

    def test_returns_evidence_list(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        assert 'evidence' in result
        assert isinstance(result['evidence'], list)

    def test_finds_title_zh(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        # 模板 p0 "毕业论文（设计）题目（三号黑体，居中）"
        assert 'title_zh' in result['rules']
        value = result['rules']['title_zh']['value']
        assert value.get('font.size_pt') == 16  # 三号
        assert value.get('para.align') == 'center'

    def test_finds_abstract_zh_title(self):
        result = extract_all(str(FIXTURES / 'spec_template_a.docx'))
        # 模板 p1 "摘  要（小三号宋体加粗，中间空2个字符，居中）"
        assert 'abstract_zh_title' in result['rules']
        value = result['rules']['abstract_zh_title']['value']
        assert value.get('font.cjk') == '宋体'
        assert value.get('font.size_pt') == 15  # 小三
        assert value.get('font.bold') is True
        assert value.get('para.align') == 'center'


class TestExtractFromSelection:
    def test_single_paragraph(self):
        result = extract_from_selection(
            str(FIXTURES / 'spec_template_a.docx'),
            para_indices=[1],
            field_id='abstract_zh_title',
        )
        assert result['field_id'] == 'abstract_zh_title'
        assert result['value'].get('font.cjk') == '宋体'
        assert result['value'].get('font.size_pt') == 15
        assert result['confidence'] > 0.8

    def test_empty_para_returns_low_confidence(self):
        # 无实际内容的段落抽不到属性
        result = extract_from_selection(
            str(FIXTURES / 'spec_template_a.docx'),
            para_indices=[6],  # 大概率是空或只有换行
            field_id='title_en',
        )
        assert result['confidence'] < 0.5
```

- [ ] **Step 3: 实现 pipeline.py**

```python
"""
@file: pipeline.py
@description: extract_all / extract_from_selection 主流程
              读段落文本+样式 → 按 field_matcher 关联 → 用 patterns+gazetteer 抽属性
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any, Optional
from pathlib import Path
from docx import Document

from .gazetteer import find_font, find_align, is_bold_keyword
from .patterns import (
    extract_size_name, extract_size_pt_raw,
    find_parens_annotation, find_quoted_field,
)
from .field_matcher import match_all_fields
from ..utils.size import name_to_pt


def _extract_attributes_from_text(text: str) -> dict[str, Any]:
    """从单段文本里抽取所有可识别的格式属性"""
    attrs: dict[str, Any] = {}

    # 字号（先 pt 再字号名）
    pt = extract_size_pt_raw(text)
    if pt is None:
        size_name = extract_size_name(text)
        if size_name is not None:
            pt = name_to_pt(size_name)
    if pt is not None:
        attrs['font.size_pt'] = pt

    # 字体
    font_info = find_font(text)
    if font_info is not None:
        kind, name = font_info
        if kind == 'cjk':
            attrs['font.cjk'] = name
        else:
            attrs['font.ascii'] = name

    # 加粗
    if is_bold_keyword(text):
        attrs['font.bold'] = True

    # 对齐
    align = find_align(text)
    if align is not None:
        attrs['para.align'] = align

    return attrs


def _read_paragraph_style_attrs(para) -> dict[str, Any]:
    """从段落 XML 样式里抽取属性（Template A 说明文本段本身可能用目标样式写的）"""
    attrs: dict[str, Any] = {}
    # 第一个非空 run 的字体信息
    for run in para.runs:
        if not run.text.strip():
            continue
        if run.font.size is not None:
            attrs['font.size_pt'] = float(run.font.size.pt)
        if run.font.bold is True:
            attrs['font.bold'] = True
        # XML 层读 eastAsia 字体
        rpr = run._element.rPr
        if rpr is not None:
            rfonts = rpr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts')
            if rfonts is not None:
                ea = rfonts.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia')
                if ea:
                    attrs['font.cjk'] = ea
        break

    # 对齐
    if para.paragraph_format.alignment is not None:
        # WD_ALIGN_PARAGRAPH.CENTER = 1, LEFT = 0, RIGHT = 2, JUSTIFY = 3
        align_map = {0: 'left', 1: 'center', 2: 'right', 3: 'justify'}
        val = para.paragraph_format.alignment
        if val in align_map:
            attrs['para.align'] = align_map[val]

    # 首行缩进
    fli = para.paragraph_format.first_line_indent
    if fli is not None:
        # 按正文 12pt 换算字数（粗略）
        attrs['para.first_line_indent_chars'] = round(fli.pt / 12)

    return attrs


def _merge_attrs(from_text: dict[str, Any], from_style: dict[str, Any]) -> dict[str, Any]:
    """合并文本抽取和样式抽取的属性
    文本抽取优先（规范书里的说明是权威）"""
    merged = {**from_style, **from_text}
    return merged


def _calculate_confidence(attrs: dict[str, Any], text_len: int) -> float:
    """根据属性数量和文本长度估算置信度"""
    if len(attrs) == 0:
        return 0.0
    if len(attrs) >= 3:
        return 0.9
    if len(attrs) == 2:
        return 0.7
    return 0.5


def extract_all(file: str) -> dict[str, Any]:
    """全文自动抽取字段规则
    返回 {rules: dict[field_id, {enabled, value}], evidence: list, unmatched_paragraphs: list}"""
    doc = Document(file)
    paragraphs_text = [p.text for p in doc.paragraphs]

    # 字段关联
    field_matches = match_all_fields(paragraphs_text)

    rules: dict[str, Any] = {}
    evidence: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    for para_idx, field_id, confidence in field_matches:
        if field_id is None:
            text = paragraphs_text[para_idx].strip()
            if text:
                unmatched.append({
                    'idx': para_idx,
                    'text': text[:60],
                    'reason': 'no_field_keyword',
                })
            continue

        # 同一字段已有更早/更高置信度的匹配就跳过
        if field_id in rules:
            continue

        para = doc.paragraphs[para_idx]
        text_attrs = _extract_attributes_from_text(para.text)
        style_attrs = _read_paragraph_style_attrs(para)
        value = _merge_attrs(text_attrs, style_attrs)

        final_conf = _calculate_confidence(value, len(para.text))

        rules[field_id] = {
            'enabled': True,
            'value': value,
        }
        evidence.append({
            'field_id': field_id,
            'source_para_idx': para_idx,
            'source_text': para.text[:100],
            'confidence': final_conf,
        })

    return {
        'rules': rules,
        'evidence': evidence,
        'unmatched_paragraphs': unmatched,
    }


def extract_from_selection(
    file: str,
    para_indices: list[int],
    field_id: str,
) -> dict[str, Any]:
    """从用户选定的段落抽取属性赋给指定字段"""
    doc = Document(file)
    all_paras = list(doc.paragraphs)

    combined_text = ''
    combined_style_attrs: dict[str, Any] = {}

    for idx in para_indices:
        if idx < 0 or idx >= len(all_paras):
            continue
        para = all_paras[idx]
        combined_text += '\n' + para.text
        style_attrs = _read_paragraph_style_attrs(para)
        combined_style_attrs.update(style_attrs)

    text_attrs = _extract_attributes_from_text(combined_text)
    value = _merge_attrs(text_attrs, combined_style_attrs)

    confidence = _calculate_confidence(value, len(combined_text))

    return {
        'field_id': field_id,
        'value': value,
        'confidence': confidence,
        'evidence': {
            'source_text': combined_text[:200],
            'matched_patterns': list(value.keys()),
        },
    }
```

- [ ] **Step 4: 测试全绿**

```bash
uv run pytest tests/extractor/test_pipeline_a.py -v
```

- [ ] **Step 5: 提交**

```bash
git add src-python/thesis_worker/extractor/pipeline.py src-python/tests/extractor/test_pipeline_a.py src-python/tests/fixtures/spec_template_a.docx
git commit -m "feat(p4): extractor pipeline（extract_all + extract_from_selection）"
```

---

## Phase B — Sidecar NDJSON 命令接入（Task 6-7）

### Task 6：handlers 接入 extract_all / extract_from_selection / list_fields

**Files:**
- Modify: `src-python/thesis_worker/handlers.py`
- Create: `src-python/tests/test_handlers_v2.py`

- [ ] **Step 1: 写 handler 测试**

```python
"""
@file: test_handlers_v2.py
@description: P4 新增 sidecar 命令测试
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
    def test_returns_32_fields(self):
        resp = handle({'id': 'r4', 'cmd': 'list_fields'})
        assert resp['ok'] is True
        fields = resp['result']['fields']
        assert len(fields) == 32
        # 每字段必须有 id/label/group/order/applicable_attributes
        for f in fields:
            assert 'id' in f
            assert 'label' in f
            assert 'group' in f
            assert 'order' in f
            assert 'applicable_attributes' in f
```

- [ ] **Step 2: 修改 handlers.py**

在 handle() 中新增 cmd 分支：

```python
# 在 cancel 分支之后、unknown 之前加：

if cmd == 'extract_all':
    return _handle_extract_all(req_id, req)

if cmd == 'extract_from_selection':
    return _handle_extract_from_selection(req_id, req)

if cmd == 'list_fields':
    return _handle_list_fields(req_id)


# 文件末尾加 handler 实现：

def _handle_extract_all(req_id, req):
    from .extractor.pipeline import extract_all
    file = req['file']
    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}
    try:
        result = extract_all(file)
        return {'id': req_id, 'ok': True, 'result': result}
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}


def _handle_extract_from_selection(req_id, req):
    from .extractor.pipeline import extract_from_selection
    file = req['file']
    para_indices = req['para_indices']
    field_id = req['field_id']
    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}
    try:
        result = extract_from_selection(file, para_indices, field_id)
        return {'id': req_id, 'ok': True, 'result': result}
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}


def _handle_list_fields(req_id):
    from .engine_v2.field_defs import FIELD_DEFS
    return {'id': req_id, 'ok': True, 'result': {'fields': FIELD_DEFS}}
```

（`field_defs.py` 会在 Task 8 创建，本 task 先让 `list_fields` 引用 TBD —— **不行，要 TDD**。**改动：Task 6 先跳过 list_fields，Task 8 完成后再接入。**）

修改：本 task 只加 extract_all + extract_from_selection；list_fields 暂返回 `{'fields': []}` 占位，Task 8 完成后覆盖。

- [ ] **Step 3: 测试绿（extract 两个 cmd）**

```bash
uv run pytest tests/test_handlers_v2.py::TestExtractAll tests/test_handlers_v2.py::TestExtractFromSelection -v
```

- [ ] **Step 4: 提交**

```bash
git add src-python/thesis_worker/handlers.py src-python/tests/test_handlers_v2.py
git commit -m "feat(p4): handlers 接入 extract_all + extract_from_selection 命令"
```

---

### Task 7：前端 sidecarClient 扩展类型 + Rust pass-through

**Files:**
- Modify: `src/features/tools/toolsSidecarClient.ts`

- [ ] **Step 1: 加新 Request 类型**

```typescript
export interface ExtractAllRequest extends SidecarRequestBase {
  cmd: 'extract_all';
  file: string;
}

export interface ExtractFromSelectionRequest extends SidecarRequestBase {
  cmd: 'extract_from_selection';
  file: string;
  para_indices: number[];
  field_id: string;
}

export interface ListFieldsRequest extends SidecarRequestBase {
  cmd: 'list_fields';
}

// 加入 SidecarRequest union type（已存在的 union 末尾追加）
export type SidecarRequest =
  | PingRequest
  | DetectRequest
  | FixRequest
  | FixPreviewRequest
  | ListRulesRequest
  | CancelRequest
  | ExtractTemplateRequest  // P3 旧命令保留
  | ExtractAllRequest
  | ExtractFromSelectionRequest
  | ListFieldsRequest;
```

同时加响应类型：

```typescript
export interface ExtractedFieldValue {
  enabled: boolean;
  value: Record<string, unknown>;
}

export interface ExtractEvidence {
  field_id: string;
  source_para_idx: number;
  source_text: string;
  confidence: number;
}

export interface ExtractAllResult {
  rules: Record<string, ExtractedFieldValue>;
  evidence: ExtractEvidence[];
  unmatched_paragraphs: Array<{ idx: number; text: string; reason: string }>;
}

export interface ExtractFromSelectionResult {
  field_id: string;
  value: Record<string, unknown>;
  confidence: number;
  evidence: { source_text: string; matched_patterns: string[] };
}

export interface FieldDef {
  id: string;
  label: string;
  group: 'front' | 'body' | 'back' | 'global';
  order: number;
  applicable_attributes: string[];
}

export interface ListFieldsResult {
  fields: FieldDef[];
}
```

- [ ] **Step 2: pnpm build 确认类型 OK**

```bash
pnpm build 2>&1 | tail -5
```

- [ ] **Step 3: 提交**

```bash
git add src/features/tools/toolsSidecarClient.ts
git commit -m "feat(p4): sidecarClient 加 ExtractAll/ExtractFromSelection/ListFields 类型"
```

---

## Phase C — 32 字段定义 + v2 Rule Engine（Task 8-11）

### Task 8：Python 32 字段定义 + 属性白名单

**Files:**
- Create: `src-python/thesis_worker/engine_v2/__init__.py`（空）
- Create: `src-python/thesis_worker/engine_v2/field_defs.py`
- Create: `src-python/tests/engine_v2/__init__.py`（空）
- Create: `src-python/tests/engine_v2/test_field_defs.py`

- [ ] **Step 1: 写字段定义测试**

```python
from thesis_worker.engine_v2.field_defs import FIELD_DEFS, get_field, applicable_attrs


class TestFieldDefs:
    def test_count_32(self):
        assert len(FIELD_DEFS) == 32

    def test_groups(self):
        groups = {f['group'] for f in FIELD_DEFS}
        assert groups == {'front', 'body', 'back', 'global'}

    def test_orders_sequential(self):
        orders = [f['order'] for f in FIELD_DEFS]
        assert orders == list(range(1, 33))

    def test_get_field(self):
        f = get_field('abstract_zh_title')
        assert f['label'] == '中文「摘要」标题'

    def test_applicable_attrs_title_zh(self):
        attrs = applicable_attrs('title_zh')
        assert 'font.cjk' in attrs
        assert 'font.size_pt' in attrs
        assert 'content.max_chars' in attrs
```

- [ ] **Step 2: 实现 field_defs.py**

按 spec 32 字段表填充完整数组（id / label / group / order / applicable_attributes）。下方仅展示前 4 项，其余 28 项按 spec 照搬：

```python
"""
@file: field_defs.py
@description: 32 个论文语义字段定义（参 spec 2026-04-18-p4-semantic-fields-design.md）
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Optional

FIELD_DEFS: list[dict] = [
    {
        'id': 'title_zh',
        'label': '中文题目',
        'group': 'front',
        'order': 1,
        'applicable_attributes': [
            'font.cjk', 'font.size_pt', 'font.bold',
            'para.align', 'content.max_chars',
        ],
    },
    {
        'id': 'abstract_zh_title',
        'label': '中文「摘要」标题',
        'group': 'front',
        'order': 2,
        'applicable_attributes': [
            'font.cjk', 'font.size_pt', 'font.bold',
            'para.align', 'para.letter_spacing_chars',
            'content.specific_text',
        ],
    },
    # ... 30 条后续字段（按 spec 逐条填）
    # ⚠️ 实现时必须把 spec 里全部 32 字段列出来，不能省略
]

_FIELD_MAP: dict[str, dict] = {f['id']: f for f in FIELD_DEFS}


def get_field(field_id: str) -> Optional[dict]:
    """按 id 查字段定义"""
    return _FIELD_MAP.get(field_id)


def applicable_attrs(field_id: str) -> list[str]:
    """返回字段可用属性 key 列表；未知字段返回空"""
    field = _FIELD_MAP.get(field_id)
    return field['applicable_attributes'] if field else []
```

- [ ] **Step 3: 补全全部 32 字段（按 spec 表）**

严格按 spec `docs/superpowers/specs/2026-04-18-p4-semantic-fields-design.md` 的 32 字段表填入。

- [ ] **Step 4: 测试绿**

```bash
uv run pytest tests/engine_v2/test_field_defs.py -v
```

- [ ] **Step 5: 回填 list_fields 命令**

Modify handlers.py `_handle_list_fields` 改为返回真实 FIELD_DEFS。

- [ ] **Step 6: list_fields 测试绿**

```bash
uv run pytest tests/test_handlers_v2.py::TestListFields -v
```

- [ ] **Step 7: 提交**

```bash
git add src-python/thesis_worker/engine_v2/__init__.py src-python/thesis_worker/engine_v2/field_defs.py src-python/tests/engine_v2/ src-python/thesis_worker/handlers.py
git commit -m "feat(p4): 32 字段定义 + list_fields 命令接入"
```

---

### Task 9：Attribute Checkers

**Files:**
- Create: `src-python/thesis_worker/engine_v2/checkers.py`
- Create: `src-python/tests/engine_v2/test_checkers.py`

- [ ] **Step 1: 写 checker 测试**

```python
from docx import Document
from docx.shared import Pt
from thesis_worker.engine_v2.checkers import (
    check_font_cjk, check_font_size_pt, check_font_bold,
    check_para_align, check_para_first_line_indent_chars,
    check_content_max_chars,
)


class TestFontCheckers:
    def test_cjk_match(self, tmp_path):
        doc = Document()
        p = doc.add_paragraph('测试')
        p.runs[0].font.name = '宋体'
        # XML 需设 eastAsia
        from docx.oxml.ns import qn
        rFonts = p.runs[0]._element.rPr.rFonts
        if rFonts is None:
            from lxml import etree
            rFonts = etree.SubElement(p.runs[0]._element.rPr, qn('w:rFonts'))
        rFonts.set(qn('w:eastAsia'), '宋体')
        
        # 检查实际 = 期望
        assert check_font_cjk(p, '宋体') is None  # None = no issue
        # 期望黑体 → issue
        issue = check_font_cjk(p, '黑体')
        assert issue is not None
        assert issue['actual'] == '宋体'
        assert issue['expected'] == '黑体'


class TestFontSize:
    def test_size_match(self, tmp_path):
        doc = Document()
        p = doc.add_paragraph('测试')
        p.runs[0].font.size = Pt(12)
        assert check_font_size_pt(p, 12) is None
        assert check_font_size_pt(p, 14) is not None


class TestContentMaxChars:
    def test_within_limit(self):
        doc = Document()
        p = doc.add_paragraph('短标题')
        assert check_content_max_chars(p, 25) is None

    def test_exceeds_limit(self):
        doc = Document()
        p = doc.add_paragraph('非常非常非常非常非常非常非常非常长的标题超过了二十五个字符')
        issue = check_content_max_chars(p, 25)
        assert issue is not None
```

- [ ] **Step 2: 实现 checkers.py**

给每个属性 key 写独立 checker 函数：

```python
"""
@file: checkers.py
@description: 属性 key → checker 函数映射
              checker 接收段落对象和期望值，返回 None（符合）或 dict（违规描述）
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any, Optional
from docx.text.paragraph import Paragraph


def _read_cjk_font(para: Paragraph) -> Optional[str]:
    """读段落第一个非空 run 的 eastAsia 字体"""
    for run in para.runs:
        if not run.text.strip():
            continue
        rpr = run._element.rPr
        if rpr is None:
            return None
        rfonts = rpr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts')
        if rfonts is None:
            return None
        ea = rfonts.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia')
        return ea
    return None


def check_font_cjk(para: Paragraph, expected: str) -> Optional[dict]:
    actual = _read_cjk_font(para)
    if actual == expected:
        return None
    return {'attr': 'font.cjk', 'actual': actual, 'expected': expected}


def check_font_size_pt(para: Paragraph, expected: float) -> Optional[dict]:
    for run in para.runs:
        if not run.text.strip():
            continue
        if run.font.size is None:
            return {'attr': 'font.size_pt', 'actual': None, 'expected': expected}
        actual = float(run.font.size.pt)
        if abs(actual - expected) < 0.1:
            return None
        return {'attr': 'font.size_pt', 'actual': actual, 'expected': expected}
    return None


def check_font_bold(para: Paragraph, expected: bool) -> Optional[dict]:
    for run in para.runs:
        if not run.text.strip():
            continue
        actual = bool(run.font.bold)
        if actual == expected:
            return None
        return {'attr': 'font.bold', 'actual': actual, 'expected': expected}
    return None


def check_para_align(para: Paragraph, expected: str) -> Optional[dict]:
    """expected: 'left' / 'center' / 'right' / 'justify'"""
    align_map = {0: 'left', 1: 'center', 2: 'right', 3: 'justify'}
    val = para.paragraph_format.alignment
    actual = align_map.get(val, 'left') if val is not None else 'left'
    if actual == expected:
        return None
    return {'attr': 'para.align', 'actual': actual, 'expected': expected}


def check_para_first_line_indent_chars(para: Paragraph, expected: int, body_size_pt: float = 12) -> Optional[dict]:
    """expected 按字符数；body_size_pt 默认 12（小四号）"""
    fli = para.paragraph_format.first_line_indent
    if fli is None:
        actual_chars = 0
    else:
        actual_chars = round(fli.pt / body_size_pt)
    if actual_chars == expected:
        return None
    return {'attr': 'para.first_line_indent_chars', 'actual': actual_chars, 'expected': expected}


def check_content_max_chars(para: Paragraph, expected: int) -> Optional[dict]:
    actual = len(para.text)
    if actual <= expected:
        return None
    return {'attr': 'content.max_chars', 'actual': actual, 'expected': expected}


# 扩展 checker（按 spec 属性 key 列表全部覆盖）：
# check_font_ascii / check_font_italic
# check_para_line_spacing / check_para_space_before_lines / check_para_space_after_lines
# check_para_letter_spacing_chars / check_para_hanging_indent_chars
# check_page_new_page_before / check_page_new_page_after
# check_page_margin_{top,bottom,left,right}_cm
# check_content_char_count_min/max / check_content_item_count_min/max
# check_content_item_separator / check_content_specific_text
# check_mixed_script_ascii_is_tnr
# check_layout_position / check_citation_style
# check_pagination_front_style / check_pagination_body_style
# check_style_hint_word_style_name


# 属性 key → checker 函数映射（用于 detector 批量调用）
CHECKER_MAP: dict[str, callable] = {
    'font.cjk': check_font_cjk,
    'font.size_pt': check_font_size_pt,
    'font.bold': check_font_bold,
    'para.align': check_para_align,
    'para.first_line_indent_chars': check_para_first_line_indent_chars,
    'content.max_chars': check_content_max_chars,
    # ... 其他 checker
}
```

- [ ] **Step 3: 实现**完成所有 22 个 checker**

（按 spec 属性 key 规范列出的 22 项，除 `style_hint.word_style_name` 仅作提示不检测外，其余都要 checker）

- [ ] **Step 4: 测试绿**

```bash
uv run pytest tests/engine_v2/test_checkers.py -v
```

- [ ] **Step 5: 提交**

```bash
git add src-python/thesis_worker/engine_v2/checkers.py src-python/tests/engine_v2/test_checkers.py
git commit -m "feat(p4): v2 engine 按属性 key 的 22 个 checker"
```

---

### Task 10：v2 Detector

**Files:**
- Create: `src-python/thesis_worker/engine_v2/detector.py`
- Create: `src-python/tests/engine_v2/test_detector.py`
- Modify: `src-python/thesis_worker/handlers.py` detect dispatch

- [ ] **Step 1: 写 detector 测试**

```python
from pathlib import Path
from docx import Document
from docx.shared import Pt
from thesis_worker.engine_v2.detector import detect_v2

FIXTURES = Path(__file__).parent.parent / 'fixtures'


def make_doc_with_wrong_title(tmp_path):
    """创建一个标题字体字号错误的测试 docx"""
    doc = Document()
    p = doc.add_paragraph('研究课题', style='Heading 1')
    p.runs[0].font.name = 'Calibri'
    p.runs[0].font.size = Pt(14)
    # 应该是黑体 16pt
    path = tmp_path / 'bad_title.docx'
    doc.save(path)
    return path


class TestDetectV2:
    def test_detects_wrong_font(self, tmp_path):
        path = make_doc_with_wrong_title(tmp_path)
        template = {
            'rules': {
                'chapter_title': {
                    'enabled': True,
                    'value': {
                        'font.cjk': '黑体',
                        'font.size_pt': 16,
                    },
                },
            },
        }
        issues = detect_v2(str(path), template)
        assert len(issues) >= 1
        codes = [i['attr'] for i in issues]
        assert 'font.size_pt' in codes or 'font.cjk' in codes

    def test_empty_template_returns_empty(self, tmp_path):
        path = make_doc_with_wrong_title(tmp_path)
        issues = detect_v2(str(path), {'rules': {}})
        assert issues == []

    def test_disabled_field_skipped(self, tmp_path):
        path = make_doc_with_wrong_title(tmp_path)
        template = {
            'rules': {
                'chapter_title': {
                    'enabled': False,
                    'value': {'font.size_pt': 999},
                },
            },
        }
        issues = detect_v2(str(path), template)
        assert issues == []
```

- [ ] **Step 2: 实现 detector.py**

```python
"""
@file: detector.py
@description: v2 rule engine detect：按字段遍历 template.rules，对每字段定位论文对应段落，
              用 checkers 检查每条属性约束
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx import Document

from .field_defs import get_field
from .checkers import CHECKER_MAP


def _find_paragraphs_for_field(doc, field_id: str) -> list[int]:
    """定位字段对应的段落 index 列表
    - chapter_title：所有 style 含 'Heading 1' 的段
    - abstract_zh_title：含"摘要"的段
    - body_para：所有非 heading 非 empty 段
    - 其它：按 keyword 匹配（参 field_matcher）
    """
    from ..extractor.field_matcher import FIELD_KEYWORDS
    keywords = FIELD_KEYWORDS.get(field_id, [])
    indices: list[int] = []
    for idx, p in enumerate(doc.paragraphs):
        if any(kw in p.text for kw in keywords):
            indices.append(idx)
    # 一些特殊字段需要启发式：
    if field_id == 'chapter_title':
        # 补充所有 Heading 1 style 段
        for idx, p in enumerate(doc.paragraphs):
            if p.style and p.style.name in ('Heading 1', 'Heading1', '一级标题', '一级标题q'):
                if idx not in indices:
                    indices.append(idx)
    if field_id == 'body_para':
        # 所有非空非 heading 段
        for idx, p in enumerate(doc.paragraphs):
            style_name = p.style.name if p.style else ''
            if 'Heading' in style_name or '标题' in style_name:
                continue
            if not p.text.strip():
                continue
            if idx not in indices:
                indices.append(idx)
    return indices


def detect_v2(file: str, template: dict[str, Any]) -> list[dict]:
    """执行 v2 规则检测
    返回 Issue 列表：[{rule_id, attr, actual, expected, para_idx, snippet, context}, ...]"""
    doc = Document(file)
    rules = template.get('rules', {})
    issues: list[dict] = []

    for field_id, field_cfg in rules.items():
        if not field_cfg.get('enabled', False):
            continue
        value = field_cfg.get('value', {})
        if not value:
            continue

        # 定位字段对应段落
        para_indices = _find_paragraphs_for_field(doc, field_id)
        if not para_indices:
            continue

        # 对每段落每属性检查
        for para_idx in para_indices:
            para = doc.paragraphs[para_idx]
            for attr_key, expected in value.items():
                checker = CHECKER_MAP.get(attr_key)
                if checker is None:
                    continue
                result = checker(para, expected)
                if result is None:
                    continue
                # 构造 Issue
                snippet = para.text[:30]
                context = para.text[:60]
                issues.append({
                    'rule_id': field_id,
                    'attr': attr_key,
                    'actual': result['actual'],
                    'expected': expected,
                    'para_idx': para_idx,
                    'message': f'{field_id}.{attr_key}: actual={result["actual"]} expected={expected}',
                    'loc': {'para': para_idx, 'run': 0},
                    'current': result['actual'],
                    'fix_available': True,
                    'snippet': snippet,
                    'context': context,
                })

    return issues
```

- [ ] **Step 3: 修改 handlers.py 的 `_handle_detect`**

改为调用 `detect_v2` 而非 P3 的 REGISTRY 循环：

```python
def _handle_detect(req_id, req):
    from .engine_v2.detector import detect_v2
    # ENOENT/PARSE_ERROR 检查（保留 P3 逻辑）
    ...
    issues = detect_v2(file, template)
    # 给每个 issue 分配 issue_id
    for idx, issue in enumerate(issues):
        issue['issue_id'] = f"{issue['rule_id']}-{idx}"
    return {'id': req_id, 'ok': True, 'result': {'issues': issues}}
```

- [ ] **Step 4: 测试绿 + 完整 pytest 保证不 break**

```bash
uv run pytest tests/engine_v2/test_detector.py -v
uv run pytest 2>&1 | tail -5
```

- [ ] **Step 5: 提交**

```bash
git add src-python/thesis_worker/engine_v2/detector.py src-python/tests/engine_v2/test_detector.py src-python/thesis_worker/handlers.py
git commit -m "feat(p4): v2 detector + handlers detect dispatch"
```

---

### Task 11：v2 Fixer（含蓝色标记 + reopen 硬测试）

**Files:**
- Create: `src-python/thesis_worker/engine_v2/fixer.py`
- Create: `src-python/tests/engine_v2/test_fixer.py`
- Modify: `src-python/thesis_worker/handlers.py` fix dispatch

- [ ] **Step 1: 写 fixer 测试（含 reopen）**

```python
from pathlib import Path
from docx import Document
from docx.shared import Pt, RGBColor
from thesis_worker.engine_v2.fixer import fix_v2


def make_bad_doc(tmp_path):
    doc = Document()
    p = doc.add_paragraph('测试段')
    p.runs[0].font.name = 'Calibri'
    p.runs[0].font.size = Pt(14)
    path = tmp_path / 'bad.docx'
    doc.save(path)
    return path


class TestFixV2:
    def test_fix_font_size(self, tmp_path):
        path = make_bad_doc(tmp_path)
        issue = {
            'rule_id': 'body_para',
            'attr': 'font.size_pt',
            'para_idx': 0,
        }
        value = {'font.size_pt': 12}
        result = fix_v2(str(path), issue, value)
        assert result['applied'] is True
        # reopen 验证
        doc2 = Document(path)
        assert doc2.paragraphs[0].runs[0].font.size.pt == 12.0

    def test_fix_marks_blue(self, tmp_path):
        path = make_bad_doc(tmp_path)
        issue = {
            'rule_id': 'body_para',
            'attr': 'font.size_pt',
            'para_idx': 0,
        }
        value = {'font.size_pt': 12}
        fix_v2(str(path), issue, value)
        doc2 = Document(path)
        assert doc2.paragraphs[0].runs[0].font.color.rgb == RGBColor(0x00, 0x70, 0xC0)
```

- [ ] **Step 2: 实现 fixer.py**

```python
"""
@file: fixer.py
@description: v2 fix 实现：按 issue.attr 修改段落属性，成功后蓝色标记
@author: Atlas.oi
@date: 2026-04-18
"""
from typing import Any
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml.ns import qn

_MARK_COLOR = RGBColor(0x00, 0x70, 0xC0)


def fix_v2(file: str, issue: dict, value: dict[str, Any]) -> dict:
    """按 issue.attr + value[attr] 修改段落，标蓝
    返回 {diff, applied, xml_changed}"""
    doc = Document(file)
    para_idx = issue['para_idx']
    attr = issue['attr']
    expected = value.get(attr)

    if expected is None:
        return {'diff': '', 'applied': False, 'xml_changed': []}

    para = doc.paragraphs[para_idx]
    if not para.runs:
        return {'diff': '', 'applied': False, 'xml_changed': []}

    run = para.runs[0]
    before_summary = f'{attr}: ?'

    if attr == 'font.size_pt':
        before_summary = f'font.size_pt: {run.font.size.pt if run.font.size else "?"}'
        run.font.size = Pt(expected)
    elif attr == 'font.cjk':
        before_summary = f'font.cjk: ?'
        rpr = run._element.get_or_add_rPr()
        rfonts = rpr.find(qn('w:rFonts')) or None
        if rfonts is None:
            from lxml import etree
            rfonts = etree.SubElement(rpr, qn('w:rFonts'))
        rfonts.set(qn('w:eastAsia'), expected)
    elif attr == 'font.bold':
        before_summary = f'font.bold: {run.font.bold}'
        run.font.bold = expected
    elif attr == 'para.align':
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        align_map = {
            'left': WD_ALIGN_PARAGRAPH.LEFT,
            'center': WD_ALIGN_PARAGRAPH.CENTER,
            'right': WD_ALIGN_PARAGRAPH.RIGHT,
            'justify': WD_ALIGN_PARAGRAPH.JUSTIFY,
        }
        before_summary = f'para.align: {para.paragraph_format.alignment}'
        para.paragraph_format.alignment = align_map.get(expected)
    elif attr == 'para.first_line_indent_chars':
        before_summary = f'para.first_line_indent_chars: ?'
        # 按正文 12pt 换算
        para.paragraph_format.first_line_indent = Pt(expected * 12)
    else:
        return {'diff': '', 'applied': False, 'xml_changed': []}

    # 蓝色标记
    run.font.color.rgb = _MARK_COLOR

    doc.save(file)

    return {
        'diff': f'- {before_summary}\n+ {attr}: {expected}',
        'applied': True,
        'xml_changed': [f'w:p[{para_idx}]'],
    }
```

- [ ] **Step 3: 改 handlers.py 的 `_handle_fix`**

改为调用 `fix_v2` 代替 P3 REGISTRY[rule_id].fix()。

- [ ] **Step 4: 测试绿**

```bash
uv run pytest tests/engine_v2/test_fixer.py -v
uv run pytest 2>&1 | tail -5
```

- [ ] **Step 5: 提交**

```bash
git add src-python/thesis_worker/engine_v2/fixer.py src-python/tests/engine_v2/test_fixer.py src-python/thesis_worker/handlers.py
git commit -m "feat(p4): v2 fixer（按属性修复 + 蓝色标记 + reopen 硬测试）"
```

---

## Phase D — Rust 端（Task 12）

### Task 12：替换 _builtin-gbt7714 为 v2

**Files:**
- Create: `src-tauri/templates/_builtin-gbt7714-v2.json`
- Modify: `src-tauri/src/template_cmd.rs`
- Modify: `src-tauri/tests/template_cmd.rs`

- [ ] **Step 1: 写 v2 内置模板 JSON**

创建 `src-tauri/templates/_builtin-gbt7714-v2.json`（32 字段，各字段 value 填合理起点）：

```json
{
  "schema_version": 2,
  "id": "_builtin-gbt7714-v2",
  "name": "GB/T 7714 起点模板",
  "source": {"type": "builtin", "origin_docx": null, "extracted_at": null},
  "updated_at": "2026-04-18T00:00:00Z",
  "rules": {
    "title_zh": {
      "enabled": true,
      "value": {
        "font.cjk": "黑体",
        "font.size_pt": 16,
        "font.bold": true,
        "para.align": "center",
        "content.max_chars": 25
      }
    },
    "abstract_zh_title": {
      "enabled": true,
      "value": {
        "font.cjk": "宋体",
        "font.size_pt": 15,
        "font.bold": true,
        "para.align": "center",
        "para.letter_spacing_chars": 2,
        "content.specific_text": "摘  要"
      }
    },
    "abstract_zh_body": {
      "enabled": true,
      "value": {
        "font.cjk": "宋体",
        "font.size_pt": 12,
        "para.first_line_indent_chars": 2,
        "para.line_spacing": 1.5,
        "content.char_count_min": 280,
        "content.char_count_max": 320,
        "mixed_script.ascii_is_tnr": true
      }
    }
    // ... 剩余 29 字段，完整照 spec 填
  }
}
```

（**实现时必须把全部 32 字段填完整**。）

- [ ] **Step 2: 修 template_cmd.rs 的 BUILTIN_ID 和 BUILTIN_JSON**

```rust
pub const BUILTIN_ID: &str = "_builtin-gbt7714-v2";
const BUILTIN_JSON: &str = include_str!("../templates/_builtin-gbt7714-v2.json");
```

- [ ] **Step 3: 删除旧 `_builtin-gbt7714.json`**

```bash
git rm src-tauri/templates/_builtin-gbt7714.json
```

- [ ] **Step 4: cargo test 绿**

```bash
cargo test --test template_cmd 2>&1 | tail -10
```
Expected: 全过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/
git commit -m "feat(p4): 内置模板升级为 v2（32 字段 GB/T 7714 起点）"
```

---

## Phase E — 前端字段定义 + Store v2（Task 13-14）

### Task 13：前端 fieldDefs + 更新 RuleValueEditor

**Files:**
- Create: `src/features/tools/templates/fieldDefs.ts`
- Modify: `src/features/tools/templates/RuleValueEditor.tsx`
- Create: `src/features/tools/__tests__/fieldDefs.test.ts`

- [ ] **Step 1: 写 fieldDefs.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { FIELD_DEFS, getField, applicableAttrs } from '../templates/fieldDefs';

describe('FIELD_DEFS', () => {
  it('has 32 fields', () => {
    expect(FIELD_DEFS).toHaveLength(32);
  });
  it('order is sequential 1-32', () => {
    const orders = FIELD_DEFS.map(f => f.order);
    expect(orders).toEqual(Array.from({length: 32}, (_, i) => i + 1));
  });
  it('getField returns correct entry', () => {
    const f = getField('abstract_zh_title');
    expect(f?.label).toBe('中文「摘要」标题');
  });
  it('applicableAttrs has font.cjk for title_zh', () => {
    const attrs = applicableAttrs('title_zh');
    expect(attrs).toContain('font.cjk');
    expect(attrs).toContain('content.max_chars');
  });
});
```

- [ ] **Step 2: 实现 fieldDefs.ts**

完全镜像 Python 版 field_defs.py，export FIELD_DEFS + getField + applicableAttrs。**必须 32 条完整**。

- [ ] **Step 3: 改造 RuleValueEditor.tsx**

从按 rule_id 分发（P3）改为按**属性 key** 分发。22 个属性各自渲染对应控件：

```tsx
export interface RuleValueEditorProps {
  attr: string;           // 属性 key，如 'font.cjk'
  value: unknown;
  onChange: (next: unknown) => void;
}

export function RuleValueEditor({ attr, value, onChange }: RuleValueEditorProps) {
  switch (attr) {
    case 'font.cjk': return <CjkFontSelect value={value as string} onChange={onChange} />;
    case 'font.ascii': return <AsciiFontSelect value={value as string} onChange={onChange} />;
    case 'font.size_pt': return <SizeNameOrPtInput value={value as number} onChange={onChange} />;
    case 'font.bold': return <Toggle value={value as boolean} onChange={onChange} />;
    case 'font.italic': return <Toggle value={value as boolean} onChange={onChange} />;
    case 'para.align': return <AlignSelect value={value as string} onChange={onChange} />;
    case 'para.first_line_indent_chars': return <NumberInput value={value as number} onChange={onChange} />;
    case 'para.hanging_indent_chars': return <NumberInput value={value as number} onChange={onChange} />;
    case 'para.line_spacing': return <NumberInput value={value as number} onChange={onChange} step={0.5} />;
    case 'para.space_before_lines': return <NumberInput value={value as number} onChange={onChange} step={0.5} />;
    case 'para.space_after_lines': return <NumberInput value={value as number} onChange={onChange} step={0.5} />;
    case 'para.letter_spacing_chars': return <NumberInput value={value as number} onChange={onChange} />;
    case 'page.new_page_before': return <Toggle value={value as boolean} onChange={onChange} />;
    case 'page.new_page_after': return <Toggle value={value as boolean} onChange={onChange} />;
    case 'page.size': return <EnumSelect options={['A4','Letter']} value={value as string} onChange={onChange} />;
    case 'page.margin_top_cm':
    case 'page.margin_bottom_cm':
    case 'page.margin_left_cm':
    case 'page.margin_right_cm': return <NumberInput value={value as number} onChange={onChange} step={0.1} />;
    case 'content.char_count_min':
    case 'content.char_count_max':
    case 'content.item_count_min':
    case 'content.item_count_max':
    case 'content.max_chars': return <NumberInput value={value as number} onChange={onChange} />;
    case 'content.item_separator':
    case 'content.specific_text': return <TextInput value={value as string} onChange={onChange} />;
    case 'mixed_script.ascii_is_tnr': return <Toggle value={value as boolean} onChange={onChange} />;
    case 'layout.position': return <EnumSelect options={['above','below']} value={value as string} onChange={onChange} />;
    case 'citation.style': return <EnumSelect options={['gbt7714','apa']} value={value as string} onChange={onChange} />;
    case 'pagination.front_style':
    case 'pagination.body_style': return <EnumSelect options={['roman','arabic']} value={value as string} onChange={onChange} />;
    case 'style_hint.word_style_name': return <TextInput value={value as string} onChange={onChange} />;
    default: return <span>{JSON.stringify(value)}</span>;
  }
}

// 其中每个控件组件如 CjkFontSelect / AlignSelect 等都需要实现。
```

- [ ] **Step 4: pnpm test + build 全过**

```bash
pnpm test src/features/tools/__tests__/fieldDefs.test.ts -- --run
pnpm build 2>&1 | tail -5
```

- [ ] **Step 5: 提交**

```bash
git add src/features/tools/templates/fieldDefs.ts src/features/tools/templates/RuleValueEditor.tsx src/features/tools/__tests__/fieldDefs.test.ts
git commit -m "feat(p4): 前端 fieldDefs + RuleValueEditor 按属性 key 分发"
```

---

### Task 14：TemplateStore v2 schema 支持

**Files:**
- Modify: `src/features/tools/templates/TemplateStore.ts`
- Modify: `src/features/tools/__tests__/templateStore.test.ts`

- [ ] **Step 1: 修改 TemplateJson 类型默认 schema_version=2**

```typescript
export interface TemplateJson {
  schema_version: 2;  // 固定为 2
  id: string;
  name: string;
  source: TemplateSource;
  updated_at: string;
  rules: Record<string, { enabled: boolean; value: Record<string, unknown> }>;
}
```

- [ ] **Step 2: create() 方法按 v2 深拷贝**

无需大改，`JSON.parse(JSON.stringify(builtin.rules))` 对 v2 仍然正确。

- [ ] **Step 3: 改测试 - 确认新版行为**

```typescript
it('创建模板 schema_version 固定为 2', async () => {
  // ... mock builtin.schema_version = 2
  // create → 新模板 schema_version === 2
});
```

- [ ] **Step 4: 测试绿**

```bash
pnpm test src/features/tools/__tests__/templateStore.test.ts -- --run
```

- [ ] **Step 5: 提交**

```bash
git add src/features/tools/templates/TemplateStore.ts src/features/tools/__tests__/templateStore.test.ts
git commit -m "feat(p4): TemplateStore 固定 schema_version=2"
```

---

## Phase F — 前端核心 UI 组件（Task 15-17）

### Task 15：DocxPreview 组件

**Files:**
- Create: `src/features/tools/templates/DocxPreview.tsx`
- Create: `src/features/tools/__tests__/DocxPreview.test.tsx`

- [ ] **Step 1: 写 DocxPreview 测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DocxPreview } from '../templates/DocxPreview';

// Mock docx-preview 库
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn((_data, container) => {
    // 模拟渲染：插入 3 个带 para-idx 的 div
    container.innerHTML = `
      <div class="docx-wrapper">
        <div data-para-idx="0" class="docx-paragraph">段 0</div>
        <div data-para-idx="1" class="docx-paragraph">段 1</div>
        <div data-para-idx="2" class="docx-paragraph">段 2</div>
      </div>
    `;
    return Promise.resolve();
  }),
}));

describe('DocxPreview', () => {
  it('clicking paragraph calls onParaClick with idx', async () => {
    const onParaClick = vi.fn();
    const { container } = render(
      <DocxPreview file="/tmp/test.docx" onParaClick={onParaClick} />
    );
    // 等渲染完成
    await new Promise(r => setTimeout(r, 10));
    const p1 = container.querySelector('[data-para-idx="1"]');
    if (p1) fireEvent.click(p1);
    expect(onParaClick).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: 实现 DocxPreview.tsx**

```tsx
/**
 * @file DocxPreview.tsx
 * @description docx-preview.js 包装组件，每段注入 data-para-idx 供 click 定位
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useEffect, useRef } from 'react';
import { renderAsync } from 'docx-preview';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  file: string;
  onParaClick?: (paraIdx: number) => void;
  hoveredFieldId?: string;  // 用于"请为 X 选取段落"的 UI 提示
}

export function DocxPreview({ file, onParaClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    (async () => {
      // 读 docx 文件
      const bytes = await invoke<number[]>('read_file_bytes_cmd', { path: file });
      const buffer = new Uint8Array(bytes).buffer;
      await renderAsync(buffer, container, undefined, {
        inWrapper: true,
        ignoreWidth: false,
      });
      // 注入 data-para-idx 到每个 p 元素
      const paragraphs = container.querySelectorAll('.docx-paragraph, p');
      paragraphs.forEach((p, idx) => {
        p.setAttribute('data-para-idx', String(idx));
      });
    })();
  }, [file]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const para = target.closest('[data-para-idx]');
      if (para) {
        const idx = parseInt(para.getAttribute('data-para-idx') ?? '-1', 10);
        if (idx >= 0 && onParaClick) onParaClick(idx);
      }
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [onParaClick]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--c-bg)',
        padding: 20,
      }}
    />
  );
}
```

（注意：`read_file_bytes_cmd` 需要在 Rust 端存在。如未存在，可以用 existing `read_image_bytes_cmd` 或加新命令。**简化**：复用 P2 已有的 `read_file_bytes_cmd` —— 若无，新建一个 Tauri 命令。）

- [ ] **Step 3: 测试绿**

```bash
pnpm test src/features/tools/__tests__/DocxPreview.test.tsx -- --run
```

- [ ] **Step 4: 提交**

```bash
git add src/features/tools/templates/DocxPreview.tsx src/features/tools/__tests__/DocxPreview.test.tsx
git commit -m "feat(p4): DocxPreview 组件（docx-preview.js wrapper + para_idx 注入）"
```

---

### Task 16：FieldList 组件

**Files:**
- Create: `src/features/tools/templates/FieldList.tsx`
- Create: `src/features/tools/__tests__/FieldList.test.tsx`

- [ ] **Step 1: 写 FieldList 测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { FieldList } from '../templates/FieldList';

describe('FieldList', () => {
  const mockFields = [
    { id: 'title_zh', label: '中文题目', status: 'done', confidence: 0.9 },
    { id: 'abstract_zh_title', label: '摘要标题', status: 'empty' },
  ];

  it('renders all fields', () => {
    const { container } = render(
      <FieldList fields={mockFields} currentFieldId="abstract_zh_title" onJump={vi.fn()} onSkip={vi.fn()} />
    );
    expect(screen.getByText('中文题目')).toBeInTheDocument();
    expect(screen.getByText('摘要标题')).toBeInTheDocument();
  });

  it('clicking 📍 calls onJump', () => {
    const onJump = vi.fn();
    render(
      <FieldList fields={mockFields} currentFieldId="title_zh" onJump={onJump} onSkip={vi.fn()} />
    );
    const jumpBtn = screen.getAllByRole('button', { name: /定位/i })[0];
    fireEvent.click(jumpBtn);
    expect(onJump).toHaveBeenCalled();
  });

  it('highlights current field', () => {
    const { container } = render(
      <FieldList fields={mockFields} currentFieldId="abstract_zh_title" onJump={vi.fn()} onSkip={vi.fn()} />
    );
    const current = container.querySelector('[data-current="true"]');
    expect(current).toHaveTextContent('摘要标题');
  });
});
```

- [ ] **Step 2: 实现 FieldList.tsx**

```tsx
/**
 * @file FieldList.tsx
 * @description 32 字段表 + sequential 推进 + 📍 跳转 + 跳过
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { FIELD_DEFS } from './fieldDefs';

export interface FieldStatus {
  id: string;
  label: string;
  status: 'done' | 'partial' | 'empty' | 'skipped';
  confidence?: number;
  value?: Record<string, unknown>;
}

interface Props {
  fields: FieldStatus[];
  currentFieldId: string | null;
  onJump: (fieldId: string) => void;
  onSkip: (fieldId: string) => void;
}

function statusColor(status: string, conf?: number): string {
  if (status === 'skipped') return 'var(--c-fg-muted)';
  if (status === 'done' && conf !== undefined && conf >= 0.8) return 'var(--c-success)';
  if (conf !== undefined && conf >= 0.5) return 'var(--c-warning)';
  if (status === 'empty') return 'var(--c-fg-subtle)';
  return 'var(--c-danger)';
}

export function FieldList({ fields, currentFieldId, onJump, onSkip }: Props) {
  const doneCount = fields.filter(f => f.status === 'done' || f.status === 'skipped').length;

  return (
    <div style={{
      flex: 1,
      padding: 14,
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      fontFamily: 'var(--font-ui)',
      fontSize: 13,
      overflow: 'auto',
    }}>
      <div style={{ fontSize: 12, color: 'var(--c-fg-muted)', marginBottom: 10 }}>
        进度：{doneCount} / {fields.length}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {fields.map((f) => {
          const isCurrent = f.id === currentFieldId;
          return (
            <li
              key={f.id}
              data-current={isCurrent}
              style={{
                padding: '6px 10px',
                margin: '2px 0',
                background: isCurrent ? 'var(--c-accent-dim)' : 'transparent',
                borderLeft: isCurrent ? '3px solid var(--c-accent)' : '3px solid transparent',
                borderRadius: 'var(--r-sm)',
                color: statusColor(f.status, f.confidence),
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>
                {f.status === 'done' ? '✓ ' : f.status === 'skipped' ? '⏭ ' : f.status === 'partial' ? '⚠ ' : '○ '}
                {f.label}
                {f.confidence !== undefined && ` (${f.confidence.toFixed(2)})`}
              </span>
              <button
                aria-label="定位"
                onClick={() => onJump(f.id)}
                style={{
                  padding: '2px 6px',
                  background: 'var(--c-raised)',
                  color: 'var(--c-fg)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                📍
              </button>
              <button
                aria-label="跳过"
                onClick={() => onSkip(f.id)}
                style={{
                  padding: '2px 6px',
                  background: 'transparent',
                  color: 'var(--c-fg-muted)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                ⏭
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: 测试绿**

```bash
pnpm test src/features/tools/__tests__/FieldList.test.tsx -- --run
```

- [ ] **Step 4: 提交**

```bash
git add src/features/tools/templates/FieldList.tsx src/features/tools/__tests__/FieldList.test.tsx
git commit -m "feat(p4): FieldList 32 字段状态列表 + 跳转/跳过"
```

---

### Task 17：RuleTemplateWorkspace 整合

**Files:**
- Create: `src/features/tools/templates/RuleTemplateWorkspace.tsx`
- Create: `src/features/tools/__tests__/RuleTemplateWorkspace.test.tsx`

- [ ] **Step 1: 写整合测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { RuleTemplateWorkspace } from '../templates/RuleTemplateWorkspace';

vi.mock('../toolsSidecarClient', () => ({
  sidecarInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('RuleTemplateWorkspace', () => {
  it('auto-extracts on mount', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({
      rules: {
        title_zh: { enabled: true, value: { 'font.cjk': '黑体', 'font.size_pt': 16 } },
      },
      evidence: [{ field_id: 'title_zh', source_para_idx: 0, source_text: 'XX', confidence: 0.9 }],
      unmatched_paragraphs: [],
    });
    render(<RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => {
      expect(sidecarInvoke).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'extract_all' }));
    });
  });
});
```

- [ ] **Step 2: 实现 RuleTemplateWorkspace.tsx**

```tsx
/**
 * @file RuleTemplateWorkspace.tsx
 * @description P4 核心工作台：双栏 docx 预览 + 字段表 sequential 工作流
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useEffect, useState } from 'react';
import { DocxPreview } from './DocxPreview';
import { FieldList, FieldStatus } from './FieldList';
import { FIELD_DEFS } from './fieldDefs';
import {
  sidecarInvoke, SidecarError,
  ExtractAllResult, ExtractFromSelectionResult,
} from '../toolsSidecarClient';

interface Props {
  docxPath: string;
  initialName?: string;
  onSave: (rules: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function RuleTemplateWorkspace({ docxPath, initialName, onSave, onCancel }: Props) {
  const [fields, setFields] = useState<FieldStatus[]>([]);
  const [currentFieldId, setCurrentFieldId] = useState<string | null>(null);
  const [interruptReturn, setInterruptReturn] = useState<string | null>(null);
  const [extractedRules, setExtractedRules] = useState<Record<string, any>>({});
  const [error, setError] = useState<SidecarError | null>(null);
  const [templateName, setTemplateName] = useState(initialName ?? '新模板');

  // Mount 自动 extract_all
  useEffect(() => {
    (async () => {
      try {
        const result = await sidecarInvoke<ExtractAllResult>({
          cmd: 'extract_all',
          file: docxPath,
        });
        setExtractedRules(result.rules);
        // 初始化 fields 状态
        const evidenceMap = new Map(result.evidence.map(e => [e.field_id, e.confidence]));
        const initialFields: FieldStatus[] = FIELD_DEFS.map(def => {
          const conf = evidenceMap.get(def.id);
          const hasValue = def.id in result.rules;
          return {
            id: def.id,
            label: def.label,
            status: hasValue && (conf ?? 0) >= 0.8 ? 'done'
                  : hasValue && (conf ?? 0) >= 0.5 ? 'partial'
                  : 'empty',
            confidence: conf,
            value: result.rules[def.id]?.value,
          };
        });
        setFields(initialFields);
        // 当前字段 = 第一个未完成
        const firstIncomplete = initialFields.find(f => f.status === 'empty' || f.status === 'partial');
        setCurrentFieldId(firstIncomplete?.id ?? null);
      } catch (e) {
        if (e instanceof SidecarError) setError(e);
      }
    })();
  }, [docxPath]);

  // 段落点击处理
  const handleParaClick = async (paraIdx: number) => {
    if (!currentFieldId) return;
    try {
      const result = await sidecarInvoke<ExtractFromSelectionResult>({
        cmd: 'extract_from_selection',
        file: docxPath,
        para_indices: [paraIdx],
        field_id: currentFieldId,
      });
      // 更新字段状态
      const newRules = { ...extractedRules, [currentFieldId]: { enabled: true, value: result.value } };
      setExtractedRules(newRules);
      setFields(prev => prev.map(f =>
        f.id === currentFieldId
          ? {
              ...f,
              status: result.confidence >= 0.8 ? 'done' : result.confidence >= 0.5 ? 'partial' : 'empty',
              confidence: result.confidence,
              value: result.value,
            }
          : f
      ));
      // 推进到下一字段
      advanceField();
    } catch (e) {
      if (e instanceof SidecarError) setError(e);
    }
  };

  const advanceField = () => {
    // 如果是从临时跳转完成回到 interruptReturn
    if (interruptReturn) {
      setCurrentFieldId(interruptReturn);
      setInterruptReturn(null);
      return;
    }
    // 否则按顺序找下一未完成
    const currentIdx = fields.findIndex(f => f.id === currentFieldId);
    const next = fields.slice(currentIdx + 1).find(f => f.status === 'empty' || f.status === 'partial');
    setCurrentFieldId(next?.id ?? null);
  };

  const handleJump = (fieldId: string) => {
    // 临时跳转前记录下一位
    const currentIdx = fields.findIndex(f => f.id === currentFieldId);
    const returnTo = fields.slice(currentIdx + 1).find(f => f.status === 'empty' || f.status === 'partial');
    setInterruptReturn(returnTo?.id ?? null);
    setCurrentFieldId(fieldId);
  };

  const handleSkip = (fieldId: string) => {
    setFields(prev => prev.map(f => f.id === fieldId ? { ...f, status: 'skipped' } : f));
    if (fieldId === currentFieldId) advanceField();
  };

  const handleSaveClick = () => {
    // 构造最终 rules
    const finalRules: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.status === 'skipped') continue;
      if (f.value) {
        finalRules[f.id] = { enabled: true, value: f.value };
      }
    }
    onSave(finalRules);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-bg)' }}>
      <div style={{ padding: 10, borderBottom: '1px solid var(--c-border)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          placeholder="模板名称"
          style={{ flex: 1, padding: 6, background: 'var(--c-raised)', color: 'var(--c-fg)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-sm)' }}
        />
        <button onClick={onCancel}>取消</button>
        <button onClick={handleSaveClick} style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)', padding: '6px 12px', border: 'none', borderRadius: 'var(--r-sm)' }}>保存为模板</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1.4, borderRight: '1px solid var(--c-border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 10, background: 'var(--c-raised)', fontSize: 12, color: 'var(--c-fg-muted)' }}>
            {currentFieldId
              ? `请为「${FIELD_DEFS.find(f => f.id === currentFieldId)?.label}」选取规则段落`
              : '所有字段已完成，点「保存为模板」'}
          </div>
          <DocxPreview file={docxPath} onParaClick={handleParaClick} />
        </div>
        <div style={{ flex: 1 }}>
          <FieldList fields={fields} currentFieldId={currentFieldId} onJump={handleJump} onSkip={handleSkip} />
        </div>
      </div>
      {/* ErrorModal 复用 */}
    </div>
  );
}
```

- [ ] **Step 3: 测试绿**

```bash
pnpm test src/features/tools/__tests__/RuleTemplateWorkspace.test.tsx -- --run
pnpm build 2>&1 | tail -5
```

- [ ] **Step 4: 提交**

```bash
git add src/features/tools/templates/RuleTemplateWorkspace.tsx src/features/tools/__tests__/RuleTemplateWorkspace.test.tsx
git commit -m "feat(p4): RuleTemplateWorkspace 双栏工作台整合"
```

---

## Phase G — 集成 + E2E + 收尾（Task 18-20）

### Task 18：TemplateManager 接入 RuleTemplateWorkspace

**Files:**
- Modify: `src/features/tools/templates/TemplateManager.tsx`
- Delete: `src/features/tools/templates/TemplateExtractor.tsx`（P3 废弃）

- [ ] **Step 1: 改 handleNewFromDocx 打开 RuleTemplateWorkspace 替代 TemplateExtractor**

```tsx
// 原来：setExtractorOpen({ docxPath, name });
// 改为：
setWorkspaceOpen({ docxPath, name });

// 渲染：
{workspaceOpen && (
  <div style={{ position: 'fixed', inset: 0, background: 'var(--c-bg)', zIndex: 1100 }}>
    <RuleTemplateWorkspace
      docxPath={workspaceOpen.docxPath}
      initialName={workspaceOpen.name}
      onCancel={() => setWorkspaceOpen(null)}
      onSave={async (rules) => {
        await create(workspaceOpen.name, { explicitRules: rules });
        setWorkspaceOpen(null);
      }}
    />
  </div>
)}
```

（`create()` 需要支持 `explicitRules` 参数——TemplateStore 要更新。）

- [ ] **Step 2: TemplateStore.create 支持 explicitRules**

Modify TemplateStore.ts `create()`：若 options.explicitRules 有值，直接用；否则深拷贝 builtin。

- [ ] **Step 3: 删除 TemplateExtractor.tsx + 相关 test**

```bash
git rm src/features/tools/templates/TemplateExtractor.tsx src/features/tools/__tests__/TemplateExtractor.test.tsx
```

- [ ] **Step 4: 删除 toolsSidecarClient 里 ExtractTemplateRequest 类型**

- [ ] **Step 5: pnpm test + build 全过**

```bash
pnpm test -- --run 2>&1 | tail -5
pnpm build 2>&1 | tail -5
```

- [ ] **Step 6: 提交**

```bash
git add src/features/tools/templates/ src/features/tools/__tests__/ src/features/tools/toolsSidecarClient.ts
git commit -m "feat(p4): TemplateManager 接入 RuleTemplateWorkspace 替代 TemplateExtractor"
```

---

### Task 19：删除 P3 11 规则文件（P3 已被 v2 engine 取代）

**Files:**
- Delete: `src-python/thesis_worker/rules/` 整个目录（保留 `__init__.py` 空化，暂时）
- Delete: `src-python/thesis_worker/extractor.py`（旧版 extractor，P4 用 `extractor/` 包）
- Modify: `src-python/thesis_worker/handlers.py` 移除 REGISTRY import

- [ ] **Step 1: 确认 handlers.py 不再引用 rules 目录**

grep 确认 `from .rules import REGISTRY` 被替换为 v2 engine。

- [ ] **Step 2: 删旧代码**

```bash
git rm -r src-python/thesis_worker/rules/
git rm src-python/thesis_worker/extractor.py
git rm -r src-python/tests/rules/
git rm src-python/tests/test_extractor.py
```

- [ ] **Step 3: handlers.py 清理 list_rules/detect 等里对旧 REGISTRY 的引用**

- [ ] **Step 4: pytest 全过**

```bash
uv run pytest 2>&1 | tail -5
```

- [ ] **Step 5: 提交**

```bash
git add src-python/
git commit -m "chore(p4): 删除 P3 11 抽象规则 + 旧 extractor（被 v2 engine 取代）"
```

---

### Task 20：milestone tag + E2E 手动验证

- [ ] **Step 1: 跑全套测试**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
cd src-python && uv run pytest 2>&1 | tail -5
cd .. && pnpm test -- --run 2>&1 | tail -5
pnpm build 2>&1 | tail -5
```

全绿 + build OK。

- [ ] **Step 2: rebuild Python sidecar binary**

```bash
cd src-python && ./build_sidecar.sh
```

- [ ] **Step 3: 手动 E2E 验证**

- `pnpm tauri dev` 启动
- 创建新模板 → 上传 Template A (`论文格式模板.docx`) → 观察 ≥ 85% 字段自动填
- 对红色字段手动 sequential 选段补全
- 保存为模板
- 上传实际论文 docx → 用此模板检测 → 有 Issue 报告
- 单条 Issue 修复 → DocxPreview 里蓝色标记
- Cmd+Z 撤销 → 恢复

记录问题清单 commit `fix(p4): E2E 验证发现的 bug`（若有）

- [ ] **Step 4: milestone tag**

```bash
git tag -a milestone-p4-semantic-fields -m "P4 完成：32 语义字段规则引擎

- 前置 12 + 正文 8 + 后置 6 + 页面 6 = 32 字段
- 新 sidecar API：extract_all / extract_from_selection / list_fields
- v2 rule engine：22 attribute checker + detector + fixer
- DocxPreview + FieldList + RuleTemplateWorkspace 双栏 UI
- Flow C 调整版：sequential + 📍 临时打断
- 无 HanLP，仅 Gazetteer + 正则
- 硬破坏迁移（代码只认 schema_version=2）
- 内置 _builtin-gbt7714-v2 起点模板"

git push origin feat/p4-semantic-fields  # 推分支（不 push main，等 merge 决策）
git push origin milestone-p4-semantic-fields
```

- [ ] **Step 5: 更新 plan / 确认完成**

更新本 plan 文件结尾加"完成日期 2026-XX-XX"。commit。

```bash
git add docs/superpowers/plans/2026-04-18-p4-semantic-fields-full.md
git commit -m "docs(plan): 标记 P4 plan 全部 task 完成"
```

---

## Self-Review

- **Spec 覆盖**：32 字段 ✓ | 22 属性 key ✓ | Flow C ✓ | extract_all/from_selection/list_fields ✓ | schema v2 ✓ | 硬破坏 ✓ | _builtin-gbt7714-v2 ✓ | docx-preview.js 复用 ✓ | chineseSizeMap 前后端 ✓ | Gazetteer+正则 ✓ | 不加 HanLP ✓ | .docx-only ✓ | 封面跳过（无相关 task，在 field_defs 省略封面字段体现） ✓

- **Placeholder 扫描**：
  - Task 8 的 `FIELD_DEFS` 数组实现说"照 spec 填 32 条"——spec 里有完整表，实现者按表 1:1 照抄。**不是 placeholder，是引用 spec**。
  - Task 9 checkers 说"其他 checker 按 spec 22 项列表实现"——同上，spec 明确。
  - Task 12 `_builtin-gbt7714-v2.json` 说"剩余 29 字段照 spec 填"——spec 32 字段表 + 起点值范例可推。
  - Task 13 RuleValueEditor 列了 22 个属性 case，实现基本完整，`CjkFontSelect` 等子组件需要实现但逻辑简单（下拉选择）。

- **类型一致**：
  - `FieldStatus.status` = `'done' | 'partial' | 'empty' | 'skipped'`（Task 16）
  - `ExtractAllResult.rules` = `Record<string, {enabled, value}>`（Task 7）
  - Python `FIELD_DEFS` / TypeScript `FIELD_DEFS` 结构一致
  - `CHECKER_MAP` 与 `applicable_attributes` 属性名匹配

- **独立可交付**：P4 完成后 tools tab 可用（更好），P3 功能全被 v2 engine 取代。

---

## Subagent 调度建议

- **Task 1-11**（后端 Python）：model=sonnet，机械度高，可快节奏
- **Task 12**（Rust 内置模板）：model=sonnet，照 spec 填 JSON
- **Task 13-14**（前端 schema/store 升级）：model=sonnet
- **Task 15-17**（前端核心 UI）：model=sonnet，需要手动 UI 调试 + DocxPreview 联调复杂
- **Task 18-19**（集成 + 清理）：model=sonnet
- **Task 20**（E2E + milestone）：手动为主，model=opus 做综合判断

控制器按 SDD 流程：每 task 先 implementer → spec-reviewer → code-quality-reviewer，review 过才 mark complete。

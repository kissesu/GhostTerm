# P2 - Python Sidecar 骨架 + NDJSON IPC + 首条规则

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起"工具箱"完整 IPC 通路：Python sidecar (`ghostterm-thesis`) 打包嵌入 app bundle，Rust spawn + NDJSON 通信，前端调用并展示结果。实现首条规则 `cjk_ascii_space`（中英/中数之间空格检测和修复）作为端到端验证

**Architecture:** 
- Python 项目 `src-python/thesis_worker/`，uv 管理依赖，PyInstaller `--onedir` 打包
- Tauri `externalBin` 引入 sidecar binary，Rust 通过 `tauri-plugin-shell` spawn 常驻 worker
- NDJSON over stdio：前端 `invoke('tools_sidecar_invoke', payload)` → Rust 写 stdin 读 stdout → 返回前端
- 错误直接抛出到 UI modal，无自动重试（遵循 spec Section 7）

**Tech Stack:** Python 3.12+ / python-docx / pytest / PyInstaller / uv；Rust tauri 2 + tauri-plugin-shell；React + TypeScript + Vitest

**依赖 plan:** P1（三 tab 架构已就绪，本 plan 往 `ToolsWorkspace` 里填实际内容）

**依赖 spec:** Section 3（IPC 协议）+ Section 5（规则引擎）+ Section 7（错误处理）

**不在本 plan 范围**：配置模板系统（P3）/ 其余 10 条规则 / 备份/undo / 模板 extractor（P3）/ 完整 E2E（P4）

---

## File Structure

| 动作 | 路径 | 职责 |
|------|------|------|
| Create | `src-python/pyproject.toml` | uv 管理的 Python 项目配置 |
| Create | `src-python/.gitignore` | .venv / dist / build 等 |
| Create | `src-python/thesis_worker/__init__.py` | Python 包标记 |
| Create | `src-python/thesis_worker/__main__.py` | sidecar 入口：stdio NDJSON 主循环 |
| Create | `src-python/thesis_worker/handlers.py` | cmd → handler 路由（ping / detect / fix） |
| Create | `src-python/thesis_worker/models.py` | dataclasses: Issue / FixResult |
| Create | `src-python/thesis_worker/rules/__init__.py` | REGISTRY 字典 |
| Create | `src-python/thesis_worker/rules/cjk_ascii_space.py` | 首条规则实现 |
| Create | `src-python/thesis_worker/rules/base.py` | 规则基类/协议 |
| Create | `src-python/tests/__init__.py` | pytest 包 |
| Create | `src-python/tests/fixtures/cjk_space_bad.docx` | 违规样本 |
| Create | `src-python/tests/fixtures/cjk_space_clean.docx` | 合规样本 |
| Create | `src-python/tests/test_main_loop.py` | sidecar stdio 主循环单测 |
| Create | `src-python/tests/test_handlers.py` | ping / detect / fix 路由单测 |
| Create | `src-python/tests/rules/test_cjk_ascii_space.py` | 规则 detect+fix+reopen 硬测试 |
| Create | `src-python/build_sidecar.sh` | PyInstaller 本地打包脚本（macOS/Linux） |
| Create | `src-python/build_sidecar.ps1` | PyInstaller 本地打包脚本（Windows） |
| Modify | `.gitignore`（项目根） | 加入 `src-python/.venv/` `src-python/dist/` `src-python/build/` |
| Modify | `src-tauri/tauri.conf.json` | `bundle.externalBin` 加入 sidecar 二进制路径 |
| Create | `src-tauri/src/sidecar.rs` | sidecar spawn + stdin/stdout 通信 + 单例生命周期 |
| Modify | `src-tauri/src/lib.rs` | 注册 sidecar 状态 + `tools_sidecar_invoke` command |
| Modify | `src-tauri/Cargo.toml` | 确认 tauri-plugin-shell 已启用 |
| Create | `src-tauri/tests/sidecar_protocol.rs` | mock sidecar 脚本 + 协议往返集成测试 |
| Create | `src/features/tools/toolsSidecarClient.ts` | 前端 invoke 封装 + 类型 |
| Create | `src/features/tools/ErrorModal.tsx` | 错误 modal 组件（带"复制完整错误信息"按钮） |
| Create | `src/features/tools/ToolRunner.tsx` | 选文件 + 检测 + 展示 issues 的最小 UI |
| Modify | `src/features/tools/ToolsWorkspace.tsx` | 用 ToolRunner 替换占位 |
| Create | `src/features/tools/__tests__/toolsSidecarClient.test.ts` | mock invoke 测试 |
| Modify | `.github/workflows/release.yml` | 加 Python 测试 + PyInstaller 打包 job |

---

## Task 1: 创建 Python 项目骨架

**Files:**
- Create: `src-python/pyproject.toml`
- Create: `src-python/.gitignore`
- Create: `src-python/thesis_worker/__init__.py`
- Modify: `.gitignore`（项目根）

- [ ] **Step 1: 确认 uv 已安装**

```bash
uv --version
```

Expected: 输出版本号（如 `uv 0.5.x`）。若无，参照用户 CLAUDE.md "Python: 使用 uv"——macOS `brew install uv`。

- [ ] **Step 2: 创建 pyproject.toml**

`src-python/pyproject.toml`：

```toml
[project]
name = "thesis-worker"
version = "0.1.0"
description = "GhostTerm Python sidecar: DOCX rule-based detection and fixing"
authors = [{name = "Atlas.oi"}]
requires-python = ">=3.12"
dependencies = [
    "python-docx>=1.1.2",
    "pdfplumber>=0.11.0",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8.3.0",
    "pytest-cov>=5.0.0",
    "pyinstaller>=6.10.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
```

- [ ] **Step 3: 创建 .gitignore**

`src-python/.gitignore`：

```gitignore
.venv/
dist/
build/
__pycache__/
*.egg-info/
.pytest_cache/
*.spec
```

- [ ] **Step 4: 更新项目根 .gitignore**

追加到 `/Users/oi/CodeCoding/Code/自研项目/GhostTerm/.gitignore`：

```gitignore

# Python sidecar
src-python/.venv/
src-python/dist/
src-python/build/
src-python/__pycache__/
```

- [ ] **Step 5: 创建 Python 包标记**

`src-python/thesis_worker/__init__.py`：

```python
"""
@file: __init__.py
@description: thesis_worker 是 GhostTerm 的 Python sidecar 入口包，负责 DOCX
              规则型检测与修复。所有 docx 读写通过 python-docx。
@author: Atlas.oi
@date: 2026-04-17
"""
__version__ = "0.1.0"
```

- [ ] **Step 6: 初始化 venv + 同步依赖**

```bash
cd src-python
uv venv
uv sync
```

Expected: 创建 `.venv/`，打印 "Resolved N packages"

- [ ] **Step 7: Commit**

```bash
cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm
git add src-python/pyproject.toml src-python/.gitignore src-python/thesis_worker/__init__.py .gitignore
git commit -m "chore(sidecar): Python 项目骨架 + uv 依赖管理"
```

---

## Task 2: sidecar 数据模型

**Files:**
- Create: `src-python/thesis_worker/models.py`

- [ ] **Step 1: 创建 models.py**

`src-python/thesis_worker/models.py`：

```python
"""
@file: models.py
@description: sidecar 数据模型 dataclasses：Request / Response / Issue / Location / FixResult
              与前端 TypeScript 接口一一对应（snake_case → camelCase 在 Rust 层转换）
@author: Atlas.oi
@date: 2026-04-17
"""
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class Location:
    """问题在 docx 中的位置"""
    para: int
    run: int
    char: Optional[int] = None  # run 内字符偏移，可选


@dataclass
class Issue:
    """一个检测到的问题"""
    rule_id: str
    loc: Location
    message: str
    current: Any          # 实际值（例如 "字体A"）
    expected: Any         # 期望值（例如 "宋体"）
    fix_available: bool
    issue_id: str = ""    # 由 handler 后分配，稳定引用
    evidence_xml: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


@dataclass
class FixResult:
    """一条修复操作的返回"""
    diff: str
    applied: bool
    xml_changed: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
```

- [ ] **Step 2: 验证 import 正常**

```bash
cd src-python
uv run python -c "from thesis_worker.models import Issue, Location, FixResult; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src-python/thesis_worker/models.py
git commit -m "feat(sidecar): 数据模型 Issue / Location / FixResult"
```

---

## Task 3: 规则基类 + REGISTRY 骨架

**Files:**
- Create: `src-python/thesis_worker/rules/base.py`
- Create: `src-python/thesis_worker/rules/__init__.py`

- [ ] **Step 1: 创建 base.py（Protocol）**

`src-python/thesis_worker/rules/base.py`：

```python
"""
@file: base.py
@description: 规则 Protocol 定义。每条规则都必须有 id/category/severity/detect，
              fix 可选（None 表示只检测不修复）
@author: Atlas.oi
@date: 2026-04-17
"""
from typing import Protocol, Any, Optional
from docx.document import Document
from ..models import Issue, FixResult


class Rule(Protocol):
    id: str                    # 'cjk_ascii_space' 等
    category: str              # 'format' | 'citation' | 'structure' | 'writing' | 'ai'
    severity: str              # 'blocker' | 'warning' | 'info'
    fix_available: bool        # 是否支持 fix

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]: ...

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult: ...
```

- [ ] **Step 2: 创建 REGISTRY**

`src-python/thesis_worker/rules/__init__.py`：

```python
"""
@file: __init__.py
@description: 规则注册表 REGISTRY。新增规则只需 import + 注册到字典
@author: Atlas.oi
@date: 2026-04-17
"""
from .cjk_ascii_space import CjkAsciiSpaceRule

REGISTRY: dict = {
    'cjk_ascii_space': CjkAsciiSpaceRule,
    # P4 追加其余 10 条
}
```

（本 task `cjk_ascii_space` 还未实现，后 Task 4 实现；此处先 import 会失败，Task 4 完成后才能 import 通）

- [ ] **Step 3: Commit**

```bash
git add src-python/thesis_worker/rules/base.py src-python/thesis_worker/rules/__init__.py
git commit -m "feat(sidecar): 规则 Protocol + REGISTRY 骨架"
```

---

## Task 4: 实现规则 cjk_ascii_space（TDD）

**Files:**
- Create: `src-python/thesis_worker/rules/cjk_ascii_space.py`
- Create: `src-python/tests/__init__.py`
- Create: `src-python/tests/rules/__init__.py`
- Create: `src-python/tests/rules/test_cjk_ascii_space.py`
- Create: `src-python/tests/fixtures/cjk_space_bad.docx`
- Create: `src-python/tests/fixtures/cjk_space_clean.docx`

- [ ] **Step 1: 生成 fixture docx**

创建 `src-python/tests/make_fixtures.py`（一次性脚本，本 plan 跑完可删）：

```python
"""
@file: make_fixtures.py
@description: 一次性脚本，生成测试 fixture docx。跑完可删。
@author: Atlas.oi
@date: 2026-04-17
"""
from docx import Document
from pathlib import Path

out = Path(__file__).parent / 'fixtures'
out.mkdir(parents=True, exist_ok=True)

# bad: 中英间有空格
bad = Document()
bad.add_paragraph('这是 AI 工具。')
bad.add_paragraph('版本 2.1.1 已发布。')
bad.add_paragraph('无违规段落。')
bad.save(out / 'cjk_space_bad.docx')

# clean: 中英紧贴，无空格
clean = Document()
clean.add_paragraph('这是AI工具。')
clean.add_paragraph('版本2.1.1已发布。')
clean.save(out / 'cjk_space_clean.docx')

print('fixtures generated')
```

跑：

```bash
cd src-python
uv run python tests/make_fixtures.py
```

Expected: `fixtures generated`，生成两个 docx

- [ ] **Step 2: 创建 tests/__init__.py 等包标记**

`src-python/tests/__init__.py`：空文件（包标记）

`src-python/tests/rules/__init__.py`：空文件

- [ ] **Step 3: 写失败测试**

`src-python/tests/rules/test_cjk_ascii_space.py`：

```python
"""
@file: test_cjk_ascii_space.py
@description: cjk_ascii_space 规则 detect + fix + reopen 硬测试
@author: Atlas.oi
@date: 2026-04-17
"""
import tempfile
import shutil
from pathlib import Path
from docx import Document

from thesis_worker.rules.cjk_ascii_space import CjkAsciiSpaceRule

FIXTURES = Path(__file__).parent.parent / 'fixtures'
CONFIG_FORBID = {'allowed': False}  # 院校要求：不允许空格


class TestDetect:
    def test_detect_finds_violations_in_bad_doc(self):
        doc = Document(FIXTURES / 'cjk_space_bad.docx')
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        # "这是 AI 工具" 有两处违规（中-空-英 + 英-空-中）
        # "版本 2.1.1 已发布" 有两处违规（中-空-数 + 数-空-中）
        # "无违规段落。" 0 处
        assert len(issues) == 4
        for i in issues:
            assert i.rule_id == 'cjk_ascii_space'
            assert i.fix_available is True

    def test_detect_returns_empty_on_clean_doc(self):
        doc = Document(FIXTURES / 'cjk_space_clean.docx')
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        assert issues == []

    def test_detect_skip_when_allowed_true(self):
        """config 设为 allowed:true（允许空格）→ 不检测"""
        doc = Document(FIXTURES / 'cjk_space_bad.docx')
        issues = CjkAsciiSpaceRule.detect(doc, {'allowed': True})
        assert issues == []


class TestFix:
    def test_fix_and_reopen_produces_no_issues(self, tmp_path):
        """关键硬测试：修复后重开跑 detect 必须返回空"""
        origin = FIXTURES / 'cjk_space_bad.docx'
        tmp = tmp_path / 'copy.docx'
        shutil.copy(origin, tmp)

        doc = Document(tmp)
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        assert len(issues) == 4

        # 逐条修复
        for issue in issues:
            CjkAsciiSpaceRule.fix(doc, issue, CONFIG_FORBID)
        doc.save(tmp)

        # 重开验证
        reopened = Document(tmp)
        remaining = CjkAsciiSpaceRule.detect(reopened, CONFIG_FORBID)
        assert remaining == []

    def test_fix_marks_blue_color(self, tmp_path):
        from docx.shared import RGBColor
        origin = FIXTURES / 'cjk_space_bad.docx'
        tmp = tmp_path / 'copy.docx'
        shutil.copy(origin, tmp)

        doc = Document(tmp)
        issues = CjkAsciiSpaceRule.detect(doc, CONFIG_FORBID)
        assert issues  # 非空

        CjkAsciiSpaceRule.fix(doc, issues[0], CONFIG_FORBID)
        doc.save(tmp)

        reopened = Document(tmp)
        # 第 0 段第 0 run（修改发生处）应有蓝色标记 #0070C0
        first_run = reopened.paragraphs[0].runs[0]
        assert first_run.font.color.rgb == RGBColor(0x00, 0x70, 0xC0)
```

- [ ] **Step 4: 运行测试验证失败**

```bash
cd src-python
uv run pytest tests/rules/test_cjk_ascii_space.py -v
```

Expected: ImportError（CjkAsciiSpaceRule 不存在）

- [ ] **Step 5: 实现规则**

`src-python/thesis_worker/rules/cjk_ascii_space.py`：

```python
"""
@file: cjk_ascii_space.py
@description: 检测和修复中英/中数之间的空格
              config 示例：{"allowed": false} = 不允许空格（院校特定要求）
                          {"allowed": true}  = 跳过该规则
@author: Atlas.oi
@date: 2026-04-17
"""
import re
from typing import Any
from docx.document import Document
from docx.shared import RGBColor

from ..models import Issue, Location, FixResult


# 中文字符范围 + ASCII 字母数字
_CJK = r'[\u4e00-\u9fa5]'
_ASCII = r'[A-Za-z0-9]'
# 匹配：中-空格+ -英 或 英-空格+ -中（空格 1 个或多个都算违规）
_VIOLATION_RE = re.compile(
    rf'(?:{_CJK} +{_ASCII})|(?:{_ASCII} +{_CJK})'
)

# 蓝色标记：Office 标准 "蓝色, 个性色 1" = #0070C0
_MARK_COLOR = RGBColor(0x00, 0x70, 0xC0)


class CjkAsciiSpaceRule:
    id = 'cjk_ascii_space'
    category = 'writing'
    severity = 'warning'
    fix_available = True

    @staticmethod
    def detect(doc: Document, value: Any) -> list[Issue]:
        if value.get('allowed', True) is not False:
            return []  # allowed 为 true 或未设 → 跳过

        issues: list[Issue] = []
        for p_idx, para in enumerate(doc.paragraphs):
            for r_idx, run in enumerate(para.runs):
                text = run.text
                for m in _VIOLATION_RE.finditer(text):
                    current = m.group(0)
                    expected = re.sub(r' +', '', current)
                    issues.append(Issue(
                        rule_id='cjk_ascii_space',
                        loc=Location(para=p_idx, run=r_idx, char=m.start()),
                        message='中英/中数之间不应有空格',
                        current=current,
                        expected=expected,
                        fix_available=True,
                    ))
        return issues

    @staticmethod
    def fix(doc: Document, issue: Issue, value: Any) -> FixResult:
        para = doc.paragraphs[issue.loc.para]
        run = para.runs[issue.loc.run]
        before = run.text
        after = _VIOLATION_RE.sub(
            lambda m: re.sub(r' +', '', m.group(0)),
            before,
        )
        run.text = after
        run.font.color.rgb = _MARK_COLOR

        return FixResult(
            diff=f'- {before}\n+ {after}',
            applied=True,
            xml_changed=[f'w:p[{issue.loc.para}]/w:r[{issue.loc.run}]'],
        )
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd src-python
uv run pytest tests/rules/test_cjk_ascii_space.py -v
```

Expected: 5 tests PASS（含 reopen 硬测试）

- [ ] **Step 7: Commit**

```bash
git add src-python/thesis_worker/rules/cjk_ascii_space.py \
        src-python/tests/__init__.py \
        src-python/tests/rules/__init__.py \
        src-python/tests/rules/test_cjk_ascii_space.py \
        src-python/tests/make_fixtures.py \
        src-python/tests/fixtures/
git commit -m "feat(rules): cjk_ascii_space 首条规则实现 + TDD"
```

---

## Task 5: handlers（cmd 路由）

**Files:**
- Create: `src-python/thesis_worker/handlers.py`
- Create: `src-python/tests/test_handlers.py`

- [ ] **Step 1: 写失败测试**

`src-python/tests/test_handlers.py`：

```python
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
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd src-python
uv run pytest tests/test_handlers.py -v
```

Expected: ImportError（handlers 不存在）

- [ ] **Step 3: 实现 handlers.py**

`src-python/thesis_worker/handlers.py`：

```python
"""
@file: handlers.py
@description: NDJSON 请求路由。收到 {id, cmd, ...} → 返回 {id, ok, result?, error?, code?}
              错误处理原则（spec Section 7）：不降级，异常直接抛出成 response
              - 规则异常 → 整批中止，不跳过其它规则
              - 文件错误 → 明确 code (ENOENT / EPERM / PARSE_ERROR)
@author: Atlas.oi
@date: 2026-04-17
"""
import traceback
from pathlib import Path
from typing import Any
from docx import Document
from docx.opc.exceptions import PackageNotFoundError

from .rules import REGISTRY


def handle(req: dict) -> dict:
    """顶层路由。任何未捕获异常都转成 code=INTERNAL 的 response（sidecar 进程不崩）"""
    req_id = req.get('id')
    cmd = req.get('cmd')

    try:
        if cmd == 'ping':
            return {'id': req_id, 'ok': True, 'result': 'pong'}

        if cmd == 'detect':
            return _handle_detect(req_id, req)

        if cmd == 'fix':
            return _handle_fix(req_id, req)

        return {
            'id': req_id, 'ok': False,
            'error': f'unknown cmd: {cmd}',
            'code': 'UNKNOWN_CMD',
        }
    except Exception as e:
        return {
            'id': req_id, 'ok': False,
            'error': f'{type(e).__name__}: {e}\n{traceback.format_exc()}',
            'code': 'INTERNAL',
        }


def _handle_detect(req_id: str, req: dict) -> dict:
    file = req['file']
    template = req['template']

    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}

    try:
        doc = Document(file)
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}
    except PermissionError as e:
        return {'id': req_id, 'ok': False, 'error': str(e), 'code': 'EPERM'}

    all_issues = []
    for rule_id, rule_cfg in template['rules'].items():
        if not rule_cfg.get('enabled', False):
            continue
        rule = REGISTRY.get(rule_id)
        if rule is None:
            continue  # 未注册的规则跳过（模板 schema 可能比当前 sidecar 新）

        try:
            found = rule.detect(doc, rule_cfg.get('value'))
        except Exception as e:
            # spec Section 7：单规则抛异常 → 整批中止
            return {
                'id': req_id, 'ok': False,
                'error': f'rule {rule_id} raised: {type(e).__name__}: {e}\n{traceback.format_exc()}',
                'code': 'RULE_ERROR',
            }

        # 给每个 issue 分配稳定 id
        for idx, issue in enumerate(found):
            issue.issue_id = f'{rule_id}-{len(all_issues) + idx}'
        all_issues.extend(found)

    return {
        'id': req_id, 'ok': True,
        'result': {'issues': [i.to_dict() for i in all_issues]},
    }


def _handle_fix(req_id: str, req: dict) -> dict:
    # P2 简化：fix 接受完整 issue payload（后续 P4 可能改为按 issue_id 查库）
    file = req['file']
    issue_dict = req['issue']
    rule_id = issue_dict['rule_id']
    value = req.get('value', {})

    if not Path(file).exists():
        return {'id': req_id, 'ok': False, 'error': f'file not found: {file}', 'code': 'ENOENT'}

    try:
        doc = Document(file)
    except PackageNotFoundError:
        return {'id': req_id, 'ok': False, 'error': f'docx malformed: {file}', 'code': 'PARSE_ERROR'}

    rule = REGISTRY.get(rule_id)
    if rule is None:
        return {'id': req_id, 'ok': False, 'error': f'unknown rule: {rule_id}', 'code': 'UNKNOWN_RULE'}

    # 把 dict 转回 Issue
    from .models import Issue, Location
    issue = Issue(
        rule_id=rule_id,
        loc=Location(**issue_dict['loc']),
        message=issue_dict['message'],
        current=issue_dict['current'],
        expected=issue_dict['expected'],
        fix_available=issue_dict['fix_available'],
        issue_id=issue_dict.get('issue_id', ''),
    )

    result = rule.fix(doc, issue, value)
    doc.save(file)

    return {'id': req_id, 'ok': True, 'result': result.to_dict()}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd src-python
uv run pytest tests/test_handlers.py -v
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-python/thesis_worker/handlers.py src-python/tests/test_handlers.py
git commit -m "feat(sidecar): handlers cmd 路由 + 异常不降级"
```

---

## Task 6: sidecar 主循环（NDJSON stdio）

**Files:**
- Create: `src-python/thesis_worker/__main__.py`
- Create: `src-python/tests/test_main_loop.py`

- [ ] **Step 1: 写失败测试**

`src-python/tests/test_main_loop.py`：

```python
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
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd src-python
uv run pytest tests/test_main_loop.py -v
```

Expected: FAIL（`__main__` 不存在）

- [ ] **Step 3: 实现 `__main__.py`**

`src-python/thesis_worker/__main__.py`：

```python
"""
@file: __main__.py
@description: sidecar 入口。NDJSON over stdin/stdout 主循环。
              - 每行一个 JSON 请求
              - 响应每行一个 JSON
              - stdin EOF → 正常退出（exitcode 0）
              - 非法 JSON → 返回 PARSE_ERROR，继续接下一条（不崩）
              - handler 异常 → 捕获并转 INTERNAL 响应
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
            continue  # 空行跳过

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
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd src-python
uv run pytest tests/test_main_loop.py -v
```

Expected: 3 tests PASS

- [ ] **Step 5: 手动 smoke test**

```bash
cd src-python
echo '{"id":"s1","cmd":"ping"}' | uv run python -m thesis_worker
```

Expected: `{"id": "s1", "ok": true, "result": "pong"}`

- [ ] **Step 6: Commit**

```bash
git add src-python/thesis_worker/__main__.py src-python/tests/test_main_loop.py
git commit -m "feat(sidecar): NDJSON stdio 主循环 + 异常不崩"
```

---

## Task 7: PyInstaller 本地打包

**Files:**
- Create: `src-python/build_sidecar.sh`
- Create: `src-python/build_sidecar.ps1`

- [ ] **Step 1: 确认目标三元组命名**

Tauri sidecar 要求二进制命名为 `<name>-<triple>`，例如：
- macOS arm64: `ghostterm-thesis-aarch64-apple-darwin`
- macOS x86_64: `ghostterm-thesis-x86_64-apple-darwin`
- Windows x64: `ghostterm-thesis-x86_64-pc-windows-msvc.exe`

**但 Tauri 2 sidecar binary path** 在 tauri.conf.json 里写 `binaries/ghostterm-thesis`，实际匹配时后面自动加 `-<triple>`。

- [ ] **Step 2: 创建 macOS/Linux 打包脚本**

`src-python/build_sidecar.sh`：

```bash
#!/usr/bin/env bash
#
# @file build_sidecar.sh
# @description PyInstaller 打包 ghostterm-thesis sidecar binary
#              输出到 ../src-tauri/binaries/ghostterm-thesis-<triple>
# @author Atlas.oi
# @date 2026-04-17
#
set -euo pipefail

cd "$(dirname "$0")"

# 确定当前平台 triple
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)   TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64)  TRIPLE="x86_64-apple-darwin" ;;
  Linux-x86_64)   TRIPLE="x86_64-unknown-linux-gnu" ;;
  *)              echo "unsupported platform" >&2; exit 1 ;;
esac

OUT_DIR="../src-tauri/binaries"
mkdir -p "$OUT_DIR"

uv sync
uv run pyinstaller \
  --onedir \
  --name "ghostterm-thesis-${TRIPLE}" \
  --distpath "./dist" \
  --workpath "./build" \
  --specpath "./build" \
  --clean \
  --noconfirm \
  thesis_worker/__main__.py

# Tauri 约定：sidecar 作为单目录放入 binaries/
# 但 Tauri 2 需要单可执行文件；我们用 --onedir 生成包再 wrap 为单文件不方便。
# 改用 --onefile（打包耗时稍长但 Tauri bundling 简单）。
# 如遇启动慢，后续可切回 --onedir + 手写路由。

echo "done: ${OUT_DIR}/ghostterm-thesis-${TRIPLE}"
```

**修正**：Tauri 2 sidecar 实际要单可执行文件，改用 `--onefile`：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)   TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64)  TRIPLE="x86_64-apple-darwin" ;;
  *)              echo "unsupported platform" >&2; exit 1 ;;
esac

OUT_DIR="../src-tauri/binaries"
mkdir -p "$OUT_DIR"

uv sync
uv run pyinstaller \
  --onefile \
  --name "ghostterm-thesis-${TRIPLE}" \
  --distpath "$OUT_DIR" \
  --workpath "./build" \
  --specpath "./build" \
  --clean \
  --noconfirm \
  thesis_worker/__main__.py

echo "done: ${OUT_DIR}/ghostterm-thesis-${TRIPLE}"
```

设置可执行：

```bash
chmod +x src-python/build_sidecar.sh
```

- [ ] **Step 3: 创建 Windows 打包脚本**

`src-python/build_sidecar.ps1`：

```powershell
# @file build_sidecar.ps1
# @description PyInstaller 打包 Windows sidecar
# @author Atlas.oi
# @date 2026-04-17

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$triple = "x86_64-pc-windows-msvc"
$outDir = "..\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

uv sync
uv run pyinstaller `
  --onefile `
  --name "ghostterm-thesis-$triple" `
  --distpath $outDir `
  --workpath ".\build" `
  --specpath ".\build" `
  --clean `
  --noconfirm `
  thesis_worker\__main__.py

Write-Host "done: $outDir\ghostterm-thesis-$triple.exe"
```

- [ ] **Step 4: 本地跑一次验证**

macOS 上：

```bash
cd src-python
./build_sidecar.sh
```

Expected: 约 30-90 秒后输出 `done: ../src-tauri/binaries/ghostterm-thesis-<triple>`，文件存在

- [ ] **Step 5: smoke test 打包产物**

```bash
echo '{"id":"s1","cmd":"ping"}' | ../src-tauri/binaries/ghostterm-thesis-aarch64-apple-darwin
```

Expected: `{"id": "s1", "ok": true, "result": "pong"}`

若失败：检查 `./build/<name>.spec` 或 `uv run pyinstaller` 输出的 warning

- [ ] **Step 6: 确保 binaries 进 gitignore**

追加项目根 `.gitignore`：

```gitignore

# Tauri sidecar binaries（本地构建产物，不入库；CI 在每次 release 重新构建）
src-tauri/binaries/
```

- [ ] **Step 7: Commit**

```bash
git add src-python/build_sidecar.sh src-python/build_sidecar.ps1 .gitignore
git commit -m "feat(sidecar): PyInstaller 打包脚本（macOS/Linux/Windows）"
```

---

## Task 8: Tauri 集成 sidecar（Rust 层）

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 检查 Cargo.toml tauri-plugin-shell**

读 `src-tauri/Cargo.toml`，确认 `tauri-plugin-shell` 在 `[dependencies]`（GhostTerm 已有终端功能，通常已存在）。若无，加：

```toml
tauri-plugin-shell = "2"
```

- [ ] **Step 2: 更新 tauri.conf.json 加 externalBin**

在 `bundle` 字段下加 `externalBin`：

```json
{
  "bundle": {
    "externalBin": [
      "binaries/ghostterm-thesis"
    ],
    "...": "其它保持不变"
  }
}
```

Tauri 会自动根据当前构建 target 匹配 `binaries/ghostterm-thesis-<triple>`（无需写 triple 后缀）。

- [ ] **Step 3: 创建 `src-tauri/src/sidecar.rs`**

```rust
//! @file sidecar.rs
//! @description GhostTerm thesis sidecar 生命周期管理 + NDJSON 通信
//!              常驻 worker：首次 invoke 时 spawn，app 退出时 kill
//!              错误处理（spec Section 7）：不自动 restart / retry；错误直接抛给前端
//! @author Atlas.oi
//! @date 2026-04-17
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::oneshot;

pub struct SidecarState {
    pub child: Mutex<Option<CommandChild>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self { child: Mutex::new(None) }
    }
}

/// 启动 sidecar 并返回其 CommandChild
fn spawn_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("ghostterm-thesis")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    // 后台监听 stderr（转发到日志）
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("[sidecar stderr] {line}");
                    // TODO: 追加到 ~/.ghostterm/logs/thesis-worker.log（保留证据，不自动轮转）
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[sidecar] terminated: {:?}", payload);
                    // 不自动 restart；状态清空
                    if let Some(state) = app_clone.try_state::<SidecarState>() {
                        *state.child.lock().unwrap() = None;
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Tauri command：前端调用
#[tauri::command]
pub async fn tools_sidecar_invoke(
    app: AppHandle,
    state: State<'_, SidecarState>,
    payload: Value,
) -> Result<Value, String> {
    // 确保 sidecar 已启动
    {
        let guard = state.child.lock().unwrap();
        if guard.is_none() {
            drop(guard);
            let child = spawn_sidecar(&app)?;
            *state.child.lock().unwrap() = Some(child);
        }
    }

    // 写请求 + 读响应
    // 注意：CommandChild 的 stdin 是 write 型；sidecar 的 stdout 在 event stream 里
    // 简化方案：借 tauri-plugin-shell 的 `write` + 匹配响应 id
    // 当前 CommandChild API 仅暴露 stdin write；stdout 需要 spawn 时收（但我们已在 spawn_sidecar 里消费了 event）
    //
    // 正确实现：重构 spawn_sidecar 用 channel 返回 stdout 行流，这里按 id 匹配
    // —— P2 暂采用更简单方案：使用 std::process::Command 直接 spawn + pipe

    return Err("sidecar_invoke 方案需要重构：见本文件末尾 NOTE".into());
}
```

**⚠️ NOTE — 简化方案重构**

tauri-plugin-shell 的 `CommandEvent` 设计用于"一次性命令 + 监听输出"，不是"长连接双向"场景。对于 NDJSON 双向通信，两条路径：

**A. 重构用 event channel**：spawn_sidecar 返回 `CommandChild + mpsc::Receiver<String>`（stdout 行），请求时 write + await 匹配 id 的行。需要 id 队列。

**B. 用 std::process::Command 手动管理**：直接用 `std::process::Command`（需要自己处理 binary 路径查找）+ `BufReader::lines()`。简单但绕过了 Tauri sidecar 的 bundle 路径解析。

**推荐 A**。Tauri 2 的 sidecar API 支持 `write` 到 stdin。

重写 `sidecar.rs`：

```rust
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};
use std::collections::HashMap;

pub struct SidecarState {
    pub inner: AsyncMutex<Option<SidecarInner>>,
}

pub struct SidecarInner {
    pub child: CommandChild,
    pub pending: Arc<AsyncMutex<HashMap<String, oneshot::Sender<Value>>>>,
}

impl Default for SidecarState {
    fn default() -> Self { Self { inner: AsyncMutex::new(None) } }
}

async fn ensure_spawned(app: &AppHandle, state: &State<'_, SidecarState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() { return Ok(()); }

    let (mut rx, child) = app.shell()
        .sidecar("ghostterm-thesis")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    let pending: Arc<AsyncMutex<HashMap<String, oneshot::Sender<Value>>>> =
        Arc::new(AsyncMutex::new(HashMap::new()));

    let pending_clone = pending.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for raw in line.split('\n').filter(|s| !s.is_empty()) {
                        if let Ok(resp) = serde_json::from_str::<Value>(raw) {
                            let id = resp.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let mut pmap = pending_clone.lock().await;
                            if let Some(tx) = pmap.remove(&id) {
                                let _ = tx.send(resp);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(p) => {
                    eprintln!("[sidecar] terminated: {:?}", p);
                    break;
                }
                _ => {}
            }
        }
    });

    *guard = Some(SidecarInner { child, pending });
    Ok(())
}

#[tauri::command]
pub async fn tools_sidecar_invoke(
    app: AppHandle,
    state: State<'_, SidecarState>,
    payload: Value,
) -> Result<Value, String> {
    ensure_spawned(&app, &state).await?;

    let req_id = payload.get("id")
        .and_then(|v| v.as_str())
        .ok_or("payload missing 'id'")?
        .to_string();

    let (tx, rx) = oneshot::channel::<Value>();

    // 写 stdin + 注册 pending
    {
        let mut guard = state.inner.lock().await;
        let inner = guard.as_mut().ok_or("sidecar not running")?;
        inner.pending.lock().await.insert(req_id.clone(), tx);

        let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let mut data = line.into_bytes();
        data.push(b'\n');
        inner.child.write(&data).map_err(|e| format!("write stdin failed: {e}"))?;
    }

    // 等待响应（不设超时：P2 简化，由前端显示"仍在运行"+"取消"；P4 加超时）
    rx.await.map_err(|_| "sidecar closed before response".to_string())
}

#[tauri::command]
pub async fn tools_sidecar_restart(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<(), String> {
    {
        let mut guard = state.inner.lock().await;
        if let Some(mut inner) = guard.take() {
            let _ = inner.child.kill();
        }
    }
    ensure_spawned(&app, &state).await
}
```

- [ ] **Step 4: 注册到 lib.rs**

读 `src-tauri/src/lib.rs`，在 `.invoke_handler(tauri::generate_handler![...])` 里加：

```rust
sidecar::tools_sidecar_invoke,
sidecar::tools_sidecar_restart,
```

在 `.setup(|app| { ... })` 里加：

```rust
app.manage(sidecar::SidecarState::default());
```

在 `lib.rs` 头加 `mod sidecar;` 和必要的 use。

- [ ] **Step 5: 本地打包 + 跑 tauri dev 验证**

```bash
cd src-python && ./build_sidecar.sh && cd ..
pnpm tauri dev
```

Expected: app 启动成功，控制台无 sidecar 错误（还未主动 invoke，所以 sidecar 不会 spawn）

- [ ] **Step 6: 手动 invoke 验证（使用浏览器 devtools）**

```js
// 在 dev 窗口的 devtools console
await window.__TAURI__.core.invoke('tools_sidecar_invoke', {
  payload: { id: 'test-1', cmd: 'ping' }
})
```

Expected: `{id: "test-1", ok: true, result: "pong"}`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/src/sidecar.rs src-tauri/src/lib.rs
git commit -m "feat(sidecar): Rust sidecar 管理 + tools_sidecar_invoke command"
```

---

## Task 9: 前端 sidecar client + error modal

**Files:**
- Create: `src/features/tools/toolsSidecarClient.ts`
- Create: `src/features/tools/ErrorModal.tsx`
- Create: `src/features/tools/__tests__/toolsSidecarClient.test.ts`

- [ ] **Step 1: 写 client 测试（mock invoke）**

`src/features/tools/__tests__/toolsSidecarClient.test.ts`：

```ts
/**
 * @file toolsSidecarClient.test.ts
 * @description sidecar client 请求/响应 + 错误路径测试
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { sidecarInvoke, SidecarError } from '../toolsSidecarClient';

describe('toolsSidecarClient', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('成功响应返回 result', async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 'r1', ok: true, result: 'pong' });
    const res = await sidecarInvoke({ cmd: 'ping' });
    expect(res).toBe('pong');
  });

  it('ok:false 抛 SidecarError（含 code + 完整 error 字符串）', async () => {
    vi.mocked(invoke).mockResolvedValue({
      id: 'r1', ok: false,
      error: 'Traceback...\nRuleError: rule cjk_ascii_space raised',
      code: 'RULE_ERROR',
    });
    await expect(sidecarInvoke({ cmd: 'detect', file: 'x', template: {} as any }))
      .rejects.toMatchObject({
        code: 'RULE_ERROR',
        fullError: expect.stringContaining('Traceback'),
      });
  });

  it('invoke 本身抛异常（Rust 端错误）→ 也包装成 SidecarError', async () => {
    vi.mocked(invoke).mockRejectedValue('sidecar binary not found');
    await expect(sidecarInvoke({ cmd: 'ping' }))
      .rejects.toMatchObject({
        code: 'SIDECAR_UNAVAILABLE',
      });
  });

  it('自动分配 id', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args: any) => ({
      id: args.payload.id,
      ok: true,
      result: args.payload.id,  // 回显 id
    }));
    const r1 = await sidecarInvoke({ cmd: 'ping' });
    const r2 = await sidecarInvoke({ cmd: 'ping' });
    expect(r1).not.toBe(r2);  // 两次 id 不同
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test -- --run src/features/tools/__tests__/toolsSidecarClient.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 client**

`src/features/tools/toolsSidecarClient.ts`：

```ts
/**
 * @file toolsSidecarClient.ts
 * @description Python sidecar 调用封装。
 *              所有错误（sidecar 返回 ok:false / Rust invoke 失败）都统一抛 SidecarError，
 *              由上层 UI 弹 modal 显示（spec Section 7：不降级，暴露即修）。
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { invoke } from '@tauri-apps/api/core';

export interface SidecarRequestBase {
  cmd: string;
}

export interface PingRequest extends SidecarRequestBase {
  cmd: 'ping';
}

export interface DetectRequest extends SidecarRequestBase {
  cmd: 'detect';
  file: string;
  template: TemplateJson;
}

export interface FixRequest extends SidecarRequestBase {
  cmd: 'fix';
  file: string;
  issue: IssueDict;
  value?: unknown;
}

export type SidecarRequest = PingRequest | DetectRequest | FixRequest;

export interface IssueDict {
  rule_id: string;
  loc: { para: number; run: number; char?: number };
  message: string;
  current: unknown;
  expected: unknown;
  fix_available: boolean;
  issue_id: string;
  evidence_xml?: string | null;
}

export interface TemplateJson {
  rules: Record<string, { enabled: boolean; value: unknown }>;
}

export interface SidecarOk<T = unknown> {
  id: string;
  ok: true;
  result: T;
}

export interface SidecarErr {
  id: string | null;
  ok: false;
  error: string;
  code: string;
}

export class SidecarError extends Error {
  constructor(
    public code: string,
    public fullError: string,
  ) {
    super(`[${code}] ${fullError.split('\n')[0]}`);
    this.name = 'SidecarError';
  }
}

let _nextId = 0;
function genId(): string {
  _nextId += 1;
  return `req-${Date.now()}-${_nextId}`;
}

export async function sidecarInvoke<T = unknown>(req: SidecarRequest): Promise<T> {
  const payload = { id: genId(), ...req };

  let raw: SidecarOk<T> | SidecarErr;
  try {
    raw = await invoke<SidecarOk<T> | SidecarErr>('tools_sidecar_invoke', { payload });
  } catch (rustErr) {
    throw new SidecarError('SIDECAR_UNAVAILABLE', String(rustErr));
  }

  if (!raw.ok) {
    throw new SidecarError(raw.code, raw.error);
  }

  return raw.result;
}

export async function sidecarRestart(): Promise<void> {
  try {
    await invoke('tools_sidecar_restart');
  } catch (e) {
    throw new SidecarError('SIDECAR_RESTART_FAILED', String(e));
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test -- --run src/features/tools/__tests__/toolsSidecarClient.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: 实现 ErrorModal**

`src/features/tools/ErrorModal.tsx`：

```tsx
/**
 * @file ErrorModal.tsx
 * @description sidecar 错误 modal。spec Section 7：暴露 + 完整信息 + 复制按钮
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useEffect, useState } from 'react';
import { SidecarError } from './toolsSidecarClient';

interface Props {
  error: SidecarError | null;
  onClose: () => void;
  onRestart?: () => void;
}

export function ErrorModal({ error, onClose, onRestart }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!error) setCopied(false);
  }, [error]);

  if (!error) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`[${error.code}]\n${error.fullError}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板失败也要显式
      alert('复制失败，请手动选择文本');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'var(--c-overlay-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          maxWidth: 720,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-danger)' }}>
          工具执行失败 [{error.code}]
        </div>
        <pre
          style={{
            flex: 1, overflow: 'auto',
            padding: 12,
            background: 'var(--c-raised)',
            borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--c-fg)',
            whiteSpace: 'pre-wrap',
            maxHeight: 400,
          }}
        >
          {error.fullError}
        </pre>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleCopy}
            style={{
              padding: '8px 14px',
              background: 'var(--c-raised)',
              color: 'var(--c-fg)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
            }}
          >
            {copied ? '已复制 ✓' : '复制完整错误信息'}
          </button>
          {onRestart && (
            <button
              onClick={onRestart}
              style={{
                padding: '8px 14px',
                background: 'var(--c-raised)',
                color: 'var(--c-fg)',
                border: '1px solid var(--c-border)',
                borderRadius: 'var(--r-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
              }}
            >
              重启 sidecar
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'var(--c-accent)',
              color: 'var(--c-accent-text)',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/features/tools/toolsSidecarClient.ts \
        src/features/tools/ErrorModal.tsx \
        src/features/tools/__tests__/toolsSidecarClient.test.ts
git commit -m "feat(tools): sidecar client + ErrorModal（不降级，暴露即修）"
```

---

## Task 10: ToolRunner（简单 UI：选文件 + 检测 + 列 issues）

**Files:**
- Create: `src/features/tools/ToolRunner.tsx`
- Modify: `src/features/tools/ToolsWorkspace.tsx`

- [ ] **Step 1: 实现 ToolRunner**

`src/features/tools/ToolRunner.tsx`：

```tsx
/**
 * @file ToolRunner.tsx
 * @description P2 最小 UI：选 docx → 点"检测"（仅 cjk_ascii_space） → 列 issues
 *              P3 接入模板下拉；P4 加工具箱分类 + 修复按钮
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { sidecarInvoke, SidecarError, type IssueDict, sidecarRestart } from './toolsSidecarClient';
import { ErrorModal } from './ErrorModal';

// P2 写死最小模板：只启用 cjk_ascii_space
const P2_TEMPLATE = {
  rules: {
    cjk_ascii_space: { enabled: true, value: { allowed: false } },
  },
};

export function ToolRunner() {
  const [file, setFile] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueDict[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SidecarError | null>(null);

  const handlePick = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    });
    if (typeof picked === 'string') {
      setFile(picked);
      setIssues(null);
    }
  };

  const handleDetect = async () => {
    if (!file) return;
    setRunning(true);
    setIssues(null);
    try {
      const result = await sidecarInvoke<{ issues: IssueDict[] }>({
        cmd: 'detect',
        file,
        template: P2_TEMPLATE as any,
      });
      setIssues(result.issues);
    } catch (e) {
      if (e instanceof SidecarError) setError(e);
      else throw e;
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{
      flex: 1,
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      overflow: 'auto',
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>工具箱（P2：中英空格检测）</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={handlePick}
          style={{
            padding: '8px 14px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          选择 DOCX 文件
        </button>
        <span style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
          {file ?? '尚未选择'}
        </span>
      </div>

      <button
        onClick={handleDetect}
        disabled={!file || running}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 16px',
          background: file && !running ? 'var(--c-accent)' : 'var(--c-raised)',
          color: file && !running ? 'var(--c-accent-text)' : 'var(--c-fg-subtle)',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          cursor: file && !running ? 'pointer' : 'default',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {running ? '检测中…' : '运行检测（cjk_ascii_space）'}
      </button>

      {issues && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--c-fg-muted)' }}>
            共 {issues.length} 处违规
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {issues.map((i) => (
              <li
                key={i.issue_id}
                style={{
                  padding: '8px 12px',
                  background: 'var(--c-raised)',
                  borderRadius: 'var(--r-sm)',
                  marginBottom: 4,
                  fontSize: 12,
                }}
              >
                <div><strong>{i.message}</strong></div>
                <div style={{ color: 'var(--c-fg-muted)' }}>
                  位置：段落 {i.loc.para}，run {i.loc.run}
                  {' · '}
                  当前：<code style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(i.current)}</code>
                  {' · '}
                  期望：<code style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(i.expected)}</code>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorModal
        error={error}
        onClose={() => setError(null)}
        onRestart={async () => {
          try {
            await sidecarRestart();
            setError(null);
          } catch (e) {
            if (e instanceof SidecarError) setError(e);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: 替换 ToolsWorkspace 占位**

`src/features/tools/ToolsWorkspace.tsx` 重写：

```tsx
/**
 * @file ToolsWorkspace.tsx
 * @description "工具" Tab 的 workspace。P2 含 ToolRunner
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { ToolRunner } from './ToolRunner';

export function ToolsWorkspace() {
  return (
    <div data-testid="tools-workspace" style={{ flex: 1, display: 'flex' }}>
      <ToolRunner />
    </div>
  );
}
```

- [ ] **Step 3: tsc + test**

```bash
pnpm tsc --noEmit
pnpm test -- --run
```

Expected: 全绿（WorkspaceRouter 的 `tools-workspace` testid 仍存在，P1 集成测试继续通过）

- [ ] **Step 4: Commit**

```bash
git add src/features/tools/ToolRunner.tsx src/features/tools/ToolsWorkspace.tsx
git commit -m "feat(tools): ToolRunner 最小 UI（选文件+检测+列 issues）"
```

---

## Task 11: 手动 E2E 验证 + milestone

- [ ] **Step 1: 构建 sidecar**

```bash
cd src-python && ./build_sidecar.sh && cd ..
```

- [ ] **Step 2: 启动 dev**

```bash
pnpm tauri dev
```

- [ ] **Step 3: 端到端手动 checklist**

- [ ] 启动默认"项目" tab（P1 行为保持）
- [ ] 点击"工具" tab → 看到 ToolRunner（"工具箱（P2：中英空格检测）"标题）
- [ ] 点"选择 DOCX 文件" → 文件选择器弹出 → 选 `src-python/tests/fixtures/cjk_space_bad.docx`（路径需手填或先复制出来）
- [ ] 路径显示；"运行检测"按钮变成 accent 色
- [ ] 点"运行检测" → 显示"检测中…" → 1 秒内返回结果
- [ ] 显示 "共 4 处违规"，列出 4 条 issues（段落号 + run + 当前 + 期望）
- [ ] 重复点检测应仍返回 4 条（sidecar 常驻，不重启）
- [ ] 切到"项目" tab → 原有 FileTree/Editor/Terminal 仍正常
- [ ] 切回"工具" → 检测结果仍在（组件 display:none 保活）

- [ ] **Step 4: 错误路径验证**

手动制造错误：

- [ ] 选一个不存在的路径（devtools console 直接调用 `invoke`）：
    ```js
    window.__TAURI__.core.invoke('tools_sidecar_invoke', {
      payload: { id: 'e1', cmd: 'detect', file: '/nonexistent.docx', template: {rules:{}} }
    })
    ```
    应返回 `{ok:false, code:'ENOENT'}`（或走 ToolRunner UI 触发，触发 ErrorModal 应展示完整 Python traceback + "复制"按钮 + "重启 sidecar"按钮）

- [ ] 点"重启 sidecar"（在 ErrorModal 里） → modal 关闭 → 再次检测仍正常

- [ ] **Step 5: 全量自动测试**

```bash
cd src-python && uv run pytest && cd ..
cd src-tauri && cargo test && cd ..
pnpm test -- --run
pnpm build
```

Expected: 三套测试全绿 + build 成功

- [ ] **Step 6: Git tag milestone**

```bash
git tag -a milestone-p2-sidecar -m "P2 完成：Python sidecar + NDJSON IPC + cjk_ascii_space 规则端到端通"
```

- [ ] **Step 7: 更新 memory（可选）**

若过程中发现坑（例如 Tauri 2 sidecar stdin write API 细节、PyInstaller onefile 在 macOS 的权限签名问题等），新增 `feedback_<topic>.md` 追加到 MEMORY.md 索引。

---

## Task 12: CI 扩展

**Files:**
- Modify: `.github/workflows/release.yml`

**目标**：在 CI release 流程里加 Python 测试 + 每平台 PyInstaller 打包 + 产物放入 `src-tauri/binaries/` 供 Tauri bundle 打包使用。

- [ ] **Step 1: 读当前 release.yml**

```bash
cat .github/workflows/release.yml
```

理解现有 matrix（macos arm64 / macos x86_64 / windows）和版本同步脚本（见 memory `feedback_ci_version_sync`）。

- [ ] **Step 2: 在 matrix 步骤开头加 Python 测试 + sidecar 打包**

在每个 os job 的 steps 里，**在现有版本同步步骤和 `pnpm tauri build` 之间**插入：

```yaml
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install uv
        run: |
          curl -LsSf https://astral.sh/uv/install.sh | sh
          echo "$HOME/.local/bin" >> $GITHUB_PATH
        shell: bash
        if: runner.os != 'Windows'

      - name: Install uv (Windows)
        run: |
          powershell -Command "irm https://astral.sh/uv/install.ps1 | iex"
          echo "$HOME/.cargo/bin" >> $env:GITHUB_PATH
        shell: pwsh
        if: runner.os == 'Windows'

      - name: Python sidecar tests
        working-directory: src-python
        run: |
          uv sync
          uv run pytest
        shell: bash

      - name: Build sidecar (macOS/Linux)
        if: runner.os != 'Windows'
        working-directory: src-python
        run: ./build_sidecar.sh
        shell: bash

      - name: Build sidecar (Windows)
        if: runner.os == 'Windows'
        working-directory: src-python
        run: ./build_sidecar.ps1
        shell: pwsh

      - name: Frontend tests
        run: pnpm test -- --run

      - name: Rust tests
        working-directory: src-tauri
        run: cargo test
```

（x86_64 交叉编译在 macOS arm64 runner 上跑的情况，按现有 CI 的 `build_sidecar.sh` 会检测 $(uname -m) 决定 triple，需要按实际 CI matrix 调整。P2 先保证 native 平台打包通过；P4 加交叉编译支持。）

- [ ] **Step 3: 本地测一下 YAML 语法**

```bash
# 使用 actionlint（或简单 YAML parse）
cat .github/workflows/release.yml | python -c "import sys, yaml; yaml.safe_load(sys.stdin)"
```

Expected: 无 YAML 错误

- [ ] **Step 4: Commit（不打 tag，让 P2 的 milestone tag 保持）**

```bash
git add .github/workflows/release.yml
git commit -m "ci: 加入 Python sidecar 测试 + PyInstaller 打包"
```

---

## Self-Review（P2）

- **Spec 覆盖**：
  - Section 3 (IPC 协议 / NDJSON / 命令集 / 并发): ✓ Task 5/6/8
  - Section 5 (Rule Protocol / REGISTRY / Issue/FixResult): ✓ Task 2/3/4
  - Section 7 (错误不降级，直接抛出): ✓ Task 5/8/9（handlers 捕获异常成 response；Rust 不自动 restart；前端 SidecarError modal）
  - Section 8 (Python pytest + 修复后重开硬测试): ✓ Task 4
  - Sidecar 生命周期 (常驻 worker): ✓ Task 8 ensure_spawned 单例

- **Placeholder 扫描**：
  - Task 8 的 `// TODO: 追加到 ~/.ghostterm/logs/` 是一处 TODO；**修正**：P4 再做日志落盘，P2 只需 stderr 转发 `eprintln!`（调试用）——这条注释保留但不影响 P2 功能
  - Task 12 的"x86_64 交叉编译留 P4" 是计划性说明，不是 placeholder 待填

- **类型一致**：
  - `Issue` 的 `loc` 在 Python 是 `Location` dataclass，序列化成 dict；TS 端是 `{para, run, char?}` —— 字段对齐 ✓
  - `IssueDict.issue_id` / `rule_id` / `fix_available` 三处都是 snake_case，Tauri 2 默认保留（Rust Value 透传，未做 camelCase 转换）—— 一致 ✓
  - `SidecarRequest` union + `sidecarInvoke<T>` 泛型 ✓

- **独立可交付**：P2 完成后 merge 到 main 即可发布，工具 tab 有 1 条规则可跑，其他规则 P3/P4 逐步加。

---

## 下一个 plan

P2 完成后：`docs/superpowers/plans/2026-04-17-p3-config-templates.md`（配置模板系统 + 内置独立 CRUD + 深拷贝隔离 + docx extractor + 升级迁移）

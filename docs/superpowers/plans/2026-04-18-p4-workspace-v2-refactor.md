# P4 RuleTemplateWorkspace v2 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P4 工作台从"只显示抓到的摘要"升级为"按字段声明的 applicable_attributes 逐条展示 + 未抓到位可就地编辑 + 按句选取 + shift 多选"，解决用户 2026-04-18 反馈的 7 项缺陷。

**Architecture:** 前端 UI 驱动层重构（FieldList schema 驱动渲染）+ Python pipeline 抽取补齐 + DocxPreview 切句 + sidecar 协议扩展 selected_text + 新字段全栈联动。

**Tech Stack:** React + TypeScript + Zustand + vitest / Python 3.12 + python-docx + pytest / Tauri 2 + Rust

**依赖 plan:** `docs/superpowers/plans/2026-04-18-p4-semantic-fields-full.md` (milestone-p4 base); 分支 `feat/p4-semantic-fields` (HEAD: dd063ac)

**依赖 spec/memory:**
- `~/.claude/projects/-Users-oi-CodeCoding-Code------GhostTerm/memory/project_p4_workspace_v2_backlog.md`
- `~/.claude/projects/-Users-oi-CodeCoding-Code------GhostTerm/memory/feedback_p4_applicable_attributes_driven_ui.md`
- `~/.claude/projects/-Users-oi-CodeCoding-Code------GhostTerm/memory/feedback_no_semantic_understanding_needed.md`

**不在本 plan 范围：**

- 修改 32 字段定义本身（只读 applicable_attributes）
- 模板 JSON 迁移（TemplateStore v2 保持不变）
- HanLP 引入做分句（正则 `[。！？；：]` 足够）
- 迁移工具 migration.ts（无数据 schema 变化）
- 单独支持 .doc 格式

---

## File Structure

| 动作 | 路径 | 职责 |
|------|------|------|
| Modify | `src/features/tools/templates/formatFieldValue.ts` | `font.size_pt` 用 `ptToName`；`font.cjk`/`font.ascii` 合并显示 |
| Create | `src/features/tools/templates/__tests__/formatFieldValue.test.ts` | 新 unit 测试覆盖 L1 格式化规则 |
| Modify | `src/features/tools/templates/FieldList.tsx` | 按 applicable_attributes 驱动渲染每 attr 一行；行内编辑；未抓到位可填 |
| Modify | `src/features/tools/__tests__/FieldList.test.tsx` | 覆盖 schema 驱动渲染 + 行内编辑流 |
| Modify | `src/features/tools/templates/RuleTemplateWorkspace.tsx` | 手填 value 置信度=1.0；保留 advanceField 流程；接入 shift buffer |
| Modify | `src-python/thesis_worker/extractor/pipeline.py` | `_read_paragraph_style_attrs` 追加行距/字间距/段前段后读取 |
| Modify | `src-python/tests/extractor/test_pipeline_a.py` | 扩展新属性断言 |
| Modify | `src-python/tests/extractor/test_pipeline_b.py` | 扩展新属性断言 |
| Modify | `src/features/tools/templates/DocxPreview.tsx` | 渲染后遍历文本节点按标点切句包 `<span data-sent-idx>`；扩展样式 scope 到 `[data-sent-idx]` |
| Modify | `src/features/tools/toolsSidecarClient.ts` | `extract_from_selection` 入参扩 `selected_text` |
| Modify | `src/features/tools/templates/RuleTemplateWorkspace.tsx` | shift keydown/keyup 监听；selection buffer；hint UI |
| Modify | `src-python/thesis_worker/extractor/pipeline.py` | `extract_from_selection` 接 `selected_text`（原段落 str.find 定位覆盖 run） |
| Modify | `src/features/tools/templates/fieldDefs.ts` + `src-python/thesis_worker/engine_v2/field_defs.py` | 新增 `mixed_script.punct_space_after` 属性到 global 字段 |
| Modify | `src/features/tools/templates/RuleValueEditor.tsx` | 新增 `mixed_script.punct_space_after` 编辑分支（checkbox） |
| Modify | `src-python/thesis_worker/extractor/pipeline.py` | 新 attr 抽取（正则 `[.,;:!?](?=\s)` vs `[.,;:!?](?=\S)` 统计） |

---

## Task 1: L1 UI formatter 修正

**Problem:** 字号显示 `14pt` 用户看不懂（模板原文是"小四号"），cjk/ascii 同值时视觉假重复（`宋体 · 加粗 · 宋体 · 15pt`）。

**Changes:**

- [ ] `src/features/tools/templates/formatFieldValue.ts`
  - `font.size_pt` 分支：先调 `ptToName(value)`（从 `./chineseSizeMap` import），返回不为 null 则输出"小四号"；返回 null 则回退 `{value}pt`
  - `font.cjk` 和 `font.ascii` 合并逻辑（在 `formatFieldValue` 函数内聚合后处理）：
    - 若两者都有且值相同 → 输出一条 `中西文 {字体}`
    - 若两者都有且值不同 → 输出 `中 {cjk} · 西 {ascii}`
    - 若只有一个 → 输出 `中 {cjk}` 或 `西 {ascii}`
  - `formatAttr` 中 `font.cjk`/`font.ascii` 分支保留但仅返回原值，由 `formatFieldValue` 合并层统一加前缀
- [ ] `src/features/tools/templates/__tests__/formatFieldValue.test.ts` 新文件
  - 覆盖：`font.size_pt: 12` → `小四号`
  - 覆盖：`font.size_pt: 11.5` → `11.5pt`（非标准号）
  - 覆盖：cjk+ascii 同值 → `中西文 宋体`
  - 覆盖：cjk+ascii 异值 → `中 宋体 · 西 Times New Roman`
  - 覆盖：只有 cjk → `中 宋体`
  - 覆盖：多属性拼接顺序 + 空 value 返回空串

**Acceptance:**
- 新 `formatFieldValue.test.ts` 通过
- 已有 `FieldList.test.tsx` 测试可能需调整字符串断言（`14pt` → `小四号`），同步修正
- `pnpm vitest run` 全绿

---

## Task 2: FieldList 按 applicable_attributes 驱动渲染 + 行内编辑

**Problem:** FieldList 当前只显示抓到的值摘要，用户看不到"应有但缺失"的约束，机器抓错无路可救。

**Changes:**

- [ ] `src/features/tools/templates/FieldList.tsx`
  - 每字段从"单行摘要"改为"卡片结构"：
    ```
    [状态图标] 字段标签 (0.90)                  [定位] [跳过]
    ├ {attr_label}:  {值或空位 + RuleValueEditorByAttr}    ✓ / ⨯ 未抓到
    ├ ...（遍历 applicableAttrs(f.id)）
    ```
  - 从 `./fieldDefs` import `applicableAttrs`；从 `./RuleValueEditor` import `RuleValueEditorByAttr`
  - attr 中文 label 映射表（内部常量）：`font.cjk → 中文字体`、`font.ascii → 西文字体`、`font.size_pt → 字号`、`font.bold → 加粗`、`para.align → 对齐`、`para.first_line_indent_chars → 首行缩进`、`para.line_spacing → 行距`、`para.letter_spacing_chars → 字间距（字数）`、`para.space_before_lines → 段前`、`para.space_after_lines → 段后`、`para.hanging_indent_chars → 悬挂缩进`、`content.specific_text → 指定文本`、`content.max_chars → 最大字数`、`content.char_count_min → 最少字数`、`content.char_count_max → 最多字数`、`content.item_count_min → 最少项数`、`content.item_count_max → 最多项数`、`content.item_separator → 分隔符`、`page.size → 纸张`、`page.margin_top_cm → 上边距`、`page.margin_bottom_cm → 下边距`、`page.margin_left_cm → 左边距`、`page.margin_right_cm → 右边距`、`page.new_page_before → 另起页`、`pagination.front_style → 前置页码`、`pagination.body_style → 正文页码`、`mixed_script.ascii_is_tnr → 西文用 Times`、`layout.position → 图表位置`、`citation.style → 引文样式`
  - `Props` 新增 `onAttrChange(fieldId: string, attrKey: string, newValue: unknown): void`
  - 行内编辑：每个 attr 位用 `RuleValueEditorByAttr` 组件渲染控件；onChange 触发 `onAttrChange`
  - 未抓到（attr key 不在 f.value）→ 展示"⨯ 未抓到" + 空控件；有值 → 展示"✓" + 当前值控件
  - 保留进度计数、定位按钮、跳过按钮
- [ ] `src/features/tools/templates/RuleTemplateWorkspace.tsx`
  - 新增 `handleAttrChange(fieldId, attrKey, newValue)`：`setFields(prev => prev.map(f => f.id===fieldId ? { ...f, value: {...(f.value||{}), [attrKey]: newValue}, confidence: 1.0, status: 'done' } : f))`
  - 传入 FieldList 的 `onAttrChange` prop
- [ ] `src/features/tools/__tests__/FieldList.test.tsx`
  - 覆盖：给 title_zh 字段，value 只有 font.cjk → UI 渲染 5 行（applicableAttrs 全列），其中 4 行标"未抓到"
  - 覆盖：给某 attr 空位填值 → 触发 onAttrChange with 正确 (fieldId, attrKey, value)
  - 保留原有进度、定位、跳过测试

**Acceptance:**
- FieldList.test 全绿
- RuleTemplateWorkspace.test 中"手填 value 置信度=1"新增断言通过
- 视觉检查：title_zh 字段展示 5 行（中文字体/字号/加粗/对齐/最大字数），未抓到的清晰标注

---

## Task 3: sidecar 抓取补齐行距/字间距/段前段后

**Problem:** pipeline.py `_read_paragraph_style_attrs` 只读字体/字号/加粗/对齐/首行缩进，`applicable_attributes` 声明的其它属性未实现抽取。

**Changes:**

- [ ] `src-python/thesis_worker/extractor/pipeline.py`
  - 顶部新增 XML 常量：`_W_SPACING = qn('w:spacing')`、`_W_VAL = qn('w:val')`（如已有 qn import 则复用，否则 `from docx.oxml.ns import qn`）
  - `_read_paragraph_style_attrs` 追加以下代码段（放在现有代码尾部、return 前）：
    ```python
    # 行距（python-docx 暴露 float 倍数或 Emu 绝对值）
    ls = para.paragraph_format.line_spacing
    if ls is not None:
        attrs['para.line_spacing'] = round(float(ls), 2)

    # 段前行数（pt → 约 12pt/行）
    sb = para.paragraph_format.space_before
    if sb is not None:
        attrs['para.space_before_lines'] = round(sb.pt / 12, 1)

    # 段后行数
    sa = para.paragraph_format.space_after
    if sa is not None:
        attrs['para.space_after_lines'] = round(sa.pt / 12, 1)
    ```
  - 字间距（在 for run loop 里，紧跟现有 rFonts 读取之后；仅第一个非空 run）：
    ```python
    spacing_el = rpr.find(_W_SPACING)
    if spacing_el is not None:
        val = spacing_el.get(_W_VAL)
        if val:
            # twips: 1字(12pt) = 240 twips
            attrs['para.letter_spacing_chars'] = round(int(val) / 240, 1)
    ```
  - 若 w:spacing 未设置但段落文本形如 "摘  要"（首尾非空字符、中间全空格）：作为 fallback，`re.match(r'^(\S)(\s+)(\S)$', para.text.strip())` 命中则 `attrs.setdefault('para.letter_spacing_chars', len(m.group(2)))`
- [ ] `src-python/tests/extractor/test_pipeline_a.py` 或新建 `test_pipeline_attrs.py`
  - 用 python-docx 手工构造段落：设置 line_spacing=1.5 / space_before=Pt(12) / space_after=Pt(6) / 运行 rPr.spacing=240 / 段落文字 "摘  要"
  - 断言返回的 attrs 分别含正确值

**Acceptance:**
- `pytest src-python/tests` 全绿
- 新属性抽取后 FieldList 中"行距""字间距""段前""段后"从"⨯ 未抓到"变为"✓ 正确值"

---

## Task 4: 按句选取 + shift 多选 + hint UI

**Problem:** 同段多字段（"关键词：" + "×××；×××"）无法分别选取；用户只能点整段触发 extract。

**Changes:**

- [ ] `src/features/tools/templates/DocxPreview.tsx`
  - 在注入 `data-para-idx` 的 useEffect 之后、添加新 useEffect：遍历所有 `[data-para-idx]` 元素，对其 Text 节点按 `/([。！？；：])/g` 切分并重新包裹为 `<span data-para-idx="{p}" data-sent-idx="{p}.{s}">` 结构；标点跟随前一句（含在 span 内）
  - 切句 span 赋予 `cursor: pointer` + 复用现有 hover 样式（扩展 `.docx-preview-container [data-sent-idx]` 到样式规则）
  - 事件委托 handler：优先找 `[data-sent-idx]`（若存在），取其 `textContent` 作为 `selected_text`；否则回退 `[data-para-idx]` 取段落索引
  - `onParaClick` prop 重命名为 `onSelectionClick`，接收 `{ paraIdx: number; sentenceIdx?: number; text: string; shiftKey: boolean }`
  - 点击时 `e.shiftKey` 读键盘状态（不监听全局）；选中态累积时保留所有 class="docx-sent-selected" span
- [ ] `src/features/tools/toolsSidecarClient.ts`
  - `extract_from_selection` 入参扩展：增加 `selected_text?: string`；保留 `para_indices`（兼容空段选择）
  - `ExtractFromSelectionResult` 不变
- [ ] `src-python/thesis_worker/extractor/pipeline.py`
  - `extract_from_selection` 签名：`def extract_from_selection(file, para_indices, field_id, selected_text=None)`
  - 若 `selected_text` 提供：在 `para_indices[0]` 段的 `para.text` 里 `find(selected_text)` 定位字符起止 → 遍历段落 runs 累加字符 offset 找到覆盖的 run 子集 → 仅对这些 run 跑 `_extract_attributes_from_text` + `_read_run_style_attrs`（现有 `_read_paragraph_style_attrs` 取第一个非空 run 策略改为仅在选中 run 范围内取第一个非空）
  - 否则保留原段级路径
- [ ] `src/features/tools/templates/RuleTemplateWorkspace.tsx`
  - window 级 `keydown`/`keyup` 监听：`e.key === 'Shift'` 切换 `isShiftPressed` state
  - 新 state `selectionBuffer: Array<{paraIdx, sentenceIdx?, text}>`
  - `handleSelectionClick({shiftKey, ...})`:
    - 非 shift → 立即 `sidecarInvoke extract_from_selection` 单句
    - shift → push 到 buffer，UI 显示累积数量
  - shift keyup effect：buffer 非空 → 拼接所有 text 调 `extract_from_selection(selected_text=拼接文本)` 一次提交，清空 buffer
  - Esc 键：清空 buffer
  - hint 条 UI（左栏顶部提示条）：
    - 默认："请为「...」选取段落  ·  按住 Shift 多选多段 · Esc 取消"
    - shift 按下时变 accent 色："多选中 · 已选 N 段 · 松开 Shift 提交 · Esc 取消"
- [ ] 测试：`src/features/tools/__tests__/RuleTemplateWorkspace.test.tsx`
  - fireEvent click 不按 shift → 立即 invoke
  - fireEvent click 按 shift → buffer 增加，invoke 未触发
  - window keyup(Shift) → 触发一次 invoke 含累积 selected_text

**Acceptance:**
- 句级 hover/click 视觉反馈生效（段内多个句子分别高亮）
- 按住 shift 点多段，松开一次提交
- 未按 shift 保持旧的单击即提交
- 测试全绿
- hint 文案显示

---

## Task 5: 新字段 mixed_script.punct_space_after

**Problem:** 用户反馈"英文标点符号后空一字符"属于全文排版规范，当前字段体系无对应 attr。

**Changes:**

- [ ] `src/features/tools/templates/fieldDefs.ts`
  - 在 `mixed_script_global`（order 32）的 `applicable_attributes` 末尾追加 `'mixed_script.punct_space_after'`
- [ ] `src-python/thesis_worker/engine_v2/field_defs.py`
  - 与前端同步：同字段 applicable_attributes 追加 `'mixed_script.punct_space_after'`
- [ ] `src/features/tools/templates/RuleValueEditor.tsx`
  - `RuleValueEditorByAttr` 新增 case `mixed_script.punct_space_after` → checkbox（`bool` 值，默认 false）
- [ ] `src/features/tools/templates/formatFieldValue.ts`
  - `formatAttr` 新增 case：`mixed_script.punct_space_after` → `value === true ? '英文标点后空格' : ''`
- [ ] `src/features/tools/templates/FieldList.tsx`
  - attr label 映射追加 `'mixed_script.punct_space_after': '英文标点后空格'`
- [ ] `src-python/thesis_worker/extractor/pipeline.py`
  - 新增抽取：在 `extract_all` 结束前对全文跑 `_detect_punct_space_after(doc)`：
    - 收集所有 run.text 拼接为全文 str
    - `space_after_count = len(re.findall(r'[.,;:!?](?=\s)', text))`
    - `no_space_count = len(re.findall(r'[.,;:!?](?=\S)', text))`
    - 若 `space_after_count > 2 * no_space_count` → `rules['mixed_script_global']['value']['mixed_script.punct_space_after'] = True`
- [ ] `src-python/tests/extractor/test_pipeline_attrs.py`
  - 构造含英文标点后有/无空格的文本，断言判定结果

**Acceptance:**
- global 字段 `mixed_script_global` 的 attr 列表显示"英文标点后空格"行
- 可勾选 checkbox 保存
- 自动抽取对典型规范文本识别正确
- `pytest` 全绿

---

## Dependency Graph

```
Task 1 (formatFieldValue L1)
   ↓
Task 2 (FieldList schema 驱动 + 行内编辑)
   ↓
Task 3 (sidecar 抓取补齐)    [独立，可并 Task 4 前插入]
   ↓
Task 4 (按句选取 + shift)
   ↓
Task 5 (新字段)
```

串行执行，每 task 间走 spec reviewer + code quality reviewer 双 review。

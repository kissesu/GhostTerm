# P4 - 论文语义字段规则引擎重构

> **Status**: Design approved via brainstorming 2026-04-18
> **Author**: Atlas.oi
> **Depends on**: P3 (milestone-p3-tools, feat/p3-tools-full)
> **Spec version**: 1.0

## 背景与目标

### 问题现状

P3 实现了 11 条抽象规则（`font.body` / `font.h1` / `paragraph.indent` / `citation.format` 等），对"论文的所有正文段落应该是宋体小四号"这种通用格式能力做检测。

**实测发现 P3 抽象规则在真实论文 docx 上失效**：

- 用户的实际 docx（`/Users/oi/CodeCoding/Code/毕设/毕设-茶园生态管理系统/docs/论文范文.docx`）用自定义中文样式名（`一级标题q` / `摘要字q` / `论文正文q`），非标准 `Heading 1`
- P3 `font.h1.extract()` 按 `style.name in {'Heading 1', 'Heading1'}` 匹配，此 docx 完全抓不到（style name 不符）
- 即使 extract 成功，`font.body` 这种抽象规则**只能给论文正文"整体"一个期望字体**；但真实论文不同部分字体要求不同（摘要正文 vs 正文段落 vs 参考文献条目字体大小不一样）

### 目标

重构规则引擎为**按论文语义字段的细粒度规则**，每个字段独立设置字体/字号/对齐/缩进等约束。

- 32 个语义字段覆盖标准中文本科毕业论文结构
- 支持用户上传任意学校规范 docx **自动抽取** + **手动补全**双管齐下
- 不依赖 LLM（规则+词典+正则为主）
- 不做预置学校模板库（规范年度变，维护成本高）
- 复用 P3 已建立的 sidecar/template/backup/undo 架构

### 成功标准

| 指标 | 目标 |
|------|------|
| 字段覆盖 | 32 语义字段能描述 80% 中文本科论文 |
| 自动抽取准确率（Template A 括号型） | ≥ 85% |
| 自动抽取准确率（Template B 叙述型） | ≥ 70% |
| 用户手动补全剩余字段耗时 | ≤ 5 分钟 |
| P3 已建 UI/sidecar 架构保留率 | ≥ 90% |

## 架构总览

```
┌──────────────────────────────────────────────────┐
│ 用户上传规范 docx                                 │
└────────┬─────────────────────────────────────────┘
         ↓
┌──────────────────────────────────────────────────┐
│ Python sidecar (thesis_worker)                   │
│  ├─ extract_all(file)                            │
│  │    ├─ python-docx 切段落文本 + 样式属性       │
│  │    ├─ Gazetteer 词典（字体/字号名/对齐）      │
│  │    ├─ 多套正则 pattern（A 括号型 + B 叙述型）│
│  │    ├─ 关键词 → 字段 id 关联                  │
│  │    └─ 返回 {rules, evidence}                 │
│  └─ extract_from_selection(file, para_indices, field_id)
│       └─ 同上逻辑但限定段落                     │
└────────┬─────────────────────────────────────────┘
         ↓ NDJSON over stdin/stdout
┌──────────────────────────────────────────────────┐
│ Rust backend (Tauri commands，P3 已有)           │
│  ├─ tools_sidecar_invoke（透传）                │
│  ├─ template_* cmds（CRUD，P3 复用）            │
│  └─ backup_* cmds（备份/undo，P3 复用）         │
└────────┬─────────────────────────────────────────┘
         ↓
┌──────────────────────────────────────────────────┐
│ 前端 React (feat/p3-tools-full 分支扩展)         │
│  ├─ RuleTemplateWorkspace（新）                  │
│  │    ├─ 左栏 DocxPreview（docx-preview.js）    │
│  │    │     └─ 段落 hover + click → para_idx   │
│  │    └─ 右栏 FieldList                         │
│  │          ├─ 32 字段 + 进度条                │
│  │          ├─ 当前字段高亮                    │
│  │          └─ 📍 跳转、跳过、保存             │
│  ├─ TemplateStore（P3 扩展 schema_version=2）   │
│  └─ detect/fix UI（P3 复用）                    │
└──────────────────────────────────────────────────┘
```

## 32 个语义字段

字段 id 采用 `snake_case` 命名。Sequential 顺序按文档阅读顺序（前置→正文→后置→页面级全局）。

### 前置部分（12 字段）

| # | id | label | group | 典型属性 |
|---|----|-------|-------|---------|
| 1 | `title_zh` | 中文题目 | front | font.cjk, font.size_pt, font.bold, para.align, content.max_chars |
| 2 | `abstract_zh_title` | 中文「摘要」标题 | front | + para.letter_spacing_chars, content.specific_text |
| 3 | `abstract_zh_body` | 中文摘要正文 | front | + para.first_line_indent_chars, para.line_spacing, content.char_count_min/max, mixed_script.ascii_is_tnr |
| 4 | `keywords_zh_label` | 中文关键词标签 | front | font.cjk, font.size_pt, font.bold, content.specific_text |
| 5 | `keywords_zh_content` | 中文关键词内容 | front | font.cjk, font.size_pt, content.item_count_min/max, content.item_separator |
| 6 | `title_en` | 英文题目 | front | font.ascii, font.size_pt, font.bold, para.align |
| 7 | `abstract_en_title` | 「Abstract」标题 | front | 同 `abstract_zh_title` 换 ascii |
| 8 | `abstract_en_body` | 英文摘要正文 | front | 同 `abstract_zh_body` 换 ascii |
| 9 | `keywords_en_label` | 「Key Words」标签 | front | 同 `keywords_zh_label` 换 ascii |
| 10 | `keywords_en_content` | 英文关键词内容 | front | 同 `keywords_zh_content` 换 ascii |
| 11 | `toc_title` | 目录标题 | front | font.cjk, font.size_pt, font.bold, para.align, para.space_before/after_lines |
| 12 | `toc_entry` | 目录条目 | front | font.cjk, font.size_pt, para.first_line_indent_chars |

### 正文部分（8 字段）

| # | id | label | group | 典型属性 |
|---|----|-------|-------|---------|
| 13 | `chapter_title` | 一级章节标题 | body | font.cjk, font.size_pt, font.bold, para.align, para.space_before/after_lines, page.new_page_before |
| 14 | `section_title` | 二级章节标题 | body | font.cjk, font.size_pt, font.bold, para.align |
| 15 | `subsection_title` | 三级章节标题 | body | font.cjk, font.size_pt, para.align |
| 16 | `body_para` | 正文段落 | body | font.cjk, font.ascii, font.size_pt, para.first_line_indent_chars, para.line_spacing, mixed_script.ascii_is_tnr |
| 17 | `figure_caption` | 图题 | body | font.cjk, font.size_pt, para.align, layout.position=below |
| 18 | `figure_inner_text` | 图内文字/图例 | body | font.cjk, font.size_pt |
| 19 | `table_caption` | 表题 | body | font.cjk, font.size_pt, para.align, layout.position=above |
| 20 | `table_inner_text` | 表内容 | body | font.cjk, font.size_pt |

### 后置部分（6 字段）

| # | id | label | group | 典型属性 |
|---|----|-------|-------|---------|
| 21 | `references_title` | 参考文献标题 | back | font.cjk, font.size_pt, font.bold, para.align, page.new_page_before |
| 22 | `reference_entry` | 参考文献条目 | back | font.cjk, font.ascii, font.size_pt, para.hanging_indent_chars, citation.style=gbt7714 |
| 23 | `ack_title` | 致谢标题 | back | font.cjk, font.size_pt, font.bold, para.align, para.letter_spacing_chars, page.new_page_before |
| 24 | `ack_body` | 致谢正文 | back | font.cjk, font.size_pt, para.first_line_indent_chars |
| 25 | `appendix_title` | 附录标题 | back | 同 `ack_title` |
| 26 | `appendix_body` | 附录正文 | back | 同 `ack_body` |

### 页面级全局（6 字段）

| # | id | label | group | 典型属性 |
|---|----|-------|-------|---------|
| 27 | `page_size` | 页面大小 | global | page.size（A4 默认） |
| 28 | `page_margin` | 页边距 | global | page.margin_{top,bottom,left,right}_cm |
| 29 | `page_header` | 页眉 | global | font.cjk, font.size_pt, para.align, content.specific_text |
| 30 | `page_footer_number` | 页脚页码 | global | font.ascii, font.size_pt, para.align, pagination.front_style, pagination.body_style |
| 31 | `line_spacing_global` | 全文行距 | global | para.line_spacing |
| 32 | `mixed_script_global` | 数字/西文字体全局 | global | mixed_script.ascii_is_tnr |

**封面字段不在 32 个字段内**：封面是学校固定模板，P4 跳过检查（用户决策）。

**全局字段与字段级的独立性**：global 字段与字段级字段**互不继承**。如 `line_spacing_global.value."para.line_spacing" = 1.5` 是整文档主体行距一致性检查；`body_para.value."para.line_spacing" = 1.5` 是正文段落行距检查。两者都启用时各自独立检查。用户按需启用。稀疏 schema 语义（缺失=不检查）同样适用，无继承逻辑。

## 标准属性 Key 规范

所有字段 `value` 用稀疏 map 存储，key 为点号扁平化名称。缺失 key = "不检查此属性"。

### Font 属性

| key | 类型 | 语义 |
|-----|------|------|
| `font.cjk` | string | 中文字体名（"宋体" / "黑体" / "楷体" / "仿宋"） |
| `font.ascii` | string | 英文字体名（"Times New Roman" / "Arial"） |
| `font.size_pt` | number | 字号（pt，从字号名映射后的 float） |
| `font.bold` | bool | 加粗 |
| `font.italic` | bool | 斜体 |

### Paragraph 属性

| key | 类型 | 语义 |
|-----|------|------|
| `para.align` | enum | `"left" / "center" / "right" / "justify"` |
| `para.first_line_indent_chars` | number | 首行缩进（字符数，换算 = chars × body font size） |
| `para.hanging_indent_chars` | number | 悬挂缩进（参考文献用） |
| `para.line_spacing` | number | 行距（1.5 = 1.5 倍，也可以是磅值） |
| `para.space_before_lines` | number | 段前行数 |
| `para.space_after_lines` | number | 段后行数 |
| `para.letter_spacing_chars` | number | 字间距（如"摘 要"中间空 2 字） |

### Page 属性

| key | 类型 | 语义 |
|-----|------|------|
| `page.new_page_before` | bool | 独占页前 |
| `page.new_page_after` | bool | 独占页后 |
| `page.size` | enum | `"A4" / "Letter"` |
| `page.margin_top_cm` | number | 上边距（cm） |
| `page.margin_bottom_cm` | number | 下边距 |
| `page.margin_left_cm` | number | 左边距 |
| `page.margin_right_cm` | number | 右边距 |

### Content 属性

| key | 类型 | 语义 |
|-----|------|------|
| `content.char_count_min` | number | 字数下限 |
| `content.char_count_max` | number | 字数上限 |
| `content.item_count_min` | number | 项数下限 |
| `content.item_count_max` | number | 项数上限 |
| `content.item_separator` | string | 分隔符（"；" / ";"） |
| `content.specific_text` | string | 必须精确包含的文本（如"摘  要"） |
| `content.max_chars` | number | 字符数上限（题目 ≤ 25） |

### 其他属性

| key | 类型 | 语义 |
|-----|------|------|
| `mixed_script.ascii_is_tnr` | bool | 数字/西文必须 Times New Roman |
| `layout.position` | enum | `"above" / "below"`（图表题位置） |
| `citation.style` | enum | `"gbt7714" / "apa"` |
| `pagination.front_style` | enum | `"roman" / "arabic"`（前置部分页码风格） |
| `pagination.body_style` | enum | `"roman" / "arabic"`（正文页码风格） |
| `style_hint.word_style_name` | string | Word style 匹配辅助（如 `"Heading 1"`） |

## Schema 设计

### TemplateJson v2（与 P3 结构兼容）

```json
{
  "schema_version": 2,
  "id": "_builtin-gbt7714-v2",
  "name": "GB/T 7714 起点模板",
  "source": {
    "type": "builtin",
    "origin_docx": null,
    "extracted_at": null
  },
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
    // ... 其余 29 字段
  }
}
```

### 字段 id 稀疏性

TemplateJson.rules 里**不必包含全部 32 字段**。如果用户只定义了 10 个字段的规则，rules 就只含那 10 个 key。其他字段 detect 时跳过（视为"不检查"）。

### schema_version 迁移

- P3 的 v1 模板（11 抽象规则）**不迁移**，代码只认 v2
- P3 旧模板 JSON 文件若留在 `~/.config/ghostterm/templates/` 目录，TemplateStore.load 能读进来但 UI 显示为"规则空白"（因为 v1 rule_id `font.body` 等不在 32 字段 id 列表里，被忽略）
- 用户可手工删除旧模板或作为"参考"保留

## UI 主流程（Flow C 调整版）

### 工作台双栏布局

```
┌─────────────────────────────────────────────────────────────┐
│ 模板选择下拉 [论文格式模板 ▼]  [管理模板]  [从 docx 新建]  │
├──────────────────────────────┬──────────────────────────────┤
│ 左栏：docx-preview 渲染       │ 右栏：32 字段表              │
│ ┌──────────────────────────┐ │ 进度：5 / 32                 │
│ │ 毕业论文题目（三号黑体）  │ │ ● 中文题目  CURRENT          │
│ │ [当前 hover 高亮]         │ │ ✓ 摘要标题  0.92             │
│ │ 摘要（小三号宋体加粗）    │ │ ⚠ 英文题目  0.55  📍         │
│ │ × × × × × 300 字左右...   │ │ ○ Abstract 待填  📍          │
│ │ ...                       │ │ ○ ... 26 项                  │
│ └──────────────────────────┘ │ [跳过] [保存为模板]          │
│ ▼ 请为「中文题目」选取段落   │                              │
└──────────────────────────────┴──────────────────────────────┘
```

### 交互逻辑

1. **上传 docx**（用户选文件）→ `extract_all` 自动预抓 → 预填字段值
2. **染色规则**：
   - `confidence >= 0.8`：绿色 ✓（已完成）
   - `0.5 <= confidence < 0.8`：黄色 ⚠（建议校准）
   - `confidence < 0.5 or 未设置`：灰/红 ○（未完成）
3. **当前字段（CURRENT）** = 字段表顺序中第一个未完成的字段，高亮显示在表顶部
4. **Sequential mode（默认）**：
   - 左栏顶部提示"请为 X 选取段落"
   - 用户点击/选中段落 → `extract_from_selection(file, [para_idx], field_id=当前)` → 填入值
   - 自动推进到下一个未完成字段
5. **手动跳转**：
   - 用户点任意字段的 📍 按钮 → 跳到该字段（临时打断 sequence）
   - 选完该段 → 回到原 sequence 中断点的下一个未完成字段
6. **跳过**：
   - 用户点字段的「跳过」→ 标记 `enabled = false`，不阻塞 sequence
7. **已完成字段也可 📍**：点击后进入跳转模式（覆盖旧值）
8. **保存**：所有字段绿色或跳过 → 「保存为模板」按钮出现 → `template_save_cmd`

## Sidecar API 协议

### 新增命令

#### `extract_all`

```typescript
Request: {
  id: string,
  cmd: "extract_all",
  file: string  // docx 绝对路径
}

Response: {
  ok: true,
  result: {
    rules: {
      "abstract_zh_title": {
        enabled: true,
        value: { "font.cjk": "宋体", "font.size_pt": 15, ... }
      },
      // ... 自动识别到的字段
    },
    evidence: [
      {
        field_id: "abstract_zh_title",
        source_para_idx: 1,
        source_text: "摘  要（小三号宋体加粗）",
        confidence: 0.92
      }
    ],
    unmatched_paragraphs: [
      { idx: 17, text: "...", reason: "no_field_keyword" }
    ]
  }
}
```

**实现策略（决策 A-关键词定位）**：
- Gazetteer 词典：字段 id → 触发关键词列表
  - `abstract_zh_title` → ["摘 要", "摘要"]
  - `abstract_zh_body` → 接在 `abstract_zh_title` 后的段落（位置关系）
- 遍历段落文本，含关键词 → 关联字段
- 正则从段落文本/样式抽属性
- 位置模式作为兜底（"参考文献在文档末尾"等）
- **不做启发式学习**（P4 范围外）

**extract_all 失败策略（决策 C1）**：
返回空 `rules`，前端进入纯手动 sequential mode。不报错（失败静默）。

#### `extract_from_selection`

```typescript
Request: {
  id: string,
  cmd: "extract_from_selection",
  file: string,
  para_indices: number[],  // 选中的段落 index 数组（决策 B1：数组而非 range）
  field_id: string
}

Response: {
  ok: true,
  result: {
    field_id: "abstract_zh_body",
    value: { "font.cjk": "宋体", "font.size_pt": 12, ... },
    confidence: 0.95,
    evidence: {
      source_text: "...",
      matched_patterns: ["括号说明", "字体词典", "段落样式"]
    }
  }
}
```

`para_indices` 用数组以支持非连续选取（如用户选 p1 + p3 跳过 p2）。

#### `list_fields`

```typescript
Request: { id, cmd: "list_fields" }

Response: {
  ok: true,
  result: {
    fields: [
      {
        id: "title_zh",
        label: "中文题目",
        group: "front",
        order: 1,
        applicable_attributes: ["font.cjk", "font.size_pt", "font.bold", "para.align", "content.max_chars"]
      }
      // ... 32 项
    ]
  }
}
```

### 修改命令（P3 保留 API）

`detect` / `fix` / `fix_preview` / `list_rules` / `cancel` 的请求/响应 **JSON 格式不变**。内部 rule engine 重写为按 32 字段处理：

- `detect(file, template)`：遍历 template.rules 的每个 field_id → 定位论文对应段落 → 检查每条属性约束 → 返回 Issue 列表
- `fix(file, issue, value)`：按 issue.rule_id（= field_id）+ 属性 key 修改 docx → 蓝色标记 → 保存

## 实现技术栈

### 前端

- **docx-preview.js** 复用（P2 已集成，用于 Office 预览）
  - 需要 custom renderer wrapper 给每段注入 `data-para-idx` 属性
- **字号名 → pt 映射**：`src/features/tools/templates/chineseSizeMap.ts` 前端独立副本
  ```typescript
  export const CHINESE_SIZE_MAP: Record<string, number> = {
    '初号': 42, '小初': 36, '一号': 26, '小一': 24,
    '二号': 22, '小二': 18, '三号': 16, '小三': 15,
    '四号': 14, '小四': 12, '五号': 10.5, '小五': 9,
    '六号': 7.5, '小六': 6.5,
  };
  ```
- **工作台组件新建**：`RuleTemplateWorkspace.tsx`（左栏 DocxPreview + 右栏 FieldList）
- **P3 TemplateEditor / TemplateExtractor 保留** 但改为"字段属性编辑"而非"规则编辑"

### 后端 Python sidecar

- **python-docx** 沿用（读段落文本 + 样式）
- **Gazetteer 词典**：`src-python/thesis_worker/extractor/gazetteer.py`
  - 字体词：`['宋体', '黑体', '楷体', '仿宋', 'Times New Roman', 'Arial', '隶书', ...]`
  - 字号词：键从 `CHINESE_SIZE_MAP`
  - 对齐词：`['居中', '左对齐', '右对齐', '两端对齐', '顶格', '顶头']`
  - 加粗词：`['加粗', '粗体']`
- **正则 pattern 库**：`src-python/thesis_worker/extractor/patterns.py`
  - A 型括号：`r'(\S+)（([^）]*(?:号|体|粗|居中|缩进|行距)[^）]*)）'`
  - B 型叙述：`r'[""]([^""]{2,10})[""]\s*[为是]\s*([^，。；\n]+)'`
  - 字号写法：`r'([小大])?([初一二三四五六])号'` 或 `r'(\d+(?:\.\d+)?)\s*(pt|磅)'`
- **字段关联**：`src-python/thesis_worker/extractor/field_matcher.py`
  - 字段 id → 触发关键词列表
  - 段落内容匹配
- **字号 → pt 映射**：`src-python/thesis_worker/utils/size.py` 后端独立副本（同前端表）
- **不引入 HanLP**（MVP 先跑）

### Rust

- `template_cmd.rs` 几乎无变化（`rules: serde_json::Value` 透传）
- `_builtin-gbt7714.json` 替换为 `_builtin-gbt7714-v2.json`（32 字段 schema_version=2）
- 其他命令（detect/fix 透传）不变

## 内置起点模板（GB/T 7714-2015）

`src-tauri/templates/_builtin-gbt7714-v2.json` 预填合理默认值作为"起点"：

- 标题类：黑体系列，加粗，居中
- 正文类：宋体小四，首行缩进 2 字，1.5 倍行距
- 参考文献：GB/T 7714 标准（bracket 编号，悬挂缩进）
- 页面：A4，上下 2.5cm 左右 2.5-3cm
- 全局：数字/西文 TNR

用户上传自家规范 docx 后，用 extract 覆盖有差异的字段。

## 测试策略

### 后端 Python (pytest)

- `test_extractor_gazetteer`：词典匹配单元测试
- `test_extractor_patterns_a`：Template A 括号型样本抽取正确率（目标 ≥ 85%）
- `test_extractor_patterns_b`：Template B 叙述型样本抽取正确率（目标 ≥ 70%）
- `test_field_matcher`：字段关联逻辑
- `test_extract_all_integration`：全流程，用真实 docx（两份测试 fixture）
- `test_extract_from_selection`：指定段落抽取
- `test_detect_v2_rules`：按 32 字段 schema 检测
- `test_fix_v2_rules`：按字段属性修复 + reopen 硬测试

### 前端 TypeScript (vitest)

- `chineseSizeMap.test.ts`：映射表
- `FieldList.test.tsx`：sequential 推进逻辑 / 跳过 / 📍 跳转
- `DocxPreview.test.tsx`：段落 idx 注入 + click handler
- `RuleTemplateWorkspace.test.tsx`：整合流程（mock sidecar）
- `templateStoreV2.test.ts`：schema_version=2 load/save

### Rust (cargo test)

- `template_cmd_v2_roundtrip`：v2 模板 CRUD
- 其余 P3 测试保留

### E2E 手动测试

- 上传 Template A（论文格式模板.docx）→ 预期 ≥ 85% 字段自动填
- 上传 Template B（撰写规范及模板.doc → docx）→ 预期 ≥ 70% 字段自动填
- 手动补全所有字段 → 保存 → 重新检测实际论文 → 有违规报告

## 迁移与兼容

- **用户决策 A 硬破坏**：代码只认 schema_version=2
- P3 旧模板文件若留在磁盘：TemplateStore.load 仍读进来，但 UI 显示为"空白模板"（rule_id 对不上 32 字段）
- 无迁移代码，无备份，用户可自行手工删除或参考

## .docx-only 策略（用户决策 A）

- 文件选择器 filter `['docx']`
- .doc 文件拖拽进 app 或通过"打开方式"传入时报错：
  ```
  暂不支持 .doc 格式。请用 Word 打开 → 文件 → 另存为 → 选择 "Word 文档 (*.docx)"
  ```
- 不引入 LibreOffice / Word COM 自动化依赖（P5 可按需添加）

## 排除项（P4 不做）

- **LLM 集成**（本地/云端均 out）
- **HanLP NER/依存分析**（MVP 先用正则+词典；准确率不够再评估）
- **预置学校模板库**（规范年度变，维护成本高）
- **封面格式检查**（学校固定模板）
- **.doc 格式支持**（用户自转）
- **四级章节标题**
- **公式编号格式**
- **引用 `[n]` 位置检查**（reference_entry 的 citation.style 属性代替）
- **AI 化自动改写**（只检测，不改）
- **图表自动重排**
- **在线协作 / 云同步**
- **HTML 选取的启发式字段学习**（用户标注 N 个后机器自学）
- **v1 → v2 自动字段映射**（硬破坏迁移）

## 未来（P5+）

- HanLP fine-tune 提升 Template B 抽取准确率到 90%
- .doc 兼容（调系统 LibreOffice subprocess）
- 四级章节标题 + 公式 + 图表自动重排
- 格式规则社区共享 JSON（类似 Zotero CSL）
- AI 化写作检测 → 改写建议（LLM 选择）

## 参考资料

- **模板样本**：
  - Template A：`毕设-茶园生态管理系统/docs/论文格式模板.docx`（括号说明型）
  - Template B：`毕设-旅游信息服务系统/docs/撰写规范及模板.doc`（叙述文型）
- **规范原文**：GB/T 7714-2015
- **P3 依赖 spec**：`docs/superpowers/specs/2026-04-17-titlebar-nav-tools-design.md`
- **P3 plan**：`docs/superpowers/plans/2026-04-18-p3-tools-full-feature.md`
- **Brainstorm session**：`.superpowers/brainstorm/21295-1776516685/` （UI mockups）

## Discovery 关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 规则粒度 | 32 语义字段（不是 11 抽象） | 真实论文字段各异，抽象规则失效 |
| 学校模板库 | 不做预置 | 规范年度变，维护成本高 |
| 自动抽取技术 | 正则+词典+docx-preview 选取 | LLM-free；MVP 后按需加 HanLP |
| 封面字段 | 跳过 | 学校固定模板 |
| .doc 兼容 | 仅 .docx | 用户自转 |
| P3 迁移 | 硬破坏 | 代码只认 v2，旧模板自然降级 |
| 内置模板 | X3 GB/T 7714 起点 | 新用户首次打开有参考值 |
| UI 流程 | Flow C 调整版 | sequential + 📍 临时打断 |
| Schema 结构 | 方案 3 稀疏 | 兼容 P3 架构，属性级演化 |
| docx 渲染库 | docx-preview.js 复用 | P2 已集成 |
| 字号映射表 | 前后端各一份 | 14 项静态，同步无价值 |
| Sidecar API | 3 新命令 + P3 命令 JSON 不变 | 前端既有代码保留 95% |
| extract 关联策略 | 关键词定位为主 + 位置兜底 | 不做启发式学习（P4 范围外） |
| 选取粒度 | para_indices 数组 | 支持非连续选取 |
| extract_all 失败 | 静默返空 | 用户体感 = 只是没自动填 |

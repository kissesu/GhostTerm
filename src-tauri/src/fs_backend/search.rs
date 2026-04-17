// @file: fs_backend/search.rs
// @description: 全文搜索后端 - 基于 ignore crate（尊重 .gitignore）和 regex 的项目内搜索
//               支持内容搜索和文件名搜索两种模式
// @author: Atlas.oi
// @date: 2026-04-16

// 每个文件最多返回的匹配条数，超出后设 truncated=true 并停止该文件扫描
const MAX_MATCHES_PER_FILE: usize = 50;

// 总文件数上限，超出后设整体 truncated=true 并停止遍历
const MAX_FILES: usize = 200;

// 单文件大小上限（5MB），超过此大小跳过该文件
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// 单条匹配结果，对应文件中某一行的某段文本
/// rename_all = "camelCase"：前端 TS 接口用 camelCase（lineNumber/lineContent/...）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 行号，1-based；文件名搜索模式下置 0
    pub line_number: u32,
    /// 匹配所在行的完整文本内容
    pub line_content: String,
    /// 匹配起始列（字节偏移，0-based）
    pub column_start: u32,
    /// 匹配结束列（字节偏移，exclusive）
    pub column_end: u32,
}

/// 单个文件的搜索结果
/// rename_all = "camelCase"：前端 TS 接口用 camelCase（filePath/absPath）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    /// 相对 root_path 的路径（供 UI 显示用）
    pub file_path: String,
    /// 绝对路径（供前端 openFile 打开文件用）
    pub abs_path: String,
    /// 该文件内所有匹配条目
    pub matches: Vec<SearchMatch>,
    /// 该文件是否因超过 MAX_MATCHES_PER_FILE 而被截断
    pub truncated: bool,
}

/// 整次搜索的汇总结果
#[derive(serde::Serialize)]
pub struct SearchResult {
    /// 各文件的匹配结果列表
    pub files: Vec<SearchFileResult>,
    /// 是否因超过 MAX_FILES 而被截断
    pub truncated: bool,
}

/// 前端传入的搜索参数
/// rename_all = "camelCase"：前端 JS 用 camelCase（rootPath/caseSensitive/...），
/// serde 自动映射到 Rust snake_case 字段名
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    /// 项目根目录路径
    pub root_path: String,
    /// 搜索关键词或正则表达式字符串
    pub query: String,
    /// 搜索模式："content"（文件内容） | "filename"（文件名）
    pub mode: String,
    /// 是否区分大小写
    pub case_sensitive: bool,
    /// 是否全词匹配（仅对 use_regex=false 时生效）
    pub whole_word: bool,
    /// 是否把 query 当作正则表达式直接使用
    pub use_regex: bool,
    /// 文件 glob 过滤，如 "*.ts"；None 表示不过滤
    pub file_glob: Option<String>,
}

/// 根据 SearchParams 构建用于匹配的正则表达式
///
/// 构建规则：
/// 1. use_regex=true：直接用 query 作为正则 pattern
/// 2. use_regex=false：先用 regex::escape 转义，再根据 whole_word 加 \b 边界
/// 3. case_sensitive=false：在 pattern 前追加 (?i) 修饰符
fn build_regex(params: &SearchParams) -> Result<regex::Regex, String> {
    let mut pattern = if params.use_regex {
        // 用户提供的正则表达式，直接使用
        params.query.clone()
    } else {
        // 字面量搜索：转义所有正则特殊字符
        let escaped = regex::escape(&params.query);
        // whole_word 仅对字面量模式生效，正则模式由用户自行写 \b
        if params.whole_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    // 大小写不敏感时在 pattern 最前面加 (?i) 修饰符
    if !params.case_sensitive {
        pattern = format!("(?i){}", pattern);
    }

    regex::Regex::new(&pattern).map_err(|e| format!("正则表达式无效: {}", e))
}

/// 构建文件遍历器，自动尊重 .gitignore 等忽略规则
///
/// 若 file_glob 非空，追加 glob override 过滤器，只遍历匹配扩展名的文件
fn build_walker(params: &SearchParams) -> Result<ignore::Walk, String> {
    let mut builder = ignore::WalkBuilder::new(&params.root_path);
    // 自动读取 .gitignore / .ignore / .git/info/exclude 等规则
    builder.standard_filters(true);

    if let Some(ref glob) = params.file_glob {
        // 用 OverrideBuilder 添加文件 glob 过滤，只搜索匹配文件
        let mut override_builder = ignore::overrides::OverrideBuilder::new(&params.root_path);
        override_builder
            .add(glob)
            .map_err(|e| format!("glob 格式错误: {}", e))?;
        let overrides = override_builder
            .build()
            .map_err(|e| format!("构建 glob 过滤器失败: {}", e))?;
        builder.overrides(overrides);
    }

    Ok(builder.build())
}

/// 对单个文件进行内容搜索
///
/// 返回 None 表示无匹配或文件应跳过（大文件、非 UTF-8、读取失败等）
fn search_file_content(
    path: &std::path::Path,
    root_path: &str,
    re: &regex::Regex,
) -> Option<SearchFileResult> {
    // 规范化 root_path：Path::new 会自动去除末尾斜杠，避免 strip_prefix 因末尾斜杠失败
    let root = std::path::Path::new(root_path);

    // 检查文件大小，超过 5MB 跳过
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_FILE_SIZE {
        return None;
    }

    // 读取原始字节，失败则跳过
    let bytes = std::fs::read(path).ok()?;

    // 尝试 UTF-8 解码，非 UTF-8 文件跳过（不报错）
    let content = String::from_utf8(bytes).ok()?;

    let mut matches: Vec<SearchMatch> = Vec::new();
    let mut file_truncated = false;

    'outer: for (idx, line) in content.lines().enumerate() {
        // 对当前行进行全量匹配扫描
        // 先检查容量再 push，确保 truncated 语义为"有匹配因超限未被收录"
        for m in re.find_iter(line) {
            if matches.len() >= MAX_MATCHES_PER_FILE {
                // 确认还有未收录的匹配才置为 truncated，然后终止整个外层遍历
                file_truncated = true;
                break 'outer;
            }
            matches.push(SearchMatch {
                line_number: (idx + 1) as u32, // 转换为 1-based 行号
                line_content: line.to_string(),
                column_start: m.start() as u32,
                column_end: m.end() as u32,
            });
        }
    }

    if matches.is_empty() {
        return None;
    }

    let abs_path = path.to_string_lossy().to_string();
    let file_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    Some(SearchFileResult {
        file_path,
        abs_path,
        matches,
        truncated: file_truncated,
    })
}

/// 对单个文件进行文件名搜索
///
/// 匹配的是相对于 root_path 的路径字符串，而不是文件内容
/// 每个文件至多返回 1 条 SearchMatch
fn search_file_name(
    path: &std::path::Path,
    root_path: &str,
    re: &regex::Regex,
) -> Option<SearchFileResult> {
    // 规范化 root_path：Path::new 自动处理末尾斜杠，与 search_file_content 保持一致
    let root = std::path::Path::new(root_path);
    let rel = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    // 先提取匹配区间，再 move rel；re.find 借用 rel，需先记录偏移
    let (col_start, col_end) = {
        let m = re.find(&rel)?;
        (m.start() as u32, m.end() as u32)
    };

    let abs_path = path.to_string_lossy().to_string();

    Some(SearchFileResult {
        file_path: rel.clone(),
        abs_path,
        matches: vec![SearchMatch {
            line_number: 0,
            line_content: rel,
            column_start: col_start,
            column_end: col_end,
        }],
        truncated: false,
    })
}

/// Tauri Command: 在指定项目目录内执行全文搜索
///
/// 业务逻辑：
/// 1. 根据参数构建正则表达式
/// 2. 使用 ignore::WalkBuilder 遍历文件（自动尊重 .gitignore）
/// 3. 根据 mode 分发到内容搜索或文件名搜索逻辑
/// 4. 按截断限制（每文件 50 条、总文件 200 个）收集结果
#[tauri::command]
pub fn search_files_cmd(params: SearchParams) -> Result<SearchResult, String> {
    let re = build_regex(&params)?;
    let walker = build_walker(&params)?;

    let mut files: Vec<SearchFileResult> = Vec::new();
    let mut overall_truncated = false;

    for entry_result in walker {
        // 遍历错误（如权限不足）直接跳过该项
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };

        // 只处理普通文件，跳过目录和符号链接等
        if entry.file_type().map(|ft| !ft.is_file()).unwrap_or(true) {
            continue;
        }

        let path = entry.path();

        // 根据搜索模式选择不同的匹配策略
        let result = if params.mode == "filename" {
            search_file_name(path, &params.root_path, &re)
        } else {
            // 默认走内容搜索模式（mode == "content" 或其他值）
            search_file_content(path, &params.root_path, &re)
        };

        if let Some(file_result) = result {
            files.push(file_result);

            // 达到文件数上限时终止遍历
            if files.len() >= MAX_FILES {
                overall_truncated = true;
                break;
            }
        }
    }

    Ok(SearchResult {
        files,
        truncated: overall_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// 测试基本内容搜索：能在文件中找到指定关键词并返回正确行号和列偏移
    #[test]
    fn test_content_search_basic() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("main.rs");
        fs::write(&file, "fn main() {\n    println!(\"hello world\");\n}\n").unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "hello".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();

        assert_eq!(result.files.len(), 1);
        let f = &result.files[0];
        assert_eq!(f.matches.len(), 1);
        let m = &f.matches[0];
        // 第 2 行包含 "hello world"
        assert_eq!(m.line_number, 2);
        assert!(m.line_content.contains("hello"));
        // column_start 应指向 "hello" 的起始字节位置
        assert!(m.column_start < m.column_end);
    }

    /// 测试大小写不敏感搜索
    #[test]
    fn test_content_search_case_insensitive() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("readme.txt");
        fs::write(&file, "Hello World\nhello again\nHELLO THERE").unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "hello".to_string(),
            mode: "content".to_string(),
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        assert_eq!(result.files.len(), 1);
        // 三行都应匹配
        assert_eq!(result.files[0].matches.len(), 3);
    }

    /// 测试文件名搜索模式：匹配文件路径，不读取文件内容
    #[test]
    fn test_filename_search() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("app.tsx"), "export default function App() {}").unwrap();
        fs::write(dir.path().join("utils.ts"), "export function helper() {}").unwrap();
        fs::write(dir.path().join("style.css"), "body {}").unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "\\.ts".to_string(),   // 匹配 .ts 和 .tsx 扩展名
            mode: "filename".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: true,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        // app.tsx 和 utils.ts 都应匹配，style.css 不应匹配
        assert_eq!(result.files.len(), 2);
        // line_number 应为 0（文件名搜索标记）
        for f in &result.files {
            assert_eq!(f.matches[0].line_number, 0);
        }
    }

    /// 测试 .gitignore 被尊重：.gitignore 排除的目录内文件不应出现在结果中
    ///
    /// ignore crate 要求存在 .git 目录才会将 .gitignore 视为 git-aware 忽略规则，
    /// 因此测试环境必须同时创建 .git 目录模拟真实 git 仓库结构
    #[test]
    fn test_gitignore_respected() {
        let dir = tempdir().unwrap();

        // 创建最小化 .git 目录，让 ignore crate 识别为 git 仓库根
        // 没有 .git 时 ignore 不加载 .gitignore（只加载 .ignore 文件）
        fs::create_dir(dir.path().join(".git")).unwrap();

        // 创建 .gitignore，排除 node_modules 目录
        fs::write(dir.path().join(".gitignore"), "node_modules/\n").unwrap();

        // 在 node_modules 内创建包含关键词的文件
        let nm = dir.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        fs::write(nm.join("index.js"), "const target = 'hello';").unwrap();

        // 在普通目录中也创建包含相同关键词的文件
        fs::write(dir.path().join("src.ts"), "const greeting = 'hello';").unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "hello".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();

        // 只有 src.ts 应该被搜索到，node_modules/index.js 被 .gitignore 排除
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].file_path.contains("src.ts"));
    }

    /// 测试每文件超过 50 条匹配时 truncated=true
    #[test]
    fn test_file_truncation() {
        let dir = tempdir().unwrap();

        // 写入 60 行，每行都包含关键词 "needle"
        let content: String = (0..60).map(|i| format!("line {} needle\n", i)).collect();
        fs::write(dir.path().join("big.txt"), &content).unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "needle".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        assert_eq!(result.files.len(), 1);

        let f = &result.files[0];
        // 最多返回 50 条匹配
        assert_eq!(f.matches.len(), MAX_MATCHES_PER_FILE);
        // 文件级截断标记应为 true
        assert!(f.truncated);
    }

    /// 测试 5MB 以上文件被跳过
    #[test]
    fn test_large_file_skipped() {
        let dir = tempdir().unwrap();

        // 写入一个 6MB 的文件，每行包含 "needle"
        let line = "needle ".repeat(100) + "\n"; // ~701 bytes
        let repeat_count = (6 * 1024 * 1024) / line.len() + 1;
        let content: String = line.repeat(repeat_count);
        fs::write(dir.path().join("huge.txt"), &content).unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "needle".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        // 大文件应被跳过，结果为空
        assert_eq!(result.files.len(), 0);
    }

    /// 测试 F1 修复：文件恰好 50 条匹配时 truncated 应为 false（无误报）
    #[test]
    fn test_file_truncation_exact_limit_no_false_positive() {
        let dir = tempdir().unwrap();

        // 写入恰好 50 行，每行一条匹配，总计恰好等于上限
        let content: String = (0..MAX_MATCHES_PER_FILE)
            .map(|i| format!("line {} needle\n", i))
            .collect();
        fs::write(dir.path().join("exact.txt"), &content).unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "needle".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        assert_eq!(result.files.len(), 1);

        let f = &result.files[0];
        // 恰好 50 条，所有匹配均被收录，不应触发截断
        assert_eq!(f.matches.len(), MAX_MATCHES_PER_FILE);
        assert!(!f.truncated, "恰好 50 条匹配时不应误报 truncated=true");
    }

    /// 测试 F1 修复：同一行有多个匹配，恰好凑满 50 条时 truncated 为 false
    #[test]
    fn test_file_truncation_multimatches_per_line_exact() {
        let dir = tempdir().unwrap();

        // 每行 2 个 "needle"，共 25 行 = 50 条匹配，恰好到达上限但不超出
        let content: String = (0..25)
            .map(|i| format!("needle{} and needle{}_end\n", i, i))
            .collect();
        fs::write(dir.path().join("multi.txt"), &content).unwrap();

        let params = SearchParams {
            root_path: dir.path().to_string_lossy().to_string(),
            query: "needle".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        assert_eq!(result.files.len(), 1);

        let f = &result.files[0];
        assert_eq!(f.matches.len(), MAX_MATCHES_PER_FILE);
        assert!(!f.truncated, "同行多匹配恰好凑满 50 条时不应误报 truncated=true");
    }

    /// 测试 F2 修复：root_path 末尾带斜杠时 file_path 仍为相对路径
    #[test]
    fn test_root_path_trailing_slash() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("hello.txt"), "hello world").unwrap();

        // root_path 末尾带斜杠
        let root_with_slash = format!("{}/", dir.path().to_string_lossy());

        let params = SearchParams {
            root_path: root_with_slash,
            query: "hello".to_string(),
            mode: "content".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        assert_eq!(result.files.len(), 1);

        let file_path = &result.files[0].file_path;
        // file_path 应为相对路径 "hello.txt"，而非以 "/" 开头的绝对路径
        assert!(
            !file_path.starts_with('/'),
            "末尾斜杠的 root_path 不应导致 file_path 变为绝对路径，实际值: {}",
            file_path
        );
        assert!(file_path.contains("hello.txt"), "file_path 应包含文件名");
    }

    /// 测试 F2 修复：filename 模式下 root_path 末尾带斜杠时相对路径正确
    #[test]
    fn test_root_path_trailing_slash_filename_mode() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("needle.rs"), "content").unwrap();

        let root_with_slash = format!("{}/", dir.path().to_string_lossy());

        let params = SearchParams {
            root_path: root_with_slash,
            query: "needle".to_string(),
            mode: "filename".to_string(),
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            file_glob: None,
        };

        let result = search_files_cmd(params).unwrap();
        assert_eq!(result.files.len(), 1);

        let file_path = &result.files[0].file_path;
        assert!(
            !file_path.starts_with('/'),
            "filename 模式末尾斜杠不应导致绝对路径，实际值: {}",
            file_path
        );
        assert!(file_path.contains("needle.rs"));
    }
}

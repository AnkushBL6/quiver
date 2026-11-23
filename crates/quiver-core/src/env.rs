//! Home directory and environment resolution. Everything that touches the
//! user's machine goes through [`Env`] so tests can run against a temp home.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Environment variables that relocate an agent's home directory, with their defaults.
const HOME_VARS: &[(&str, &str)] = &[
    ("CODEX_HOME", "~/.codex"),
    ("CLAUDE_CONFIG_DIR", "~/.claude"),
    ("VIBE_HOME", "~/.vibe"),
    ("HERMES_HOME", "~/.hermes"),
    ("AUTOHAND_HOME", "~/.autohand"),
    ("GROK_HOME", "~/.grok"),
    ("SARVAM_HOME", "~/.sarvam"),
];

#[derive(Debug, Clone)]
pub struct Env {
    pub home: PathBuf,
    vars: HashMap<String, String>,
    /// When false (tests), absolute system paths such as /Applications are not probed.
    pub probe_system: bool,
}

impl Env {
    /// The real environment of the current process.
    pub fn system() -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        let mut vars = HashMap::new();
        for key in HOME_VARS.iter().map(|(k, _)| *k).chain([
            "XDG_CONFIG_HOME",
            "XDG_STATE_HOME",
            "GITHUB_TOKEN",
            "GH_TOKEN",
            "PATH",
        ]) {
            if let Ok(v) = std::env::var(key)
                && !v.trim().is_empty()
            {
                vars.insert(key.to_string(), v.trim().to_string());
            }
        }
        Self {
            home,
            vars,
            probe_system: true,
        }
    }

    /// An isolated environment rooted at `home` with no variables set.
    pub fn isolated(home: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            vars: HashMap::new(),
            probe_system: false,
        }
    }

    pub fn with_var(mut self, key: &str, value: &str) -> Self {
        self.vars.insert(key.to_string(), value.to_string());
        self
    }

    pub fn var(&self, key: &str) -> Option<&str> {
        self.vars.get(key).map(String::as_str)
    }

    pub fn xdg_config(&self) -> PathBuf {
        match self.var("XDG_CONFIG_HOME") {
            Some(v) => PathBuf::from(v),
            None => self.home.join(".config"),
        }
    }

    /// Expand a registry path template: `~`, `{XDG_CONFIG}` and `{VAR}` home overrides.
    pub fn expand(&self, template: &str) -> PathBuf {
        let mut s = template.to_string();
        if s.contains("{XDG_CONFIG}") {
            s = s.replace("{XDG_CONFIG}", &self.xdg_config().to_string_lossy());
        }
        for (key, default) in HOME_VARS {
            let token = format!("{{{key}}}");
            if s.contains(&token) {
                let value = match self.var(key) {
                    Some(v) => v.to_string(),
                    None => default.to_string(),
                };
                s = s.replace(&token, &value);
            }
        }
        if s == "~" {
            return self.home.clone();
        }
        if let Some(rest) = s.strip_prefix("~/") {
            return self.home.join(rest);
        }
        PathBuf::from(s)
    }

    /// Whether a probe path exists. System paths are skipped in isolated mode.
    pub fn exists(&self, path: &Path) -> bool {
        if !self.probe_system && !path.starts_with(&self.home) {
            return false;
        }
        path.exists()
    }

    /// Shorten a path for display: replace the home prefix with `~`.
    pub fn display(&self, path: &Path) -> String {
        match path.strip_prefix(&self.home) {
            Ok(rest) if rest.as_os_str().is_empty() => "~".to_string(),
            Ok(rest) => format!("~/{}", rest.to_string_lossy()),
            Err(_) => path.to_string_lossy().into_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_templates() {
        let env = Env::isolated("/h").with_var("CODEX_HOME", "/opt/codex");
        assert_eq!(
            env.expand("~/.claude/skills"),
            PathBuf::from("/h/.claude/skills")
        );
        assert_eq!(
            env.expand("{XDG_CONFIG}/opencode/skills"),
            PathBuf::from("/h/.config/opencode/skills")
        );
        assert_eq!(
            env.expand("{CODEX_HOME}/skills"),
            PathBuf::from("/opt/codex/skills")
        );
        assert_eq!(
            env.expand("{CLAUDE_CONFIG_DIR}/skills"),
            PathBuf::from("/h/.claude/skills")
        );
        assert_eq!(
            env.expand("/Applications/Zed.app"),
            PathBuf::from("/Applications/Zed.app")
        );
    }
}

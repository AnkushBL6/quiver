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
        let home = system_home();
        let mut vars = HashMap::new();
        for key in HOME_VARS.iter().map(|(k, _)| *k).chain([
            "XDG_CONFIG_HOME",
            "XDG_STATE_HOME",
            "GITHUB_TOKEN",
            "GH_TOKEN",
            "PATH",
            // Windows: where tools and editors install, and which extensions run.
            "PATHEXT",
            "APPDATA",
            "LOCALAPPDATA",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "SystemRoot",
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
    /// Templates are written with `/`; on Windows the result uses native separators.
    pub fn expand(&self, template: &str) -> PathBuf {
        native(self.expand_raw(template))
    }

    fn expand_raw(&self, template: &str) -> PathBuf {
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
        #[cfg(windows)]
        if let Some(rest) = s.strip_prefix("~\\") {
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
    /// Home-relative paths always use `/` (`~/.claude/skills`), like the agents' own docs.
    pub fn display(&self, path: &Path) -> String {
        // A resolved path (e.g. /private/tmp/... for /tmp/...) still belongs under ~.
        let rest = path
            .strip_prefix(&self.home)
            .map(Path::to_path_buf)
            .or_else(|_| {
                let real = std::fs::canonicalize(&self.home).map_err(|_| ())?;
                path.strip_prefix(real)
                    .map(Path::to_path_buf)
                    .map_err(|_| ())
            });
        match rest.as_deref() {
            Ok(rest) if rest.as_os_str().is_empty() => "~".to_string(),
            Ok(rest) => format!("~/{}", rest.to_string_lossy().replace('\\', "/")),
            Err(_) => path.to_string_lossy().into_owned(),
        }
    }

    /// Directories where command-line tools commonly live, beyond `PATH` (GUI apps
    /// on macOS get a minimal one; on Windows these are the usual per-user installs).
    pub fn extra_bin_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = [
            "~/.local/bin",
            "~/.npm-global/bin",
            "~/.bun/bin",
            "~/.cargo/bin",
            "~/.volta/bin",
            "~/bin",
        ]
        .iter()
        .map(|d| self.expand(d))
        .collect();
        #[cfg(unix)]
        dirs.extend(
            ["/opt/homebrew/bin", "/usr/local/bin"]
                .iter()
                .map(PathBuf::from),
        );
        #[cfg(windows)]
        {
            let appdata = self.var("APPDATA").map(PathBuf::from);
            let local = self.var("LOCALAPPDATA").map(PathBuf::from);
            dirs.extend(appdata.map(|a| a.join("npm")));
            if let Some(l) = local {
                dirs.push(l.join("pnpm"));
                dirs.push(l.join("Volta").join("bin"));
                dirs.push(l.join("Microsoft").join("WinGet").join("Links"));
            }
            dirs.push(self.home.join("scoop").join("shims"));
        }
        dirs
    }
}

/// Home directory of the current user.
fn system_home() -> PathBuf {
    #[cfg(windows)]
    {
        // USERPROFILE is the Windows home; HOME may be set by Git Bash or MSYS in
        // a form (`/c/Users/me`) native code can't use.
        ["USERPROFILE", "HOME"]
            .iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .find(|p| p.is_absolute())
            .or_else(std::env::home_dir)
            .unwrap_or_else(|| PathBuf::from(r"C:\"))
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"))
    }
}

/// Rewrite separators to the platform's own (`C:\a/b` → `C:\a\b`); a no-op elsewhere.
fn native(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        path.components().collect()
    } else {
        path
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

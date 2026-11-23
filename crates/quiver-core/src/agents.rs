//! Agent registry: which coding agents exist, where they read skills from,
//! and whether they are installed on this machine.

use crate::env::Env;
use crate::fsutil;
use crate::model::{AgentInfo, LinkMode, Settings};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const REGISTRY_JSON: &str = include_str!("../agents.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDef {
    pub id: String,
    pub name: String,
    /// Global skill dirs; the first is preferred for installs, the rest are legacy/alternates.
    pub global_dirs: Vec<String>,
    /// Extra dirs the agent reads but Quiver never installs into.
    #[serde(default)]
    pub read_dirs: Vec<String>,
    /// Paths whose existence means the agent is installed.
    pub detect: Vec<String>,
    /// CLI binary names; finding one in a common bin dir also means installed.
    #[serde(default)]
    pub detect_bins: Vec<String>,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default = "default_tier")]
    pub tier: u8,
    #[serde(default)]
    pub note: Option<String>,
    /// macOS app bundle names (in /Applications or ~/Applications), used for icons.
    /// Other platforms have no bundles; the UI shows a monogram instead.
    #[serde(default)]
    pub apps: Vec<String>,
}

fn default_tier() -> u8 {
    3
}

#[derive(Deserialize)]
struct Registry {
    agents: Vec<AgentDef>,
}

/// The built-in registry, parsed once.
pub fn builtin() -> &'static [AgentDef] {
    static REG: OnceLock<Vec<AgentDef>> = OnceLock::new();
    REG.get_or_init(|| {
        serde_json::from_str::<Registry>(REGISTRY_JSON)
            .expect("embedded agents.json is valid")
            .agents
    })
}

/// An agent resolved against the current machine.
#[derive(Debug, Clone)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub tier: u8,
    pub detected: bool,
    pub enabled: bool,
    /// Directory Quiver writes links into.
    pub install_dir: PathBuf,
    /// Every directory the agent reads (install_dir first), canonical store excluded.
    pub dirs: Vec<PathBuf>,
    pub reads_canonical: bool,
    pub link_mode: LinkMode,
    pub note: Option<String>,
    pub custom: bool,
    pub app_path: Option<PathBuf>,
}

impl Agent {
    /// Agent is active: installed and not hidden by the user.
    pub fn active(&self) -> bool {
        self.detected && self.enabled
    }

    pub fn info(&self, env: &Env, skill_count: usize) -> AgentInfo {
        AgentInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            tier: self.tier,
            detected: self.detected,
            enabled: self.enabled,
            skills_dir: self.install_dir.to_string_lossy().into_owned(),
            extra_dirs: self
                .dirs
                .iter()
                .filter(|d| **d != self.install_dir)
                .map(|d| d.to_string_lossy().into_owned())
                .collect(),
            reads_canonical: self.reads_canonical,
            link_mode: self.link_mode,
            skill_count,
            note: self.note.clone().or_else(|| {
                self.reads_canonical.then(|| {
                    format!(
                        "Reads {} directly; every managed skill is visible.",
                        env.display(&env.home.join(".agents/skills"))
                    )
                })
            }),
            custom: self.custom,
            app_path: self
                .app_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        }
    }
}

/// First installed app bundle among `names` (macOS only).
fn find_app(env: &Env, names: &[String]) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") || !env.probe_system {
        return None;
    }
    names.iter().find_map(|n| {
        [
            PathBuf::from("/Applications"),
            env.home.join("Applications"),
        ]
        .into_iter()
        .map(|d| d.join(n))
        .find(|p| p.is_dir())
    })
}

/// Normalize a path for equality checks (resolves symlinks when the path exists).
pub fn normalize(path: &Path) -> PathBuf {
    fsutil::normalize(path)
}

/// Resolve the full agent list for this machine.
pub fn resolve(env: &Env, settings: &Settings, canonical: &Path) -> Vec<Agent> {
    let canonical_norm = normalize(canonical);
    let mut out: Vec<Agent> = Vec::new();

    for def in builtin() {
        let detected = def.detect.iter().any(|p| env.exists(&env.expand(p)))
            || def.detect_bins.iter().any(|b| has_bin(env, b));
        let globals: Vec<PathBuf> = def.global_dirs.iter().map(|d| env.expand(d)).collect();
        let install_dir = pick_install_dir(env, &globals);
        let mut dirs = vec![install_dir.clone()];
        for d in globals.iter().chain(
            def.read_dirs
                .iter()
                .map(|d| env.expand(d))
                .collect::<Vec<_>>()
                .iter(),
        ) {
            if !dirs.contains(d) {
                dirs.push(d.clone());
            }
        }
        let mut agent = make_agent(
            def.id.clone(),
            def.name.clone(),
            def.tier,
            detected,
            install_dir,
            dirs,
            def.note.clone(),
            false,
            settings,
            &canonical_norm,
        );
        agent.app_path = find_app(env, &def.apps);
        out.push(agent);
    }
    let claude_app = out
        .iter()
        .find(|a| a.id == "claude-code")
        .and_then(|a| a.app_path.clone());

    // Extra Claude Code profiles (CLAUDE_CONFIG_DIR), e.g. ~/.claude-work or ~/.claude_t3_api.
    // The main entry is always ~/.claude so the app and CLI agree regardless of env.
    let default_claude = env.home.join(".claude");
    let mut profiles: Vec<PathBuf> = std::fs::read_dir(&env.home)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    (name.starts_with(".claude-") || name.starts_with(".claude_"))
                        && p.is_dir()
                        && (p.join("skills").is_dir() || p.join("settings.json").is_file())
                })
                .collect()
        })
        .unwrap_or_default();
    if let Some(custom) = env.var("CLAUDE_CONFIG_DIR").map(PathBuf::from)
        && normalize(&custom) != normalize(&default_claude)
        && !profiles.iter().any(|p| normalize(p) == normalize(&custom))
    {
        profiles.push(custom);
    }
    profiles.sort();
    {
        for p in profiles {
            let file = p
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default();
            let suffix = file
                .strip_prefix(".claude")
                .map(|s| s.trim_start_matches(['-', '_']).to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or(file.clone());
            let dir = p.join("skills");
            let mut agent = make_agent(
                format!("claude-code@{suffix}"),
                format!("Claude Code ({suffix})"),
                1,
                true,
                dir.clone(),
                vec![dir],
                Some(format!(
                    "Claude Code profile at {} (CLAUDE_CONFIG_DIR).",
                    env.display(&p)
                )),
                false,
                settings,
                &canonical_norm,
            );
            agent.app_path = claude_app.clone();
            out.push(agent);
        }
    }

    for c in &settings.custom_agents {
        let dir = env.expand(&c.skills_dir);
        let detected = dir.exists() || dir.parent().is_some_and(Path::exists);
        out.push(make_agent(
            c.id.clone(),
            c.name.clone(),
            1,
            detected,
            dir.clone(),
            vec![dir],
            None,
            true,
            settings,
            &canonical_norm,
        ));
    }

    // Stable order: detected first, then tier, then registry order.
    let order: Vec<String> = out.iter().map(|a| a.id.clone()).collect();
    out.sort_by_key(|a| (!a.detected, a.tier, order.iter().position(|id| *id == a.id)));
    out
}

#[allow(clippy::too_many_arguments)]
fn make_agent(
    id: String,
    name: String,
    tier: u8,
    detected: bool,
    install_dir: PathBuf,
    dirs: Vec<PathBuf>,
    note: Option<String>,
    custom: bool,
    settings: &Settings,
    canonical_norm: &Path,
) -> Agent {
    let reads_canonical = normalize(&install_dir) == canonical_norm;
    let dirs = dirs
        .into_iter()
        .filter(|d| normalize(d) != canonical_norm)
        .collect();
    Agent {
        enabled: !settings.hidden_agents.contains(&id),
        link_mode: settings.link_modes.get(&id).copied().unwrap_or_default(),
        id,
        name,
        tier,
        detected,
        install_dir,
        dirs,
        reads_canonical,
        note,
        custom,
        app_path: None,
    }
}

/// Whether a CLI binary is installed in a common location (GUI apps get a minimal PATH).
fn has_bin(env: &Env, bin: &str) -> bool {
    if !env.probe_system {
        return false;
    }
    let mut dirs = env.extra_bin_dirs();
    if let Some(path) = env.var("PATH") {
        dirs.extend(std::env::split_paths(path));
    }
    let exts = bin_extensions(env);
    dirs.iter().any(|d| bin_in_dir(d, bin, &exts))
}

/// Executable suffixes to try after the bare name: none on Unix; on Windows the
/// usual script and program extensions (including the `.cmd`/`.ps1` shims npm writes).
fn bin_extensions(env: &Env) -> Vec<String> {
    if !cfg!(windows) {
        return vec![];
    }
    let mut exts: Vec<String> = env
        .var("PATHEXT")
        .unwrap_or(".COM;.EXE;.BAT;.CMD")
        .split(';')
        .filter(|e| !e.is_empty())
        .map(str::to_lowercase)
        .collect();
    if !exts.iter().any(|e| e == ".ps1") {
        exts.push(".ps1".into());
    }
    exts
}

fn bin_in_dir(dir: &Path, bin: &str, exts: &[String]) -> bool {
    dir.join(bin).is_file() || exts.iter().any(|e| dir.join(format!("{bin}{e}")).is_file())
}

/// First dir that exists, else first whose parent exists, else the preferred one.
fn pick_install_dir(env: &Env, dirs: &[PathBuf]) -> PathBuf {
    if let Some(d) = dirs.iter().find(|d| env.exists(d)) {
        return d.clone();
    }
    if let Some(d) = dirs
        .iter()
        .find(|d| d.parent().is_some_and(|p| env.exists(p)))
    {
        return d.clone();
    }
    dirs[0].clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_parses_and_ids_unique() {
        let reg = builtin();
        assert!(reg.len() > 60);
        let mut ids: Vec<_> = reg.iter().map(|a| a.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), reg.len());
        for a in reg {
            assert!(!a.global_dirs.is_empty(), "{} has no dirs", a.id);
        }
    }

    #[test]
    fn detects_and_resolves() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::create_dir_all(home.path().join(".codex")).unwrap();
        std::fs::create_dir_all(home.path().join(".gemini/config")).unwrap();
        let env = Env::isolated(home.path());
        let canonical = home.path().join(".agents/skills");
        let agents = resolve(&env, &Settings::default(), &canonical);
        let claude = agents.iter().find(|a| a.id == "claude-code").unwrap();
        assert!(claude.detected && !claude.reads_canonical);
        assert_eq!(claude.install_dir, home.path().join(".claude/skills"));
        let codex = agents.iter().find(|a| a.id == "codex").unwrap();
        assert!(codex.detected && codex.reads_canonical);
        assert_eq!(codex.dirs, vec![home.path().join(".codex/skills")]);
        let ag = agents.iter().find(|a| a.id == "antigravity").unwrap();
        assert!(ag.detected);
        assert_eq!(ag.install_dir, home.path().join(".gemini/config/skills"));
        let cursor = agents.iter().find(|a| a.id == "cursor").unwrap();
        assert!(!cursor.detected);
    }
}

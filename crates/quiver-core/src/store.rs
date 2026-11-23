//! Persistent state:
//! - `~/.agents/.skill-lock.json`: shared with the vercel-labs `skills` CLI
//!   (v3 schema). Unknown fields are preserved verbatim.
//! - `~/.quiver/state.json`: Quiver-only data (non-GitHub sources, install
//!   hashes for local-edit detection, per-agent exclusions, update cache).
//! - `~/.quiver/settings.json`: user settings.

use crate::env::Env;
use crate::fsutil::write_atomic;
use crate::model::{Settings, SkillSource, UpdateInfo};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub const LOCK_VERSION: u64 = 3;

pub fn lock_path(env: &Env) -> PathBuf {
    match env.var("XDG_STATE_HOME") {
        Some(x) => PathBuf::from(x).join("skills/.skill-lock.json"),
        None => env.home.join(".agents/.skill-lock.json"),
    }
}

/// The shared skills lockfile, kept as raw JSON so foreign fields survive.
#[derive(Debug, Clone)]
pub struct Lock {
    path: PathBuf,
    root: Map<String, Value>,
}

impl Lock {
    pub fn load(env: &Env) -> Self {
        let path = lock_path(env);
        let root = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v {
                Value::Object(m)
                    if m.get("version").and_then(Value::as_u64).unwrap_or(0) >= LOCK_VERSION =>
                {
                    Some(m)
                }
                _ => None,
            })
            .unwrap_or_else(|| {
                let mut m = Map::new();
                m.insert("version".into(), json!(LOCK_VERSION));
                m.insert("skills".into(), json!({}));
                m
            });
        Self { path, root }
    }

    fn skills(&self) -> Option<&Map<String, Value>> {
        self.root.get("skills").and_then(Value::as_object)
    }

    fn skills_mut(&mut self) -> &mut Map<String, Value> {
        if !self.root.get("skills").is_some_and(Value::is_object) {
            self.root.insert("skills".into(), json!({}));
        }
        self.root
            .get_mut("skills")
            .and_then(Value::as_object_mut)
            .expect("skills map")
    }

    pub fn entry(&self, id: &str) -> Option<LockEntry> {
        let v = self.skills()?.get(id)?;
        serde_json::from_value(v.clone()).ok()
    }

    pub fn ids(&self) -> Vec<String> {
        self.skills()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Insert or update an entry, keeping any unknown fields already present.
    pub fn upsert(&mut self, id: &str, entry: &LockEntry) {
        let new = serde_json::to_value(entry).unwrap_or(Value::Null);
        let skills = self.skills_mut();
        match (skills.get_mut(id), new) {
            (Some(Value::Object(existing)), Value::Object(fields)) => {
                for (k, v) in fields {
                    if !v.is_null() {
                        existing.insert(k, v);
                    }
                }
            }
            (_, new) => {
                skills.insert(id.to_string(), new);
            }
        }
    }

    pub fn remove(&mut self, id: &str) -> bool {
        self.skills_mut().remove(id).is_some()
    }

    pub fn save(&self) -> Result<()> {
        let text = serde_json::to_string_pretty(&Value::Object(self.root.clone()))?;
        write_atomic(&self.path, text.as_bytes())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LockEntry {
    pub source: String,
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_path: Option<String>,
    /// For GitHub sources: git tree SHA of the skill folder.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub skill_folder_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

impl LockEntry {
    pub fn to_source(&self) -> SkillSource {
        SkillSource {
            kind: if self.source_type == "github" {
                "github".into()
            } else {
                self.source_type.clone()
            },
            source: self.source.clone(),
            url: self.source_url.clone(),
            skill_path: self.skill_path.clone(),
            git_ref: None,
            installed_at: self.installed_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SkillState {
    /// Source for skills not tracked in the shared lock (local, git, zip),
    /// or extra info (ref) for GitHub ones.
    pub source: Option<SkillSource>,
    /// Content hash right after the last install/update.
    pub installed_hash: Option<String>,
    /// Upstream revision at install time (git commit for git sources, folder
    /// tree sha for GitHub, content hash for local sources).
    pub revision: Option<String>,
    /// Agents the user explicitly unlinked; sync never re-links these.
    pub excluded_agents: Vec<String>,
    /// Upstream source this skill was forked from ("Make it mine").
    pub forked_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    pub skills: BTreeMap<String, SkillState>,
    pub updates: Vec<UpdateInfo>,
    pub updates_checked_ms: i64,
    /// Agents seen as detected on the previous scan (for auto-link of new agents).
    pub known_agents: Vec<String>,
}

pub fn data_dir(env: &Env) -> PathBuf {
    env.home.join(".quiver")
}

impl State {
    pub fn load(env: &Env) -> Self {
        read_json(&data_dir(env).join("state.json")).unwrap_or_default()
    }
    pub fn save(&self, env: &Env) -> Result<()> {
        write_atomic(
            &data_dir(env).join("state.json"),
            serde_json::to_string_pretty(self)?.as_bytes(),
        )
    }
    pub fn skill_mut(&mut self, id: &str) -> &mut SkillState {
        self.skills.entry(id.to_string()).or_default()
    }
}

pub fn load_settings(env: &Env) -> Settings {
    read_json(&data_dir(env).join("settings.json")).unwrap_or_default()
}

pub fn save_settings(env: &Env, settings: &Settings) -> Result<()> {
    let mut s = settings.clone();
    s.github_token_source = None;
    let mut v = serde_json::to_value(&s)?;
    if let Some(m) = v.as_object_mut() {
        m.remove("githubTokenSource");
    }
    write_atomic(
        &data_dir(env).join("settings.json"),
        serde_json::to_string_pretty(&v)?.as_bytes(),
    )
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &std::path::Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---------- GitHub token ----------
// Kept in the OS credential store: the macOS Keychain or Windows Credential Manager.

const KEYCHAIN_SERVICE: &str = "dev.quiver.app";
const KEYCHAIN_ACCOUNT: &str = "github-token";

pub fn keychain_get() -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .ok()?
        .get_password()
        .ok()
        .filter(|t| !t.is_empty())
}

pub fn keychain_set(token: Option<&str>) -> Result<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)?;
    match token.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => entry.set_password(t)?,
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.into()),
        },
    }
    Ok(())
}

/// Resolve a GitHub token: Keychain → GITHUB_TOKEN/GH_TOKEN → `gh auth token`.
/// Returns (token, source label).
pub fn github_token(env: &Env) -> Option<(String, &'static str)> {
    if !env.probe_system {
        return None;
    }
    if let Some(t) = keychain_get() {
        return Some((t, "keychain"));
    }
    for k in ["GITHUB_TOKEN", "GH_TOKEN"] {
        if let Some(t) = env.var(k) {
            return Some((t.to_string(), "env"));
        }
    }
    gh_cli_token(env).map(|t| (t, "gh"))
}

fn gh_cli_token(env: &Env) -> Option<String> {
    // GUI apps get a minimal PATH on macOS, so probe the usual install locations too.
    let name = if cfg!(windows) { "gh.exe" } else { "gh" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(unix)]
    candidates
        .extend(["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].map(PathBuf::from));
    #[cfg(windows)]
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = env.var(var) {
            candidates.push(std::path::Path::new(root).join(r"GitHub CLI\gh.exe"));
        }
    }
    if let Some(path) = env.var("PATH") {
        candidates.extend(std::env::split_paths(path).map(|p| p.join(name)));
    }
    let gh = candidates.into_iter().find(|p| p.is_file())?;
    let out = crate::proc::command(gh)
        .args(["auth", "token"])
        .output()
        .ok()?;
    let t = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !t.is_empty()).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_preserves_unknown_fields() {
        let home = tempfile::tempdir().unwrap();
        let env = Env::isolated(home.path());
        let p = lock_path(&env);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, r#"{"version":3,"skills":{"a":{"source":"o/r","sourceType":"github","skillFolderHash":"x","pluginName":"keep"}},"dismissed":{"k":1}}"#).unwrap();
        let mut lock = Lock::load(&env);
        let mut e = lock.entry("a").unwrap();
        e.skill_folder_hash = "y".into();
        lock.upsert("a", &e);
        lock.upsert(
            "b",
            &LockEntry {
                source: "o/r".into(),
                source_type: "github".into(),
                ..Default::default()
            },
        );
        lock.save().unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["skills"]["a"]["pluginName"], "keep");
        assert_eq!(v["skills"]["a"]["skillFolderHash"], "y");
        assert_eq!(v["dismissed"]["k"], 1);
        assert!(v["skills"]["b"].is_object());
    }
}

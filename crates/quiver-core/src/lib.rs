//! Quiver core: one skill library for every AI coding agent.
//!
//! Skills live once in the canonical store (`~/.agents/skills`, the location
//! shared with the `skills` CLI and read natively by Codex, Cline, Warp, Zed,
//! Pi and others). Every other agent gets a link in its own skills folder: a
//! symlink on macOS and Linux, a junction on Windows (see [`fsutil`]).

pub mod agents;
pub mod env;
pub mod fsutil;
pub mod github;
mod mine;
pub mod model;
mod ops;
pub mod proc;
pub mod scan;
pub mod search;
pub mod skill;
pub mod source;
pub mod sources;
pub mod store;
mod updates;

pub use env::Env;
pub use model::*;
pub use source::Session;

use std::path::PathBuf;

/// Entry point for all operations. Cheap to construct; holds no open handles.
#[derive(Debug, Clone)]
pub struct Quiver {
    pub env: Env,
    pub settings: Settings,
}

impl Quiver {
    /// Quiver for the current user.
    pub fn system() -> Self {
        Self::with_env(Env::system())
    }

    pub fn with_env(env: Env) -> Self {
        let settings = store::load_settings(&env);
        Self { env, settings }
    }

    pub fn reload_settings(&mut self) {
        self.settings = store::load_settings(&self.env);
    }

    pub fn save_settings(&mut self, settings: Settings) -> anyhow::Result<()> {
        store::save_settings(&self.env, &settings)?;
        self.settings = settings;
        Ok(())
    }

    /// Settings with the read-only token source filled in.
    pub fn settings_view(&self) -> Settings {
        let mut s = self.settings.clone();
        s.github_token_source = store::github_token(&self.env).map(|(_, src)| src.to_string());
        s
    }

    /// The canonical store, `~/.agents/skills`.
    pub fn canonical_dir(&self) -> PathBuf {
        self.env.home.join(".agents/skills")
    }

    /// Fallback location for "trashed" items when no system Trash exists.
    pub fn backup_dir(&self) -> PathBuf {
        store::data_dir(&self.env).join("trash")
    }

    pub fn agents(&self) -> Vec<agents::Agent> {
        agents::resolve(&self.env, &self.settings, &self.canonical_dir())
    }

    pub fn scan(&self) -> Inventory {
        scan::scan(self)
    }

    pub fn detail(&self, id: &str) -> anyhow::Result<SkillDetail> {
        scan::detail(self, id)
    }

    pub fn read_file(&self, id: &str, path: &str) -> anyhow::Result<String> {
        scan::read_file(self, id, path)
    }

    pub fn search(&self, query: &str) -> anyhow::Result<Vec<SearchResult>> {
        let installed: Vec<String> = scan::raw_scan(self).by_id.keys().cloned().collect();
        search::search(query, &installed)
    }

    /// Every directory the app should watch for changes.
    pub fn watch_dirs(&self) -> Vec<PathBuf> {
        let mut v = vec![self.canonical_dir()];
        if self.my_dir().is_dir() {
            v.push(self.my_dir());
        }
        for a in self.agents().iter().filter(|a| a.detected) {
            v.extend(a.dirs.iter().cloned());
        }
        v.sort();
        v.dedup();
        v
    }
}

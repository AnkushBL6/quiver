//! Mutating operations on the canonical store and agent dirs.
//!
//! Invariants:
//! - The canonical store (`~/.agents/skills/<id>`) is the single source of truth.
//! - Agent dirs only ever receive links (symlinks, or junctions on Windows) or,
//!   in copy mode, copies of it.
//! - Nothing user-authored is deleted outright: real folders go to the Trash.

use crate::Quiver;
use crate::agents::{Agent, normalize};
use crate::fsutil::{self, Entry, entry};
use crate::model::*;
use crate::scan::{Raw, RawLoc, raw_scan};
use crate::skill;
use crate::store::{Lock, State};
use anyhow::{Context, Result, anyhow, bail};
use std::path::{Path, PathBuf};

impl Quiver {
    fn agent<'a>(&self, raw: &'a Raw, agent_id: &str) -> Result<&'a Agent> {
        raw.agents
            .iter()
            .find(|a| a.id == agent_id)
            .ok_or_else(|| anyhow!("unknown agent `{agent_id}`"))
    }

    /// Agents a skill is linked to by default (settings, else all active).
    pub fn default_agents(&self, agents: &[Agent]) -> Vec<String> {
        let active = agents.iter().filter(|a| a.active());
        if self.settings.default_agents.is_empty() {
            active.map(|a| a.id.clone()).collect()
        } else {
            active
                .filter(|a| self.settings.default_agents.contains(&a.id))
                .map(|a| a.id.clone())
                .collect()
        }
    }

    /// Make one skill visible (`enabled`) or invisible to one agent.
    pub fn set_link(&self, id: &str, agent_id: &str, enabled: bool) -> Result<()> {
        let mut raw = raw_scan(self);
        let agent = self.agent(&raw, agent_id)?.clone();
        let locs = raw.by_id.get(id).cloned().unwrap_or_default();
        anyhow::ensure!(!locs.is_empty(), "skill `{id}` not found");
        anyhow::ensure!(
            !locs.iter().all(|l| l.kind == LocationKind::Plugin),
            "`{id}` is provided by a plugin and can't be changed here"
        );

        if !locs.iter().any(|l| l.kind == LocationKind::Canonical) {
            // Bring it under management first so nothing is lost.
            self.adopt_inner(&raw, id, None, false)?;
            raw = raw_scan(self);
        }
        let mut state = State::load(&self.env);
        if enabled {
            state
                .skill_mut(id)
                .excluded_agents
                .retain(|a| a != agent_id);
            self.link_one(&raw, id, &agent)?;
        } else {
            anyhow::ensure!(
                !agent.reads_canonical,
                "{} reads ~/.agents/skills directly, so it sees every managed skill. Remove the skill to hide it.",
                agent.name
            );
            let ex = &mut state.skill_mut(id).excluded_agents;
            if !ex.iter().any(|a| a == agent_id) {
                ex.push(agent_id.to_string());
            }
            self.unlink_one(&raw, id, &agent)?;
        }
        state.save(&self.env)
    }

    /// Link to / unlink from every active agent.
    pub fn set_link_all(&self, id: &str, enabled: bool) -> Result<OpReport> {
        let raw = raw_scan(self);
        let mut report = OpReport::default();
        for a in raw
            .agents
            .iter()
            .filter(|a| a.active() && !a.reads_canonical)
        {
            match self.set_link(id, &a.id, enabled) {
                Ok(()) => report.ok.push(a.id.clone()),
                Err(e) => report.errors.push(OpMessage {
                    id: a.id.clone(),
                    message: format!("{e:#}"),
                }),
            }
        }
        Ok(report)
    }

    /// Link/unlink many skills for one agent (Matrix column toggle).
    pub fn set_link_agent(&self, agent_id: &str, ids: &[String], enabled: bool) -> OpReport {
        let mut report = OpReport::default();
        for id in ids {
            match self.set_link(id, agent_id, enabled) {
                Ok(()) => report.ok.push(id.clone()),
                Err(e) => report.errors.push(OpMessage {
                    id: id.clone(),
                    message: format!("{e:#}"),
                }),
            }
        }
        report
    }

    /// Create the agent entry for a managed skill.
    pub(crate) fn link_one(&self, raw: &Raw, id: &str, agent: &Agent) -> Result<()> {
        if agent.reads_canonical {
            return Ok(());
        }
        let src = raw.canonical.join(id);
        anyhow::ensure!(src.exists(), "`{id}` is not in the canonical store");
        let dest = agent.install_dir.join(id);
        let src_real = normalize(&src);
        match entry(&dest) {
            Entry::Missing => {}
            Entry::Link { resolves: true, .. } if normalize(&dest) == src_real => {
                if agent.link_mode == LinkMode::Symlink {
                    return Ok(());
                }
                fsutil::remove_link(&dest)?;
            }
            Entry::Link {
                resolves: false, ..
            } => fsutil::remove_link(&dest)?,
            Entry::Link { .. } | Entry::Dir => {
                if normalize(&dest) == src_real {
                    // Canonical is itself a link to this folder: flip ownership first.
                    bail!(
                        "`{id}` in {} is the canonical copy's source; run Make universal to normalize it",
                        agent.name
                    );
                }
                let same = skill::folder_hash(&dest) == skill::folder_hash(&src);
                if !same {
                    bail!(
                        "{} already has a different `{id}` at {}. Resolve the conflict in Health first.",
                        agent.name,
                        self.env.display(&dest)
                    );
                }
                if agent.link_mode == LinkMode::Copy && matches!(entry(&dest), Entry::Dir) {
                    return Ok(());
                }
                self.discard(&dest)?;
            }
            Entry::File => bail!("{} exists and is a file", self.env.display(&dest)),
        }
        match agent.link_mode {
            LinkMode::Symlink => fsutil::link_or_copy_dir(&src, &dest),
            LinkMode::Copy => fsutil::copy_dir(&src_real, &dest),
        }
    }

    /// Remove the skill from every dir this agent reads (links removed, copies trashed).
    fn unlink_one(&self, raw: &Raw, id: &str, agent: &Agent) -> Result<()> {
        let canonical_real = normalize(&raw.canonical.join(id));
        for l in raw
            .by_id
            .get(id)
            .into_iter()
            .flatten()
            .filter(|l| l.agents.contains(&agent.id))
        {
            match l.kind {
                LocationKind::Link | LocationKind::Broken | LocationKind::ForeignLink => {
                    fsutil::remove_link(&l.path)?
                }
                LocationKind::Directory => {
                    anyhow::ensure!(
                        l.real.as_ref() != Some(&canonical_real),
                        "the canonical copy of `{id}` lives in {}; run Make universal first",
                        agent.name
                    );
                    self.discard(&l.path)?;
                }
                LocationKind::Canonical | LocationKind::Plugin => {}
            }
        }
        Ok(())
    }

    pub(crate) fn discard(&self, path: &Path) -> Result<()> {
        fsutil::trash(path, &self.backup_dir())
    }

    /// "Make universal": move the skill into the canonical store, replace
    /// identical copies with links, and link it to the default agents.
    /// `from` chooses which copy wins when copies conflict.
    pub fn adopt(&self, id: &str, from: Option<&Path>) -> Result<()> {
        let raw = raw_scan(self);
        self.adopt_inner(&raw, id, from, true)
    }

    fn adopt_inner(
        &self,
        raw: &Raw,
        id: &str,
        from: Option<&Path>,
        link_defaults: bool,
    ) -> Result<()> {
        let locs: Vec<RawLoc> = raw
            .by_id
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("skill `{id}` not found"))?;
        anyhow::ensure!(
            !locs.iter().all(|l| l.kind == LocationKind::Plugin),
            "`{id}` is provided by a plugin"
        );
        anyhow::ensure!(
            skill::name_error(id).is_none() || !id.contains('/'),
            "invalid skill id `{id}`"
        );
        let canonical_path = raw.canonical.join(id);
        let canonical_loc = locs.iter().find(|l| l.kind == LocationKind::Canonical);

        // Choose the winning real directory.
        let winner_real: PathBuf = match from {
            Some(p) => {
                let p_norm = normalize(p);
                locs.iter()
                    .find(|l| l.real.as_ref() == Some(&p_norm) || l.path == p)
                    .and_then(|l| l.real.clone())
                    .ok_or_else(|| anyhow!("{} is not a copy of `{id}`", p.display()))?
            }
            None => match canonical_loc.and_then(|c| c.real.clone()) {
                Some(r) => r,
                None => {
                    let mut reals: Vec<&PathBuf> = locs
                        .iter()
                        .filter(|l| l.kind != LocationKind::Plugin)
                        .filter_map(|l| l.real.as_ref())
                        .collect();
                    reals.sort();
                    reals.dedup();
                    let mut hashes: Vec<Option<String>> =
                        reals.iter().map(|r| skill::folder_hash(r)).collect();
                    hashes.dedup();
                    match (reals.first(), hashes.len()) {
                        (None, _) => bail!("`{id}` has no readable copy (all links are broken)"),
                        (Some(r), 1) => (*r).clone(),
                        _ => bail!(
                            "`{id}` has {} different versions; choose which one to keep",
                            hashes.len()
                        ),
                    }
                }
            },
        };

        let agent_dirs: Vec<PathBuf> = raw
            .agents
            .iter()
            .flat_map(|a| a.dirs.iter().map(|d| normalize(d)))
            .collect();
        let inside_agent_dir = |p: &Path| {
            p.parent()
                .is_some_and(|parent| agent_dirs.contains(&normalize(parent)))
        };
        let current_canonical_real = canonical_loc.and_then(|c| c.real.clone());
        let winner_hash = skill::folder_hash(&winner_real);

        // Classify every agent-side location BEFORE anything moves.
        #[derive(PartialEq)]
        enum Fate {
            Keep,
            Relink,
            Prune,
        }
        let plan: Vec<(&RawLoc, Fate)> = locs
            .iter()
            .filter(|l| !matches!(l.kind, LocationKind::Canonical | LocationKind::Plugin))
            .map(|l| {
                let fate = match l.kind {
                    LocationKind::Broken => Fate::Prune,
                    // Links into the store keep working once the winner is installed there.
                    LocationKind::Link => Fate::Keep,
                    _ if l.kind == LocationKind::Directory
                        && l.real.as_ref() == Some(&winner_real) =>
                    {
                        Fate::Keep
                    }
                    _ => {
                        let same = l.real.as_ref() == Some(&winner_real)
                            || (current_canonical_real.is_some()
                                && l.real == current_canonical_real
                                && from.is_none())
                            || l.real.as_deref().and_then(skill::folder_hash) == winner_hash;
                        let copy_mode = raw
                            .agents
                            .iter()
                            .any(|a| l.agents.contains(&a.id) && a.link_mode == LinkMode::Copy);
                        if same && copy_mode && l.kind == LocationKind::Directory {
                            Fate::Keep
                        } else if same || from.is_some() {
                            // An explicit choice replaces divergent copies too (they go to the Trash).
                            Fate::Relink
                        } else {
                            Fate::Keep
                        }
                    }
                };
                (l, fate)
            })
            .collect();

        let needs_install = current_canonical_real.as_ref() != Some(&winner_real)
            || canonical_loc.is_some_and(|c| c.target.is_some() && inside_agent_dir(&winner_real));
        if needs_install {
            std::fs::create_dir_all(&raw.canonical)?;
            let staging = raw.canonical.join(format!(".quiver-adopt-{id}"));
            match entry(&staging) {
                Entry::Missing => {}
                Entry::Link { .. } => fsutil::remove_link(&staging)?,
                _ => std::fs::remove_dir_all(&staging)?,
            }
            let moved = inside_agent_dir(&winner_real);
            if moved {
                // A real folder in an agent dir: move it (keeps permissions, git metadata).
                fsutil::move_path(&winner_real, &staging)
                    .with_context(|| format!("moving {}", winner_real.display()))?;
            } else {
                // Lives elsewhere (a dev checkout, an old canonical target): keep it live via a link.
                fsutil::symlink_dir_abs(&winner_real, &staging)?;
            }
            match entry(&canonical_path) {
                Entry::Missing => {}
                Entry::Link { .. } => fsutil::remove_link(&canonical_path)?,
                _ => self.discard(&canonical_path)?,
            }
            std::fs::rename(&staging, &canonical_path)
                .context("installing into the canonical store")?;
            if moved {
                // Leave a link where the folder used to be.
                fsutil::link_or_copy_dir(&canonical_path, &winner_real)?;
            }
        }

        for (l, fate) in &plan {
            match fate {
                Fate::Keep => {}
                Fate::Prune => fsutil::remove_link(&l.path)?,
                Fate::Relink => {
                    match entry(&l.path) {
                        Entry::Link { .. } => fsutil::remove_link(&l.path)?,
                        Entry::Dir => self.discard(&l.path)?,
                        _ => {}
                    }
                    fsutil::link_or_copy_dir(&canonical_path, &l.path)?;
                }
            }
        }
        let canon_hash = skill::folder_hash(&normalize(&canonical_path));

        let mut state = State::load(&self.env);
        let st = state.skill_mut(id);
        if st.installed_hash.is_none() {
            st.installed_hash = canon_hash.clone();
        }
        state.save(&self.env)?;

        if link_defaults {
            let raw = raw_scan(self);
            let excluded = state
                .skills
                .get(id)
                .map(|s| s.excluded_agents.clone())
                .unwrap_or_default();
            for agent_id in self.default_agents(&raw.agents) {
                if excluded.contains(&agent_id) {
                    continue;
                }
                let agent = self.agent(&raw, &agent_id)?;
                // Best effort: a conflicting copy in one agent shouldn't block the rest.
                let _ = self.link_one(&raw, id, agent);
            }
        }
        Ok(())
    }

    /// Remove a skill everywhere. Real folders go to the Trash; links are deleted;
    /// a canonical entry that links to an outside folder is unlinked, not trashed.
    pub fn remove(&self, id: &str) -> Result<()> {
        let raw = raw_scan(self);
        let locs = raw
            .by_id
            .get(id)
            .ok_or_else(|| anyhow!("skill `{id}` not found"))?;
        anyhow::ensure!(
            !locs.iter().all(|l| l.kind == LocationKind::Plugin),
            "`{id}` is provided by a plugin; uninstall the plugin instead"
        );
        // The user's own skill: its folder in My Skills goes too (to the Trash),
        // otherwise the next sync would register it again.
        let my_norm = self.my_norm();
        let mine_dir = locs
            .iter()
            .find(|l| l.kind == LocationKind::Canonical)
            .and_then(|l| l.real.clone())
            .filter(|r| crate::mine::is_mine_path(my_norm.as_deref(), r));
        // Links first, then real folders (so links never dangle into the Trash).
        for l in locs.iter().filter(|l| l.kind != LocationKind::Plugin) {
            if matches!(entry(&l.path), Entry::Link { .. }) {
                fsutil::remove_link(&l.path)?;
            }
        }
        for l in locs
            .iter()
            .filter(|l| matches!(l.kind, LocationKind::Directory | LocationKind::Canonical))
        {
            if matches!(entry(&l.path), Entry::Dir) {
                self.discard(&l.path)?;
            }
        }
        if let Some(dir) = mine_dir {
            self.discard(&dir)?;
        }
        let mut lock = Lock::load(&self.env);
        if lock.remove(id) {
            lock.save()?;
        }
        let mut state = State::load(&self.env);
        state.skills.remove(id);
        state.updates.retain(|u| u.id != id);
        state.save(&self.env)
    }

    /// Scaffold a new skill in the canonical store and link it.
    pub fn create(&self, id: &str, description: &str) -> Result<()> {
        if let Some(e) = skill::name_error(id) {
            bail!("invalid skill name: {e}");
        }
        let link = self.canonical_dir().join(id);
        anyhow::ensure!(
            matches!(entry(&link), Entry::Missing),
            "a skill named `{id}` already exists"
        );
        // New skills are the user's own: written into My Skills, linked into the store.
        let my = self.ensure_my_dir()?;
        if !my.is_dir() {
            self.my_skills_init()?;
        }
        let dir = my.join(id);
        anyhow::ensure!(!dir.exists(), "{} already exists", self.env.display(&dir));
        fsutil::write_atomic(
            &dir.join(skill::SKILL_FILE),
            skill::template(id, description).as_bytes(),
        )?;
        fsutil::symlink_dir(&dir, &link)?;
        let raw = raw_scan(self);
        for agent_id in self.default_agents(&raw.agents) {
            let _ = self.link_one(&raw, id, self.agent(&raw, &agent_id)?);
        }
        Ok(())
    }

    /// What "sync everything" would change.
    pub fn sync_plan(&self) -> SyncPlan {
        let inv = crate::scan::scan(self);
        let raw = raw_scan(self);
        let state = State::load(&self.env);
        let defaults = self.default_agents(&raw.agents);
        let mut plan = SyncPlan {
            links: vec![],
            adopt: vec![],
            prune: vec![],
            conflicts: vec![],
            register: self.unregistered_mine(),
        };
        for s in inv.skills.iter().filter(|s| !s.read_only) {
            if s.issues.iter().any(|i| i.kind == IssueKind::Conflict) {
                plan.conflicts.push(s.id.clone());
            }
            for l in s
                .locations
                .iter()
                .filter(|l| l.kind == LocationKind::Broken)
            {
                plan.prune.push(l.path.clone());
            }
            if !s.managed {
                if !s.issues.iter().any(|i| i.kind == IssueKind::Conflict)
                    && s.primary_path.is_some()
                {
                    plan.adopt.push(s.id.clone());
                }
                continue;
            }
            let excluded = state
                .skills
                .get(&s.id)
                .map(|x| x.excluded_agents.as_slice())
                .unwrap_or(&[]);
            for p in &s.presence {
                if p.presence == Presence::Absent
                    && defaults.contains(&p.agent_id)
                    && !excluded.contains(&p.agent_id)
                {
                    plan.links.push((s.id.clone(), p.agent_id.clone()));
                }
            }
        }
        plan
    }

    pub fn sync_apply(&self, link: bool, adopt: bool, prune: bool) -> OpReport {
        let mut report = OpReport::default();
        let plan = self.sync_plan();
        let mut record = |id: String, r: Result<()>| match r {
            Ok(()) => report.ok.push(id),
            Err(e) => report.errors.push(OpMessage {
                id,
                message: format!("{e:#}"),
            }),
        };
        if prune {
            for path in &plan.prune {
                let p = Path::new(path);
                let r = if matches!(
                    entry(p),
                    Entry::Link {
                        resolves: false,
                        ..
                    }
                ) {
                    fsutil::remove_link(p)
                } else {
                    Ok(())
                };
                record(format!("prune:{}", self.env.display(p)), r);
            }
        }
        if adopt {
            match self.register_mine() {
                Ok(ids) => {
                    for i in ids {
                        record(format!("register:{i}"), Ok(()));
                    }
                }
                Err(e) => record("register".into(), Err(e)),
            }
            for id in &plan.adopt {
                record(format!("adopt:{id}"), self.adopt(id, None));
            }
        }
        if link {
            let raw = raw_scan(self);
            for (id, agent_id) in &plan.links {
                let r = self
                    .agent(&raw, agent_id)
                    .and_then(|a| self.link_one(&raw, id, a));
                record(format!("link:{id}→{agent_id}"), r);
            }
        }
        report
    }

    /// Universal mode: bring everything into line (adopt, link, prune) when
    /// anything is out of sync. Returns None when off or already in sync.
    /// Conflicting copies are never touched automatically.
    pub fn auto_sync(&self) -> Option<OpReport> {
        if !self.settings.universal {
            // New folders in My Skills are always registered; distribution
            // follows the default agents.
            let ids = self.register_mine().ok()?;
            return (!ids.is_empty()).then(|| OpReport {
                ok: ids.into_iter().map(|i| format!("register:{i}")).collect(),
                ..Default::default()
            });
        }
        let plan = self.sync_plan();
        if plan.adopt.is_empty()
            && plan.links.is_empty()
            && plan.prune.is_empty()
            && plan.register.is_empty()
        {
            return None;
        }
        Some(self.sync_apply(true, true, true))
    }

    /// Delete broken links of one skill.
    pub fn prune(&self, id: &str) -> Result<()> {
        let raw = raw_scan(self);
        for l in raw
            .by_id
            .get(id)
            .into_iter()
            .flatten()
            .filter(|l| l.kind == LocationKind::Broken)
        {
            fsutil::remove_link(&l.path)?;
        }
        Ok(())
    }

    /// Link every managed skill into agents that were not detected last time.
    /// Returns ids of newly detected agents.
    pub fn handle_new_agents(&self) -> Result<Vec<String>> {
        let raw = raw_scan(self);
        let mut state = State::load(&self.env);
        let active: Vec<String> = raw
            .agents
            .iter()
            .filter(|a| a.active())
            .map(|a| a.id.clone())
            .collect();
        let first_run = state.known_agents.is_empty();
        let new: Vec<String> = active
            .iter()
            .filter(|a| !state.known_agents.contains(a))
            .cloned()
            .collect();
        if !first_run && (self.settings.auto_link_new_agents || self.settings.universal) {
            for agent_id in &new {
                let agent = self.agent(&raw, agent_id)?;
                for (id, locs) in &raw.by_id {
                    if locs.iter().any(|l| l.kind == LocationKind::Canonical) {
                        let _ = self.link_one(&raw, id, agent);
                    }
                }
            }
        }
        if state.known_agents != active {
            state.known_agents = active;
            state.save(&self.env)?;
        }
        Ok(if first_run { vec![] } else { new })
    }
}

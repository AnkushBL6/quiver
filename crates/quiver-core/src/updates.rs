//! Update checks and updates.
//! GitHub: compare the skill folder's git tree SHA (one API call per repo).
//! Git: `git ls-remote` commit. Local: content hash of the source folder.

use crate::Quiver;
use crate::agents::normalize;
use crate::fsutil::{Entry, entry};
use crate::github::Tree;
use crate::model::*;
use crate::scan::raw_scan;
use crate::skill;
use crate::source::git_remote_head;
use crate::store::{Lock, State, now_iso, now_ms};
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::PathBuf;

struct Tracked {
    id: String,
    source: SkillSource,
    current: Option<String>,
    installed_hash: Option<String>,
    live_link: bool,
}

impl Quiver {
    fn tracked(&self) -> Vec<Tracked> {
        let raw = raw_scan(self);
        let lock = Lock::load(&self.env);
        let state = State::load(&self.env);
        let my_norm = self.my_norm();
        raw.by_id
            .iter()
            .filter_map(|(id, locs)| {
                let canon = locs.iter().find(|l| l.kind == LocationKind::Canonical)?;
                // The user's own skills are never updated from anywhere.
                if canon
                    .real
                    .as_ref()
                    .is_some_and(|r| crate::mine::is_mine_path(my_norm.as_deref(), r))
                {
                    return None;
                }
                let st = state.skills.get(id);
                let lock_entry = lock.entry(id);
                let source = match (&lock_entry, st.and_then(|s| s.source.clone())) {
                    (Some(e), extra) => {
                        let mut s = e.to_source();
                        s.git_ref = extra.and_then(|x| x.git_ref);
                        s
                    }
                    (None, Some(s)) => s,
                    (None, None) => SkillSource {
                        kind: "unknown".into(),
                        ..Default::default()
                    },
                };
                let current = lock_entry
                    .map(|e| e.skill_folder_hash)
                    .filter(|h| !h.is_empty())
                    .or_else(|| st.and_then(|s| s.revision.clone()));
                Some(Tracked {
                    id: id.clone(),
                    source,
                    current,
                    installed_hash: st.and_then(|s| s.installed_hash.clone()),
                    live_link: canon.target.is_some(),
                })
            })
            .collect()
    }

    /// Check every managed skill for updates. Uses the cache unless `force`
    /// or the cache is older than the configured interval.
    pub fn check_updates(&self, force: bool) -> Vec<UpdateInfo> {
        let mut state = State::load(&self.env);
        let max_age = i64::from(self.settings.check_interval_hours.max(1)) * 3_600_000;
        let tracked = self.tracked();
        if !force && now_ms() - state.updates_checked_ms < max_age && !state.updates.is_empty() {
            return state
                .updates
                .iter()
                .filter(|u| tracked.iter().any(|t| t.id == u.id))
                .cloned()
                .collect();
        }

        // One tree fetch per (repo, ref).
        let gh = self.github();
        let mut repos: Vec<(String, String)> = tracked
            .iter()
            .filter(|t| t.source.kind == "github" && !t.live_link)
            .map(|t| {
                (
                    t.source.source.clone(),
                    t.source.git_ref.clone().unwrap_or_else(|| "HEAD".into()),
                )
            })
            .collect();
        repos.sort();
        repos.dedup();
        let trees: HashMap<(String, String), Result<Tree, String>> = repos
            .par_iter()
            .map(|k| (k.clone(), gh.tree(&k.0, &k.1).map_err(|e| format!("{e:#}"))))
            .collect();

        let canonical = self.canonical_dir();
        let checked_at_ms = now_ms();
        let infos: Vec<UpdateInfo> = tracked
            .par_iter()
            .map(|t| {
                let mut info = UpdateInfo {
                    id: t.id.clone(),
                    status: UpdateStatus::Untracked,
                    source: (!t.source.source.is_empty()).then(|| t.source.source.clone()),
                    current: t.current.clone(),
                    latest: None,
                    locally_modified: false,
                    message: None,
                    checked_at_ms,
                };
                if t.live_link {
                    info.message = Some("Linked live to a folder on disk; it updates when that folder changes.".into());
                    return info;
                }
                let dir = normalize(&canonical.join(&t.id));
                if let Some(h) = &t.installed_hash {
                    info.locally_modified = skill::folder_hash(&dir).as_ref() != Some(h);
                }
                let folder = t.source.skill_path.as_deref().unwrap_or("").trim_end_matches("SKILL.md").trim_end_matches('/').to_string();
                let mut moved: Option<String> = None;
                let latest: Result<Option<String>, String> = match t.source.kind.as_str() {
                    "github" => {
                        let key = (t.source.source.clone(), t.source.git_ref.clone().unwrap_or_else(|| "HEAD".into()));
                        match trees.get(&key) {
                            Some(Ok(tree)) => match tree.locate(&folder) {
                                Some(f) if f == folder => Ok(tree.folder_sha(&f)),
                                Some(f) => {
                                    moved = Some(f.clone());
                                    Ok(tree.folder_sha(&f))
                                }
                                None => Err(format!("Removed upstream from {} (`{folder}`). Your installed copy keeps working.", t.source.source)),
                            },
                            Some(Err(e)) => Err(e.clone()),
                            None => Ok(None),
                        }
                    }
                    "git" => git_remote_head(t.source.url.as_deref().unwrap_or(&t.source.source), t.source.git_ref.as_deref()).map(Some).map_err(|e| format!("{e:#}")),
                    "local" => {
                        let src = PathBuf::from(&t.source.source).join(&folder);
                        if src.exists() { Ok(skill::folder_hash(&src)) } else { Err(format!("source folder {} is gone", src.display())) }
                    }
                    _ => Ok(None),
                };
                match latest {
                    Ok(Some(l)) => {
                        info.status = if Some(&l) == t.current.as_ref() { UpdateStatus::UpToDate } else { UpdateStatus::Available };
                        if t.current.is_none() {
                            info.status = UpdateStatus::Available;
                            info.message = Some("Installed version unknown; updating will sync it with the source.".into());
                        }
                        info.latest = Some(l);
                        if let Some(m) = &moved {
                            info.status = UpdateStatus::Available;
                            info.message = Some(format!("Moved upstream to `{m}`; updating follows the move."));
                        }
                    }
                    Ok(None) => {
                        info.message = Some("No source recorded. Reinstall from a repo to get updates.".into());
                    }
                    Err(e) => {
                        info.status = UpdateStatus::Error;
                        info.message = Some(e);
                    }
                }
                info
            })
            .collect();

        state.updates = infos.clone();
        state.updates_checked_ms = checked_at_ms;
        let _ = state.save(&self.env);
        infos
    }

    /// Update skills to their latest upstream version. Skips locally modified
    /// skills unless `force`.
    pub fn update(&self, ids: &[String], force: bool) -> OpReport {
        let mut report = OpReport::default();
        let tracked = self.tracked();
        let infos = self.check_updates(false);
        let gh = self.github();
        let mut trees: HashMap<(String, String), Tree> = HashMap::new();
        let mut lock = Lock::load(&self.env);
        let mut state = State::load(&self.env);

        for id in ids {
            let Some(t) = tracked.iter().find(|t| &t.id == id) else {
                report.errors.push(OpMessage {
                    id: id.clone(),
                    message: "not a managed skill".into(),
                });
                continue;
            };
            let dir = self.canonical_dir().join(id);
            let modified = t
                .installed_hash
                .as_ref()
                .is_some_and(|h| skill::folder_hash(&normalize(&dir)).as_ref() != Some(h))
                || infos.iter().any(|u| &u.id == id && u.locally_modified);
            if modified && !force {
                report.skipped.push(OpMessage { id: id.clone(), message: format!("has local edits; update with force to overwrite (old version goes to the {})", crate::fsutil::TRASH_NAME) });
                continue;
            }
            if t.live_link || matches!(entry(&dir), Entry::Link { .. }) {
                report.skipped.push(OpMessage {
                    id: id.clone(),
                    message: "linked live to a local folder".into(),
                });
                continue;
            }
            let tree = if t.source.kind == "github" {
                let key = (
                    t.source.source.clone(),
                    t.source.git_ref.clone().unwrap_or_else(|| "HEAD".into()),
                );
                if !trees.contains_key(&key) {
                    match gh.tree(&key.0, &key.1) {
                        Ok(tr) => {
                            trees.insert(key.clone(), tr);
                        }
                        Err(e) => {
                            report.errors.push(OpMessage {
                                id: id.clone(),
                                message: format!("{e:#}"),
                            });
                            continue;
                        }
                    }
                }
                trees.get(&key)
            } else {
                None
            };
            // Follow upstream folder moves.
            let mut source = t.source.clone();
            if let (Some(tree), Some(sp)) = (tree, source.skill_path.clone()) {
                let folder = sp
                    .trim_end_matches("SKILL.md")
                    .trim_end_matches('/')
                    .to_string();
                if let Some(f) = tree.locate(&folder).filter(|f| *f != folder) {
                    source.skill_path = Some(if f.is_empty() {
                        "SKILL.md".into()
                    } else {
                        format!("{f}/SKILL.md")
                    });
                }
            }
            match self.reinstall_from(id, &source, tree) {
                Ok(revision) => {
                    let st = state.skill_mut(id);
                    st.installed_hash = skill::folder_hash(&dir);
                    st.revision = Some(revision.clone());
                    if t.source.kind == "github" {
                        if let Some(mut e) = lock.entry(id) {
                            e.skill_folder_hash = revision;
                            e.skill_path = source.skill_path.clone();
                            e.updated_at = Some(now_iso());
                            lock.upsert(id, &e);
                        }
                    } else if let Some(s) = st.source.as_mut() {
                        s.updated_at = Some(now_iso());
                    }
                    state.updates.retain(|u| &u.id != id);
                    report.ok.push(id.clone());
                }
                Err(e) => report.errors.push(OpMessage {
                    id: id.clone(),
                    message: format!("{e:#}"),
                }),
            }
        }
        let _ = lock.save();
        let _ = state.save(&self.env);
        let raw = raw_scan(self);
        for id in &report.ok {
            self.refresh_copies(&raw, id);
        }
        report
    }
}

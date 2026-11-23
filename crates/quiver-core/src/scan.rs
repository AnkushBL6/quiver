//! Inventory scan: walks the canonical store and every agent's skill dirs and
//! reconciles them into one list of skills with per-agent presence.

use crate::Quiver;
use crate::agents::{Agent, normalize};
use crate::fsutil::{Entry, entry, link_target_abs};
use crate::model::*;
use crate::skill;
use crate::store::{Lock, State, now_ms};
use rayon::prelude::*;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub(crate) struct RawLoc {
    pub path: PathBuf,
    /// Agents reading the directory this entry lives in (empty for canonical).
    pub agents: Vec<String>,
    pub kind: LocationKind,
    pub target: Option<PathBuf>,
    /// Real (canonicalized) directory holding the content, if it resolves.
    pub real: Option<PathBuf>,
    pub writable: bool,
    pub plugin: Option<String>,
}

/// Raw scan result before reconciliation; also used by mutating ops.
pub(crate) struct Raw {
    pub agents: Vec<Agent>,
    pub canonical: PathBuf,
    pub by_id: BTreeMap<String, Vec<RawLoc>>,
}

fn list_dir(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut v: Vec<_> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (!name.starts_with('.')).then(|| (name, e.path()))
        })
        .collect();
    v.sort();
    v
}

pub(crate) fn raw_scan(q: &Quiver) -> Raw {
    let canonical = q.canonical_dir();
    let canonical_norm = normalize(&canonical);
    let agents = q.agents();
    let mut by_id: BTreeMap<String, Vec<RawLoc>> = BTreeMap::new();

    // 1. Canonical store.
    for (name, path) in list_dir(&canonical) {
        match entry(&path) {
            Entry::Dir => {
                if skill::skill_file(&path).is_some()
                    || std::fs::read_dir(&path)
                        .map(|mut r| r.next().is_some())
                        .unwrap_or(false)
                {
                    by_id.entry(name).or_default().push(RawLoc {
                        real: Some(normalize(&path)),
                        path,
                        agents: vec![],
                        kind: LocationKind::Canonical,
                        target: None,
                        writable: true,
                        plugin: None,
                    });
                }
            }
            Entry::Link { target, resolves } => {
                let real = resolves.then(|| normalize(&path)).filter(|r| r.is_dir());
                by_id.entry(name).or_default().push(RawLoc {
                    kind: if real.is_some() {
                        LocationKind::Canonical
                    } else {
                        LocationKind::Broken
                    },
                    real,
                    path,
                    agents: vec![],
                    target: Some(target),
                    writable: true,
                    plugin: None,
                });
            }
            _ => {}
        }
    }

    // 2. Agent dirs (deduplicated; several agents may share one dir).
    let mut dir_agents: Vec<(PathBuf, Vec<String>, bool)> = Vec::new();
    for a in &agents {
        for d in &a.dirs {
            let n = normalize(d);
            let writable = *d == a.install_dir;
            match dir_agents.iter_mut().find(|(p, _, _)| normalize(p) == n) {
                Some((_, ids, w)) => {
                    ids.push(a.id.clone());
                    *w |= writable;
                }
                None => dir_agents.push((d.clone(), vec![a.id.clone()], writable)),
            }
        }
    }
    for (dir, ids, writable) in &dir_agents {
        for (name, path) in list_dir(dir) {
            let loc = match entry(&path) {
                Entry::Link { target, resolves } => {
                    let abs = link_target_abs(&path, &target);
                    let into_canonical = abs
                        .parent()
                        .map(normalize)
                        .is_some_and(|p| p == canonical_norm);
                    let key = if into_canonical {
                        abs.file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or(name.clone())
                    } else {
                        name.clone()
                    };
                    let real = resolves.then(|| normalize(&path)).filter(|r| r.is_dir());
                    let kind = match (&real, into_canonical) {
                        (None, _) => LocationKind::Broken,
                        (Some(_), true) => LocationKind::Link,
                        (Some(_), false) => LocationKind::ForeignLink,
                    };
                    if kind == LocationKind::ForeignLink
                        && real
                            .as_ref()
                            .is_some_and(|r| skill::skill_file(r).is_none())
                    {
                        continue;
                    }
                    (
                        key,
                        RawLoc {
                            path,
                            agents: ids.clone(),
                            kind,
                            target: Some(target),
                            real,
                            writable: *writable,
                            plugin: None,
                        },
                    )
                }
                Entry::Dir if skill::skill_file(&path).is_some() => (
                    name,
                    RawLoc {
                        real: Some(normalize(&path)),
                        path,
                        agents: ids.clone(),
                        kind: LocationKind::Directory,
                        target: None,
                        writable: *writable,
                        plugin: None,
                    },
                ),
                _ => continue,
            };
            by_id.entry(loc.0).or_default().push(loc.1);
        }
    }

    // 3. Plugin-provided skills (read-only).
    if q.settings.scan_plugins {
        for (plugin, agent_id, skills_dir) in plugin_skill_dirs(q, &agents) {
            for (name, path) in list_dir(&skills_dir) {
                if skill::skill_file(&path).is_none() {
                    continue;
                }
                by_id
                    .entry(format!("{plugin}:{name}"))
                    .or_default()
                    .push(RawLoc {
                        real: Some(normalize(&path)),
                        path,
                        agents: vec![agent_id.clone()],
                        kind: LocationKind::Plugin,
                        target: None,
                        writable: false,
                        plugin: Some(plugin.clone()),
                    });
            }
        }
    }

    Raw {
        agents,
        canonical,
        by_id,
    }
}

/// (plugin name, skills dir) for the enabled plugins of one Claude Code
/// config folder (`~/.claude` or a profile).
fn claude_plugin_skill_dirs(root: &Path) -> Vec<(String, PathBuf)> {
    let read = |p: PathBuf| {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    };
    let Some(manifest) = read(root.join("plugins/installed_plugins.json")) else {
        return vec![];
    };
    let enabled = read(root.join("settings.json"))
        .and_then(|v| v.get("enabledPlugins").cloned())
        .and_then(|v| v.as_object().cloned());
    let Some(plugins) = manifest.get("plugins").and_then(|p| p.as_object()) else {
        return vec![];
    };
    let mut out = Vec::new();
    for (key, installs) in plugins {
        // Claude only loads plugins switched on in settings.json.
        if let Some(map) = &enabled
            && !map.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
        {
            continue;
        }
        let Some(list) = installs.as_array() else {
            continue;
        };
        // Prefer the user-scope install, else the first one.
        let pick = list
            .iter()
            .find(|i| i.get("scope").and_then(|s| s.as_str()) == Some("user"))
            .or(list.first());
        if let Some(path) = pick
            .and_then(|i| i.get("installPath"))
            .and_then(|p| p.as_str())
        {
            let dir = PathBuf::from(path).join("skills");
            if dir.is_dir() {
                out.push((key.split('@').next().unwrap_or(key).to_string(), dir));
            }
        }
    }
    out
}

/// (plugin name, agent id, skills dir) for installed agent plugins.
fn plugin_skill_dirs(q: &Quiver, agents: &[Agent]) -> Vec<(String, String, PathBuf)> {
    let mut out = Vec::new();
    let active = |id: &str| agents.iter().any(|a| a.id == id && a.detected);
    // Claude Code and each extra profile (claude-code@x) have their own
    // plugins folder and their own enabled list in settings.json.
    for a in agents
        .iter()
        .filter(|a| a.detected && (a.id == "claude-code" || a.id.starts_with("claude-code@")))
    {
        let Some(root) = a.install_dir.parent() else {
            continue;
        };
        for (name, dir) in claude_plugin_skill_dirs(root) {
            out.push((name, a.id.clone(), dir));
        }
    }
    if active("antigravity") {
        let root = q.env.expand("~/.gemini/config/plugins");
        for (name, path) in list_dir(&root) {
            let dir = path.join("skills");
            if dir.is_dir() {
                out.push((
                    name.trim_end_matches("-plugin").to_string(),
                    "antigravity".to_string(),
                    dir,
                ));
            }
        }
    }
    out
}

/// Full reconciled inventory.
pub fn scan(q: &Quiver) -> Inventory {
    let raw = raw_scan(q);
    let lock = Lock::load(&q.env);
    let state = State::load(&q.env);
    let my_dir = q.my_dir();
    let mine = Mine {
        norm: q.my_norm(),
        changes: crate::mine::changes_by_skill(&my_dir),
    };
    let mut skills: Vec<Skill> = raw
        .by_id
        .par_iter()
        .map(|(id, locs)| build_skill(q, &raw.agents, id, locs, &lock, &state, &mine))
        .collect();
    skills.sort_by_key(|a| a.id.to_lowercase());
    let mut pinned = crate::pins::pinned_index(q);
    for s in &mut skills {
        s.pinned_in = pinned.remove(&s.id).unwrap_or_default();
    }

    let visible = |p: Presence| !matches!(p, Presence::Absent | Presence::Broken);
    let agents: Vec<AgentInfo> = raw
        .agents
        .iter()
        .map(|a| {
            let count = skills
                .iter()
                .filter(|s| {
                    s.presence
                        .iter()
                        .any(|p| p.agent_id == a.id && visible(p.presence))
                })
                .count();
            a.info(&q.env, count)
        })
        .collect();

    let stats = Stats {
        total: skills.len(),
        managed: skills.iter().filter(|s| s.managed).count(),
        unmanaged: skills.iter().filter(|s| !s.managed && !s.read_only).count(),
        with_issues: skills
            .iter()
            .filter(|s| s.issues.iter().any(|i| i.severity != "info"))
            .count(),
        agents_detected: raw.agents.iter().filter(|a| a.active()).count(),
    };
    Inventory {
        canonical_dir: raw.canonical.to_string_lossy().into_owned(),
        agents,
        skills,
        stats,
        scanned_at_ms: now_ms(),
    }
}

/// My Skills context shared across a scan.
struct Mine {
    norm: Option<PathBuf>,
    /// Uncommitted file count per skill; None when not a git repo.
    changes: Option<HashMap<String, u32>>,
}

fn build_skill(
    q: &Quiver,
    agents: &[Agent],
    id: &str,
    locs: &[RawLoc],
    lock: &Lock,
    state: &State,
    mine: &Mine,
) -> Skill {
    let canonical = locs.iter().find(|l| l.kind == LocationKind::Canonical);
    let managed = canonical.is_some();
    let read_only = locs.iter().all(|l| l.kind == LocationKind::Plugin);
    let primary: Option<PathBuf> = canonical
        .and_then(|c| c.real.clone())
        .or_else(|| {
            locs.iter()
                .find(|l| l.kind == LocationKind::Directory)
                .and_then(|l| l.real.clone())
        })
        .or_else(|| locs.iter().find_map(|l| l.real.clone()));

    // Content hashes, only when distinct real dirs need comparing.
    let mut reals: Vec<&PathBuf> = locs.iter().filter_map(|l| l.real.as_ref()).collect();
    reals.sort();
    reals.dedup();
    let hashes: HashMap<PathBuf, Option<String>> = if reals.len() > 1 {
        reals
            .iter()
            .map(|r| ((*r).clone(), skill::folder_hash(r)))
            .collect()
    } else {
        HashMap::new()
    };
    let hash_of = |p: &Option<PathBuf>| p.as_ref().and_then(|p| hashes.get(p).cloned().flatten());
    let canonical_real = canonical.and_then(|c| c.real.clone());
    let canonical_hash = hash_of(&canonical_real);

    let mut issues = Vec::new();
    let meta = primary.as_deref().and_then(skill::read_meta);
    let dir_name = id.rsplit(':').next().unwrap_or(id);
    match &meta {
        Some(m) => issues.extend(skill::validate(m, dir_name)),
        None if primary.is_some() => issues.push(Issue {
            kind: IssueKind::MissingSkillMd,
            message: "folder has no SKILL.md".into(),
            severity: "error".into(),
        }),
        None => {}
    }
    let broken: Vec<&RawLoc> = locs
        .iter()
        .filter(|l| l.kind == LocationKind::Broken)
        .collect();
    if !broken.is_empty() {
        issues.push(Issue {
            kind: IssueKind::BrokenLink,
            message: format!(
                "{} broken link{}: {}",
                broken.len(),
                if broken.len() == 1 { "" } else { "s" },
                broken
                    .iter()
                    .map(|l| q.env.display(&l.path))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            severity: "error".into(),
        });
    }
    let mut distinct: Vec<&String> = hashes.values().flatten().collect();
    distinct.sort();
    distinct.dedup();
    if distinct.len() > 1 {
        issues.push(Issue {
            kind: IssueKind::Conflict,
            message: format!(
                "{} different versions of this skill exist across agents",
                distinct.len()
            ),
            severity: "warning".into(),
        });
    }
    if !managed && !read_only && primary.is_some() {
        let n = locs
            .iter()
            .filter(|l| l.real.is_some())
            .flat_map(|l| l.agents.iter())
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        issues.push(Issue {
            kind: IssueKind::Unmanaged,
            message: format!(
                "Only visible to {n} agent{}. Make it universal to share it with every agent.",
                if n == 1 { "" } else { "s" }
            ),
            severity: "info".into(),
        });
    }

    let presence: Vec<AgentPresence> = agents
        .iter()
        .map(|a| {
            let mut best = if a.reads_canonical && managed {
                Presence::Native
            } else {
                Presence::Absent
            };
            for l in locs.iter().filter(|l| l.agents.contains(&a.id)) {
                let p = match l.kind {
                    LocationKind::Link => Presence::Linked,
                    LocationKind::Plugin => Presence::Plugin,
                    LocationKind::Broken => Presence::Broken,
                    LocationKind::Canonical => continue,
                    LocationKind::Directory | LocationKind::ForeignLink => {
                        if canonical_real.is_some() && l.real == canonical_real {
                            Presence::Linked
                        } else if canonical_hash.is_some() && hash_of(&l.real) == canonical_hash {
                            Presence::Copied
                        } else if l.kind == LocationKind::Directory {
                            Presence::Local
                        } else {
                            Presence::Foreign
                        }
                    }
                };
                if rank(p) > rank(best) {
                    best = p;
                }
            }
            AgentPresence {
                agent_id: a.id.clone(),
                presence: best,
            }
        })
        .collect();

    let st = primary.as_deref().map(skill::stats).unwrap_or_default();
    let is_mine = canonical_real
        .as_ref()
        .is_some_and(|r| crate::mine::is_mine_path(mine.norm.as_deref(), r));
    let source = lock
        .entry(id)
        .map(|e| {
            let mut s = e.to_source();
            if let Some(extra) = state.skills.get(id).and_then(|s| s.source.as_ref()) {
                s.git_ref = extra.git_ref.clone();
            }
            s
        })
        .or_else(|| state.skills.get(id).and_then(|s| s.source.clone()))
        .or_else(|| {
            // Canonical entry symlinked to a folder outside agent dirs = live local source.
            canonical
                .filter(|c| c.target.is_some())
                .and_then(|c| c.real.as_ref())
                .map(|r| SkillSource {
                    kind: "local".into(),
                    source: q.env.display(r),
                    ..Default::default()
                })
        });
    let source = if is_mine {
        canonical_real.as_ref().map(|r| SkillSource {
            kind: "mine".into(),
            source: q.env.display(r),
            ..Default::default()
        })
    } else {
        source
    };
    let origin = if read_only {
        Origin::Plugin
    } else if !managed {
        Origin::Unmanaged
    } else if is_mine {
        Origin::Mine
    } else if source
        .as_ref()
        .is_some_and(|s| !matches!(s.kind.as_str(), "local" | "unknown" | ""))
    {
        Origin::Installed
    } else {
        Origin::Local
    };

    let locations = locs
        .iter()
        .map(|l| Location {
            path: l.path.to_string_lossy().into_owned(),
            agent_id: l.agents.first().cloned(),
            kind: l.kind,
            target: l.target.as_ref().map(|t| t.to_string_lossy().into_owned()),
            content_hash: hash_of(&l.real),
            writable: l.writable,
        })
        .collect();

    Skill {
        id: id.to_string(),
        name: meta
            .as_ref()
            .and_then(|m| m.name.clone())
            .unwrap_or_else(|| dir_name.to_string()),
        description: meta
            .as_ref()
            .and_then(|m| m.description.clone())
            .unwrap_or_default(),
        version: meta.as_ref().and_then(|m| m.version.clone()),
        license: meta.as_ref().and_then(|m| m.license.clone()),
        allowed_tools: meta.as_ref().and_then(|m| m.allowed_tools.clone()),
        managed,
        primary_path: primary.map(|p| p.to_string_lossy().into_owned()),
        locations,
        presence,
        source,
        issues,
        file_count: st.file_count,
        size_bytes: st.size_bytes,
        modified_ms: st.modified_ms,
        read_only,
        plugin: locs.iter().find_map(|l| l.plugin.clone()),
        origin,
        git_changes: if is_mine {
            mine.changes
                .as_ref()
                .map(|m| m.get(id).copied().unwrap_or(0))
        } else {
            None
        },
        forked_from: state.skills.get(id).and_then(|s| s.forked_from.clone()),
        pinned_in: vec![],
    }
}

fn rank(p: Presence) -> u8 {
    match p {
        Presence::Absent => 0,
        Presence::Broken => 1,
        Presence::Plugin => 2,
        Presence::Foreign => 3,
        Presence::Local => 4,
        Presence::Copied => 5,
        Presence::Linked => 6,
        Presence::Native => 7,
    }
}

/// Detail view for one skill.
pub fn detail(q: &Quiver, id: &str) -> anyhow::Result<SkillDetail> {
    let inv = scan(q);
    let skill = inv
        .skills
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| anyhow::anyhow!("skill `{id}` not found"))?;
    let dir = skill.primary_path.clone().map(PathBuf::from);
    let meta = dir
        .as_deref()
        .and_then(skill::read_meta)
        .unwrap_or_default();
    Ok(SkillDetail {
        files: dir.as_deref().map(skill::list_files).unwrap_or_default(),
        skill_md: meta.raw,
        body: meta.body,
        frontmatter: meta.frontmatter,
        skill,
    })
}

/// Read a text file inside a skill (bounded, no path escapes).
pub fn read_file(q: &Quiver, id: &str, rel: &str) -> anyhow::Result<String> {
    let raw = raw_scan(q);
    let locs = raw
        .by_id
        .get(id)
        .ok_or_else(|| anyhow::anyhow!("skill `{id}` not found"))?;
    let root = locs
        .iter()
        .find(|l| l.kind == LocationKind::Canonical)
        .or_else(|| locs.iter().find(|l| l.real.is_some()))
        .and_then(|l| l.real.clone())
        .ok_or_else(|| anyhow::anyhow!("skill `{id}` has no readable folder"))?;
    let path = root.join(crate::fsutil::safe_rel(rel)?);
    let real = normalize(&path);
    anyhow::ensure!(real.starts_with(&root), "path escapes the skill folder");
    let meta = std::fs::metadata(&real)?;
    anyhow::ensure!(meta.len() <= 1_048_576, "file is larger than 1 MB");
    let bytes = std::fs::read(&real)?;
    String::from_utf8(bytes).map_err(|_| anyhow::anyhow!("binary file"))
}

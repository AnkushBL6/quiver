//! Source discovery for skills that arrived without one (copied by hand,
//! unzipped, installed by an older tool). Each candidate comes from the
//! skills.sh directory; it is verified against the repo's git tree, so a
//! match is a fact ("this folder is byte-identical to anthropics/skills at
//! skills/pdf"), not a guess from the name alone.

use crate::Quiver;
use crate::agents::normalize;
use crate::github::{Tree, git_blob_sha};
use crate::model::*;
use crate::skill;
use crate::store::{Lock, LockEntry, State, now_iso};
use anyhow::{Result, bail};
use rayon::prelude::*;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Candidate repos to verify per skill.
const MAX_REPOS_PER_SKILL: usize = 4;
/// Parallel skills.sh searches (it rate-limits bursts).
const SEARCH_CONCURRENCY: usize = 4;
/// Popular collections checked before any search.
const WELL_KNOWN: &[&str] = &[
    "anthropics/skills",
    "obra/superpowers",
    "vercel-labs/agent-skills",
    "affaan-m/everything-claude-code",
];

impl Quiver {
    /// Find upstream sources for skills. `ids` empty = every managed skill
    /// without a remote source (origin `local`).
    ///
    /// Repos already installed from on this machine (plus a few well-known
    /// collections) are checked first: one GitHub call per repo, no search.
    /// Only skills still without a verified match go to the skills.sh search,
    /// a few at a time, stopping politely when it rate-limits.
    pub fn find_sources(&self, ids: &[String]) -> SourceScan {
        let inv = self.scan();
        let targets: Vec<(String, PathBuf)> = inv
            .skills
            .iter()
            .filter(|s| {
                if ids.is_empty() {
                    s.origin == Origin::Local
                } else {
                    ids.contains(&s.id) && matches!(s.origin, Origin::Local | Origin::Unmanaged)
                }
            })
            .filter_map(|s| Some((s.id.clone(), s.primary_path.as_ref()?.into())))
            .collect();
        let local: HashMap<String, Fingerprint> = targets
            .par_iter()
            .map(|(id, dir)| {
                let md = skill::skill_file(dir)
                    .and_then(|f| std::fs::read(f).ok())
                    .map(|b| git_blob_sha(&b));
                (
                    id.clone(),
                    Fingerprint {
                        tree: git_tree_sha(dir),
                        md,
                    },
                )
            })
            .collect();

        let gh = self.github();
        let mut trees: HashMap<String, Tree> = HashMap::new();
        let fetch = |repos: Vec<String>, trees: &mut HashMap<String, Tree>| {
            let todo: Vec<String> = repos
                .into_iter()
                .filter(|r| !trees.contains_key(r))
                .collect();
            let got: Vec<(String, Tree)> = todo
                .par_iter()
                .filter_map(|r| gh.tree(r, "HEAD").ok().map(|t| (r.clone(), t)))
                .collect();
            trees.extend(got);
        };

        // 1. Known repos.
        let lock = Lock::load(&self.env);
        let mut known: Vec<String> = lock
            .ids()
            .iter()
            .filter_map(|id| lock.entry(id))
            .filter(|e| e.source_type == "github")
            .map(|e| e.source)
            .chain(WELL_KNOWN.iter().map(|s| (*s).to_string()))
            .collect();
        known.sort();
        known.dedup();
        fetch(known.clone(), &mut trees);
        let mut best: HashMap<String, SourceMatch> = HashMap::new();
        for (id, _) in &targets {
            for repo in &known {
                if let Some(t) = trees.get(repo) {
                    consider(&mut best, id, repo, 0, true, t, &local[id]);
                }
            }
        }

        // 2. Directory search for the rest, a few at a time.
        let pending: Vec<String> = targets
            .iter()
            .map(|(id, _)| id.clone())
            .filter(|id| {
                best.get(id)
                    .is_none_or(|m| m.confidence == MatchConfidence::Name)
            })
            .collect();
        let mut rate_limited = false;
        let mut unchecked = Vec::new();
        for chunk in pending.chunks(SEARCH_CONCURRENCY) {
            if rate_limited {
                unchecked.extend(chunk.iter().cloned());
                continue;
            }
            let results: Vec<(String, Result<Vec<SearchResult>, String>)> = chunk
                .par_iter()
                .map(|id| {
                    (
                        id.clone(),
                        crate::search::search(id, &[]).map_err(|e| format!("{e:#}")),
                    )
                })
                .collect();
            let mut wanted: Vec<(String, Vec<(String, u64)>)> = Vec::new();
            for (id, r) in results {
                match r {
                    Ok(list) => {
                        let mut repos: Vec<(String, u64)> = list
                            .into_iter()
                            .filter(|r| {
                                skill::sanitize_name(&r.name) == id
                                    || r.id.rsplit('/').next() == Some(id.as_str())
                            })
                            .filter(|r| r.source.split('/').count() == 2)
                            .map(|r| (r.source, r.installs))
                            .collect();
                        repos.dedup_by(|a, b| a.0 == b.0);
                        repos.truncate(MAX_REPOS_PER_SKILL);
                        wanted.push((id, repos));
                    }
                    Err(e) if e.contains("429") => {
                        rate_limited = true;
                        unchecked.push(id);
                    }
                    Err(_) => {}
                }
            }
            fetch(
                wanted
                    .iter()
                    .flat_map(|(_, r)| r.iter().map(|(repo, _)| repo.clone()))
                    .collect(),
                &mut trees,
            );
            for (id, repos) in &wanted {
                for (repo, installs) in repos {
                    if let Some(t) = trees.get(repo) {
                        let known = known.contains(repo);
                        consider(&mut best, id, repo, *installs, known, t, &local[id]);
                    }
                }
            }
        }

        let mut matches: Vec<SourceMatch> = best.into_values().collect();
        matches.sort_by(|a, b| a.id.cmp(&b.id));
        unchecked.sort();
        SourceScan {
            checked: targets.len(),
            matches,
            rate_limited,
            unchecked,
        }
    }

    /// Record `source` as the upstream of a skill so it gets update checks.
    /// The content on disk is not touched; if it differs from upstream, the
    /// next update check reports an update.
    pub fn track_source(&self, id: &str, source: &str, skill_path: &str) -> Result<()> {
        let dir = normalize(&self.canonical_dir().join(id));
        if !dir.is_dir() {
            bail!("`{id}` is not in the shared store yet; make it universal first");
        }
        if crate::mine::is_mine_path(self.my_norm().as_deref(), &dir) {
            bail!("`{id}` is one of your own skills");
        }
        let folder = skill_path
            .strip_suffix("SKILL.md")
            .unwrap_or(skill_path)
            .trim_end_matches('/');
        let tree = self.github().tree(source, "HEAD")?;
        let upstream = tree
            .folder_sha(folder)
            .ok_or_else(|| anyhow::anyhow!("{source} has no folder `{folder}`"))?;
        // Identical content: record upstream's hash (up to date). Otherwise record
        // the local tree hash so the update check offers upstream's version.
        let local = git_tree_sha(&dir).unwrap_or_default();
        let hash = if local == upstream { upstream } else { local };
        let mut lock = Lock::load(&self.env);
        let now = now_iso();
        lock.upsert(
            id,
            &LockEntry {
                source: source.to_string(),
                source_type: "github".into(),
                source_url: Some(format!("https://github.com/{source}.git")),
                skill_path: Some(skill_path.to_string()),
                skill_folder_hash: hash.clone(),
                installed_at: Some(now.clone()),
                updated_at: Some(now),
            },
        );
        lock.save()?;
        let mut state = State::load(&self.env);
        let st = state.skill_mut(id);
        st.source = None;
        st.installed_hash = skill::folder_hash(&dir);
        st.revision = Some(hash);
        state.updates.retain(|u| u.id != id);
        state.save(&self.env)
    }
}

struct Fingerprint {
    tree: Option<String>,
    md: Option<String>,
}

/// Compare a skill against every same-named folder in a repo tree and keep
/// the strongest match seen so far.
fn consider(
    best: &mut HashMap<String, SourceMatch>,
    id: &str,
    repo: &str,
    installs: u64,
    known: bool,
    tree: &Tree,
    local: &Fingerprint,
) {
    for folder in tree.skill_folders().into_iter().filter(|f| {
        f.rsplit('/').next().unwrap_or(f) == id
            || (f.is_empty() && repo.rsplit('/').next() == Some(id))
    }) {
        let md_path = if folder.is_empty() {
            "SKILL.md".to_string()
        } else {
            format!("{folder}/SKILL.md")
        };
        let upstream = tree.folder_sha(&folder);
        let upstream_md = tree
            .files_in(&folder)
            .find(|e| e.path == md_path)
            .map(|e| e.sha.clone());
        let confidence = if upstream.is_some() && upstream == local.tree {
            MatchConfidence::Exact
        } else if upstream_md.is_some() && upstream_md == local.md {
            MatchConfidence::SkillMd
        } else {
            MatchConfidence::Name
        };
        let m = SourceMatch {
            id: id.to_string(),
            source: repo.to_string(),
            skill_path: md_path,
            confidence,
            installs,
            known,
        };
        // Strongest evidence first; on a tie the original collection beats mirrors.
        let rank = |m: &SourceMatch| (m.confidence, m.known, m.installs);
        let better = best.get(id).is_none_or(|b| rank(&m) > rank(b));
        if better {
            best.insert(id.to_string(), m);
        }
    }
}

/// `git hash-object -t tree` for a folder as it would be committed: the same
/// value GitHub reports for the folder, ignoring `.git`, `.DS_Store` and empty dirs.
pub fn git_tree_sha(dir: &Path) -> Option<String> {
    tree_sha_raw(dir).map(hex::encode)
}

fn tree_sha_raw(dir: &Path) -> Option<[u8; 20]> {
    let mut entries: Vec<(String, &'static str, [u8; 20])> = Vec::new();
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" || name == ".DS_Store" {
            continue;
        }
        let ft = e.file_type().ok()?;
        let path = e.path();
        if ft.is_symlink() {
            let target = std::fs::read_link(&path).ok()?;
            let bytes = target.to_string_lossy().into_owned().into_bytes();
            entries.push((name, "120000", blob_raw(&bytes)));
        } else if ft.is_dir() {
            if let Some(sha) = tree_sha_raw(&path) {
                entries.push((name, "40000", sha));
            }
        } else {
            let bytes = std::fs::read(&path).ok()?;
            #[cfg(unix)]
            let exec = {
                use std::os::unix::fs::PermissionsExt;
                e.metadata().ok()?.permissions().mode() & 0o111 != 0
            };
            #[cfg(not(unix))]
            let exec = false;
            entries.push((
                name,
                if exec { "100755" } else { "100644" },
                blob_raw(&bytes),
            ));
        }
    }
    if entries.is_empty() {
        return None;
    }
    // Git sorts tree entries by name, with directories compared as "name/".
    entries.sort_by(|a, b| {
        let key = |e: &(String, &str, [u8; 20])| {
            let mut k = e.0.clone().into_bytes();
            if e.1 == "40000" {
                k.push(b'/');
            }
            k
        };
        key(a).cmp(&key(b))
    });
    let mut body = Vec::new();
    for (name, mode, sha) in &entries {
        body.extend_from_slice(mode.as_bytes());
        body.push(b' ');
        body.extend_from_slice(name.as_bytes());
        body.push(0);
        body.extend_from_slice(sha);
    }
    let mut h = Sha1::new();
    h.update(format!("tree {}\0", body.len()).as_bytes());
    h.update(&body);
    Some(h.finalize().into())
}

fn blob_raw(bytes: &[u8]) -> [u8; 20] {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Matches `git write-tree` for the same content.
    #[test]
    fn tree_sha_matches_git() {
        if !Path::new("/usr/bin/git").is_file() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        std::fs::create_dir_all(root.join("s/scripts")).unwrap();
        std::fs::create_dir_all(root.join("s/a.b")).unwrap();
        std::fs::write(root.join("s/SKILL.md"), "---\nname: s\n---\nhi\n").unwrap();
        std::fs::write(root.join("s/scripts/run.sh"), "#!/bin/sh\necho\n").unwrap();
        std::fs::write(root.join("s/a.b/x"), "x").unwrap();
        std::fs::write(root.join("s/a"), "file named a").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                root.join("s/scripts/run.sh"),
                std::fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        let git = |args: &[&str]| {
            let o = std::process::Command::new("/usr/bin/git")
                .current_dir(root.join("s"))
                .args(args)
                .output()
                .unwrap();
            String::from_utf8(o.stdout).unwrap().trim().to_string()
        };
        git(&["init", "-q"]);
        git(&["add", "-A"]);
        let expected = git(&["write-tree"]);
        assert_eq!(git_tree_sha(&root.join("s")).unwrap(), expected);
    }
}

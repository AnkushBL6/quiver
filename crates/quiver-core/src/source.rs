//! Resolving install sources and installing skills from them.

use crate::Quiver;
use crate::agents::normalize;
use crate::fsutil::{self, Entry, entry};
use crate::github::{Client, Tree};
use crate::model::*;
use crate::scan::raw_scan;
use crate::skill::{self, Meta};
use crate::store::{Lock, LockEntry, State, now_iso};
use anyhow::{Context, Result, anyhow, bail};
use rayon::prelude::*;
use std::path::{Path, PathBuf};

const MAX_CANDIDATES: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Spec {
    GitHub {
        repo: String,
        git_ref: Option<String>,
        subpath: Option<String>,
        filter: Option<String>,
    },
    Git {
        url: String,
        git_ref: Option<String>,
    },
    Archive {
        url: String,
    },
    Local {
        path: PathBuf,
    },
    Zip {
        path: PathBuf,
    },
}

/// Parse user input into a source spec.
pub fn parse(input: &str, home: &Path) -> Result<Spec> {
    let mut s = input.trim().trim_end_matches('/').to_string();
    anyhow::ensure!(!s.is_empty(), "enter a GitHub repo, URL or folder");

    // Local paths.
    if s.starts_with('/')
        || s.starts_with("~/")
        || s == "~"
        || s.starts_with("./")
        || s.starts_with("../")
        || s.starts_with("file://")
    {
        let raw = s.trim_start_matches("file://");
        let p = if let Some(rest) = raw.strip_prefix("~/") {
            home.join(rest)
        } else {
            PathBuf::from(raw)
        };
        return local_spec(p);
    }

    if let Some(rest) = s.strip_prefix("github:") {
        s = rest.to_string();
    }
    let (body, git_ref) = match s.split_once('#') {
        Some((b, r)) => (b.to_string(), Some(r.to_string()).filter(|r| !r.is_empty())),
        None => (s.clone(), None),
    };

    if body.starts_with("http://") || body.starts_with("https://") {
        let u = url::Url::parse(&body).context("invalid URL")?;
        let host = u.host_str().unwrap_or("").to_lowercase();
        let segs: Vec<String> = u
            .path_segments()
            .map(|p| p.filter(|x| !x.is_empty()).map(|x| x.to_string()).collect())
            .unwrap_or_default();
        let lower = body.to_lowercase();
        if lower.ends_with(".zip") || lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            return Ok(Spec::Archive { url: body });
        }
        if host == "skills.sh" || host == "www.skills.sh" {
            anyhow::ensure!(segs.len() >= 2, "unrecognized skills.sh URL");
            return Ok(Spec::GitHub {
                repo: format!("{}/{}", segs[0], segs[1]),
                git_ref,
                subpath: None,
                filter: segs.get(2).cloned(),
            });
        }
        if host == "github.com" || host == "www.github.com" {
            anyhow::ensure!(segs.len() >= 2, "URL must point to a repository");
            let repo = format!("{}/{}", segs[0], segs[1].trim_end_matches(".git"));
            if segs.len() >= 4 && (segs[2] == "tree" || segs[2] == "blob") {
                let mut rest: Vec<&str> = segs[4..].iter().map(String::as_str).collect();
                if segs[2] == "blob"
                    && rest
                        .last()
                        .is_some_and(|l| l.eq_ignore_ascii_case("SKILL.md"))
                {
                    rest.pop();
                }
                return Ok(Spec::GitHub {
                    repo,
                    git_ref: Some(segs[3].clone()),
                    subpath: (!rest.is_empty()).then(|| rest.join("/")),
                    filter: None,
                });
            }
            return Ok(Spec::GitHub {
                repo,
                git_ref,
                subpath: None,
                filter: None,
            });
        }
        return Ok(Spec::Git { url: body, git_ref });
    }
    if body.starts_with("git@") || body.starts_with("ssh://") || body.starts_with("git://") {
        return Ok(Spec::Git { url: body, git_ref });
    }

    // owner/repo[/path...][@skill]
    let (body, filter) = match body.rsplit_once('@') {
        Some((b, f)) if !f.contains('/') && b.contains('/') => (b.to_string(), Some(f.to_string())),
        _ => (body, None),
    };
    let segs: Vec<&str> = body.split('/').collect();
    let valid = |x: &str| {
        !x.is_empty()
            && x.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
            && x != "."
            && x != ".."
    };
    if segs.len() >= 2 && segs.iter().all(|x| valid(x)) {
        // Prefer an existing relative folder if the user typed one.
        if Path::new(&body).is_dir() {
            return local_spec(std::fs::canonicalize(&body)?);
        }
        return Ok(Spec::GitHub {
            repo: format!("{}/{}", segs[0], segs[1].trim_end_matches(".git")),
            git_ref,
            subpath: (segs.len() > 2).then(|| segs[2..].join("/")),
            filter,
        });
    }
    if Path::new(&body).exists() {
        return local_spec(std::fs::canonicalize(&body)?);
    }
    bail!(
        "couldn't understand `{input}`. Try owner/repo, a GitHub URL, a git URL, or a folder path."
    )
}

fn local_spec(p: PathBuf) -> Result<Spec> {
    anyhow::ensure!(p.exists(), "{} does not exist", p.display());
    if p.is_file() {
        let name = p.to_string_lossy().to_lowercase();
        anyhow::ensure!(
            name.ends_with(".zip") || name.ends_with(".skill"),
            "files must be .zip archives"
        );
        return Ok(Spec::Zip { path: p });
    }
    Ok(Spec::Local { path: p })
}

enum Backing {
    GitHub {
        tree: Tree,
        git_ref: String,
    },
    Dir {
        root: PathBuf,
        commit: Option<String>,
    },
}

/// A resolved source, held by the app between `resolve_source` and `install`.
pub struct Session {
    pub resolved: ResolvedSource,
    spec: Spec,
    backing: Backing,
    _tmp: Option<tempfile::TempDir>,
}

impl Quiver {
    pub fn github(&self) -> Client {
        Client::new(crate::store::github_token(&self.env).map(|(t, _)| t))
    }

    pub fn resolve(&self, input: &str) -> Result<Session> {
        let spec = parse(input, &self.env.home)?;
        let canonical = self.canonical_dir();
        let (backing, tmp, display, kind) = match &spec {
            Spec::GitHub { repo, git_ref, .. } => {
                let r = git_ref.clone().unwrap_or_else(|| "HEAD".into());
                let tree = self.github().tree(repo, &r)?;
                (
                    Backing::GitHub { tree, git_ref: r },
                    None,
                    repo.clone(),
                    "github",
                )
            }
            Spec::Git { url, git_ref } => {
                let tmp = tempfile::tempdir()?;
                let commit = git_clone(url, git_ref.as_deref(), tmp.path())?;
                let root = tmp.path().to_path_buf();
                (
                    Backing::Dir {
                        root,
                        commit: Some(commit),
                    },
                    Some(tmp),
                    url.clone(),
                    "git",
                )
            }
            Spec::Archive { url } => {
                let tmp = tempfile::tempdir()?;
                let root = download_archive(url, tmp.path())?;
                (
                    Backing::Dir { root, commit: None },
                    Some(tmp),
                    url.clone(),
                    "zip",
                )
            }
            Spec::Zip { path } => {
                let tmp = tempfile::tempdir()?;
                let file = std::fs::File::open(path)?;
                extract_zip(file, tmp.path())?;
                (
                    Backing::Dir {
                        root: tmp.path().to_path_buf(),
                        commit: None,
                    },
                    Some(tmp),
                    self.env.display(path),
                    "zip",
                )
            }
            Spec::Local { path } => (
                Backing::Dir {
                    root: path.clone(),
                    commit: None,
                },
                None,
                self.env.display(path),
                "local",
            ),
        };

        // Discover skill folders and read their metadata.
        let metas: Vec<(String, Option<Meta>)> = match &backing {
            Backing::GitHub { tree, git_ref } => {
                let Spec::GitHub { repo, .. } = &spec else {
                    unreachable!()
                };
                let mut folders = tree.skill_folders();
                folders.truncate(MAX_CANDIDATES);
                let gh = self.github();
                folders
                    .par_iter()
                    .map(|f| {
                        let p = if f.is_empty() {
                            "SKILL.md".to_string()
                        } else {
                            format!("{f}/SKILL.md")
                        };
                        let meta = gh
                            .raw(repo, git_ref, &p)
                            .ok()
                            .and_then(|b| String::from_utf8(b).ok())
                            .map(|s| skill::parse(&s));
                        (f.clone(), meta)
                    })
                    .collect()
            }
            Backing::Dir { root, .. } => discover_local(root)
                .into_iter()
                .map(|f| {
                    let meta = skill::read_meta(&root.join(&f));
                    (f, meta)
                })
                .collect(),
        };

        let mut candidates: Vec<Candidate> = metas
            .into_iter()
            .map(|(path, meta)| {
                let base = path
                    .rsplit('/')
                    .next()
                    .filter(|b| !b.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| default_root_name(&spec));
                let name = meta
                    .as_ref()
                    .and_then(|m| m.name.clone())
                    .unwrap_or_else(|| base.clone());
                let id = skill::sanitize_name(&name);
                let issues = match &meta {
                    Some(m) => skill::validate(m, &id)
                        .into_iter()
                        .filter(|i| i.kind != IssueKind::NameMismatch)
                        .collect(),
                    None => vec![Issue {
                        kind: IssueKind::MissingSkillMd,
                        message: "couldn't read SKILL.md".into(),
                        severity: "error".into(),
                    }],
                };
                Candidate {
                    already_installed: matches!(
                        entry(&canonical.join(&id)),
                        Entry::Dir | Entry::Link { .. }
                    ),
                    description: meta
                        .as_ref()
                        .and_then(|m| m.description.clone())
                        .unwrap_or_default(),
                    id,
                    name,
                    path,
                    issues,
                }
            })
            .collect();

        // Narrow by subpath / skill filter.
        if let Spec::GitHub {
            subpath, filter, ..
        } = &spec
        {
            let mut filter = filter.clone();
            if let Some(sp) = subpath {
                let narrowed: Vec<Candidate> = candidates
                    .iter()
                    .filter(|c| c.path == *sp || c.path.starts_with(&format!("{sp}/")))
                    .cloned()
                    .collect();
                if narrowed.is_empty() && filter.is_none() {
                    // `owner/repo/skill` (skills.sh style id): treat last segment as a name.
                    filter = sp.rsplit('/').next().map(str::to_string);
                } else {
                    candidates = narrowed;
                }
            }
            if let Some(f) = filter {
                let f = f.to_lowercase();
                candidates.retain(|c| {
                    c.name.to_lowercase() == f
                        || c.id == f
                        || c.path.rsplit('/').next() == Some(f.as_str())
                });
            }
        }
        anyhow::ensure!(
            !candidates.is_empty(),
            "no skills (folders with a SKILL.md) found in {display}"
        );
        candidates.sort_by(|a, b| a.id.cmp(&b.id));

        let token = format!("src-{:x}", rand_u64());
        Ok(Session {
            resolved: ResolvedSource {
                token,
                kind: kind.into(),
                display,
                candidates,
            },
            spec,
            backing,
            _tmp: tmp,
        })
    }

    pub fn install(
        &self,
        session: &Session,
        paths: &[String],
        agents: &[String],
        overwrite: bool,
    ) -> OpReport {
        let mut report = OpReport::default();
        let canonical = self.canonical_dir();
        let mut lock = Lock::load(&self.env);
        let mut state = State::load(&self.env);
        let mut installed = Vec::new();

        for path in paths {
            let Some(c) = session.resolved.candidates.iter().find(|c| &c.path == path) else {
                report.errors.push(OpMessage {
                    id: path.clone(),
                    message: "not part of this source".into(),
                });
                continue;
            };
            let dest = canonical.join(&c.id);
            if !matches!(entry(&dest), Entry::Missing) && !overwrite {
                report.skipped.push(OpMessage {
                    id: c.id.clone(),
                    message: "already installed (enable overwrite to replace it)".into(),
                });
                continue;
            }
            match self.materialize(session, &c.path, &c.id, &dest) {
                Ok(revision) => {
                    let installed_hash = skill::folder_hash(&dest);
                    let st = state.skill_mut(&c.id);
                    st.installed_hash = installed_hash;
                    st.revision = Some(revision.clone());
                    st.excluded_agents.clear();
                    let now = now_iso();
                    match &session.spec {
                        Spec::GitHub { repo, git_ref, .. } => {
                            let installed_at = lock
                                .entry(&c.id)
                                .and_then(|e| e.installed_at)
                                .unwrap_or_else(|| now.clone());
                            lock.upsert(
                                &c.id,
                                &LockEntry {
                                    source: repo.clone(),
                                    source_type: "github".into(),
                                    source_url: Some(format!("https://github.com/{repo}.git")),
                                    skill_path: Some(if c.path.is_empty() {
                                        "SKILL.md".into()
                                    } else {
                                        format!("{}/SKILL.md", c.path)
                                    }),
                                    skill_folder_hash: revision,
                                    installed_at: Some(installed_at),
                                    updated_at: Some(now),
                                },
                            );
                            st.source = git_ref.as_ref().map(|r| SkillSource {
                                kind: "github".into(),
                                source: repo.clone(),
                                git_ref: Some(r.clone()),
                                ..Default::default()
                            });
                        }
                        other => {
                            lock.remove(&c.id);
                            let (kind, src, url, git_ref) = match other {
                                Spec::Git { url, git_ref } => {
                                    ("git", url.clone(), Some(url.clone()), git_ref.clone())
                                }
                                Spec::Local { path } => {
                                    ("local", path.to_string_lossy().into_owned(), None, None)
                                }
                                Spec::Zip { path } => {
                                    ("unknown", path.to_string_lossy().into_owned(), None, None)
                                }
                                Spec::Archive { url } => {
                                    ("unknown", url.clone(), Some(url.clone()), None)
                                }
                                Spec::GitHub { .. } => unreachable!(),
                            };
                            st.source = Some(SkillSource {
                                kind: kind.into(),
                                source: src,
                                url,
                                skill_path: Some(c.path.clone()),
                                git_ref,
                                installed_at: Some(now.clone()),
                                updated_at: Some(now),
                            });
                        }
                    }
                    installed.push(c.id.clone());
                    report.ok.push(c.id.clone());
                }
                Err(e) => report.errors.push(OpMessage {
                    id: c.id.clone(),
                    message: format!("{e:#}"),
                }),
            }
        }
        if let Err(e) = lock.save().and_then(|_| state.save(&self.env)) {
            report.errors.push(OpMessage {
                id: "state".into(),
                message: format!("{e:#}"),
            });
        }

        // Link into agents.
        let raw = raw_scan(self);
        let targets: Vec<String> = if agents.is_empty() {
            self.default_agents(&raw.agents)
        } else {
            agents.to_vec()
        };
        for id in &installed {
            self.refresh_copies(&raw, id);
            for agent_id in &targets {
                if let Some(a) = raw.agents.iter().find(|a| &a.id == agent_id)
                    && let Err(e) = self.link_one(&raw, id, a)
                {
                    report.skipped.push(OpMessage {
                        id: format!("{id}→{agent_id}"),
                        message: format!("{e:#}"),
                    });
                }
            }
        }
        report
    }

    /// Write candidate `path` of `session` into `dest` atomically. Returns the
    /// upstream revision (folder tree sha / commit / content hash).
    fn materialize(&self, session: &Session, path: &str, id: &str, dest: &Path) -> Result<String> {
        let canonical = self.canonical_dir();
        std::fs::create_dir_all(&canonical)?;
        let staging = canonical.join(format!(".quiver-staging-{id}-{:x}", rand_u64()));
        let result = (|| -> Result<String> {
            let revision = match (&session.backing, &session.spec) {
                (Backing::GitHub { tree, git_ref }, Spec::GitHub { repo, .. }) => {
                    self.github()
                        .download_folder(repo, git_ref, tree, path, &staging)?;
                    tree.folder_sha(path).unwrap_or_default()
                }
                (Backing::Dir { root, commit }, _) => {
                    let src = root.join(fsutil::safe_rel(path).or_else(|_| {
                        if path.is_empty() {
                            Ok(PathBuf::new())
                        } else {
                            bail!("bad path")
                        }
                    })?);
                    fsutil::copy_dir(&src, &staging)?;
                    commit
                        .clone()
                        .or_else(|| skill::folder_hash(&src))
                        .unwrap_or_default()
                }
                _ => bail!("inconsistent source session"),
            };
            anyhow::ensure!(
                skill::skill_file(&staging).is_some(),
                "downloaded folder has no SKILL.md"
            );
            swap_into_place(self, &staging, dest)?;
            Ok(revision)
        })();
        if staging.exists() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result
    }

    /// Re-copy the skill into agents that use copy mode.
    pub(crate) fn refresh_copies(&self, raw: &crate::scan::Raw, id: &str) {
        let src = normalize(&raw.canonical.join(id));
        for a in raw
            .agents
            .iter()
            .filter(|a| a.link_mode == LinkMode::Copy && !a.reads_canonical)
        {
            let dest = a.install_dir.join(id);
            if matches!(entry(&dest), Entry::Dir)
                && skill::folder_hash(&dest) != skill::folder_hash(&src)
                && self.discard(&dest).is_ok()
            {
                let _ = fsutil::copy_dir(&src, &dest);
            }
        }
    }

    /// Re-fetch a skill from its recorded source into the canonical store.
    pub(crate) fn reinstall_from(
        &self,
        id: &str,
        source: &SkillSource,
        tree_cache: Option<&Tree>,
    ) -> Result<String> {
        let dest = self.canonical_dir().join(id);
        let folder = source
            .skill_path
            .as_deref()
            .unwrap_or("")
            .trim_end_matches("SKILL.md")
            .trim_end_matches('/')
            .to_string();
        match source.kind.as_str() {
            "github" => {
                let git_ref = source.git_ref.clone().unwrap_or_else(|| "HEAD".into());
                let owned;
                let tree = match tree_cache {
                    Some(t) => t,
                    None => {
                        owned = self.github().tree(&source.source, &git_ref)?;
                        &owned
                    }
                };
                let session = Session {
                    resolved: ResolvedSource {
                        token: String::new(),
                        kind: "github".into(),
                        display: source.source.clone(),
                        candidates: vec![],
                    },
                    spec: Spec::GitHub {
                        repo: source.source.clone(),
                        git_ref: Some(git_ref.clone()),
                        subpath: None,
                        filter: None,
                    },
                    backing: Backing::GitHub {
                        tree: tree.clone(),
                        git_ref,
                    },
                    _tmp: None,
                };
                self.materialize(&session, &folder, id, &dest)
            }
            "git" => {
                let url = source.url.clone().unwrap_or_else(|| source.source.clone());
                let tmp = tempfile::tempdir()?;
                let commit = git_clone(&url, source.git_ref.as_deref(), tmp.path())?;
                let session = Session {
                    resolved: ResolvedSource {
                        token: String::new(),
                        kind: "git".into(),
                        display: url.clone(),
                        candidates: vec![],
                    },
                    spec: Spec::Git {
                        url,
                        git_ref: source.git_ref.clone(),
                    },
                    backing: Backing::Dir {
                        root: tmp.path().to_path_buf(),
                        commit: Some(commit),
                    },
                    _tmp: Some(tmp),
                };
                self.materialize(&session, &folder, id, &dest)
            }
            "local" => {
                let root = PathBuf::from(&source.source);
                anyhow::ensure!(
                    root.exists(),
                    "source folder {} no longer exists",
                    root.display()
                );
                let session = Session {
                    resolved: ResolvedSource {
                        token: String::new(),
                        kind: "local".into(),
                        display: source.source.clone(),
                        candidates: vec![],
                    },
                    spec: Spec::Local { path: root.clone() },
                    backing: Backing::Dir { root, commit: None },
                    _tmp: None,
                };
                self.materialize(&session, &folder, id, &dest)
            }
            other => bail!("`{id}` came from a {other} source and can't be updated automatically"),
        }
    }
}

/// Replace `dest` with `staging` (both in the canonical dir) atomically-ish.
fn swap_into_place(q: &Quiver, staging: &Path, dest: &Path) -> Result<()> {
    match entry(dest) {
        Entry::Missing => {}
        Entry::Link { .. } => fsutil::remove_link(dest)?,
        Entry::Dir => {
            let old = dest.with_file_name(format!(
                ".quiver-old-{}-{:x}",
                dest.file_name().unwrap().to_string_lossy(),
                rand_u64()
            ));
            std::fs::rename(dest, &old)?;
            if let Err(e) = std::fs::rename(staging, dest) {
                let _ = std::fs::rename(&old, dest);
                return Err(e.into());
            }
            return q.discard(&old);
        }
        Entry::File => bail!("{} is a file", dest.display()),
    }
    std::fs::rename(staging, dest)?;
    Ok(())
}

fn default_root_name(spec: &Spec) -> String {
    match spec {
        Spec::GitHub { repo, .. } => repo.rsplit('/').next().unwrap_or("skill").to_string(),
        Spec::Git { url, .. } | Spec::Archive { url } => url
            .rsplit('/')
            .next()
            .unwrap_or("skill")
            .trim_end_matches(".git")
            .trim_end_matches(".zip")
            .to_string(),
        Spec::Local { path } | Spec::Zip { path } => path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "skill".into()),
    }
}

/// Folders (relative to root, "" = root) that contain a SKILL.md.
pub fn discover_local(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = walkdir::WalkDir::new(root)
        .follow_links(true)
        .max_depth(7)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0
                || !(e.file_type().is_dir()
                    && (n == "node_modules"
                        || n == ".git"
                        || n == "__MACOSX"
                        || (n.starts_with('.') && n != ".claude" && n != ".agents")))
        })
        .flatten()
        .filter(|e| e.file_type().is_file() && e.file_name() == "SKILL.md")
        .filter_map(|e| {
            e.path()
                .parent()
                .and_then(|p| p.strip_prefix(root).ok())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
        .collect();
    out.sort();
    out.dedup();
    // A skill's own subfolders may hold example SKILL.md files; keep only top-most skills.
    let tops: Vec<String> = out
        .iter()
        .filter(|p| {
            !out.iter()
                .any(|q| q != *p && (q.is_empty() || p.starts_with(&format!("{q}/"))))
        })
        .cloned()
        .collect();
    tops.into_iter().take(MAX_CANDIDATES).collect()
}

pub(crate) fn find_git() -> Result<PathBuf> {
    [
        "/usr/bin/git",
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|p| p.is_file())
    .ok_or_else(|| anyhow!("git is not installed (run `xcode-select --install`)"))
}

/// Shallow clone; returns the checked-out commit.
pub fn git_clone(url: &str, git_ref: Option<&str>, dest: &Path) -> Result<String> {
    let git = find_git()?;
    let mut cmd = std::process::Command::new(&git);
    cmd.args(["clone", "--depth", "1", "--quiet"]);
    if let Some(r) = git_ref {
        cmd.args(["--branch", r]);
    }
    cmd.arg(url).arg(dest).env("GIT_TERMINAL_PROMPT", "0");
    let out = cmd.output().context("running git")?;
    if !out.status.success() {
        bail!(
            "git clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let rev = std::process::Command::new(&git)
        .arg("-C")
        .arg(dest)
        .args(["rev-parse", "HEAD"])
        .output()?;
    Ok(String::from_utf8_lossy(&rev.stdout).trim().to_string())
}

/// Remote HEAD (or ref) commit without cloning.
pub fn git_remote_head(url: &str, git_ref: Option<&str>) -> Result<String> {
    let git = find_git()?;
    let out = std::process::Command::new(git)
        .args(["ls-remote", url, git_ref.unwrap_or("HEAD")])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    anyhow::ensure!(
        out.status.success(),
        "git ls-remote failed: {}",
        String::from_utf8_lossy(&out.stderr).trim()
    );
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("ref not found"))
}

fn download_archive(url: &str, dir: &Path) -> Result<PathBuf> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| anyhow!("download failed: {e}"))?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(resp.into_reader(), 200 * 1024 * 1024),
        &mut bytes,
    )?;
    let lower = url.to_lowercase();
    if lower.ends_with(".zip") {
        extract_zip(std::io::Cursor::new(bytes), dir)?;
    } else {
        let mut ar = tar::Archive::new(flate2::read::GzDecoder::new(std::io::Cursor::new(bytes)));
        for e in ar.entries()? {
            let mut e = e?;
            if e.header().entry_type().is_file() {
                let rel = fsutil::safe_rel(&e.path()?.to_string_lossy())?;
                let out = dir.join(rel);
                if let Some(p) = out.parent() {
                    std::fs::create_dir_all(p)?;
                }
                e.unpack(&out)?;
            }
        }
    }
    Ok(dir.to_path_buf())
}

fn extract_zip<R: std::io::Read + std::io::Seek>(reader: R, dir: &Path) -> Result<()> {
    let mut zip = zip::ZipArchive::new(reader).context("not a valid zip archive")?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        let Some(rel) = f.enclosed_name() else {
            continue;
        };
        let out = dir.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&out)?;
            std::io::copy(&mut f, &mut w)?;
        }
    }
    Ok(())
}

fn rand_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gh(repo: &str, git_ref: Option<&str>, subpath: Option<&str>, filter: Option<&str>) -> Spec {
        Spec::GitHub {
            repo: repo.into(),
            git_ref: git_ref.map(Into::into),
            subpath: subpath.map(Into::into),
            filter: filter.map(Into::into),
        }
    }

    #[test]
    fn parses_sources() {
        let h = Path::new("/nonexistent-home");
        assert_eq!(
            parse("anthropics/skills", h).unwrap(),
            gh("anthropics/skills", None, None, None)
        );
        assert_eq!(
            parse("anthropics/skills/skills/pdf", h).unwrap(),
            gh("anthropics/skills", None, Some("skills/pdf"), None)
        );
        assert_eq!(
            parse("vercel-labs/skills@find-skills", h).unwrap(),
            gh("vercel-labs/skills", None, None, Some("find-skills"))
        );
        assert_eq!(
            parse("https://github.com/anthropics/skills", h).unwrap(),
            gh("anthropics/skills", None, None, None)
        );
        assert_eq!(
            parse("https://github.com/anthropics/skills.git", h).unwrap(),
            gh("anthropics/skills", None, None, None)
        );
        assert_eq!(
            parse("https://github.com/a/b/tree/main/skills/x", h).unwrap(),
            gh("a/b", Some("main"), Some("skills/x"), None)
        );
        assert_eq!(
            parse("https://github.com/a/b/blob/dev/skills/x/SKILL.md", h).unwrap(),
            gh("a/b", Some("dev"), Some("skills/x"), None)
        );
        assert_eq!(
            parse("https://skills.sh/vercel-labs/agent-skills/react", h).unwrap(),
            gh("vercel-labs/agent-skills", None, None, Some("react"))
        );
        assert_eq!(
            parse("a/b#v2", h).unwrap(),
            gh("a/b", Some("v2"), None, None)
        );
        assert!(matches!(
            parse("git@gitlab.com:x/y.git", h).unwrap(),
            Spec::Git { .. }
        ));
        assert!(matches!(
            parse("https://gitlab.com/x/y", h).unwrap(),
            Spec::Git { .. }
        ));
        assert!(matches!(
            parse("https://example.com/s.zip", h).unwrap(),
            Spec::Archive { .. }
        ));
        assert!(parse("not a source", h).is_err());
    }

    #[test]
    fn discovers_top_level_skills() {
        let d = tempfile::tempdir().unwrap();
        for p in ["a", "nested/b", "a/examples/inner", "node_modules/c"] {
            std::fs::create_dir_all(d.path().join(p)).unwrap();
            std::fs::write(
                d.path().join(p).join("SKILL.md"),
                "---\nname: x\ndescription: y\n---\n",
            )
            .unwrap();
        }
        assert_eq!(
            discover_local(d.path()),
            vec!["a".to_string(), "nested/b".to_string()]
        );
    }
}

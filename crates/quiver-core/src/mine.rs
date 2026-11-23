//! My Skills: skills the user writes and maintains themselves.
//!
//! They live in a folder the user owns (default `~/Skills`, a git repo), one
//! folder per skill. The canonical store entry `~/.agents/skills/<id>` is a
//! symlink into that folder, so every agent sees the skill while the source
//! of truth stays in the user's repo. Updates never touch these skills.

use crate::Quiver;
use crate::agents::normalize;
use crate::fsutil::{self, Entry, entry};
use crate::model::*;
use crate::scan::raw_scan;
use crate::skill;
use crate::store::{Lock, State};
use anyhow::{Context, Result, bail};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

const README: &str = "# My agent skills\n\n\
Skills I wrote, one folder per skill (each with a `SKILL.md`).\n\n\
Managed with [Quiver](https://github.com/AnkushBL6/quiver): every folder here is \
linked into `~/.agents/skills` and from there into every coding agent \
(Claude Code, Codex, Antigravity, Cursor, Copilot, ...).\n";

impl Quiver {
    /// The My Skills folder, `~` expanded.
    pub fn my_dir(&self) -> PathBuf {
        let raw = self.settings.my_skills_dir.trim();
        self.env
            .expand(if raw.is_empty() { "~/Skills" } else { raw })
    }

    /// Why the configured folder cannot hold the user's skills (it overlaps the
    /// canonical store, an agent's skills folder, or is the home folder).
    pub fn my_dir_problem(&self) -> Option<String> {
        let d = normalize(&self.my_dir());
        let shown = self.env.display(&d);
        if d == normalize(&self.env.home) || self.env.home.starts_with(&d) {
            return Some(format!(
                "{shown} is your home folder; pick a dedicated folder"
            ));
        }
        let c = normalize(&self.canonical_dir());
        if d.starts_with(&c) || c.starts_with(&d) {
            return Some(format!(
                "{shown} overlaps the shared store ~/.agents/skills"
            ));
        }
        for a in self.agents() {
            for ad in a.dirs.iter().map(|x| normalize(x)) {
                if d.starts_with(&ad) || ad.starts_with(&d) {
                    return Some(format!("{shown} overlaps {}'s skills folder", a.name));
                }
            }
        }
        None
    }

    /// The normalized My Skills folder, or None when it is unusable.
    pub(crate) fn my_norm(&self) -> Option<PathBuf> {
        self.my_dir_problem()
            .is_none()
            .then(|| normalize(&self.my_dir()))
    }

    pub(crate) fn ensure_my_dir(&self) -> Result<PathBuf> {
        match self.my_dir_problem() {
            Some(p) => bail!("My Skills folder: {p}"),
            None => Ok(self.my_dir()),
        }
    }

    /// Create the folder and turn it into a git repo (idempotent).
    pub fn my_skills_init(&self) -> Result<MySkillsStatus> {
        let dir = self.ensure_my_dir()?;
        std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        if !dir.join("README.md").exists() {
            fsutil::write_atomic(&dir.join("README.md"), README.as_bytes())?;
        }
        if !dir.join(".gitignore").exists() {
            fsutil::write_atomic(&dir.join(".gitignore"), b".DS_Store\nnode_modules/\n")?;
        }
        if git_bin().is_some() && !is_repo(&dir) {
            git(&dir, &["init", "-q", "-b", "main"])?;
        }
        Ok(self.my_skills_status())
    }

    pub fn my_skills_status(&self) -> MySkillsStatus {
        let dir = self.my_dir();
        let exists = dir.is_dir();
        let git_available = git_bin().is_some();
        let repo = exists && git_available && is_repo(&dir);
        let count = skill_folders(&dir).len();
        let mut st = MySkillsStatus {
            dir: dir.to_string_lossy().into_owned(),
            display_dir: self.env.display(&dir),
            exists,
            git_available,
            is_repo: repo,
            branch: None,
            remote: None,
            github_repo: None,
            ahead: 0,
            behind: 0,
            changes: vec![],
            last_commit: None,
            count,
            problem: self.my_dir_problem(),
        };
        if !repo || st.problem.is_some() {
            return st;
        }
        st.changes = git_changes(&dir).unwrap_or_default();
        if let Ok(out) = git(&dir, &["status", "--porcelain=v2", "--branch"]) {
            for line in out.lines() {
                if let Some(b) = line.strip_prefix("# branch.head ") {
                    st.branch = (b != "(detached)").then(|| b.to_string());
                } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
                    let mut it = ab.split_whitespace();
                    st.ahead = it
                        .next()
                        .and_then(|a| a.trim_start_matches('+').parse().ok())
                        .unwrap_or(0);
                    st.behind = it
                        .next()
                        .and_then(|b| b.trim_start_matches('-').parse().ok())
                        .unwrap_or(0);
                }
            }
        }
        st.remote = git(&dir, &["remote", "get-url", "origin"])
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        st.github_repo = st.remote.as_deref().and_then(github_repo);
        st.last_commit = git(&dir, &["log", "-1", "--format=%h%x00%s%x00%ct"])
            .ok()
            .and_then(|out| {
                let mut it = out.trim_end().splitn(3, '\0');
                Some(Commit {
                    hash: it.next()?.to_string(),
                    subject: it.next()?.to_string(),
                    when_ms: it.next()?.trim().parse::<i64>().ok()? * 1000,
                })
            });
        st
    }

    /// Commit changes. `ids` limits the commit to those skills; empty = everything.
    /// Returns the short hash of the new commit.
    pub fn my_skills_commit(&self, message: &str, ids: &[String]) -> Result<String> {
        let dir = self.my_dir();
        let message = message.trim();
        if message.is_empty() {
            bail!("commit message is empty");
        }
        if !is_repo(&dir) {
            self.my_skills_init()?;
        }
        if ids.is_empty() {
            git(&dir, &["add", "-A"])?;
        } else {
            let mut args = vec!["add", "-A", "--"];
            for id in ids {
                fsutil::safe_rel(id)?;
                args.push(id);
            }
            git(&dir, &args)?;
        }
        let staged = git(&dir, &["diff", "--cached", "--name-only"])?;
        if staged.trim().is_empty() {
            bail!("nothing to commit");
        }
        let mut cmd = git_cmd(&dir)?;
        cmd.args(["commit", "-q", "-m", message]);
        // Commit even when the user never configured an identity.
        if git(&dir, &["config", "user.email"])
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
        {
            cmd.env("GIT_AUTHOR_NAME", "Quiver")
                .env("GIT_AUTHOR_EMAIL", "quiver@localhost")
                .env("GIT_COMMITTER_NAME", "Quiver")
                .env("GIT_COMMITTER_EMAIL", "quiver@localhost");
        }
        run(cmd)?;
        Ok(git(&dir, &["rev-parse", "--short", "HEAD"])?
            .trim()
            .to_string())
    }

    pub fn my_skills_pull(&self) -> Result<String> {
        let dir = self.my_dir();
        let out = git(&dir, &["pull", "--ff-only"])?;
        // New folders from the remote become visible to every agent.
        let _ = self.register_mine();
        Ok(summary(&out, "Already up to date."))
    }

    pub fn my_skills_push(&self) -> Result<String> {
        let dir = self.my_dir();
        let has_upstream = git(&dir, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_ok();
        let out = if has_upstream {
            git(&dir, &["push"])?
        } else {
            git(&dir, &["push", "-u", "origin", "HEAD"])?
        };
        Ok(summary(&out, "Pushed."))
    }

    /// Skill folders in My Skills that have no canonical store entry yet.
    pub(crate) fn unregistered_mine(&self) -> Vec<String> {
        if self.my_dir_problem().is_some() {
            return vec![];
        }
        let canonical = self.canonical_dir();
        skill_folders(&self.my_dir())
            .into_iter()
            .filter(|id| skill::name_error(id).is_none())
            .filter(|id| matches!(entry(&canonical.join(id)), Entry::Missing))
            .collect()
    }

    /// Link every unregistered My Skills folder into the canonical store and
    /// out to the default agents. Returns the registered ids.
    pub fn register_mine(&self) -> Result<Vec<String>> {
        let ids = self.unregistered_mine();
        if ids.is_empty() {
            return Ok(ids);
        }
        let my = self.my_dir();
        let canonical = self.canonical_dir();
        for id in &ids {
            fsutil::symlink_dir(&my.join(id), &canonical.join(id))?;
        }
        let raw = raw_scan(self);
        let defaults = self.default_agents(&raw.agents);
        for id in &ids {
            for agent_id in &defaults {
                if let Some(a) = raw.agents.iter().find(|a| &a.id == agent_id) {
                    let _ = self.link_one(&raw, id, a);
                }
            }
        }
        Ok(ids)
    }

    /// Make any skill one of the user's own: its content moves (or is copied)
    /// into the My Skills folder, upstream tracking is dropped, and every agent
    /// keeps seeing it through the canonical store.
    pub fn make_mine(&self, id: &str) -> Result<()> {
        let my = self.ensure_my_dir()?;
        let my_norm = normalize(&my);
        let canonical = self.canonical_dir();
        let entry_path = canonical.join(id);
        let dest = my.join(id);

        // Unmanaged skills enter the canonical store first.
        if matches!(entry(&entry_path), Entry::Missing) {
            self.adopt(id, None)?;
        }
        let real = normalize(&entry_path);
        if is_mine_path(Some(&my_norm), &real) {
            return Ok(());
        }
        if !my.is_dir() {
            self.my_skills_init()?;
        }
        if dest.exists() || matches!(entry(&dest), Entry::Link { .. }) {
            bail!("{} already exists", self.env.display(&dest));
        }

        let lock = Lock::load(&self.env);
        let mut state = State::load(&self.env);
        let upstream = lock
            .entry(id)
            .map(|e| e.source)
            .or_else(|| {
                state
                    .skills
                    .get(id)
                    .and_then(|s| s.source.as_ref())
                    .filter(|s| s.kind != "local")
                    .map(|s| s.source.clone())
            })
            .filter(|s| !s.is_empty());

        match entry(&entry_path) {
            Entry::Dir => {
                // Move the real folder, then point the store at it.
                fsutil::move_path(&entry_path, &dest)?;
            }
            Entry::Link { resolves: true, .. } => {
                // Linked to some other folder (a dev checkout): copy it, keep the original.
                fsutil::copy_dir(&real, &dest)?;
                fsutil::remove_link(&entry_path)?;
            }
            _ => bail!("`{id}` has no readable folder"),
        }
        if let Err(e) = fsutil::symlink_dir(&dest, &entry_path) {
            // Put things back so the skill never disappears.
            let _ = fsutil::move_path(&dest, &entry_path);
            return Err(e);
        }

        let mut lock = lock;
        if lock.remove(id) {
            lock.save()?;
        }
        let s = state.skill_mut(id);
        s.source = None;
        s.installed_hash = None;
        s.revision = None;
        if upstream.is_some() {
            s.forked_from = upstream;
        }
        state.updates.retain(|u| u.id != id);
        state.save(&self.env)?;
        Ok(())
    }

    /// Editor apps found on this machine, most preferred first.
    pub fn list_editors(&self) -> Vec<EditorApp> {
        if !self.env.probe_system {
            return vec![];
        }
        const KNOWN: &[&str] = &[
            "Visual Studio Code",
            "Cursor",
            "Zed",
            "Windsurf",
            "Antigravity",
            "Sublime Text",
            "Nova",
            "BBEdit",
            "Xcode",
            "TextEdit",
        ];
        let roots = [
            PathBuf::from("/Applications"),
            self.env.home.join("Applications"),
            PathBuf::from("/System/Applications"),
        ];
        KNOWN
            .iter()
            .filter_map(|name| {
                roots
                    .iter()
                    .map(|r| r.join(format!("{name}.app")))
                    .find(|p| p.is_dir())
                    .map(|p| EditorApp {
                        name: (*name).to_string(),
                        path: p.to_string_lossy().into_owned(),
                    })
            })
            .collect()
    }

    /// Open a skill folder in the chosen (or first available) editor.
    pub fn open_in_editor(&self, id: &str) -> Result<()> {
        let path = normalize(&self.canonical_dir().join(id));
        let path = if path.is_dir() {
            path
        } else {
            scan_primary(self, id).context("skill not found")?
        };
        let editors = self.list_editors();
        let app = self
            .settings
            .editor
            .as_ref()
            .and_then(|e| editors.iter().find(|a| &a.name == e))
            .or_else(|| {
                editors
                    .iter()
                    .find(|a| a.name != "TextEdit" && a.name != "Xcode")
            });
        let mut cmd = Command::new("/usr/bin/open");
        match app {
            Some(a) => {
                cmd.arg("-a").arg(&a.path).arg(&path);
            }
            None => {
                cmd.arg("-t").arg(path.join(skill::SKILL_FILE));
            }
        }
        run(cmd).map(|_| ())
    }
}

/// True if `real` (normalized) is a skill folder inside My Skills.
pub(crate) fn is_mine_path(my_norm: Option<&Path>, real: &Path) -> bool {
    my_norm.is_some_and(|m| real.starts_with(m) && real != m)
}

fn scan_primary(q: &Quiver, id: &str) -> Option<PathBuf> {
    raw_scan(q)
        .by_id
        .get(id)?
        .iter()
        .find_map(|l| l.real.clone())
}

/// Skill folders (directories with a SKILL.md, or symlinks to them) in `dir`.
pub(crate) fn skill_folders(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut out: Vec<String> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (!name.starts_with('.') && skill::skill_file(&e.path()).is_some()).then_some(name)
        })
        .collect();
    out.sort();
    out
}

/// Uncommitted file count per skill folder, or None when not a git repo.
pub(crate) fn changes_by_skill(dir: &Path) -> Option<HashMap<String, u32>> {
    if git_bin().is_none() || !is_repo(dir) {
        return None;
    }
    let mut map = HashMap::new();
    for c in git_changes(dir).ok()? {
        if let Some(id) = c.skill_id {
            *map.entry(id).or_insert(0) += 1;
        }
    }
    Some(map)
}

fn git_changes(dir: &Path) -> Result<Vec<GitChange>> {
    let out = git(
        dir,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let mut changes = Vec::new();
    let mut parts = out.split('\0').filter(|p| !p.is_empty());
    while let Some(rec) = parts.next() {
        if rec.len() < 4 {
            continue;
        }
        let (code, path) = rec.split_at(3);
        let code = code.trim();
        if code.starts_with('R') || code.starts_with('C') {
            parts.next(); // original path
        }
        let status = match code {
            "??" => "??",
            c if c.contains('D') => "D",
            c if c.contains('A') => "A",
            c if c.contains('R') => "R",
            _ => "M",
        };
        let skill_id = path
            .split_once('/')
            .map(|(first, _)| first.to_string())
            .filter(|first| {
                dir.join(first).join(skill::SKILL_FILE).exists() || dir.join(first).is_dir()
            });
        changes.push(GitChange {
            path: path.to_string(),
            status: status.into(),
            skill_id,
        });
    }
    Ok(changes)
}

/// "owner/repo" for GitHub remotes (https or ssh).
fn github_repo(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut it = rest.split('/');
    let (o, r) = (it.next()?, it.next()?);
    (!o.is_empty() && !r.is_empty()).then(|| format!("{o}/{r}"))
}

fn summary(out: &str, empty: &str) -> String {
    let s = out.trim();
    if s.is_empty() {
        empty.to_string()
    } else {
        s.to_string()
    }
}

fn git_bin() -> Option<PathBuf> {
    crate::source::find_git().ok()
}

fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn git_cmd(dir: &Path) -> Result<Command> {
    let bin = crate::source::find_git()?;
    let mut cmd = Command::new(bin);
    cmd.arg("-C")
        .arg(dir)
        // Never block on a credential or host-key prompt from a GUI app.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C");
    Ok(cmd)
}

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let mut cmd = git_cmd(dir)?;
    cmd.args(args);
    run(cmd)
}

/// Run a command; stdout on success, stderr (or stdout) as the error otherwise.
fn run(mut cmd: Command) -> Result<String> {
    let out = cmd.output().context("running command")?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // git push/pull report progress on stderr.
        return Ok(if stdout.trim().is_empty() {
            stderr.into_owned()
        } else {
            stdout
        });
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let msg = if err.trim().is_empty() {
        stdout
    } else {
        err.into_owned()
    };
    bail!("{}", msg.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_remotes() {
        assert_eq!(
            github_repo("git@github.com:me/skills.git").as_deref(),
            Some("me/skills")
        );
        assert_eq!(
            github_repo("https://github.com/me/skills").as_deref(),
            Some("me/skills")
        );
        assert_eq!(github_repo("https://gitlab.com/me/skills"), None);
    }
}

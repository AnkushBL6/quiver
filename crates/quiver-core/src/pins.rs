//! Per-project pinned skills.
//!
//! A repository (say a release branch) can keep its own fixed version of a skill
//! while every other project keeps using the shared one in `~/.agents/skills`.
//!
//! # Layout (inside the project: the git root of the chosen folder, else the folder)
//!
//! * `.agents/skills/<pin>/`: the pinned copy. Real files, no links inside.
//!   `SKILL.md` gets `name: <pin>` and a `description` that starts with
//!   "Pinned copy of <skill> for this repository; ..."; everything else is
//!   byte-identical to the source.
//! * For every chosen agent whose project folder isn't `.agents/skills`, a
//!   relative symlink (or, in copy mode, a full copy) at `<projectDir>/<pin>`.
//!   Agents that read `.agents/skills` themselves need nothing.
//! * `quiver-pins.json`: the lock, committed with the repo. Hashes and names
//!   only; no absolute or personal paths.
//!
//! The pin has its own name because Claude Code ranks personal skills above
//! project ones: a project skill named like a global one is silently ignored.
//! With distinct names the outcome never depends on an agent's precedence rules.
//!
//! # Hash (`quiver-pin-v1`, identical on macOS, Linux and Windows)
//!
//! Walk the folder (skipping `.git`, `node_modules`, `.DS_Store`, `Thumbs.db`),
//! hash every file's content with CRLF folded to LF when it is UTF-8 text without
//! NUL bytes, and hash the sorted `path 0x00 file-hash 0x0A` lines. File modes
//! are ignored.
//!
//! Everything that only needs the project folder ([`verify_project`]) works
//! without a home directory, so it runs in a bare CI checkout.

use crate::Quiver;
use crate::agents::{self, Agent};
use crate::compare::{self, Patch};
use crate::fsutil::{self, Entry, entry, normalize};
use crate::github::{Client, Tree};
use crate::model::*;
use crate::scan::{Raw, raw_scan};
use crate::skill;
use crate::store::{Lock, LockEntry};
use anyhow::{Context, Result, anyhow, bail, ensure};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ops::Range;
use std::path::{Path, PathBuf};

/// The committed lock file at the project root.
pub const LOCK_FILE: &str = "quiver-pins.json";
/// Name of the content hash scheme recorded in the docs; the lock stores only digests.
pub const HASH_SCHEME: &str = "quiver-pin-v1";
const LOCK_VERSION: u32 = 1;
/// Where pinned copies live, and the project folder agents read natively.
const PIN_ROOT: &str = ".agents/skills";
const MAX_NAME: usize = 64;
const MAX_DESCRIPTION: usize = 1024;
/// A pin is committed to a repository: keep it a sensible size.
const MAX_FILES: usize = 2000;
const MAX_BYTES: u64 = 50 * 1024 * 1024;
const IGNORED: &[&str] = &[".git", "node_modules", ".DS_Store", "Thumbs.db"];

// ---------- Lock file ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LockPin {
    pub skill: String,
    pub pinned_from: PinnedFrom,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_path: Option<String>,
    #[serde(default)]
    pub git_ref: Option<String>,
    #[serde(default)]
    pub upstream_hash: Option<String>,
    pub hash: String,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    pub pinned_at: String,
    #[serde(default)]
    pub mode: PinMode,
    #[serde(default)]
    pub agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PinLock {
    pub version: u32,
    #[serde(default)]
    pub pins: BTreeMap<String, LockPin>,
}

impl Default for PinLock {
    fn default() -> Self {
        Self {
            version: LOCK_VERSION,
            pins: BTreeMap::new(),
        }
    }
}

/// Read the project's lock. `None` when there is no lock file. Every pin name
/// and skill name is validated: the file is committed, so it may come from anyone.
pub(crate) fn read_lock(root: &Path) -> Result<Option<PinLock>> {
    let path = root.join(LOCK_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("reading {}", path.display())),
    };
    let lock: PinLock = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .with_context(|| format!("{LOCK_FILE} isn't valid ({})", path.display()))?;
    ensure!(
        lock.version <= LOCK_VERSION,
        "{LOCK_FILE} was written by a newer Quiver (lock version {}); update Quiver to read it",
        lock.version
    );
    for (name, pin) in &lock.pins {
        if let Some(e) = pin_name_error(name) {
            bail!("{LOCK_FILE} has a pin named `{name}`: {e}");
        }
        ensure!(
            !pin.skill.is_empty()
                && !pin.skill.contains(['/', '\\'])
                && pin.skill != ".."
                && pin.skill != ".",
            "{LOCK_FILE}: pin `{name}` names an invalid skill `{}`",
            pin.skill
        );
    }
    Ok(Some(lock))
}

/// Pretty JSON, 2-space indent, keys sorted, trailing newline.
fn lock_text(lock: &PinLock) -> Result<String> {
    fn sorted(v: Value) -> Value {
        match v {
            Value::Object(m) => {
                let mut entries: Vec<(String, Value)> = m.into_iter().collect();
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
            }
            Value::Array(a) => Value::Array(a.into_iter().map(sorted).collect()),
            other => other,
        }
    }
    let mut text = serde_json::to_string_pretty(&sorted(serde_json::to_value(lock)?))?;
    text.push('\n');
    Ok(text)
}

/// Write the lock; with no pins left the file is deleted.
fn write_lock(root: &Path, lock: &PinLock) -> Result<()> {
    let path = root.join(LOCK_FILE);
    if lock.pins.is_empty() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e).with_context(|| format!("deleting {}", path.display())),
        };
    }
    fsutil::write_atomic(&path, lock_text(lock)?.as_bytes())
}

// ---------- Names and paths ----------

/// Why `name` can't be a pin name, in plain language.
pub fn pin_name_error(name: &str) -> Option<String> {
    let ok = !name.is_empty()
        && name.len() <= MAX_NAME
        && name.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        });
    (!ok).then(|| {
        format!(
            "Pin names use lowercase letters, digits and single hyphens, like `browser-qa-release` (up to {MAX_NAME} characters)."
        )
    })
}

/// `root` + a `/`-separated relative path, with the platform's separators.
fn rel_path(root: &Path, rel: &str) -> PathBuf {
    rel.split('/')
        .filter(|s| !s.is_empty())
        .fold(root.to_path_buf(), |p, s| p.join(s))
}

fn pin_path(root: &Path, name: &str) -> PathBuf {
    rel_path(root, &format!("{PIN_ROOT}/{name}"))
}

/// The project a folder belongs to: its git root, else the folder itself.
pub fn find_root(path: &Path) -> PathBuf {
    let mut start = normalize(path);
    if start.is_file()
        && let Some(parent) = start.parent()
    {
        start = parent.to_path_buf();
    }
    start
        .ancestors()
        .find(|a| a.join(".git").exists())
        .map(Path::to_path_buf)
        .unwrap_or(start)
}

/// Whether the project is a git repo, and its branch (read from `.git/HEAD`; no `git` needed).
fn git_info(root: &Path) -> (bool, Option<String>) {
    let dot = root.join(".git");
    if !dot.exists() {
        return (false, None);
    }
    let gitdir = if dot.is_dir() {
        dot
    } else {
        // A worktree or submodule: `.git` is a file saying `gitdir: <path>`.
        let Some(target) = std::fs::read_to_string(&dot).ok().and_then(|t| {
            t.trim()
                .strip_prefix("gitdir:")
                .map(|p| p.trim().to_string())
        }) else {
            return (true, None);
        };
        let p = PathBuf::from(target);
        if p.is_absolute() { p } else { root.join(p) }
    };
    let branch = std::fs::read_to_string(gitdir.join("HEAD"))
        .ok()
        .and_then(|h| {
            h.trim()
                .strip_prefix("ref: refs/heads/")
                .map(str::to_string)
        });
    (true, branch)
}

/// Longest existing prefix canonicalised, the rest appended: where `path` really
/// lands once created, even through links that already exist higher up.
fn resolve_existing(path: &Path) -> PathBuf {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        if std::fs::symlink_metadata(&cur).is_ok() {
            let base = normalize(&cur);
            return tail.iter().rev().fold(base, |p, c| p.join(c));
        }
        match (cur.file_name(), cur.parent()) {
            (Some(n), Some(p)) => {
                tail.push(n.to_os_string());
                cur = p.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// `<projectDir>` of an agent in the built-in registry (the lock stores ids only).
fn project_dir_of(agent_id: &str) -> Option<String> {
    agents::builtin()
        .iter()
        .find(|d| d.id == agent_id)
        .and_then(|d| d.project_dir.clone())
        .map(|d| d.trim_matches('/').replace('\\', "/"))
        .filter(|d| !d.is_empty())
}

/// One place an agent entry must exist: `<projectDir>/<pin>`, shared by every
/// agent reading that folder.
struct Slot {
    dir: String,
    agents: Vec<String>,
}

/// The folders `agent_ids` need entries in. `.agents/skills` is read natively.
fn slots_for(agent_ids: &[String]) -> Vec<Slot> {
    let mut slots: Vec<Slot> = Vec::new();
    for id in agent_ids {
        let Some(dir) = project_dir_of(id).filter(|d| d != PIN_ROOT) else {
            continue;
        };
        match slots.iter_mut().find(|s| s.dir == dir) {
            Some(s) => s.agents.push(id.clone()),
            None => slots.push(Slot {
                dir,
                agents: vec![id.clone()],
            }),
        }
    }
    slots
}

// ---------- Hashing ----------

/// Content as hashed: CRLF becomes LF in UTF-8 text without NUL bytes; anything
/// else is used as is.
fn normalise(bytes: &[u8]) -> Cow<'_, [u8]> {
    if bytes.contains(&0)
        || !bytes.windows(2).any(|w| w == b"\r\n")
        || std::str::from_utf8(bytes).is_err()
    {
        return Cow::Borrowed(bytes);
    }
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    Cow::Owned(out)
}

/// What is in a folder, as hashed.
pub(crate) struct Scanned {
    /// `/`-separated relative path to `sha256:<hex>` of the normalised content.
    pub files: BTreeMap<String, String>,
    /// Symlinks met while not following links (a pin must hold none).
    pub links: Vec<String>,
    pub bytes: u64,
}

struct Walk {
    root_real: PathBuf,
    follow: bool,
    out: Scanned,
}

impl Walk {
    fn dir(&mut self, dir: &Path, rel: &str, depth: usize) -> Result<()> {
        ensure!(
            depth <= 32,
            "`{rel}` is nested too deeply (or a link loops back on itself)"
        );
        let mut entries = std::fs::read_dir(dir)
            .with_context(|| format!("reading {}", dir.display()))?
            .collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if IGNORED.contains(&name.as_str()) {
                continue;
            }
            let rel_path = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            let path = e.path();
            let ft = e.file_type()?;
            if ft.is_symlink() {
                if !self.follow {
                    self.out.links.push(rel_path);
                    continue;
                }
                let real = fsutil::canonicalize(&path)
                    .map_err(|_| anyhow!("`{rel_path}` is a link that leads nowhere"))?;
                ensure!(
                    fsutil::starts_with(&real, &self.root_real),
                    "`{rel_path}` is a link that points outside the skill folder; a pin must be self-contained"
                );
                let md = std::fs::metadata(&real)?;
                if md.is_dir() {
                    self.dir(&path, &rel_path, depth + 1)?;
                } else if md.is_file() {
                    self.file(&path, rel_path)?;
                }
            } else if ft.is_dir() {
                self.dir(&path, &rel_path, depth + 1)?;
            } else if ft.is_file() {
                self.file(&path, rel_path)?;
            }
        }
        Ok(())
    }

    fn file(&mut self, path: &Path, rel: String) -> Result<()> {
        let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
        self.out.bytes += bytes.len() as u64;
        self.out.files.insert(
            rel,
            format!("sha256:{}", hex::encode(Sha256::digest(normalise(&bytes)))),
        );
        Ok(())
    }
}

/// Hash every file of `dir`. With `follow`, links inside the folder are read
/// through (as long as they stay inside it); without, they are only reported.
pub(crate) fn scan_folder(dir: &Path, follow: bool) -> Result<Scanned> {
    let mut walk = Walk {
        root_real: normalize(dir),
        follow,
        out: Scanned {
            files: BTreeMap::new(),
            links: vec![],
            bytes: 0,
        },
    };
    walk.dir(dir, "", 0)?;
    Ok(walk.out)
}

/// The folder hash: `sha256:` + sha256 over `path 0x00 file-hash 0x0A` per file.
pub(crate) fn hash_files(files: &BTreeMap<String, String>) -> String {
    let mut h = Sha256::new();
    for (path, file) in files {
        h.update(path.as_bytes());
        h.update([0u8]);
        h.update(file.as_bytes());
        h.update(b"\n");
    }
    format!("sha256:{}", hex::encode(h.finalize()))
}

// ---------- SKILL.md frontmatter ----------

struct Fm {
    yaml_start: usize,
    yaml_end: usize,
}

/// Byte range of the YAML between the `---` fences.
fn locate_fm(text: &str) -> Option<Fm> {
    let bom = if text.starts_with('\u{feff}') { 3 } else { 0 };
    let after = text[bom..].strip_prefix("---")?;
    let nl = after.find('\n')?;
    if !after[..nl].trim().is_empty() {
        return None;
    }
    let yaml_start = bom + 3 + nl + 1;
    let mut at = yaml_start;
    for line in text[yaml_start..].split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some(Fm {
                yaml_start,
                yaml_end: at,
            });
        }
        at += line.len();
    }
    None
}

/// The lines of top-level `key:` and everything indented under it (block
/// scalars, wrapped values), without trailing blank lines.
fn key_block(yaml: &str, key: &str) -> Option<Range<usize>> {
    let mut at = 0;
    let mut start: Option<usize> = None;
    let mut end = 0;
    for line in yaml.split_inclusive('\n') {
        match start {
            None => {
                let is_key = line
                    .strip_prefix(key)
                    .is_some_and(|rest| rest.trim_start_matches([' ', '\t']).starts_with(':'));
                if is_key {
                    start = Some(at);
                    end = at + line.len();
                }
            }
            Some(_) => {
                if line.trim().is_empty() {
                    // Blank lines count only when more of the value follows.
                } else if line.starts_with([' ', '\t']) {
                    end = at + line.len();
                } else {
                    break;
                }
            }
        }
        at += line.len();
    }
    start.map(|s| s..end)
}

/// A double-quoted YAML string (JSON is valid YAML), with the few characters
/// some YAML parsers treat as line breaks escaped.
fn yaml_quote(s: &str) -> String {
    serde_json::to_string(s)
        .unwrap_or_else(|_| "\"\"".into())
        .replace('\u{85}', "\\u0085")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// `name: x`, quoted only where a YAML parser would read something else than a string.
fn name_line(name: &str, eol: &str) -> String {
    let ambiguous = name.bytes().all(|b| b.is_ascii_digit())
        || matches!(
            name,
            "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "y" | "n"
        );
    if ambiguous {
        format!("name: {}{eol}", yaml_quote(name))
    } else {
        format!("name: {name}{eol}")
    }
}

fn eol_of(text: &str, fm: Option<&Fm>) -> &'static str {
    let probe = match fm {
        Some(f) => &text[..f.yaml_end.min(text.len())],
        None => text,
    };
    if probe.contains("\r\n") { "\r\n" } else { "\n" }
}

/// Set `name` and `description` in the frontmatter, leaving every other byte alone.
fn rewrite_frontmatter(text: &str, name: &str, description: &str) -> String {
    let fm = locate_fm(text);
    let eol = eol_of(text, fm.as_ref());
    let desc_line = format!("description: {}{eol}", yaml_quote(description));
    let name_line = name_line(name, eol);
    match fm {
        Some(fm) => {
            let mut yaml = text[fm.yaml_start..fm.yaml_end].to_string();
            for (key, line) in [("description", &desc_line), ("name", &name_line)] {
                match key_block(&yaml, key) {
                    Some(r) => yaml.replace_range(r, line),
                    None => yaml.insert_str(0, line),
                }
            }
            format!("{}{yaml}{}", &text[..fm.yaml_start], &text[fm.yaml_end..])
        }
        None => {
            let bom = if text.starts_with('\u{feff}') { 3 } else { 0 };
            format!(
                "{}---{eol}{name_line}{desc_line}---{eol}{}",
                &text[..bom],
                &text[bom..]
            )
        }
    }
}

fn description_prefix(skill: &str) -> String {
    format!("Pinned copy of {skill} for this repository; use it instead of {skill} here. ")
}

/// The pin's description: a prefix saying what this is, then the original,
/// truncated with an ellipsis so the whole stays within the spec's limit.
fn pin_description(skill: &str, original: &str) -> String {
    let prefix = description_prefix(skill);
    let budget = MAX_DESCRIPTION.saturating_sub(prefix.chars().count());
    let original = original.trim();
    let body = if original.chars().count() <= budget {
        original.to_string()
    } else {
        let mut cut: String = original.chars().take(budget.saturating_sub(1)).collect();
        cut = cut.trim_end().to_string();
        cut.push('…');
        cut
    };
    format!("{prefix}{body}").trim_end().to_string()
}

/// The pin's description without the prefix (all that can be recovered if it was truncated).
fn original_description(pin_description: &str, skill: &str) -> String {
    let prefix = description_prefix(skill);
    pin_description
        .strip_prefix(prefix.trim_end())
        .map(|rest| rest.trim_start().to_string())
        .unwrap_or_else(|| pin_description.to_string())
}

/// The pin's `SKILL.md` as it was before the rewrite, as far as that can be told:
/// the `name` and `description` lines are replaced by the shared copy's own lines
/// when they say the same thing, so they never show as a difference.
fn unrewrite(pin_md: &str, shared_md: &str, pin: &str, skill: &str) -> String {
    let (Some(pf), Some(sf)) = (locate_fm(pin_md), locate_fm(shared_md)) else {
        return pin_md.to_string();
    };
    let pm = skill::parse(pin_md);
    let sm = skill::parse(shared_md);
    let shared_yaml = &shared_md[sf.yaml_start..sf.yaml_end];
    let eol = eol_of(pin_md, Some(&pf));
    let mut yaml = pin_md[pf.yaml_start..pf.yaml_end].to_string();

    if pm.name.as_deref() == Some(pin)
        && let Some(r) = key_block(&yaml, "name")
    {
        let original = key_block(shared_yaml, "name").map_or("", |sr| &shared_yaml[sr]);
        yaml.replace_range(r, original);
    }
    if let Some(d) = pm.description.as_deref()
        && let Some(rest) = d
            .strip_prefix(description_prefix(skill).trim_end())
            .map(str::trim)
        && let Some(r) = key_block(&yaml, "description")
    {
        let same = sm.description.as_deref().is_some_and(|sd| {
            let sd = sd.trim();
            sd == rest
                || (rest.ends_with('…') && sd.starts_with(rest.trim_end_matches('…').trim_end()))
        });
        match key_block(shared_yaml, "description") {
            Some(sr) if same => yaml.replace_range(r, &shared_yaml[sr]),
            _ => yaml.replace_range(r, &format!("description: {}{eol}", yaml_quote(rest))),
        }
    }
    format!(
        "{}{yaml}{}",
        &pin_md[..pf.yaml_start],
        &pin_md[pf.yaml_end..]
    )
}

/// Rewrite the staged copy's SKILL.md for the pin.
fn rewrite_skill_md(dir: &Path, skill: &str, pin: &str) -> Result<()> {
    let path = skill::skill_file(dir).ok_or_else(|| anyhow!("the skill has no SKILL.md"))?;
    let bytes = std::fs::read(&path)?;
    let text = String::from_utf8(bytes).map_err(|_| anyhow!("SKILL.md isn't valid UTF-8 text"))?;
    let original = skill::parse(&text).description.unwrap_or_default();
    let new = rewrite_frontmatter(&text, pin, &pin_description(skill, &original));
    let check = skill::parse(&new);
    ensure!(
        check.name.as_deref() == Some(pin)
            && check
                .description
                .as_deref()
                .is_some_and(|d| d.starts_with("Pinned copy of")),
        "couldn't rewrite the frontmatter of SKILL.md"
    );
    std::fs::write(&path, new).with_context(|| format!("writing {}", path.display()))
}

// ---------- Checking a pin ----------

/// A pin's state plus how its files changed; what `quiver pins verify` prints.
#[derive(Debug, Clone)]
pub struct PinCheck {
    pub pin: Pin,
    /// Relative to the pin's folder.
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
}

fn lock_source(lp: &LockPin) -> Option<SkillSource> {
    Some(SkillSource {
        kind: lp.source_type.clone().unwrap_or_else(|| "unknown".into()),
        source: lp.source.clone()?,
        url: lp.source_url.clone(),
        skill_path: lp.skill_path.clone(),
        git_ref: lp.git_ref.clone(),
        installed_at: None,
        updated_at: None,
    })
}

fn list_some(paths: &[String], max: usize) -> String {
    let shown = paths
        .iter()
        .take(max)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    match paths.len().saturating_sub(max) {
        0 => shown,
        more => format!("{shown} and {more} more"),
    }
}

/// Is `dest` a link (or junction) that leads to `pin_dir`?
fn links_to(dest: &Path, pin_dir: &Path) -> bool {
    if let Ok(real) = fsutil::canonicalize(dest) {
        return real == normalize(pin_dir);
    }
    // A broken link still says where it meant to go.
    match entry(dest) {
        Entry::Link { target, .. } => {
            fsutil::lexical_normalize(&fsutil::link_target_abs(dest, &target))
                == fsutil::lexical_normalize(pin_dir)
        }
        _ => false,
    }
}

/// How one agent's entry for the pin looks.
fn check_agent(
    root: &Path,
    name: &str,
    agent_id: &str,
    mode: PinMode,
    pin_dir: &Path,
    pin_hash: Option<&str>,
) -> PinAgentLink {
    let kind = match mode {
        PinMode::Symlink => PinLinkKind::Symlink,
        PinMode::Copy => PinLinkKind::Copy,
    };
    let fail = |dir: String, kind: PinLinkKind, problem: String| PinAgentLink {
        agent_id: agent_id.to_string(),
        dir,
        kind,
        ok: false,
        problem: Some(problem),
    };
    let known = agents::builtin().iter().any(|d| d.id == agent_id);
    if !known {
        return fail(
            String::new(),
            kind,
            format!("This version of Quiver doesn't know the agent `{agent_id}`."),
        );
    }
    let Some(dir) = project_dir_of(agent_id) else {
        return fail(
            String::new(),
            kind,
            "This agent has no project-level skills folder.".into(),
        );
    };
    let rel = format!("{dir}/{name}");
    if dir == PIN_ROOT {
        return PinAgentLink {
            agent_id: agent_id.to_string(),
            dir: rel,
            kind: PinLinkKind::Native,
            ok: true,
            problem: None,
        };
    }
    let dest = rel_path(root, &rel);
    let problem: Option<String> = match (mode, entry(&dest)) {
        (_, Entry::Missing) => Some(match mode {
            PinMode::Symlink => "The link is missing.".into(),
            PinMode::Copy => "The copy is missing.".into(),
        }),
        (PinMode::Symlink, Entry::Link { .. }) => {
            if links_to(&dest, pin_dir) {
                None
            } else if matches!(entry(&dest), Entry::Link { resolves: false, .. }) {
                Some("The link is broken.".into())
            } else {
                Some("The link points somewhere other than the pinned folder.".into())
            }
        }
        (PinMode::Symlink, Entry::Dir) => {
            Some("This is a real folder, but the pin uses a link to the pinned folder.".into())
        }
        (PinMode::Symlink, Entry::File) => Some(
            "It was checked out as a plain text file because git's `core.symlinks` is false (usual on Windows). Pin with copy mode instead (`quiver pin --copy`).".into(),
        ),
        (PinMode::Copy, Entry::Dir) => match (scan_folder(&dest, false), pin_hash) {
            (Ok(s), Some(h)) if hash_files(&s.files) == h && s.links.is_empty() => None,
            (Ok(_), Some(_)) => Some("The copy differs from the pinned folder.".into()),
            (Ok(_), None) => None,
            (Err(e), _) => Some(format!("The copy can't be read: {e}")),
        },
        (PinMode::Copy, Entry::Link { .. }) => {
            Some("This is a link, but the pin uses copies.".into())
        }
        (PinMode::Copy, Entry::File) => Some("A file is in the way of the copy.".into()),
    };
    PinAgentLink {
        agent_id: agent_id.to_string(),
        dir: rel,
        kind,
        ok: problem.is_none(),
        problem,
    }
}

/// Everything that can be told about a pin from the project folder alone.
pub(crate) fn check_pin(root: &Path, name: &str, lp: &LockPin) -> PinCheck {
    let pin_dir = pin_path(root, name);
    let rel_pin = format!("{PIN_ROOT}/{name}");
    let mut problems: Vec<String> = Vec::new();
    let (mut added, mut removed, mut changed) = (Vec::new(), Vec::new(), Vec::new());
    let mut missing = false;
    let mut modified = false;
    let mut current_hash: Option<String> = None;

    match entry(&pin_dir) {
        Entry::Missing => {
            missing = true;
            problems.push(format!("The pinned folder `{rel_pin}` is missing."));
        }
        Entry::Dir => match scan_folder(&pin_dir, false) {
            Ok(scanned) => {
                for (path, hash) in &scanned.files {
                    match lp.files.get(path) {
                        None => added.push(path.clone()),
                        Some(h) if h != hash => changed.push(path.clone()),
                        _ => {}
                    }
                }
                removed.extend(
                    lp.files
                        .keys()
                        .filter(|p| !scanned.files.contains_key(*p))
                        .cloned(),
                );
                // A link inside a pin makes it depend on something outside it.
                added.extend(scanned.links.iter().cloned());
                let hash = hash_files(&scanned.files);
                modified = hash != lp.hash || !scanned.links.is_empty();
                if modified {
                    let mut all: Vec<String> = added
                        .iter()
                        .chain(&changed)
                        .chain(&removed)
                        .cloned()
                        .collect();
                    all.sort();
                    all.dedup();
                    if all.is_empty() {
                        problems.push(
                            "The lock's hash doesn't match its own list of files; re-pin to repair it.".into(),
                        );
                    } else {
                        problems.push(format!(
                            "{} changed since the pin was made: {}.",
                            if all.len() == 1 {
                                "1 file".to_string()
                            } else {
                                format!("{} files", all.len())
                            },
                            list_some(&all, 6)
                        ));
                    }
                }
                current_hash = Some(hash);
            }
            Err(e) => {
                modified = true;
                problems.push(format!("The pinned folder can't be read: {e:#}"));
            }
        },
        _ => {
            modified = true;
            problems.push(format!("`{rel_pin}` is not a folder."));
        }
    }

    let links: Vec<PinAgentLink> = lp
        .agents
        .iter()
        .map(|id| check_agent(root, name, id, lp.mode, &pin_dir, current_hash.as_deref()))
        .collect();
    if !missing {
        for l in links.iter().filter(|l| !l.ok) {
            let at = if l.dir.is_empty() {
                l.agent_id.clone()
            } else {
                l.dir.clone()
            };
            problems.push(format!("{at}: {}", l.problem.as_deref().unwrap_or("")));
        }
    }
    let state = if missing {
        PinState::Missing
    } else if modified {
        PinState::Modified
    } else if links.iter().any(|l| !l.ok) {
        PinState::Links
    } else {
        PinState::Ok
    };
    for v in [&mut added, &mut removed, &mut changed] {
        v.sort();
        v.dedup();
    }
    let mut changed_files: Vec<String> = added
        .iter()
        .chain(&removed)
        .chain(&changed)
        .cloned()
        .collect();
    changed_files.sort();
    changed_files.dedup();

    let description = skill::read_meta(&pin_dir)
        .and_then(|m| m.description)
        .map(|d| original_description(&d, &lp.skill))
        .unwrap_or_default();
    PinCheck {
        pin: Pin {
            name: name.to_string(),
            skill: lp.skill.clone(),
            description,
            source: lock_source(lp),
            git_ref: lp.git_ref.clone(),
            pinned_from: lp.pinned_from,
            pinned_at: lp.pinned_at.clone(),
            hash: lp.hash.clone(),
            upstream_hash: lp.upstream_hash.clone(),
            state,
            changed_files,
            problems,
            shared_changed: None,
            name_clash: vec![],
            mode: lp.mode,
            agents: links,
            path: pin_dir.to_string_lossy().into_owned(),
        },
        added,
        removed,
        changed,
    }
}

/// Check every pin of the project at `root` (already a project root) from its
/// files alone: offline, and without a home directory or any global state.
/// `shared_changed` and `name_clash` are left empty; they need the machine's
/// shared skills.
pub fn verify_project(root: &Path) -> Result<Vec<PinCheck>> {
    let Some(lock) = read_lock(root)? else {
        return Ok(vec![]);
    };
    Ok(lock
        .pins
        .iter()
        .map(|(name, lp)| check_pin(root, name, lp))
        .collect())
}

// ---------- GitHub access (replaceable in tests) ----------

/// What pinning at a ref needs from GitHub.
pub trait PinRemote {
    /// The full commit SHA a tag, branch or SHA points at.
    fn resolve_commit(&self, repo: &str, git_ref: &str) -> Result<String>;
    fn tree(&self, repo: &str, commit: &str) -> Result<Tree>;
    /// Download `folder` of the repo at `commit` into `dest`.
    fn download_folder(
        &self,
        repo: &str,
        commit: &str,
        tree: &Tree,
        folder: &str,
        dest: &Path,
    ) -> Result<()>;
}

impl PinRemote for Client {
    fn resolve_commit(&self, repo: &str, git_ref: &str) -> Result<String> {
        Client::resolve_commit(self, repo, git_ref)
    }
    fn tree(&self, repo: &str, commit: &str) -> Result<Tree> {
        Client::tree(self, repo, commit)
    }
    fn download_folder(
        &self,
        repo: &str,
        commit: &str,
        tree: &Tree,
        folder: &str,
        dest: &Path,
    ) -> Result<()> {
        Client::download_folder(self, repo, commit, tree, folder, dest)
    }
}

// ---------- Changing the project ----------

/// Bookkeeping for a change that can be undone: what was created, and what was
/// moved aside (to be restored, or trashed once the change is final).
struct Journal {
    /// Where moved-aside items go; created on first use.
    tmp_parent: PathBuf,
    tmp: Option<tempfile::TempDir>,
    aside: Vec<Aside>,
    links: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
    parents: Vec<PathBuf>,
}

struct Aside {
    now: PathBuf,
    original: PathBuf,
    /// Could hold something the user wrote: goes to the Trash rather than away.
    precious: bool,
}

impl Journal {
    fn new(root: &Path) -> Self {
        Self {
            tmp_parent: rel_path(root, ".agents"),
            tmp: None,
            aside: vec![],
            links: vec![],
            dirs: vec![],
            parents: vec![],
        }
    }

    /// Create `path` and any missing parents below `root`, remembering which.
    fn ensure_dir(&mut self, root: &Path, path: &Path) -> Result<()> {
        let rel = path.strip_prefix(root).unwrap_or(path);
        let mut cur = root.to_path_buf();
        for c in rel.components() {
            cur.push(c);
            if std::fs::symlink_metadata(&cur).is_err() {
                std::fs::create_dir(&cur).with_context(|| format!("creating {}", cur.display()))?;
                self.parents.push(cur.clone());
            }
        }
        Ok(())
    }

    /// Move `path` out of the way.
    fn put_aside(&mut self, path: &Path, precious: bool) -> Result<()> {
        if self.tmp.is_none() {
            std::fs::create_dir_all(&self.tmp_parent)?;
            self.tmp = Some(
                tempfile::Builder::new()
                    .prefix(".quiver-tmp-")
                    .tempdir_in(&self.tmp_parent)?,
            );
        }
        let base = self.tmp.as_ref().map(|t| t.path().to_path_buf());
        let slot = base
            .context("temp folder")?
            .join(format!("old-{}", self.aside.len()))
            .join(path.file_name().unwrap_or_default());
        fsutil::move_path(path, &slot)
            .with_context(|| format!("moving {} out of the way", path.display()))?;
        self.aside.push(Aside {
            now: slot,
            original: path.to_path_buf(),
            precious,
        });
        Ok(())
    }

    /// Undo everything, newest first.
    fn rollback(&mut self) {
        for l in self.links.drain(..).rev() {
            let _ = fsutil::remove_link(&l);
        }
        for d in self.dirs.drain(..).rev() {
            let _ = std::fs::remove_dir_all(&d);
        }
        for a in self.aside.drain(..).rev() {
            let _ = fsutil::move_path(&a.now, &a.original);
        }
        self.tmp = None;
        for p in self.parents.drain(..).rev() {
            let _ = std::fs::remove_dir(&p);
        }
    }

    /// The change is final: precious leftovers go to the Trash, the rest is dropped.
    fn finish(&mut self, q: &Quiver) {
        for a in self.aside.drain(..) {
            if a.precious {
                let _ = q.discard(&a.now);
            }
        }
        self.tmp = None;
    }
}

/// Create the entry for `<slot.dir>/<name>`, or repair it. A wrong entry is moved aside first.
#[allow(clippy::too_many_arguments)]
fn ensure_slot(
    root: &Path,
    pin_dir: &Path,
    pin_hash: &str,
    slot: &Slot,
    name: &str,
    mode: PinMode,
    j: &mut Journal,
) -> Result<()> {
    let dest = rel_path(root, &format!("{}/{name}", slot.dir));
    let healthy = {
        let agent = &slot.agents[0];
        check_agent(root, name, agent, mode, pin_dir, Some(pin_hash)).ok
    };
    if healthy {
        return Ok(());
    }
    match entry(&dest) {
        Entry::Missing => {}
        Entry::Link { .. } => fsutil::remove_link(&dest)?,
        Entry::Dir => j.put_aside(&dest, true)?,
        Entry::File => {
            std::fs::remove_file(&dest).with_context(|| format!("removing {}", dest.display()))?;
        }
    }
    if let Some(parent) = dest.parent() {
        j.ensure_dir(root, parent)?;
    }
    match mode {
        PinMode::Symlink => {
            fsutil::symlink_dir_relative(pin_dir, &dest).map_err(|e| {
                if cfg!(windows) {
                    anyhow!(
                        "{e:#}. Windows only allows symlinks with Developer Mode or admin rights; pin with copy mode instead (`quiver pin --copy`)."
                    )
                } else {
                    e
                }
            })?;
            j.links.push(dest);
        }
        PinMode::Copy => {
            j.dirs.push(dest.clone());
            fsutil::copy_dir(pin_dir, &dest)?;
        }
    }
    Ok(())
}

/// The new pin folder, staged beside the project, with what was learned about it.
struct Staged {
    pinned_from: PinnedFrom,
    git_ref: Option<String>,
    source: SourceInfo,
    upstream_hash: String,
    files: BTreeMap<String, String>,
    hash: String,
}

/// Where the skill came from, as far as the global lock says (portable fields only).
#[derive(Debug, Clone, Default)]
struct SourceInfo {
    source: Option<String>,
    source_type: Option<String>,
    source_url: Option<String>,
    skill_path: Option<String>,
}

impl SourceInfo {
    fn of(lp: &LockPin) -> Self {
        Self {
            source: lp.source.clone(),
            source_type: lp.source_type.clone(),
            source_url: lp.source_url.clone(),
            skill_path: lp.skill_path.clone(),
        }
    }

    /// A source worth recording in a committed file: not a path on this machine.
    fn of_global(e: &LockEntry) -> Option<Self> {
        let portable = !e.source.is_empty()
            && e.source_type != "local"
            && !Path::new(&e.source).is_absolute()
            && !e.source.starts_with('~')
            && !e.source.contains('\\');
        portable.then(|| Self {
            source: Some(e.source.clone()),
            source_type: Some(e.source_type.clone()),
            source_url: e.source_url.clone(),
            skill_path: e.skill_path.clone(),
        })
    }
}

fn skill_folder(skill_path: &str) -> String {
    skill_path
        .trim_end_matches("SKILL.md")
        .trim_end_matches('/')
        .to_string()
}

fn now_iso_secs() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Copy a skill folder into `dest`, reading links inside it (but never outside it).
fn copy_folder(src: &Path, dest: &Path) -> Result<()> {
    let scanned = scan_folder(src, true)?;
    ensure!(
        scanned.files.len() <= MAX_FILES && scanned.bytes <= MAX_BYTES,
        "this skill is too big to pin ({} files, {} MB); a pin is committed to the repository",
        scanned.files.len(),
        scanned.bytes / (1024 * 1024)
    );
    std::fs::create_dir_all(dest)?;
    for rel in scanned.files.keys() {
        let from = rel_path(src, rel);
        let to = rel_path(dest, rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&from, &to).with_context(|| format!("copying {}", from.display()))?;
    }
    Ok(())
}

/// Remove ignorable entries (`.git`, `node_modules`, `.DS_Store`, ...) from a downloaded folder.
fn prune_ignored(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let path = e.path();
        if IGNORED.contains(&name.as_str()) {
            let _ = std::fs::remove_dir_all(&path).or_else(|_| std::fs::remove_file(&path));
        } else if e.file_type().is_ok_and(|t| t.is_dir()) {
            prune_ignored(&path);
        }
    }
}

// ---------- Quiver: projects and pins ----------

impl Quiver {
    /// A folder as the project it belongs to, for reading. The folder may be gone.
    fn read_root(&self, path: &str) -> PathBuf {
        let p = self.env.expand(path.trim());
        if p.exists() { find_root(&p) } else { p }
    }

    /// Every global skills folder and who reads it: pins must never land in one.
    fn global_dirs(&self, agents: &[Agent]) -> Vec<(PathBuf, String)> {
        let mut out = vec![(
            normalize(&self.canonical_dir()),
            "your shared skills folder (~/.agents/skills)".to_string(),
        )];
        for a in agents {
            for d in a.dirs.iter().chain(std::iter::once(&a.install_dir)) {
                out.push((normalize(d), format!("{}'s global skills folder", a.name)));
            }
        }
        out
    }

    /// The safety rules for changing a project.
    fn check_root(&self, root: &Path) -> Result<()> {
        let root_n = normalize(root);
        ensure!(
            root_n != normalize(&self.env.home),
            "Refusing to use your home folder as a project: pins there would sit among your personal skills. Pick a repository folder."
        );
        let globals = self.global_dirs(&self.agents());
        for (g, label) in &globals {
            ensure!(
                !fsutil::starts_with(&root_n, g),
                "{} is inside {label}. Pick a repository folder instead.",
                self.env.display(&root_n)
            );
        }
        let pins = resolve_existing(&rel_path(&root_n, PIN_ROOT));
        for (g, label) in &globals {
            ensure!(
                !fsutil::starts_with(&pins, g),
                "`.agents/skills` in this project is the same folder as {label}; pins must stay inside the project."
            );
        }
        Ok(())
    }

    /// A link folder (`.claude/skills`, ...) must not lead out of the project into a global folder.
    fn check_slot_dir(&self, root: &Path, dir: &str) -> Result<()> {
        let real = resolve_existing(&rel_path(&normalize(root), dir));
        for (g, label) in self.global_dirs(&self.agents()) {
            ensure!(
                !fsutil::starts_with(&real, &g),
                "`{dir}` in this project leads into {label}; Quiver won't write there."
            );
        }
        Ok(())
    }

    /// The project root for a change: an existing folder that passes the safety rules.
    fn writable_root(&self, path: &str) -> Result<PathBuf> {
        let p = self.env.expand(path.trim());
        ensure!(
            p.is_dir(),
            "{} isn't a folder on this machine",
            self.env.display(&p)
        );
        let root = find_root(&p);
        self.check_root(&root)?;
        Ok(root)
    }

    /// Why `name` can't name a pin because of skills installed globally.
    fn global_clash(&self, raw: &Raw, name: &str) -> Option<String> {
        let locs = raw.by_id.get(name)?;
        if locs.iter().all(|l| l.kind == LocationKind::Plugin) {
            return None;
        }
        let ids = clash_agents(raw, name);
        let who = ids
            .iter()
            .filter_map(|id| raw.agents.iter().find(|a| &a.id == id))
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>();
        let where_ = if who.is_empty() {
            "your global skills".to_string()
        } else {
            format!("your global skills ({})", who.join(", "))
        };
        Some(format!(
            "A skill named `{name}` already exists in {where_}. Claude Code ranks personal skills above project ones, so a project skill with that name would be ignored. Give the pin its own name, like `{name}-pinned`."
        ))
    }

    fn name_problem(&self, raw: &Raw, root: Option<&Path>, name: &str) -> Option<String> {
        if let Some(e) = pin_name_error(name) {
            return Some(e);
        }
        if let Some(e) = self.global_clash(raw, name) {
            return Some(e);
        }
        let root = root?;
        if let Ok(Some(lock)) = read_lock(root)
            && lock.pins.contains_key(name)
        {
            return Some(format!("`{name}` is already a pin in this project."));
        }
        if !matches!(entry(&pin_path(root, name)), Entry::Missing) {
            return Some(format!(
                "`{PIN_ROOT}/{name}` already exists in this project."
            ));
        }
        None
    }

    /// Whether `name` can be used for a new pin in `project`, and if not why.
    pub fn pin_check_name(&self, project: &str, name: &str) -> NameCheck {
        let name = name.trim();
        let root = {
            let r = self.read_root(project);
            r.is_dir().then_some(r)
        };
        let raw = raw_scan(self);
        match self.name_problem(&raw, root.as_deref(), name) {
            None => NameCheck {
                ok: true,
                message: None,
            },
            Some(message) => NameCheck {
                ok: false,
                message: Some(message),
            },
        }
    }

    /// The agents a new pin is made for.
    fn pin_agents(&self, agents: &[Agent], requested: &[String]) -> Result<Vec<String>> {
        let mut ids: Vec<String> = Vec::new();
        if requested.is_empty() {
            for id in self.default_agents(agents) {
                let usable = agents
                    .iter()
                    .find(|a| a.id == id)
                    .and_then(|a| a.project_dir.as_deref())
                    // Generic folders (`skills`, `data/skills`) may be something else in a repo.
                    .is_some_and(|d| d.starts_with('.'));
                if usable && !ids.contains(&id) {
                    ids.push(id);
                }
            }
            ensure!(
                !ids.is_empty(),
                "No coding agent with a project skills folder was detected on this machine. Choose agents explicitly, e.g. `--agents claude-code,codex`."
            );
        } else {
            for id in requested {
                let id = id.trim();
                let agent = agents
                    .iter()
                    .find(|a| a.id == id)
                    .ok_or_else(|| anyhow!("unknown agent `{id}`"))?;
                ensure!(
                    agent.project_dir.is_some(),
                    "{} has no project-level skills folder, so Quiver can't pin skills for it.",
                    agent.name
                );
                if !ids.iter().any(|i| i == id) {
                    ids.push(id.to_string());
                }
            }
        }
        Ok(ids)
    }

    /// The shared copy of `skill` (resolved to its real folder).
    fn shared_dir(&self, skill: &str) -> Result<PathBuf> {
        ensure!(
            !skill.is_empty() && !skill.contains(['/', '\\']) && skill != "..",
            "invalid skill name `{skill}`"
        );
        let p = self.canonical_dir().join(skill);
        let real = match entry(&p) {
            Entry::Dir | Entry::Link { resolves: true, .. } => normalize(&p),
            _ => bail!(
                "`{skill}` isn't in your shared skills ({}). Run `quiver adopt {skill}` first.",
                self.env.display(&self.canonical_dir())
            ),
        };
        ensure!(
            real.is_dir() && skill::skill_file(&real).is_some(),
            "`{skill}` in your shared skills has no SKILL.md"
        );
        Ok(real)
    }

    fn global_source(&self, skill: &str) -> Option<SourceInfo> {
        Lock::load(&self.env)
            .entry(skill)
            .and_then(|e| SourceInfo::of_global(&e))
    }

    /// Put the pin's content in `dest` (a not yet existing folder): the shared
    /// copy, or the skill's GitHub source at `git_ref`. Then rewrite SKILL.md and hash it.
    fn stage_content(
        &self,
        skill: &str,
        name: &str,
        git_ref: Option<&str>,
        remote: &dyn PinRemote,
        dest: &Path,
        prev: Option<&LockPin>,
    ) -> Result<Staged> {
        let global = self.global_source(skill);
        let known = global.clone().or_else(|| prev.map(SourceInfo::of));
        let (pinned_from, resolved_ref, source) = match git_ref
            .map(str::trim)
            .filter(|r| !r.is_empty())
        {
            None => {
                copy_folder(&self.shared_dir(skill)?, dest)?;
                (PinnedFrom::Shared, None, known.unwrap_or_default())
            }
            Some(r) => {
                let src = known
                    .filter(|s| s.source.is_some() && s.source_type.as_deref() == Some("github"));
                let src = src.ok_or_else(|| {
                        anyhow!(
                            "`{skill}` has no GitHub source recorded, so there is no repository to take `{r}` from. Leave the ref off to pin your shared copy."
                        )
                    })?;
                let repo = src.source.clone().unwrap_or_default();
                let hint = skill_folder(src.skill_path.as_deref().unwrap_or(""));
                let sha = remote.resolve_commit(&repo, r)?;
                let tree = remote.tree(&repo, &sha)?;
                let folder = tree.locate(&hint).ok_or_else(|| {
                    anyhow!("`{skill}` doesn't exist in {repo} at `{r}` (looked for `{hint}`)")
                })?;
                remote.download_folder(&repo, &sha, &tree, &folder, dest)?;
                prune_ignored(dest);
                ensure!(
                    skill::skill_file(dest).is_some(),
                    "{repo} at `{r}` has no SKILL.md for `{skill}`"
                );
                let scanned = scan_folder(dest, false)?;
                ensure!(
                    scanned.files.len() <= MAX_FILES && scanned.bytes <= MAX_BYTES,
                    "this skill is too big to pin"
                );
                let skill_path = if folder.is_empty() {
                    "SKILL.md".to_string()
                } else {
                    format!("{folder}/SKILL.md")
                };
                (
                    PinnedFrom::Github,
                    Some(sha),
                    SourceInfo {
                        skill_path: Some(skill_path),
                        ..src
                    },
                )
            }
        };
        let upstream = scan_folder(dest, false)?;
        let upstream_hash = hash_files(&upstream.files);
        rewrite_skill_md(dest, skill, name)?;
        let after = scan_folder(dest, false)?;
        Ok(Staged {
            pinned_from,
            git_ref: resolved_ref,
            source,
            upstream_hash,
            hash: hash_files(&after.files),
            files: after.files,
        })
    }

    /// Pin a skill into a project. See [`PinRequest`].
    pub fn pin_create(&self, req: &PinRequest) -> Result<ProjectDetail> {
        self.pin_create_with(req, &self.github())
    }

    /// [`Self::pin_create`] with the GitHub access supplied (tests use a stand-in).
    pub fn pin_create_with(
        &self,
        req: &PinRequest,
        remote: &dyn PinRemote,
    ) -> Result<ProjectDetail> {
        let root = self.writable_root(&req.project)?;
        let name = req.name.trim();
        let skill = req.skill.trim();
        let raw = raw_scan(self);
        if let Some(problem) = self.name_problem(&raw, Some(&root), name) {
            bail!("{problem}");
        }
        let agent_ids = self.pin_agents(&raw.agents, &req.agents)?;
        let slots = slots_for(&agent_ids);
        for s in &slots {
            self.check_slot_dir(&root, &s.dir)?;
            let dest = rel_path(&root, &format!("{}/{name}", s.dir));
            ensure!(
                matches!(entry(&dest), Entry::Missing),
                "`{}/{name}` already exists in this project",
                s.dir
            );
        }
        let mut lock = read_lock(&root)?.unwrap_or_default();

        let mut j = Journal::new(&root);
        let agents_dir = rel_path(&root, ".agents");
        j.ensure_dir(&root, &agents_dir)?;
        // Staged inside the project, so the final rename never crosses a filesystem.
        let stage = match tempfile::Builder::new()
            .prefix(".quiver-tmp-")
            .tempdir_in(&agents_dir)
        {
            Ok(stage) => stage,
            Err(e) => {
                j.rollback();
                return Err(anyhow!(e).context("creating a staging folder"));
            }
        };
        let result = (|| -> Result<()> {
            let fresh = stage.path().join(name);
            let staged =
                self.stage_content(skill, name, req.git_ref.as_deref(), remote, &fresh, None)?;
            let pin_dir = pin_path(&root, name);
            j.ensure_dir(&root, pin_dir.parent().context("pin folder has no parent")?)?;
            std::fs::rename(&fresh, &pin_dir)
                .with_context(|| format!("moving the pin into {}", pin_dir.display()))?;
            j.dirs.push(pin_dir.clone());
            for s in &slots {
                ensure_slot(&root, &pin_dir, &staged.hash, s, name, req.mode, &mut j)?;
            }
            lock.pins.insert(
                name.to_string(),
                lock_pin(skill, staged, req.mode, agent_ids.clone()),
            );
            write_lock(&root, &lock)
        })();
        drop(stage);
        match result {
            Ok(()) => {
                j.finish(self);
                self.project_detail(&root.to_string_lossy())
            }
            Err(e) => {
                j.rollback();
                Err(e)
            }
        }
    }

    /// Re-pin: from the current shared copy (`git_ref` `None`), or from the
    /// skill's GitHub source at a tag, branch or commit.
    pub fn pin_update(
        &self,
        project: &str,
        name: &str,
        git_ref: Option<&str>,
    ) -> Result<ProjectDetail> {
        self.pin_update_with(project, name, git_ref, &self.github())
    }

    pub fn pin_update_with(
        &self,
        project: &str,
        name: &str,
        git_ref: Option<&str>,
        remote: &dyn PinRemote,
    ) -> Result<ProjectDetail> {
        let root = self.writable_root(project)?;
        let mut lock = read_lock(&root)?.unwrap_or_default();
        let prev = lock
            .pins
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("`{name}` isn't a pin in this project"))?;
        let slots = slots_for(&prev.agents);
        for s in &slots {
            self.check_slot_dir(&root, &s.dir)?;
        }
        let was_modified = check_pin(&root, name, &prev).pin.state == PinState::Modified;
        let pin_dir = pin_path(&root, name);

        let mut j = Journal::new(&root);
        let agents_dir = rel_path(&root, ".agents");
        j.ensure_dir(&root, &agents_dir)?;
        let stage = match tempfile::Builder::new()
            .prefix(".quiver-tmp-")
            .tempdir_in(&agents_dir)
        {
            Ok(stage) => stage,
            Err(e) => {
                j.rollback();
                return Err(anyhow!(e).context("creating a staging folder"));
            }
        };
        let result = (|| -> Result<()> {
            let fresh = stage.path().join(name);
            let staged =
                self.stage_content(&prev.skill, name, git_ref, remote, &fresh, Some(&prev))?;
            if !matches!(entry(&pin_dir), Entry::Missing) {
                j.put_aside(&pin_dir, was_modified)?;
            }
            j.ensure_dir(&root, pin_dir.parent().context("pin folder has no parent")?)?;
            std::fs::rename(&fresh, &pin_dir)
                .with_context(|| format!("moving the pin into {}", pin_dir.display()))?;
            j.dirs.push(pin_dir.clone());
            if prev.mode == PinMode::Copy {
                // Stale copies are replaced; a copy someone edited goes to the Trash.
                for s in &slots {
                    let dest = rel_path(&root, &format!("{}/{name}", s.dir));
                    if matches!(entry(&dest), Entry::Dir) {
                        let edited = scan_folder(&dest, false)
                            .map(|c| hash_files(&c.files) != prev.hash)
                            .unwrap_or(true);
                        j.put_aside(&dest, edited)?;
                    }
                }
            }
            for s in &slots {
                ensure_slot(&root, &pin_dir, &staged.hash, s, name, prev.mode, &mut j)?;
            }
            lock.pins.insert(
                name.to_string(),
                lock_pin(&prev.skill, staged, prev.mode, prev.agents.clone()),
            );
            write_lock(&root, &lock)
        })();
        drop(stage);
        match result {
            Ok(()) => {
                j.finish(self);
                self.project_detail(&root.to_string_lossy())
            }
            Err(e) => {
                j.rollback();
                Err(e)
            }
        }
    }

    /// Accept the pin's files as they are now: the lock takes their hashes. For a
    /// deliberate hand edit of a pin, so `verify` passes again.
    pub fn pin_accept(&self, project: &str, name: &str) -> Result<ProjectDetail> {
        let root = self.writable_root(project)?;
        let mut lock = read_lock(&root)?.unwrap_or_default();
        let pin_dir = pin_path(&root, name);
        let lp = lock
            .pins
            .get_mut(name)
            .ok_or_else(|| anyhow!("`{name}` isn't a pin in this project"))?;
        ensure!(
            matches!(entry(&pin_dir), Entry::Dir),
            "the pinned folder `{PIN_ROOT}/{name}` is missing; there is nothing to accept"
        );
        let scanned = scan_folder(&pin_dir, false)?;
        ensure!(
            scanned.files.len() <= MAX_FILES && scanned.bytes <= MAX_BYTES,
            "this pin is too big"
        );
        ensure!(
            scanned.links.is_empty(),
            "the pinned folder contains links ({}); a pin must be self-contained",
            list_some(&scanned.links, 3)
        );
        lp.hash = hash_files(&scanned.files);
        lp.files = scanned.files;
        write_lock(&root, &lock)?;
        self.pin_sync(&root.to_string_lossy())
    }

    /// Stop pinning `name`: the pinned folder and its copies go to the Trash,
    /// links to it are removed, and the lock entry goes (the lock file too when
    /// no pin is left).
    pub fn pin_remove(&self, project: &str, name: &str) -> Result<ProjectDetail> {
        let root = self.writable_root(project)?;
        let mut lock = read_lock(&root)?.unwrap_or_default();
        let lp = lock
            .pins
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("`{name}` isn't a pin in this project"))?;
        let pin_dir = pin_path(&root, name);
        let slots = slots_for(&lp.agents);
        for s in &slots {
            self.check_slot_dir(&root, &s.dir)?;
            let dest = rel_path(&root, &format!("{}/{name}", s.dir));
            match entry(&dest) {
                Entry::Link { .. } if links_to(&dest, &pin_dir) => fsutil::remove_link(&dest)?,
                Entry::Dir if lp.mode == PinMode::Copy => self.discard(&dest)?,
                Entry::File => {
                    // git's text stand-in for a symlink (`core.symlinks=false`).
                    let stand_in = std::fs::metadata(&dest).is_ok_and(|m| m.len() < 1024)
                        && std::fs::read_to_string(&dest)
                            .is_ok_and(|t| t.trim().ends_with(&format!("{PIN_ROOT}/{name}")));
                    if stand_in {
                        std::fs::remove_file(&dest)?;
                    }
                }
                _ => {}
            }
        }
        match entry(&pin_dir) {
            Entry::Dir => self.discard(&pin_dir)?,
            Entry::Link { .. } => fsutil::remove_link(&pin_dir)?,
            _ => {}
        }
        lock.pins.remove(name);
        write_lock(&root, &lock)?;
        // Folders this left empty.
        for dir in slots.iter().map(|s| s.dir.as_str()).chain([PIN_ROOT]) {
            let mut cur = rel_path(&root, dir);
            while cur != root && std::fs::remove_dir(&cur).is_ok() {
                if !cur.pop() {
                    break;
                }
            }
        }
        self.project_detail(&root.to_string_lossy())
    }

    /// Recreate missing or wrong links and copies from the pinned folders. Never
    /// changes what a pin contains.
    pub fn pin_sync(&self, project: &str) -> Result<ProjectDetail> {
        let root = self.writable_root(project)?;
        let Some(lock) = read_lock(&root)? else {
            return self.project_detail(&root.to_string_lossy());
        };
        let mut j = Journal::new(&root);
        let result = (|| -> Result<()> {
            for (name, lp) in &lock.pins {
                let pin_dir = pin_path(&root, name);
                if !matches!(entry(&pin_dir), Entry::Dir) {
                    continue;
                }
                let scanned = scan_folder(&pin_dir, false)?;
                let hash = hash_files(&scanned.files);
                for s in slots_for(&lp.agents) {
                    self.check_slot_dir(&root, &s.dir)?;
                    ensure_slot(&root, &pin_dir, &hash, &s, name, lp.mode, &mut j)?;
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                j.finish(self);
                self.project_detail(&root.to_string_lossy())
            }
            Err(e) => {
                j.rollback();
                Err(e)
            }
        }
    }

    // ----- Reading -----

    fn pins_from_checks(&self, checks: Vec<PinCheck>, lock: Option<&PinLock>) -> Vec<Pin> {
        if checks.is_empty() {
            return vec![];
        }
        let raw = raw_scan(self);
        checks
            .into_iter()
            .map(|c| {
                let mut pin = c.pin;
                if let Some(lp) = lock.and_then(|l| l.pins.get(&pin.name)) {
                    pin.shared_changed = self.shared_changed(lp);
                }
                pin.name_clash = clash_agents(&raw, &pin.name);
                pin
            })
            .collect()
    }

    /// Does this machine's shared copy differ from what the pin was made from?
    fn shared_changed(&self, lp: &LockPin) -> Option<bool> {
        let upstream = lp.upstream_hash.as_deref()?;
        let real = self.shared_dir(&lp.skill).ok()?;
        let scanned = scan_folder(&real, true).ok()?;
        Some(hash_files(&scanned.files) != upstream)
    }

    fn summarize(&self, root: &Path, pin_count: usize, problem_count: usize) -> ProjectSummary {
        let (is_repo, branch) = git_info(root);
        ProjectSummary {
            path: root.to_string_lossy().into_owned(),
            display_path: self.env.display(root),
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.to_string_lossy().into_owned()),
            branch,
            is_repo,
            exists: root.is_dir(),
            pin_count,
            problem_count,
        }
    }

    fn summary_of(&self, root: &Path) -> ProjectSummary {
        let checks = if root.is_dir() {
            verify_project(root).unwrap_or_default()
        } else {
            vec![]
        };
        let problems = checks
            .iter()
            .filter(|c| c.pin.state != PinState::Ok)
            .count();
        self.summarize(root, checks.len(), problems)
    }

    /// Every registered project, with how many pins it has and how many need attention.
    pub fn projects_list(&self) -> Vec<ProjectSummary> {
        self.settings
            .projects
            .par_iter()
            .map(|p| self.summary_of(Path::new(p)))
            .collect()
    }

    /// Register a project (its git root, or the folder) so the app lists it and
    /// skills show where they are pinned. Registering twice changes nothing.
    pub fn project_add(&mut self, path: &str) -> Result<ProjectSummary> {
        let root = self.writable_root(path)?;
        let shown = root.to_string_lossy().into_owned();
        if !self
            .settings
            .projects
            .iter()
            .any(|p| normalize(Path::new(p)) == normalize(&root))
        {
            let mut s = self.settings.clone();
            s.projects.push(shown);
            self.save_settings(s)?;
        }
        Ok(self.summary_of(&root))
    }

    /// Forget a project. Never touches any file in it.
    pub fn project_remove(&mut self, path: &str) -> Result<()> {
        let want = self.read_root(path);
        let mut s = self.settings.clone();
        let before = s.projects.len();
        s.projects.retain(|p| {
            let p = Path::new(p);
            p != want && normalize(p) != normalize(&want)
        });
        if s.projects.len() != before {
            self.save_settings(s)?;
        }
        Ok(())
    }

    /// One project: its pins with their state, and the other skills in it.
    pub fn project_detail(&self, path: &str) -> Result<ProjectDetail> {
        let root = self.read_root(path);
        if !root.is_dir() {
            return Ok(ProjectDetail {
                summary: self.summarize(&root, 0, 0),
                pins: vec![],
                other_skills: vec![],
                lock_file: None,
            });
        }
        let lock = read_lock(&root)?;
        let checks = verify_project(&root)?;
        let pins = self.pins_from_checks(checks, lock.as_ref());
        let names: BTreeSet<String> = pins.iter().map(|p| p.name.clone()).collect();
        let problems = pins.iter().filter(|p| p.state != PinState::Ok).count();
        Ok(ProjectDetail {
            summary: self.summarize(&root, pins.len(), problems),
            other_skills: other_skills(&root, &names),
            lock_file: root
                .join(LOCK_FILE)
                .is_file()
                .then(|| root.join(LOCK_FILE).to_string_lossy().into_owned()),
            pins,
        })
    }

    // ----- Comparing -----

    /// The shared copy and the pin as two versions, with the pin's `SKILL.md`
    /// compared as if its `name` and `description` had never been rewritten.
    pub fn pin_compare(&self, project: &str, name: &str) -> Result<CopyComparison> {
        let ctx = self.compare_ctx(project, name)?;
        let shared_hash = skill::folder_hash(&ctx.shared_dir)
            .ok_or_else(|| anyhow!("the shared copy of `{}` can't be read", ctx.lp.skill))?;
        let pin_hash = skill::folder_hash(&ctx.pin_dir)
            .ok_or_else(|| anyhow!("the pinned folder can't be read"))?;
        let stats = |d: &Path| skill::stats(d);
        let (s1, s2) = (stats(&ctx.shared_dir), stats(&ctx.pin_dir));
        let edited = check_pin(&ctx.root, name, &ctx.lp).pin.state == PinState::Modified;
        let versions = vec![
            SkillVersion {
                id: "v1".into(),
                content_hash: shared_hash,
                locations: ctx.shared_locations,
                agent_ids: ctx.shared_agents,
                shared: true,
                modified_ms: s1.modified_ms,
                file_count: s1.file_count,
                size_bytes: s1.size_bytes,
                newest: false,
                edited_since_install: None,
            },
            SkillVersion {
                id: "v2".into(),
                content_hash: pin_hash,
                locations: vec![VersionLocation {
                    path: ctx.pin_dir.to_string_lossy().into_owned(),
                    agent_ids: vec![],
                    kind: LocationKind::Directory,
                }],
                agent_ids: vec![],
                shared: false,
                modified_ms: s2.modified_ms,
                file_count: s2.file_count,
                size_bytes: s2.size_bytes,
                newest: false,
                edited_since_install: Some(edited),
            },
        ];
        let skill_name = skill::read_meta(&ctx.shared_dir)
            .and_then(|m| m.name)
            .unwrap_or_else(|| ctx.lp.skill.clone());
        Ok(compare::compare_folders(
            &ctx.lp.skill,
            &skill_name,
            versions,
            &[
                (ctx.shared_dir.as_path(), None),
                (ctx.pin_dir.as_path(), ctx.patch.as_ref()),
            ],
        ))
    }

    /// Line diff of one file between the shared copy and the pin. `left_hash` and
    /// `right_hash` are the `contentHash` of the two versions from [`Self::pin_compare`],
    /// in either order.
    pub fn pin_compare_file(
        &self,
        project: &str,
        name: &str,
        path: &str,
        left_hash: &str,
        right_hash: &str,
    ) -> Result<FileDiff> {
        let ctx = self.compare_ctx(project, name)?;
        let shared_hash = skill::folder_hash(&ctx.shared_dir);
        let pin_hash = skill::folder_hash(&ctx.pin_dir);
        let side = |hash: &str| -> Result<compare::Folder<'_>> {
            if shared_hash.as_deref() == Some(hash) {
                Ok((ctx.shared_dir.as_path(), None))
            } else if pin_hash.as_deref() == Some(hash) {
                Ok((ctx.pin_dir.as_path(), ctx.patch.as_ref()))
            } else {
                bail!(
                    "`{name}` or its shared copy changed since the comparison was loaded; reload it"
                )
            }
        };
        compare::diff_folder_file(path, side(left_hash)?, side(right_hash)?)
    }

    fn compare_ctx(&self, project: &str, name: &str) -> Result<CompareCtx> {
        let root = self.read_root(project);
        let lock = read_lock(&root)?.unwrap_or_default();
        let lp = lock
            .pins
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("`{name}` isn't a pin in this project"))?;
        let pin_dir = pin_path(&root, name);
        ensure!(
            matches!(entry(&pin_dir), Entry::Dir),
            "the pinned folder `{PIN_ROOT}/{name}` is missing"
        );
        let (shared_dir, shared_locations, shared_agents) = compare::shared_copy(self, &lp.skill)
            .map_err(|_| {
                anyhow!(
                    "`{}` isn't in your shared skills on this machine, so there is nothing to compare the pin with",
                    lp.skill
                )
            })?;
        let patch = match (skill::skill_file(&pin_dir), skill::skill_file(&shared_dir)) {
            (Some(pf), Some(sf)) => {
                match (std::fs::read_to_string(&pf), std::fs::read_to_string(&sf)) {
                    (Ok(pin_md), Ok(shared_md)) => Some(Patch {
                        path: pf
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| skill::SKILL_FILE.into()),
                        bytes: unrewrite(&pin_md, &shared_md, name, &lp.skill).into_bytes(),
                    }),
                    _ => None,
                }
            }
            _ => None,
        };
        Ok(CompareCtx {
            root,
            lp,
            pin_dir,
            shared_dir,
            shared_locations,
            shared_agents,
            patch,
        })
    }
}

struct CompareCtx {
    root: PathBuf,
    lp: LockPin,
    pin_dir: PathBuf,
    shared_dir: PathBuf,
    shared_locations: Vec<VersionLocation>,
    shared_agents: Vec<String>,
    patch: Option<Patch>,
}

fn lock_pin(skill: &str, staged: Staged, mode: PinMode, agents: Vec<String>) -> LockPin {
    LockPin {
        skill: skill.to_string(),
        pinned_from: staged.pinned_from,
        source: staged.source.source,
        source_type: staged.source.source_type,
        source_url: staged.source.source_url,
        skill_path: staged.source.skill_path,
        git_ref: staged.git_ref,
        upstream_hash: Some(staged.upstream_hash),
        hash: staged.hash,
        files: staged.files,
        pinned_at: now_iso_secs(),
        mode,
        agents,
    }
}

/// Agents whose GLOBAL skills folders hold a skill called `name`.
fn clash_agents(raw: &Raw, name: &str) -> Vec<String> {
    let Some(locs) = raw.by_id.get(name) else {
        return vec![];
    };
    let mut ids: BTreeSet<String> = BTreeSet::new();
    for l in locs {
        match l.kind {
            LocationKind::Plugin => {}
            LocationKind::Canonical => ids.extend(
                raw.agents
                    .iter()
                    .filter(|a| a.reads_canonical && a.active())
                    .map(|a| a.id.clone()),
            ),
            _ => ids.extend(l.agents.iter().cloned()),
        }
    }
    ids.into_iter().collect()
}

// ---------- Other skills in a project ----------

/// `name -> source` from the project's `skills-lock.json` (the `skills` CLI's lock).
fn skills_lock_sources(root: &Path) -> HashMap<String, String> {
    let Some(v) = std::fs::read_to_string(root.join("skills-lock.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
    else {
        return HashMap::new();
    };
    v.get("skills")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, e)| {
                    e.get("source")
                        .and_then(Value::as_str)
                        .map(|s| (k.clone(), s.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Skill folders in the project that aren't Quiver pins: in `.agents/skills` and
/// in every agent's project folder. One entry per real folder.
fn other_skills(root: &Path, pin_names: &BTreeSet<String>) -> Vec<ProjectSkill> {
    let sources = skills_lock_sources(root);
    let mut dirs: Vec<String> = vec![PIN_ROOT.to_string()];
    dirs.extend(
        agents::builtin()
            .iter()
            .filter_map(|a| a.project_dir.as_deref())
            .map(|d| d.trim_matches('/').to_string())
            // Folders like `skills` or `data/skills` may hold anything in a repo.
            .filter(|d| d.starts_with('.') && d != PIN_ROOT)
            .collect::<BTreeSet<_>>(),
    );
    let root_n = normalize(root);
    let mut seen: HashSet<PathBuf> = pin_names
        .iter()
        .map(|n| normalize(&pin_path(root, n)))
        .collect();
    let mut out: Vec<ProjectSkill> = Vec::new();
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(rel_path(root, &d)) else {
            continue;
        };
        let mut names: Vec<String> = rd
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.') && !pin_names.contains(n))
            .collect();
        names.sort();
        for n in names {
            let path = rel_path(root, &format!("{d}/{n}"));
            let real = normalize(&path);
            if !real.is_dir()
                || !fsutil::starts_with(&real, &root_n)
                || skill::skill_file(&real).is_none()
                || !seen.insert(real.clone())
            {
                continue;
            }
            let meta = skill::read_meta(&real);
            out.push(ProjectSkill {
                name: meta
                    .as_ref()
                    .and_then(|m| m.name.clone())
                    .unwrap_or_else(|| n.clone()),
                description: meta.and_then(|m| m.description).unwrap_or_default(),
                dir: format!("{d}/{n}"),
                source: sources.get(&n).cloned(),
            });
        }
    }
    out.sort_by(|a, b| (&a.name, &a.dir).cmp(&(&b.name, &b.dir)));
    out
}

// ---------- Pins on skills (inventory) ----------

/// Pins per skill id, from every registered project's lock. Projects that are
/// gone or whose lock can't be read are skipped.
pub(crate) fn pinned_index(q: &Quiver) -> HashMap<String, Vec<PinRef>> {
    let per_project: Vec<Vec<(String, PinRef)>> = q
        .settings
        .projects
        .par_iter()
        .map(|p| {
            let root = PathBuf::from(p);
            let Some(lock) = root
                .is_dir()
                .then(|| read_lock(&root).ok().flatten())
                .flatten()
            else {
                return vec![];
            };
            let project_name = root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone());
            lock.pins
                .iter()
                .map(|(name, lp)| {
                    (
                        lp.skill.clone(),
                        PinRef {
                            project: p.clone(),
                            project_name: project_name.clone(),
                            pin: name.clone(),
                            state: check_pin(&root, name, lp).pin.state,
                        },
                    )
                })
                .collect()
        })
        .collect();
    let mut index: HashMap<String, Vec<PinRef>> = HashMap::new();
    for (skill, r) in per_project.into_iter().flatten() {
        index.entry(skill).or_default().push(r);
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_rule() {
        for ok in ["a", "browser-qa-release", "a1-b2", &"a".repeat(64)] {
            assert!(pin_name_error(ok).is_none(), "{ok}");
        }
        for bad in [
            "",
            "-a",
            "a-",
            "a--b",
            "A",
            "a_b",
            "a b",
            "../x",
            "a/b",
            &"a".repeat(65),
        ] {
            assert!(pin_name_error(bad).is_some(), "{bad}");
        }
    }

    #[test]
    fn crlf_is_folded_only_in_text() {
        assert_eq!(normalise(b"a\r\nb\r\n").as_ref(), b"a\nb\n");
        assert_eq!(normalise(b"a\rb").as_ref(), b"a\rb", "lone CR stays");
        assert_eq!(normalise(b"a\r\n\0b").as_ref(), b"a\r\n\0b", "NUL = binary");
        assert_eq!(normalise(b"\xff\r\n").as_ref(), b"\xff\r\n", "not UTF-8");
        assert_eq!(normalise(b"a\nb").as_ref(), b"a\nb");
    }

    #[test]
    fn folder_hash_matches_the_spec() {
        let mut files = BTreeMap::new();
        files.insert("a.txt".to_string(), "sha256:aa".to_string());
        files.insert("b/c.txt".to_string(), "sha256:bb".to_string());
        let mut expected = Sha256::new();
        expected.update(b"a.txt\0sha256:aa\nb/c.txt\0sha256:bb\n");
        assert_eq!(
            hash_files(&files),
            format!("sha256:{}", hex::encode(expected.finalize()))
        );
        // Known answer for the empty folder: sha256 of nothing.
        assert_eq!(
            hash_files(&BTreeMap::new()),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn frontmatter_rewrite_changes_only_name_and_description() {
        let md = "---\nname: pdf\ndescription: |\n  Work with PDFs.\n  More.\nlicense: MIT\nallowed-tools: [Read]\n---\n\n# PDF\n";
        let out = rewrite_frontmatter(md, "pdf-pinned", "Pinned copy. Work with PDFs.");
        assert_eq!(
            out,
            "---\nname: pdf-pinned\ndescription: \"Pinned copy. Work with PDFs.\"\nlicense: MIT\nallowed-tools: [Read]\n---\n\n# PDF\n"
        );
        let m = skill::parse(&out);
        assert_eq!(m.name.as_deref(), Some("pdf-pinned"));
        assert_eq!(m.license.as_deref(), Some("MIT"));
    }

    #[test]
    fn frontmatter_rewrite_handles_crlf_missing_keys_and_no_frontmatter() {
        let crlf = "---\r\nname: a\r\ndescription: d\r\n---\r\nbody\r\n";
        let out = rewrite_frontmatter(crlf, "a-pinned", "x");
        assert_eq!(
            out,
            "---\r\nname: a-pinned\r\ndescription: \"x\"\r\n---\r\nbody\r\n"
        );
        let bare = "---\nlicense: MIT\n---\nbody\n";
        let out = rewrite_frontmatter(bare, "p", "d");
        assert_eq!(
            out,
            "---\nname: p\ndescription: \"d\"\nlicense: MIT\n---\nbody\n"
        );
        let none = "# just text\n";
        let out = rewrite_frontmatter(none, "p", "d");
        assert_eq!(out, "---\nname: p\ndescription: \"d\"\n---\n# just text\n");
        // Names YAML would read as something else are quoted.
        assert!(rewrite_frontmatter("---\nname: x\n---\n", "123", "d").contains("name: \"123\""));
        assert!(rewrite_frontmatter("---\nname: x\n---\n", "no", "d").contains("name: \"no\""));
    }

    #[test]
    fn descriptions_are_prefixed_and_truncated_to_the_limit() {
        let d = pin_description("browser-qa", "Tests the browser.");
        assert_eq!(
            d,
            "Pinned copy of browser-qa for this repository; use it instead of browser-qa here. Tests the browser."
        );
        let long = "word ".repeat(400);
        let d = pin_description("browser-qa", &long);
        assert!(
            d.chars().count() <= MAX_DESCRIPTION,
            "{}",
            d.chars().count()
        );
        assert!(d.ends_with('…'));
        assert!(d.starts_with("Pinned copy of browser-qa"));
        // A long skill name still fits.
        let name = "n".repeat(64);
        let d = pin_description(&name, &long);
        assert!(d.chars().count() <= MAX_DESCRIPTION);
        assert_eq!(
            original_description(&pin_description("x", "orig"), "x"),
            "orig"
        );
    }

    #[test]
    fn unrewrite_restores_the_shared_lines_when_they_say_the_same() {
        let shared = "---\nname: Browser QA\ndescription: >\n  Tests the\n  browser.\nlicense: MIT\n---\nbody\n";
        let pin = rewrite_frontmatter(
            shared,
            "browser-qa-pinned",
            &pin_description("browser-qa", "Tests the browser."),
        );
        assert_ne!(pin, shared);
        assert_eq!(
            unrewrite(&pin, shared, "browser-qa-pinned", "browser-qa"),
            shared
        );

        // A description that really changed still shows, without the prefix.
        let changed = shared.replace("Tests the\n  browser.", "Tests everything.");
        let out = unrewrite(&pin, &changed, "browser-qa-pinned", "browser-qa");
        assert!(out.contains("description: \"Tests the browser.\""), "{out}");
        assert!(out.contains("name: Browser QA"));
    }

    #[test]
    fn unrewrite_copes_with_truncated_descriptions() {
        let long = "word ".repeat(400);
        let shared = format!("---\nname: s\ndescription: {long}\n---\nbody\n");
        let pin = rewrite_frontmatter(&shared, "s-pinned", &pin_description("s", &long));
        assert_eq!(unrewrite(&pin, &shared, "s-pinned", "s"), shared);
    }

    #[test]
    fn lock_text_is_sorted_pretty_and_ends_with_a_newline() {
        let mut lock = PinLock::default();
        lock.pins.insert(
            "p".into(),
            LockPin {
                skill: "s".into(),
                pinned_from: PinnedFrom::Shared,
                source: Some("o/r".into()),
                source_type: Some("github".into()),
                source_url: None,
                skill_path: None,
                git_ref: None,
                upstream_hash: Some("sha256:u".into()),
                hash: "sha256:h".into(),
                files: BTreeMap::from([
                    ("z".to_string(), "sha256:2".to_string()),
                    ("a".to_string(), "sha256:1".to_string()),
                ]),
                pinned_at: "2026-11-23T14:00:00Z".into(),
                mode: PinMode::Symlink,
                agents: vec!["claude-code".into()],
            },
        );
        let t = lock_text(&lock).unwrap();
        assert!(t.ends_with("}\n"));
        let keys: Vec<&str> = t
            .lines()
            .filter(|l| l.starts_with("      \""))
            .map(|l| l.trim().split('"').nth(1).unwrap())
            .collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "{t}");
        assert!(t.contains("\"gitRef\": null"));
        assert!(!t.contains("sourceUrl"), "unknown fields are omitted");
        let back: PinLock = serde_json::from_str(&t).unwrap();
        assert_eq!(back.pins["p"].files.len(), 2);
    }
}

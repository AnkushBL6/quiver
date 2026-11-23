//! Compare conflicting copies of one skill: which copy "has the fix"?
//!
//! * [`Quiver::compare_copies`] groups the real copies (shared store and agent
//!   folders) into versions by content, and says per version how new it is,
//!   how many files it has and whether it was edited since install, and per
//!   file whether it is the same everywhere. Purely local, no network.
//! * [`Quiver::compare_upstream`] asks GitHub which versions equal the latest
//!   upstream folder. Separate on purpose: it fails soft (offline, rate limit)
//!   and the comparison never waits for it.
//! * [`Quiver::compare_file`] is the line diff of one file between two versions,
//!   as side-by-side rows with intra-line changes and collapsed unchanged runs.

use crate::Quiver;
use crate::agents::Agent;
use crate::fsutil::{normalize, safe_rel, starts_with};
use crate::github::{Client, Tree};
use crate::model::*;
use crate::scan::{RawLoc, raw_scan};
use crate::skill;
use crate::sources::git_tree_sha;
use crate::updates::Tracked;
use anyhow::{Result, anyhow, ensure};
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use similar::{Algorithm, DiffOp, capture_diff_slices, capture_diff_slices_deadline};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

/// Files bigger than this are listed but never line-diffed.
pub const MAX_DIFF_BYTES: u64 = 512 * 1024;
/// More lines than this on either side is treated as too large, whatever the bytes.
const MAX_DIFF_LINES: usize = 20_000;
/// Unchanged lines kept around every change.
const CONTEXT: usize = 3;
/// A run of unchanged lines shorter than this is never collapsed.
const MIN_HIDDEN: usize = 3;
/// The diff algorithm gives up on perfect output after this long.
const DIFF_BUDGET: Duration = Duration::from_secs(2);
/// Lines in a replaced block are paired up when at least this similar.
const PAIR_MIN_SIMILARITY: f32 = 0.45;
/// Pairing is a dynamic program; beyond this many cells lines are paired by position.
const PAIR_MAX_CELLS: usize = 10_000;
/// Lines longer than this skip the token diff when deciding whether to pair them.
const PAIR_MAX_LINE: usize = 2_000;
const BINARY_SNIFF: usize = 8_000;

// ---------- Versions ----------

/// Copies with identical content.
struct Group {
    hash: String,
    /// A real folder holding this content.
    dir: PathBuf,
    copies: Vec<VersionLocation>,
    agents: BTreeSet<String>,
    shared: bool,
}

/// Group a skill's real copies into versions by content hash. The shared copy
/// comes first, then agent folders in scan order, then links to elsewhere, so the
/// numbering matches the copies Health lists.
fn group_versions(locs: &[RawLoc], agents: &[Agent]) -> Vec<Group> {
    let mut hashes: HashMap<PathBuf, Option<String>> = HashMap::new();
    let mut hash_of = |p: &PathBuf| -> Option<String> {
        hashes
            .entry(p.clone())
            .or_insert_with(|| skill::folder_hash(p))
            .clone()
    };
    let rank = |k: LocationKind| match k {
        LocationKind::Canonical => 0,
        LocationKind::Directory => 1,
        _ => 2,
    };
    let mut copies: Vec<&RawLoc> = locs
        .iter()
        .filter(|l| {
            matches!(
                l.kind,
                LocationKind::Canonical | LocationKind::Directory | LocationKind::ForeignLink
            ) && l.real.is_some()
        })
        .collect();
    copies.sort_by_key(|l| rank(l.kind));

    let mut groups: Vec<Group> = Vec::new();
    for l in copies {
        let Some(real) = &l.real else { continue };
        let Some(hash) = hash_of(real) else { continue };
        let at = match groups.iter().position(|g| g.hash == hash) {
            Some(i) => i,
            None => {
                groups.push(Group {
                    hash,
                    dir: real.clone(),
                    copies: vec![],
                    agents: BTreeSet::new(),
                    shared: false,
                });
                groups.len() - 1
            }
        };
        let g = &mut groups[at];
        g.copies.push(VersionLocation {
            path: l.path.to_string_lossy().into_owned(),
            agent_ids: l.agents.clone(),
            kind: l.kind,
        });
        g.agents.extend(l.agents.iter().cloned());
        g.shared |= l.kind == LocationKind::Canonical;
    }
    // Agents that see a version through a link.
    for l in locs.iter().filter(|l| l.kind == LocationKind::Link) {
        let Some(hash) = l.real.as_ref().and_then(&mut hash_of) else {
            continue;
        };
        if let Some(g) = groups.iter_mut().find(|g| g.hash == hash) {
            g.agents.extend(l.agents.iter().cloned());
        }
    }
    // Agents that read the shared store directly.
    if let Some(g) = groups.iter_mut().find(|g| g.shared) {
        g.agents.extend(
            agents
                .iter()
                .filter(|a| a.reads_canonical && a.active())
                .map(|a| a.id.clone()),
        );
    }
    groups
}

fn groups_of(q: &Quiver, id: &str) -> Result<(Vec<Group>, Vec<Agent>)> {
    let raw = raw_scan(q);
    let locs = raw
        .by_id
        .get(id)
        .ok_or_else(|| anyhow!("skill `{id}` not found"))?;
    let groups = group_versions(locs, &raw.agents);
    ensure!(
        !groups.is_empty(),
        "`{id}` has no readable copies to compare"
    );
    Ok((groups, raw.agents))
}

/// Whether `dir` still equals what was installed. `None` when nothing was recorded.
fn edited_since_install(t: &Tracked, dir: &Path, content_hash: &str) -> Option<bool> {
    let mut recorded = false;
    let mut matches = false;
    if let Some(h) = &t.installed_hash {
        recorded = true;
        matches |= h == content_hash;
    }
    if let Some(rev) = &t.current {
        match t.source.kind.as_str() {
            // The lock file stores the git tree sha of the folder as installed.
            "github" => {
                recorded = true;
                matches |= git_tree_sha(dir).as_deref() == Some(rev.as_str());
            }
            "local" => {
                recorded = true;
                matches |= rev == content_hash;
            }
            _ => {}
        }
    }
    recorded.then_some(!matches)
}

// ---------- Files ----------

struct FileInfo {
    size: u64,
    digest: String,
    content: FileContent,
}

/// One file whose bytes are replaced when two folders are compared: a pin's
/// `SKILL.md` with its rewritten `name` and `description` put back.
pub(crate) struct Patch {
    /// Path relative to the folder, `/` separated.
    pub path: String,
    pub bytes: Vec<u8>,
}

/// A folder to compare, with the patch (if any) applied to it.
pub(crate) type Folder<'a> = (&'a Path, Option<&'a Patch>);

fn read_tree(dir: &Path, patch: Option<&Patch>) -> BTreeMap<String, FileInfo> {
    let mut out = BTreeMap::new();
    let walk = WalkDir::new(dir)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| {
            !(e.file_type().is_dir() && skill::skip_dir(&e.file_name().to_string_lossy()))
        })
        .flatten();
    for e in walk {
        if !e.file_type().is_file() {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        let Some(info) = file_info(e.path(), meta.len()) else {
            continue;
        };
        let rel = e
            .path()
            .strip_prefix(dir)
            .unwrap_or(e.path())
            .to_string_lossy()
            .replace('\\', "/");
        out.insert(rel, info);
    }
    if let Some(p) = patch
        && out.contains_key(&p.path)
    {
        out.insert(p.path.clone(), bytes_info(&p.bytes));
    }
    out
}

fn bytes_info(bytes: &[u8]) -> FileInfo {
    FileInfo {
        size: bytes.len() as u64,
        digest: hex::encode(Sha256::digest(bytes)),
        content: if is_binary(bytes) {
            FileContent::Binary
        } else {
            FileContent::Text
        },
    }
}

fn file_info(path: &Path, size: u64) -> Option<FileInfo> {
    if size > MAX_DIFF_BYTES {
        // Hash without holding it in memory.
        let mut f = std::fs::File::open(path).ok()?;
        let mut h = Sha256::new();
        std::io::copy(&mut f, &mut h).ok()?;
        return Some(FileInfo {
            size,
            digest: hex::encode(h.finalize()),
            content: FileContent::TooLarge,
        });
    }
    let bytes = std::fs::read(path).ok()?;
    Some(FileInfo {
        size,
        ..bytes_info(&bytes)
    })
}

/// A NUL byte near the start, or bytes that aren't UTF-8: no line diff.
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF).any(|b| *b == 0) || std::str::from_utf8(bytes).is_err()
}

fn compare_files(trees: &[BTreeMap<String, FileInfo>]) -> Vec<FileCompare> {
    let paths: BTreeSet<&String> = trees.iter().flat_map(|t| t.keys()).collect();
    let mut files: Vec<FileCompare> = paths
        .into_iter()
        .map(|path| {
            let infos: Vec<Option<&FileInfo>> = trees.iter().map(|t| t.get(path)).collect();
            let present: Vec<&FileInfo> = infos.iter().flatten().copied().collect();
            let status = if present.len() < infos.len() {
                FileStatus::Partial
            } else if present.iter().all(|f| f.digest == present[0].digest) {
                FileStatus::Same
            } else {
                FileStatus::Changed
            };
            let has = |c: FileContent| present.iter().any(|f| f.content == c);
            let content = if has(FileContent::Binary) {
                FileContent::Binary
            } else if has(FileContent::TooLarge) {
                FileContent::TooLarge
            } else {
                FileContent::Text
            };
            FileCompare {
                path: path.clone(),
                status,
                content,
                variants: infos
                    .iter()
                    .map(|f| {
                        f.map(|f| FileVariant {
                            size: f.size,
                            digest: f.digest.clone(),
                        })
                    })
                    .collect(),
            }
        })
        .collect();
    files.sort_by(|a, b| {
        (a.path != skill::SKILL_FILE, &a.path).cmp(&(b.path != skill::SKILL_FILE, &b.path))
    });
    files
}

/// Which two versions to show first: the shared copy (or the first) against the
/// newest of the others.
fn suggest(versions: &[SkillVersion]) -> Option<(String, String)> {
    let left = versions.iter().position(|v| v.shared).unwrap_or(0);
    let right = versions
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != left)
        .max_by_key(|(i, v)| (v.modified_ms.unwrap_or(i64::MIN), std::cmp::Reverse(*i)))
        .map(|(i, _)| i)?;
    Some((versions[left].id.clone(), versions[right].id.clone()))
}

/// Index of the version modified strictly after every other one.
fn newest(modified: &[Option<i64>]) -> Option<usize> {
    if modified.len() < 2 || modified.iter().any(Option::is_none) {
        return None;
    }
    let top = modified.iter().flatten().max()?;
    let mut at = modified
        .iter()
        .enumerate()
        .filter(|(_, m)| **m == Some(*top));
    let first = at.next()?.0;
    at.next().is_none().then_some(first)
}

/// Versions equal to the latest upstream folder, given each version's git tree sha.
fn upstream_matches(
    tree: &Tree,
    folder: &str,
    versions: &[(String, Option<String>)],
) -> Result<Vec<String>, String> {
    let at = tree
        .locate(folder)
        .ok_or_else(|| format!("`{folder}` no longer exists upstream"))?;
    let latest = tree
        .folder_sha(&at)
        .ok_or_else(|| format!("`{at}` not found in the upstream tree"))?;
    Ok(versions
        .iter()
        .filter(|(_, sha)| sha.as_deref() == Some(latest.as_str()))
        .map(|(hash, _)| hash.clone())
        .collect())
}

impl Quiver {
    /// Group the skill's real copies into versions and compare their files.
    /// Local only: never touches the network.
    pub fn compare_copies(&self, id: &str) -> Result<CopyComparison> {
        let (groups, agents) = groups_of(self, id)?;
        let tracked = self.tracked_where(|i| i == id).into_iter().next();
        let trees: Vec<BTreeMap<String, FileInfo>> =
            groups.par_iter().map(|g| read_tree(&g.dir, None)).collect();
        let stats: Vec<skill::Stats> = groups.par_iter().map(|g| skill::stats(&g.dir)).collect();
        let edited: Vec<Option<bool>> = groups
            .par_iter()
            .map(|g| {
                tracked
                    .as_ref()
                    .filter(|t| !t.live_link)
                    .and_then(|t| edited_since_install(t, &g.dir, &g.hash))
            })
            .collect();
        let newest = newest(&stats.iter().map(|s| s.modified_ms).collect::<Vec<_>>());

        let versions: Vec<SkillVersion> = groups
            .iter()
            .enumerate()
            .map(|(i, g)| SkillVersion {
                id: format!("v{}", i + 1),
                content_hash: g.hash.clone(),
                locations: g.copies.clone(),
                agent_ids: agents
                    .iter()
                    .filter(|a| g.agents.contains(&a.id))
                    .map(|a| a.id.clone())
                    .collect(),
                shared: g.shared,
                modified_ms: stats[i].modified_ms,
                file_count: stats[i].file_count,
                size_bytes: stats[i].size_bytes,
                newest: newest == Some(i),
                edited_since_install: edited[i],
            })
            .collect();
        let name = skill::read_meta(&groups[0].dir)
            .and_then(|m| m.name)
            .unwrap_or_else(|| id.to_string());
        Ok(CopyComparison {
            skill_id: id.to_string(),
            name,
            files: compare_files(&trees),
            upstream_source: tracked
                .filter(|t| t.source.kind == "github" && !t.live_link)
                .map(|t| t.source.source),
            suggested: suggest(&versions),
            versions,
        })
    }

    /// Which versions equal the latest upstream folder on GitHub. One tree
    /// request with short timeouts; every failure comes back as
    /// [`UpstreamStatus::Unavailable`] with a message, never as an error.
    pub fn compare_upstream(&self, id: &str) -> Result<UpstreamCheck> {
        let (groups, _) = groups_of(self, id)?;
        let tracked = self
            .tracked_where(|i| i == id)
            .into_iter()
            .next()
            .filter(|t| t.source.kind == "github" && !t.live_link);
        let Some(t) = tracked else {
            return Ok(UpstreamCheck {
                status: UpstreamStatus::NoSource,
                source: None,
                matching_hashes: vec![],
                message: None,
            });
        };
        let unavailable = |message: String| UpstreamCheck {
            status: UpstreamStatus::Unavailable,
            source: Some(t.source.source.clone()),
            matching_hashes: vec![],
            message: Some(message),
        };
        let gh = Client::with_timeouts(
            crate::store::github_token(&self.env).map(|(t, _)| t),
            Duration::from_secs(5),
            Duration::from_secs(12),
        );
        let git_ref = t.source.git_ref.clone().unwrap_or_else(|| "HEAD".into());
        let tree = match gh.tree(&t.source.source, &git_ref) {
            Ok(tree) => tree,
            Err(e) => return Ok(unavailable(format!("{e:#}"))),
        };
        let folder = t
            .source
            .skill_path
            .as_deref()
            .unwrap_or("")
            .trim_end_matches("SKILL.md")
            .trim_end_matches('/')
            .to_string();
        let shas: Vec<(String, Option<String>)> = groups
            .par_iter()
            .map(|g| (g.hash.clone(), git_tree_sha(&g.dir)))
            .collect();
        Ok(match upstream_matches(&tree, &folder, &shas) {
            Ok(matching_hashes) => UpstreamCheck {
                status: UpstreamStatus::Checked,
                source: Some(t.source.source.clone()),
                matching_hashes,
                message: None,
            },
            Err(message) => unavailable(message),
        })
    }

    /// Line diff of one file between two versions, picked by `content_hash`
    /// (stable across rescans, unlike a version's position).
    pub fn compare_file(
        &self,
        id: &str,
        path: &str,
        left_hash: &str,
        right_hash: &str,
    ) -> Result<FileDiff> {
        let (groups, _) = groups_of(self, id)?;
        let side = |hash: &str| -> Result<Side> {
            let g = groups.iter().find(|g| g.hash == hash).ok_or_else(|| {
                anyhow!("that copy of `{id}` changed since the comparison was loaded; reload it")
            })?;
            read_side(&g.dir, path, None)
        };
        Ok(build_diff(path, &side(left_hash)?, &side(right_hash)?))
    }
}

/// The shared store's copy of `id`: its real folder, where that content lives,
/// and the agents that see it.
pub(crate) fn shared_copy(
    q: &Quiver,
    id: &str,
) -> Result<(PathBuf, Vec<VersionLocation>, Vec<String>)> {
    let (groups, agents) = groups_of(q, id)?;
    let g = groups
        .into_iter()
        .find(|g| g.shared)
        .ok_or_else(|| anyhow!("`{id}` is not in the shared store"))?;
    let ids = agents
        .iter()
        .filter(|a| g.agents.contains(&a.id))
        .map(|a| a.id.clone())
        .collect();
    Ok((g.dir, g.copies, ids))
}

/// Compare the files of two or more folders that aren't copies of one installed
/// skill (a shared copy and a pin). `versions` and `sides` are in the same order.
pub(crate) fn compare_folders(
    skill_id: &str,
    name: &str,
    versions: Vec<SkillVersion>,
    sides: &[Folder],
) -> CopyComparison {
    let trees: Vec<BTreeMap<String, FileInfo>> = sides
        .par_iter()
        .map(|(dir, patch)| read_tree(dir, *patch))
        .collect();
    CopyComparison {
        skill_id: skill_id.to_string(),
        name: name.to_string(),
        files: compare_files(&trees),
        upstream_source: None,
        suggested: suggest(&versions),
        versions,
    }
}

/// Line diff of one file between two folders.
pub(crate) fn diff_folder_file(path: &str, left: Folder, right: Folder) -> Result<FileDiff> {
    Ok(build_diff(
        path,
        &read_side(left.0, path, left.1)?,
        &read_side(right.0, path, right.1)?,
    ))
}

// ---------- One file, two versions ----------

enum Side {
    Missing,
    /// Over the size cap; not read.
    Large(u64),
    Data(Vec<u8>),
}

fn read_side(root: &Path, rel: &str, patch: Option<&Patch>) -> Result<Side> {
    if let Some(p) = patch
        && p.path == rel
    {
        return Ok(Side::Data(p.bytes.clone()));
    }
    let path = root.join(safe_rel(rel)?);
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Side::Missing),
        Err(e) => return Err(e.into()),
    };
    if !meta.is_file() {
        return Ok(Side::Missing);
    }
    ensure!(
        starts_with(&normalize(&path), root),
        "path escapes the skill folder"
    );
    if meta.len() > MAX_DIFF_BYTES {
        return Ok(Side::Large(meta.len()));
    }
    Ok(Side::Data(std::fs::read(&path)?))
}

fn build_diff(path: &str, left: &Side, right: &Side) -> FileDiff {
    let size = |s: &Side| match s {
        Side::Missing => None,
        Side::Large(n) => Some(*n),
        Side::Data(b) => Some(b.len() as u64),
    };
    let mut out = FileDiff {
        path: path.to_string(),
        content: FileContent::Text,
        identical: false,
        left_size: size(left),
        right_size: size(right),
        blocks: vec![],
        added: 0,
        removed: 0,
        eol_only: false,
    };
    if let (Side::Data(a), Side::Data(b)) = (left, right)
        && a == b
    {
        out.identical = true;
        out.content = if is_binary(a) {
            FileContent::Binary
        } else {
            FileContent::Text
        };
        return out;
    }
    let mut texts: [&str; 2] = ["", ""];
    for (i, s) in [left, right].into_iter().enumerate() {
        match s {
            Side::Missing => {}
            Side::Large(_) => {
                out.content = FileContent::TooLarge;
            }
            Side::Data(b) => match std::str::from_utf8(b) {
                Ok(t) if !b.iter().take(BINARY_SNIFF).any(|c| *c == 0) => texts[i] = t,
                _ => {
                    out.content = FileContent::Binary;
                    return out;
                }
            },
        }
    }
    if out.content == FileContent::TooLarge
        || texts.iter().any(|t| t.lines().count() > MAX_DIFF_LINES)
    {
        out.content = FileContent::TooLarge;
        return out;
    }
    let d = diff_text(texts[0], texts[1]);
    out.blocks = d.blocks;
    out.added = d.added;
    out.removed = d.removed;
    out.eol_only = d.eol_only;
    out
}

// ---------- Line diff ----------

/// Result of [`diff_text`].
pub struct LineDiff {
    pub blocks: Vec<DiffBlock>,
    pub added: usize,
    pub removed: usize,
    /// Same lines; only line endings or the final newline differ.
    pub eol_only: bool,
}

fn strip_eol(line: &str) -> &str {
    match line.strip_suffix('\n') {
        Some(l) => l.strip_suffix('\r').unwrap_or(l),
        None => line,
    }
}

/// Side-by-side line diff: changed lines paired up with intra-line marks,
/// unchanged runs of [`MIN_HIDDEN`] lines or more collapsed to [`CONTEXT`] lines
/// around each change.
pub fn diff_text(old: &str, new: &str) -> LineDiff {
    if old == new {
        return LineDiff {
            blocks: vec![],
            added: 0,
            removed: 0,
            eol_only: false,
        };
    }
    let a: Vec<&str> = old.split_inclusive('\n').map(strip_eol).collect();
    let b: Vec<&str> = new.split_inclusive('\n').map(strip_eol).collect();
    let ops =
        capture_diff_slices_deadline(Algorithm::Myers, &a, &b, Some(Instant::now() + DIFF_BUDGET));

    let mut rows: Vec<DiffRow> = Vec::new();
    for op in ops {
        match op {
            DiffOp::Equal {
                old_index,
                new_index,
                len,
            } => {
                for k in 0..len {
                    rows.push(DiffRow {
                        kind: RowKind::Equal,
                        left_no: Some(old_index + k + 1),
                        right_no: Some(new_index + k + 1),
                        left: Some(a[old_index + k].to_string()),
                        right: Some(b[new_index + k].to_string()),
                        left_marks: vec![],
                        right_marks: vec![],
                    });
                }
            }
            DiffOp::Delete {
                old_index, old_len, ..
            } => {
                for k in 0..old_len {
                    rows.push(one_sided(RowKind::Delete, old_index + k, a[old_index + k]));
                }
            }
            DiffOp::Insert {
                new_index, new_len, ..
            } => {
                for k in 0..new_len {
                    rows.push(one_sided(RowKind::Insert, new_index + k, b[new_index + k]));
                }
            }
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => replace_rows(
                &a[old_index..old_index + old_len],
                &b[new_index..new_index + new_len],
                old_index,
                new_index,
                &mut rows,
            ),
        }
    }
    let count = |f: fn(RowKind) -> bool| rows.iter().filter(|r| f(r.kind)).count();
    let added = count(|k| matches!(k, RowKind::Insert | RowKind::Replace));
    let removed = count(|k| matches!(k, RowKind::Delete | RowKind::Replace));
    if rows.iter().all(|r| r.kind == RowKind::Equal) {
        return LineDiff {
            blocks: vec![],
            added: 0,
            removed: 0,
            eol_only: true,
        };
    }
    LineDiff {
        blocks: collapse(rows, CONTEXT),
        added,
        removed,
        eol_only: false,
    }
}

/// A row with a line on one side only. `index` is 0-based.
fn one_sided(kind: RowKind, index: usize, text: &str) -> DiffRow {
    let (no, text) = (Some(index + 1), Some(text.to_string()));
    let deleted = kind == RowKind::Delete;
    DiffRow {
        kind,
        left_no: if deleted { no } else { None },
        right_no: if deleted { None } else { no },
        left: if deleted { text.clone() } else { None },
        right: if deleted { None } else { text },
        left_marks: vec![],
        right_marks: vec![],
    }
}

fn changed_row(
    (li, left): (usize, &str),
    (ri, right): (usize, &str),
    marks: Option<Inline>,
) -> DiffRow {
    let (left_marks, right_marks) = marks.map(|m| (m.left, m.right)).unwrap_or_default();
    DiffRow {
        kind: RowKind::Replace,
        left_no: Some(li + 1),
        right_no: Some(ri + 1),
        left: Some(left.to_string()),
        right: Some(right.to_string()),
        left_marks,
        right_marks,
    }
}

enum Step {
    Pair(usize, usize),
    Del(usize),
    Ins(usize),
}

/// A block of changed lines: pair up the lines that are alike (with intra-line
/// marks), zip the rest so both sides stay level, and let any surplus stand alone.
fn replace_rows(old: &[&str], new: &[&str], o0: usize, n0: usize, out: &mut Vec<DiffRow>) {
    fn flush(
        dels: &mut Vec<usize>,
        inss: &mut Vec<usize>,
        (old, new): (&[&str], &[&str]),
        (o0, n0): (usize, usize),
        out: &mut Vec<DiffRow>,
    ) {
        for k in 0..dels.len().max(inss.len()) {
            out.push(match (dels.get(k), inss.get(k)) {
                (Some(&i), Some(&j)) => changed_row((o0 + i, old[i]), (n0 + j, new[j]), None),
                (Some(&i), None) => one_sided(RowKind::Delete, o0 + i, old[i]),
                (None, Some(&j)) => one_sided(RowKind::Insert, n0 + j, new[j]),
                (None, None) => continue,
            });
        }
        dels.clear();
        inss.clear();
    }
    let (mut dels, mut inss) = (Vec::new(), Vec::new());
    for step in align(old, new) {
        match step {
            Step::Del(i) => dels.push(i),
            Step::Ins(j) => inss.push(j),
            Step::Pair(i, j) => {
                flush(&mut dels, &mut inss, (old, new), (o0, n0), out);
                let marks = inline(old[i], new[j]);
                out.push(changed_row((o0 + i, old[i]), (n0 + j, new[j]), Some(marks)));
            }
        }
    }
    flush(&mut dels, &mut inss, (old, new), (o0, n0), out);
}

/// Order-preserving alignment of two lists of changed lines that maximises the
/// total similarity of the pairs it makes.
fn align(old: &[&str], new: &[&str]) -> Vec<Step> {
    let (n, m) = (old.len(), new.len());
    if n * m > PAIR_MAX_CELLS {
        let mut steps: Vec<Step> = (0..n.min(m)).map(|i| Step::Pair(i, i)).collect();
        steps.extend((m.min(n)..n).map(Step::Del));
        steps.extend((n.min(m)..m).map(Step::Ins));
        return steps;
    }
    let sim: Vec<Vec<f32>> = old
        .iter()
        .map(|o| {
            new.iter()
                .map(|nw| {
                    let r = similarity(o, nw);
                    if r >= PAIR_MIN_SIMILARITY { r } else { 0.0 }
                })
                .collect()
        })
        .collect();
    let mut best = vec![vec![0f32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            let mut b = best[i + 1][j].max(best[i][j + 1]);
            if sim[i][j] > 0.0 {
                b = b.max(sim[i][j] + best[i + 1][j + 1]);
            }
            best[i][j] = b;
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut steps = Vec::new();
    while i < n && j < m {
        if sim[i][j] > 0.0 && sim[i][j] + best[i + 1][j + 1] >= best[i][j] {
            steps.push(Step::Pair(i, j));
            i += 1;
            j += 1;
        } else if best[i + 1][j] >= best[i][j] {
            steps.push(Step::Del(i));
            i += 1;
        } else {
            steps.push(Step::Ins(j));
            j += 1;
        }
    }
    steps.extend((i..n).map(Step::Del));
    steps.extend((j..m).map(Step::Ins));
    steps
}

/// 0.0 (nothing in common) to 1.0 (identical), ignoring whitespace.
fn similarity(a: &str, b: &str) -> f32 {
    if a == b {
        return 1.0;
    }
    if a.len() > PAIR_MAX_LINE || b.len() > PAIR_MAX_LINE {
        // Too long for a token diff: shared head and tail.
        let head = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
        let tail = a
            .bytes()
            .rev()
            .zip(b.bytes().rev())
            .take_while(|(x, y)| x == y)
            .count();
        return ((head + tail).min(a.len().min(b.len())) as f32 * 2.0)
            / (a.len() + b.len()).max(1) as f32;
    }
    inline(a, b).ratio
}

#[derive(Clone, Copy, PartialEq)]
enum Class {
    Word,
    Space,
    Other,
}

fn class(c: char) -> Class {
    if c.is_alphanumeric() || c == '_' {
        Class::Word
    } else if c.is_whitespace() {
        Class::Space
    } else {
        Class::Other
    }
}

/// Words, runs of whitespace, and single punctuation marks.
fn tokens(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut prev: Option<Class> = None;
    for (i, c) in s.char_indices() {
        let k = class(c);
        if let Some(p) = prev
            && (k == Class::Other || p != k)
        {
            out.push(&s[start..i]);
            start = i;
        }
        prev = Some(k);
    }
    if start < s.len() {
        out.push(&s[start..]);
    }
    out
}

struct Inline {
    /// Share of non-whitespace text the two lines have in common.
    ratio: f32,
    left: Vec<(usize, usize)>,
    right: Vec<(usize, usize)>,
}

/// Which spans of two similar lines changed.
fn inline(a: &str, b: &str) -> Inline {
    let (ta, tb) = (tokens(a), tokens(b));
    let ops = capture_diff_slices(Algorithm::Myers, &ta, &tb);
    let blank = |t: &str| t.chars().all(char::is_whitespace);
    let weight = |ts: &[&str]| -> usize {
        ts.iter()
            .filter(|t| !blank(t))
            .map(|t| t.chars().count())
            .sum()
    };
    let (mut equal, mut left, mut right) = (0usize, Vec::new(), Vec::new());
    for op in ops {
        match op {
            DiffOp::Equal { old_index, len, .. } => {
                equal += weight(&ta[old_index..old_index + len])
            }
            DiffOp::Delete {
                old_index, old_len, ..
            } => left.push((old_index, old_index + old_len)),
            DiffOp::Insert {
                new_index, new_len, ..
            } => right.push((new_index, new_index + new_len)),
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => {
                left.push((old_index, old_index + old_len));
                right.push((new_index, new_index + new_len));
            }
        }
    }
    let total = weight(&ta) + weight(&tb);
    Inline {
        ratio: if total == 0 {
            1.0
        } else {
            2.0 * equal as f32 / total as f32
        },
        left: utf16_marks(&ta, left),
        right: utf16_marks(&tb, right),
    }
}

/// Token ranges to UTF-16 offset ranges, joining ranges split by one blank token.
fn utf16_marks(tokens: &[&str], ranges: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (s, e) in ranges {
        match merged.last_mut() {
            Some(last)
                if s == last.1
                    || (s == last.1 + 1 && tokens[last.1].chars().all(char::is_whitespace)) =>
            {
                last.1 = e;
            }
            _ => merged.push((s, e)),
        }
    }
    let mut offsets = Vec::with_capacity(tokens.len() + 1);
    let mut at = 0;
    offsets.push(0);
    for t in tokens {
        at += t.encode_utf16().count();
        offsets.push(at);
    }
    merged
        .into_iter()
        .map(|(s, e)| (offsets[s], offsets[e]))
        .collect()
}

/// Cut `text` at UTF-16 `marks` (sorted, disjoint) into `(piece, changed)` parts.
pub fn split_marked(text: &str, marks: &[(usize, usize)]) -> Vec<(String, bool)> {
    let mut parts: Vec<(String, bool)> = Vec::new();
    let mut at = 0usize;
    for c in text.chars() {
        let changed = marks.iter().any(|(s, e)| at >= *s && at < *e);
        match parts.last_mut() {
            Some((piece, kind)) if *kind == changed => piece.push(c),
            _ => parts.push((c.to_string(), changed)),
        }
        at += c.len_utf16();
    }
    parts
}

/// Fold long runs of unchanged rows into collapsed blocks, keeping `context`
/// rows beside every change.
fn collapse(rows: Vec<DiffRow>, context: usize) -> Vec<DiffBlock> {
    let n = rows.len();
    let mut keep = vec![false; n];
    for (c, row) in rows.iter().enumerate() {
        if row.kind != RowKind::Equal {
            keep[c.saturating_sub(context)..(c + context + 1).min(n)].fill(true);
        }
    }
    // A gap too short to be worth hiding stays visible.
    let mut i = 0;
    while i < n {
        if keep[i] {
            i += 1;
            continue;
        }
        let start = i;
        while i < n && !keep[i] {
            i += 1;
        }
        if i - start < MIN_HIDDEN {
            keep[start..i].fill(true);
        }
    }
    let mut blocks: Vec<DiffBlock> = Vec::new();
    for (row, visible) in rows.into_iter().zip(keep) {
        match blocks.last_mut() {
            Some(b) if b.collapsed != visible => b.rows.push(row),
            _ => blocks.push(DiffBlock {
                collapsed: !visible,
                rows: vec![row],
            }),
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::Env;
    use crate::fsutil;
    use crate::store::{Lock, LockEntry, State};
    use std::fs;

    struct Home {
        _dir: tempfile::TempDir,
        root: PathBuf,
    }

    impl Home {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let root = fsutil::canonicalize(dir.path()).unwrap();
            for d in [
                ".claude/skills",
                ".codex",
                ".gemini/config",
                ".cursor/skills",
                ".agents/skills",
            ] {
                fs::create_dir_all(root.join(d)).unwrap();
            }
            Self { _dir: dir, root }
        }
        fn q(&self) -> Quiver {
            Quiver::with_env(Env::isolated(&self.root))
        }
        fn p(&self, rel: &str) -> PathBuf {
            rel.split('/')
                .fold(self.root.clone(), |acc, part| acc.join(part))
        }
        fn write(&self, rel: &str, content: &str) {
            let p = self.p(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, content).unwrap();
        }
        fn skill(&self, dir: &str, body: &str) {
            self.write(
                &format!("{dir}/SKILL.md"),
                &format!("---\nname: dup\ndescription: dup skill\n---\n{body}\n"),
            );
            self.write(&format!("{dir}/scripts/run.sh"), "echo run\n");
        }
    }

    /// The shared copy, linked into Claude Code, and Cursor's own edited copy
    /// with an extra file.
    fn conflict(h: &Home) {
        h.skill(".agents/skills/dup", "original");
        fsutil::symlink_dir(&h.p(".agents/skills/dup"), &h.p(".claude/skills/dup")).unwrap();
        h.skill(".cursor/skills/dup", "fixed the bug");
        h.write(".cursor/skills/dup/notes.md", "why\n");
    }

    fn set_mtime(path: PathBuf, at: std::time::SystemTime) {
        let f = fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_modified(at).unwrap();
    }

    #[test]
    fn groups_copies_into_versions_by_content() {
        let h = Home::new();
        conflict(&h);
        // Antigravity keeps an identical copy of its own: same version as the shared one.
        h.skill(".gemini/config/skills/dup", "original");
        let c = h.q().compare_copies("dup").unwrap();
        assert_eq!(c.versions.len(), 2);

        let (v1, v2) = (&c.versions[0], &c.versions[1]);
        assert_eq!((v1.id.as_str(), v2.id.as_str()), ("v1", "v2"));
        assert!(v1.shared && !v2.shared);
        // The shared copy and Antigravity's identical copy are one version.
        assert_eq!(v1.locations.len(), 2);
        assert_eq!(v1.locations[0].kind, LocationKind::Canonical);
        assert_eq!(v1.locations[1].kind, LocationKind::Directory);
        for agent in ["claude-code", "antigravity", "codex"] {
            assert!(
                v1.agent_ids.iter().any(|a| a == agent),
                "{agent} sees v1: {:?}",
                v1.agent_ids
            );
        }
        assert_eq!(v2.agent_ids, vec!["cursor".to_string()]);
        assert_eq!(v2.locations.len(), 1);
        assert_ne!(v1.content_hash, v2.content_hash);
        // Same hashes as the scan reports on each location.
        let inv = h.q().scan();
        let dup = inv.skills.iter().find(|s| s.id == "dup").unwrap();
        for l in &dup.locations {
            let hash = l.content_hash.as_ref().unwrap();
            assert!(
                c.versions.iter().any(|v| &v.content_hash == hash),
                "{:?}",
                l.path
            );
        }
        assert_eq!(v1.file_count, 2);
        assert_eq!(v2.file_count, 3);
        assert_eq!(c.name, "dup");
        assert_eq!(c.suggested, Some(("v1".into(), "v2".into())));
        assert_eq!(c.upstream_source, None);
    }

    #[test]
    fn single_version_has_nothing_to_suggest() {
        let h = Home::new();
        h.skill(".agents/skills/dup", "same");
        h.skill(".cursor/skills/dup", "same");
        let c = h.q().compare_copies("dup").unwrap();
        assert_eq!(c.versions.len(), 1);
        assert_eq!(c.suggested, None);
        assert!(c.files.iter().all(|f| f.status == FileStatus::Same));
        assert!(!c.versions[0].newest);
        assert!(h.q().compare_copies("nope").is_err());
    }

    #[test]
    fn file_status_is_same_changed_or_partial() {
        let h = Home::new();
        conflict(&h);
        h.write(".agents/skills/dup/blob.bin", "\0\x01binary");
        h.write(".cursor/skills/dup/blob.bin", "\0\x02binary!");
        h.write(".agents/skills/dup/big.txt", &"a\n".repeat(300_000));
        h.write(".cursor/skills/dup/big.txt", &"b\n".repeat(300_000));
        let c = h.q().compare_copies("dup").unwrap();
        let get = |p: &str| c.files.iter().find(|f| f.path == p).unwrap();

        assert_eq!(c.files[0].path, "SKILL.md", "SKILL.md comes first");
        assert_eq!(get("SKILL.md").status, FileStatus::Changed);
        assert_eq!(get("scripts/run.sh").status, FileStatus::Same);
        let notes = get("notes.md");
        assert_eq!(notes.status, FileStatus::Partial);
        assert!(notes.variants[0].is_none() && notes.variants[1].is_some());
        assert_eq!(get("blob.bin").content, FileContent::Binary);
        assert_eq!(get("blob.bin").status, FileStatus::Changed);
        assert_eq!(get("big.txt").content, FileContent::TooLarge);
        assert_eq!(get("big.txt").status, FileStatus::Changed);
        assert_eq!(get("SKILL.md").content, FileContent::Text);
        let run = get("scripts/run.sh");
        assert_eq!(
            run.variants[0].as_ref().unwrap().digest,
            run.variants[1].as_ref().unwrap().digest
        );
    }

    #[test]
    fn newest_needs_a_strict_winner() {
        let h = Home::new();
        conflict(&h);
        // Equal timestamps: nobody is newest.
        let now = std::time::SystemTime::now();
        let old = now - Duration::from_secs(5 * 86_400);
        for f in [
            ".agents/skills/dup/SKILL.md",
            ".agents/skills/dup/scripts/run.sh",
            ".cursor/skills/dup/SKILL.md",
            ".cursor/skills/dup/scripts/run.sh",
            ".cursor/skills/dup/notes.md",
        ] {
            set_mtime(h.p(f), old);
        }
        let c = h.q().compare_copies("dup").unwrap();
        assert!(c.versions.iter().all(|v| !v.newest));

        set_mtime(h.p(".cursor/skills/dup/SKILL.md"), now);
        let c = h.q().compare_copies("dup").unwrap();
        assert_eq!(
            c.versions.iter().map(|v| v.newest).collect::<Vec<_>>(),
            vec![false, true]
        );
        assert!(c.versions[1].modified_ms > c.versions[0].modified_ms);
        assert_eq!(c.suggested.unwrap().1, "v2");
    }

    #[test]
    fn newest_helper() {
        assert_eq!(newest(&[Some(1), Some(5), Some(3)]), Some(1));
        assert_eq!(newest(&[Some(5), Some(5)]), None);
        assert_eq!(newest(&[Some(5), None]), None);
        assert_eq!(newest(&[Some(5)]), None);
    }

    fn record_install(h: &Home, source: &str, folder_hash: &str, tree: &str) {
        let q = h.q();
        let mut lock = Lock::load(&q.env);
        lock.upsert(
            "dup",
            &LockEntry {
                source: source.into(),
                source_type: "github".into(),
                skill_path: Some("skills/dup/SKILL.md".into()),
                skill_folder_hash: tree.into(),
                ..Default::default()
            },
        );
        lock.save().unwrap();
        let mut state = State::load(&q.env);
        state.skill_mut("dup").installed_hash = Some(folder_hash.into());
        state.save(&q.env).unwrap();
    }

    #[test]
    fn edited_since_install_compares_with_the_install_record() {
        let h = Home::new();
        conflict(&h);
        // No record yet: nothing to say.
        let c = h.q().compare_copies("dup").unwrap();
        assert!(c.versions.iter().all(|v| v.edited_since_install.is_none()));
        assert_eq!(c.upstream_source, None);

        let shared = h.p(".agents/skills/dup");
        let hash = skill::folder_hash(&shared).unwrap();
        record_install(&h, "o/r", &hash, &git_tree_sha(&shared).unwrap());
        let c = h.q().compare_copies("dup").unwrap();
        assert_eq!(c.versions[0].edited_since_install, Some(false));
        assert_eq!(c.versions[1].edited_since_install, Some(true));
        assert_eq!(c.upstream_source.as_deref(), Some("o/r"));

        // The lock's git tree sha alone is enough (installed by another tool).
        let mut state = State::load(&h.q().env);
        state.skill_mut("dup").installed_hash = None;
        state.save(&h.q().env).unwrap();
        let c = h.q().compare_copies("dup").unwrap();
        assert_eq!(c.versions[0].edited_since_install, Some(false));
        assert_eq!(c.versions[1].edited_since_install, Some(true));

        // Edit the shared copy: it no longer matches what was installed.
        h.write(
            ".agents/skills/dup/SKILL.md",
            "---\nname: dup\ndescription: x\n---\nedited\n",
        );
        let c = h.q().compare_copies("dup").unwrap();
        assert!(
            c.versions
                .iter()
                .any(|v| v.shared && v.edited_since_install == Some(true))
        );
    }

    fn blob(path: &str, sha: &str) -> crate::github::TreeEntry {
        crate::github::TreeEntry {
            path: path.into(),
            mode: "100644".into(),
            kind: "blob".into(),
            sha: sha.into(),
            size: Some(1),
        }
    }

    #[test]
    fn upstream_match_picks_versions_equal_to_latest() {
        let h = Home::new();
        conflict(&h);
        let c = h.q().compare_copies("dup").unwrap();
        let cursor = h.p(".cursor/skills/dup");
        let shas: Vec<(String, Option<String>)> = c
            .versions
            .iter()
            .zip([h.p(".agents/skills/dup"), cursor.clone()])
            .map(|(v, dir)| (v.content_hash.clone(), git_tree_sha(&dir)))
            .collect();
        let tree = |folder: &str, sha: &str| Tree {
            sha: "root".into(),
            truncated: false,
            tree: vec![
                blob(&format!("{folder}/SKILL.md"), "b"),
                crate::github::TreeEntry {
                    path: folder.into(),
                    mode: "040000".into(),
                    kind: "tree".into(),
                    sha: sha.into(),
                    size: None,
                },
            ],
        };
        let latest = shas[1].1.clone().unwrap();
        assert_eq!(
            upstream_matches(&tree("skills/dup", &latest), "skills/dup", &shas).unwrap(),
            vec![c.versions[1].content_hash.clone()]
        );
        // Moved upstream: found again by name.
        assert_eq!(
            upstream_matches(&tree("pkg/dup", &latest), "skills/dup", &shas).unwrap(),
            vec![c.versions[1].content_hash.clone()]
        );
        // Nobody matches a newer upstream.
        assert!(
            upstream_matches(&tree("skills/dup", "ffff"), "skills/dup", &shas)
                .unwrap()
                .is_empty()
        );
        // Gone upstream.
        let gone = Tree {
            sha: "root".into(),
            truncated: false,
            tree: vec![],
        };
        assert!(upstream_matches(&gone, "skills/dup", &shas).is_err());
    }

    #[test]
    fn upstream_check_without_a_github_source_is_no_source() {
        let h = Home::new();
        conflict(&h);
        let u = h.q().compare_upstream("dup").unwrap();
        assert_eq!(u.status, UpstreamStatus::NoSource);
        assert!(u.matching_hashes.is_empty());
    }

    #[test]
    fn compare_file_diffs_two_versions() {
        let h = Home::new();
        conflict(&h);
        h.write(".agents/skills/dup/blob.bin", "\0\x01");
        h.write(".cursor/skills/dup/blob.bin", "\0\x02");
        let q = h.q();
        let c = q.compare_copies("dup").unwrap();
        let (a, b) = (&c.versions[0].content_hash, &c.versions[1].content_hash);

        let d = q.compare_file("dup", "SKILL.md", a, b).unwrap();
        assert_eq!(d.content, FileContent::Text);
        assert!(!d.identical);
        assert_eq!((d.added, d.removed), (1, 1));
        let changed: Vec<&DiffRow> = d
            .blocks
            .iter()
            .flat_map(|b| &b.rows)
            .filter(|r| r.kind == RowKind::Replace)
            .collect();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].left.as_deref(), Some("original"));
        assert_eq!(changed[0].right.as_deref(), Some("fixed the bug"));

        // A file on one side only is all additions (or, reversed, deletions).
        let d = q.compare_file("dup", "notes.md", a, b).unwrap();
        assert_eq!((d.left_size, d.right_size), (None, Some(4)));
        assert_eq!((d.added, d.removed), (1, 0));
        assert_eq!(d.blocks[0].rows[0].kind, RowKind::Insert);
        let d = q.compare_file("dup", "notes.md", b, a).unwrap();
        assert_eq!((d.added, d.removed), (0, 1));

        let d = q.compare_file("dup", "scripts/run.sh", a, b).unwrap();
        assert!(d.identical && d.blocks.is_empty());
        let d = q.compare_file("dup", "blob.bin", a, b).unwrap();
        assert_eq!(d.content, FileContent::Binary);
        assert!(d.blocks.is_empty());

        assert!(q.compare_file("dup", "../../etc/passwd", a, b).is_err());
        assert!(q.compare_file("dup", "SKILL.md", a, "stale").is_err());
    }

    #[test]
    fn compare_file_refuses_files_over_the_cap() {
        let h = Home::new();
        conflict(&h);
        h.write(".agents/skills/dup/big.txt", &"a\n".repeat(300_000));
        h.write(".cursor/skills/dup/big.txt", &"b\n".repeat(300_000));
        let q = h.q();
        let c = q.compare_copies("dup").unwrap();
        let d = q
            .compare_file(
                "dup",
                "big.txt",
                &c.versions[0].content_hash,
                &c.versions[1].content_hash,
            )
            .unwrap();
        assert_eq!(d.content, FileContent::TooLarge);
        assert!(d.blocks.is_empty());
        assert_eq!(d.left_size, Some(600_000));
    }

    // ----- diff rows -----

    fn rows(d: &LineDiff) -> Vec<&DiffRow> {
        d.blocks.iter().flat_map(|b| &b.rows).collect()
    }

    #[test]
    fn diff_marks_inserts_deletes_and_line_numbers() {
        let d = diff_text("a\nb\nc\n", "a\nc\nd\n");
        let r = rows(&d);
        let kinds: Vec<_> = r.iter().map(|r| r.kind).collect();
        assert_eq!(
            kinds,
            [
                RowKind::Equal,
                RowKind::Delete,
                RowKind::Equal,
                RowKind::Insert
            ]
        );
        // The deleted `b` sits on the left only; `c` moves from line 3 to 2.
        assert_eq!((r[1].left_no, r[1].right_no), (Some(2), None));
        assert_eq!(
            (r[1].left.as_deref(), r[1].right.as_deref()),
            (Some("b"), None)
        );
        assert_eq!((r[2].left_no, r[2].right_no), (Some(3), Some(2)));
        assert_eq!((r[3].left_no, r[3].right_no), (None, Some(3)));
        assert_eq!((d.added, d.removed), (1, 1));
        assert!(!d.eol_only);
    }

    #[test]
    fn diff_pairs_similar_lines_and_marks_what_changed() {
        let d = diff_text(
            "- Run the tests before pushing\nkeep\n",
            "- Run the full tests before pushing\nkeep\n",
        );
        let r = rows(&d);
        assert_eq!(r[0].kind, RowKind::Replace);
        let (l, rt) = (
            r[0].left.as_deref().unwrap(),
            r[0].right.as_deref().unwrap(),
        );
        assert_eq!(
            r[0].left_marks,
            Vec::<(usize, usize)>::new(),
            "pure insertion marks the right only"
        );
        let marked: Vec<String> = split_marked(rt, &r[0].right_marks)
            .into_iter()
            .filter(|(_, changed)| *changed)
            .map(|(s, _)| s)
            .collect();
        assert_eq!(marked, vec!["full ".to_string()]);
        assert_eq!(l, "- Run the tests before pushing");
    }

    #[test]
    fn diff_replace_with_unrelated_lines_stays_level_without_marks() {
        let d = diff_text("alpha\n", "zzzzzz\n");
        let r = rows(&d);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].kind, RowKind::Replace);
        assert!(r[0].left_marks.is_empty() && r[0].right_marks.is_empty());
        assert_eq!((r[0].left_no, r[0].right_no), (Some(1), Some(1)));
    }

    #[test]
    fn diff_pairing_survives_uneven_blocks() {
        // Two old lines become three: the alike ones pair up, the new one stands alone.
        let d = diff_text(
            "let total = items.length;\nreturn total;\n",
            "let total = items.size;\nconst extra = 1;\nreturn total + extra;\n",
        );
        let r = rows(&d);
        assert_eq!(r.len(), 3, "{r:?}");
        assert_eq!(r[0].kind, RowKind::Replace);
        assert!(!r[0].left_marks.is_empty());
        assert_eq!(r[1].kind, RowKind::Insert);
        assert_eq!(r[2].kind, RowKind::Replace);
        assert_eq!((r[2].left_no, r[2].right_no), (Some(2), Some(3)));
    }

    #[test]
    fn marks_are_utf16_offsets() {
        // The emoji is two UTF-16 units, so `bar` starts at 7 for JavaScript.
        let d = diff_text("😀 foo bar\n", "😀 foo baz\n");
        let r = rows(&d);
        assert_eq!(r[0].left_marks, vec![(7, 10)]);
        assert_eq!(r[0].right_marks, vec![(7, 10)]);
        let parts = split_marked("😀 foo bar", &r[0].left_marks);
        assert_eq!(
            parts,
            vec![("😀 foo ".to_string(), false), ("bar".to_string(), true)]
        );
    }

    fn numbered(n: usize, change: &[usize]) -> String {
        (1..=n)
            .map(|i| {
                if change.contains(&i) {
                    format!("changed {i}\n")
                } else {
                    format!("line {i}\n")
                }
            })
            .collect()
    }

    #[test]
    fn long_unchanged_runs_collapse_to_context() {
        let d = diff_text(&numbered(20, &[]), &numbered(20, &[10]));
        let shape: Vec<(bool, usize)> = d
            .blocks
            .iter()
            .map(|b| (b.collapsed, b.rows.len()))
            .collect();
        // 9 lines before the change: 6 hidden + 3 context; the change; 3 context + 7 hidden.
        assert_eq!(shape, vec![(true, 6), (false, 7), (true, 7)]);
        // Hidden rows keep their text and numbers so the UI can expand them.
        let hidden = &d.blocks[0].rows;
        assert_eq!(hidden[0].left_no, Some(1));
        assert_eq!(hidden[0].left.as_deref(), Some("line 1"));
        assert_eq!(hidden[5].right_no, Some(6));
    }

    #[test]
    fn short_gaps_stay_visible() {
        // Changes on lines 5 and 11: the 5 lines between them, and the single line
        // before the first change, are not worth hiding. Only the tail collapses.
        let d = diff_text(&numbered(20, &[]), &numbered(20, &[5, 11]));
        let shape: Vec<(bool, usize)> = d
            .blocks
            .iter()
            .map(|b| (b.collapsed, b.rows.len()))
            .collect();
        assert_eq!(shape, vec![(false, 14), (true, 6)]);
        let replaced = rows(&d)
            .iter()
            .filter(|r| r.kind == RowKind::Replace)
            .count();
        assert_eq!(replaced, 2);
        // Small files never collapse.
        let d = diff_text("a\nb\nc\n", "a\nB\nc\n");
        assert!(d.blocks.iter().all(|b| !b.collapsed));
    }

    #[test]
    fn line_endings_alone_are_not_a_content_change() {
        let d = diff_text("a\r\nb\r\n", "a\nb\n");
        assert!(d.eol_only && d.blocks.is_empty());
        let d = diff_text("a\nb", "a\nb\n");
        assert!(d.eol_only);
        let d = diff_text("a\nb\n", "a\nc\n");
        assert!(!d.eol_only);
        let d = diff_text("same\n", "same\n");
        assert!(!d.eol_only && d.blocks.is_empty());
    }

    #[test]
    fn whole_file_diff_for_an_empty_side() {
        let d = diff_text("", "x\ny\n");
        assert_eq!((d.added, d.removed), (2, 0));
        assert!(rows(&d).iter().all(|r| r.kind == RowKind::Insert));
        assert_eq!(rows(&d)[1].right_no, Some(2));
        let d = diff_text("x\ny\n", "");
        assert_eq!((d.added, d.removed), (0, 2));
    }

    #[test]
    fn binary_and_oversized_sides_get_no_line_diff() {
        let text = Side::Data(b"hello\n".to_vec());
        let bin = Side::Data(b"\0\x01\x02".to_vec());
        let d = build_diff("x", &text, &bin);
        assert_eq!(d.content, FileContent::Binary);
        assert!(d.blocks.is_empty());
        let d = build_diff("x", &text, &Side::Data(vec![0xff, 0xfe, b'a']));
        assert_eq!(d.content, FileContent::Binary, "not UTF-8");
        let d = build_diff("x", &text, &Side::Large(MAX_DIFF_BYTES + 1));
        assert_eq!(d.content, FileContent::TooLarge);
        assert_eq!(d.right_size, Some(MAX_DIFF_BYTES + 1));
        assert!(d.blocks.is_empty());
        let many = Side::Data("x\n".repeat(MAX_DIFF_LINES + 1).into_bytes());
        assert_eq!(build_diff("x", &text, &many).content, FileContent::TooLarge);
        let d = build_diff("x", &text, &Side::Data(b"hello\n".to_vec()));
        assert!(d.identical && d.blocks.is_empty());
        let d = build_diff("x", &Side::Missing, &text);
        assert_eq!((d.left_size, d.added), (None, 1));
    }
}

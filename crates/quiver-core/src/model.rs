//! Serializable data model shared by the core, the CLI and the desktop app.
//! Field names serialize as camelCase; the TypeScript mirror lives in
//! `app/src/lib/types.ts` and must be kept in sync.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LinkMode {
    /// Agent dir entry is a symlink to the canonical store (default).
    #[default]
    Symlink,
    /// Agent dir entry is a full copy, refreshed on every update.
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    /// 1 = flagship, 2 = popular, 3 = long tail. Used for sorting/grouping.
    pub tier: u8,
    pub detected: bool,
    /// False when the user hid the agent in settings.
    pub enabled: bool,
    /// Absolute directory Quiver installs into for this agent.
    pub skills_dir: String,
    /// Other directories this agent also reads (legacy/alternate). Scanned, never written.
    pub extra_dirs: Vec<String>,
    /// The agent reads the canonical store (~/.agents/skills) directly, so every
    /// managed skill is visible without a link.
    pub reads_canonical: bool,
    pub link_mode: LinkMode,
    /// Number of skills visible to this agent.
    pub skill_count: usize,
    pub note: Option<String>,
    pub custom: bool,
    /// Installed app bundle for this agent (used for its icon).
    pub app_path: Option<String>,
    /// Where this agent reads a repository's own skills, relative to the repo
    /// root (e.g. `.claude/skills`); `None` when it has no project-level folder.
    pub project_dir: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocationKind {
    /// The real directory inside the canonical store.
    Canonical,
    /// A real directory inside an agent dir (a copy or an unmanaged skill).
    Directory,
    /// Symlink pointing at the canonical store entry.
    Link,
    /// Symlink pointing somewhere other than the canonical store.
    ForeignLink,
    /// Symlink whose target no longer exists.
    Broken,
    /// Provided by an agent plugin (read-only).
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub path: String,
    /// None for the canonical store itself.
    pub agent_id: Option<String>,
    pub kind: LocationKind,
    /// Raw symlink target, for links.
    pub target: Option<String>,
    /// Content hash of the resolved directory (None for broken links).
    pub content_hash: Option<String>,
    /// True if the location is in a directory Quiver writes to (agent's primary dir).
    pub writable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Presence {
    /// Agent reads the canonical store directly.
    Native,
    /// Symlinked to the canonical store.
    Linked,
    /// Real copy whose content matches the canonical store (copy mode).
    Copied,
    /// Real copy whose content differs from canonical, or a skill that only
    /// exists in this agent's folder (not managed by Quiver yet).
    Local,
    /// Symlink to somewhere outside the canonical store.
    Foreign,
    /// Broken symlink.
    Broken,
    /// Provided by a plugin; cannot be toggled.
    Plugin,
    /// Not visible to this agent.
    Absent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPresence {
    pub agent_id: String,
    pub presence: Presence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueKind {
    BrokenLink,
    /// Copies with the same name have different contents.
    Conflict,
    /// Lives only in agent folders; not in the canonical store.
    Unmanaged,
    MissingSkillMd,
    InvalidFrontmatter,
    InvalidName,
    NameMismatch,
    MissingDescription,
    DescriptionTooLong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: IssueKind,
    pub message: String,
    /// "error" | "warning" | "info"
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSource {
    /// "github" | "git" | "local" | "unknown"
    pub kind: String,
    /// e.g. "anthropics/skills" or a local path.
    pub source: String,
    pub url: Option<String>,
    /// Path of SKILL.md within the source repo.
    pub skill_path: Option<String>,
    pub git_ref: Option<String>,
    pub installed_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Where a skill comes from, from the user's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    /// Authored by the user; lives in the My Skills folder (`~/Skills`).
    Mine,
    /// Installed from a remote source (GitHub, git, archive) and updatable.
    Installed,
    /// In the canonical store without a remote source.
    Local,
    /// Only in agent folders, not in the canonical store.
    Unmanaged,
    /// Provided by an agent plugin.
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Directory name; unique key.
    pub id: String,
    /// `name` from frontmatter (falls back to id).
    pub name: String,
    pub description: String,
    pub version: Option<String>,
    pub license: Option<String>,
    pub allowed_tools: Option<String>,
    /// True if the skill lives in the canonical store.
    pub managed: bool,
    /// Directory used for reading content (canonical if managed, else first real copy).
    pub primary_path: Option<String>,
    pub locations: Vec<Location>,
    /// One entry per known agent (detected or not), in registry order.
    pub presence: Vec<AgentPresence>,
    pub source: Option<SkillSource>,
    pub issues: Vec<Issue>,
    pub file_count: usize,
    pub size_bytes: u64,
    /// Unix millis of the newest file.
    pub modified_ms: Option<i64>,
    pub read_only: bool,
    /// Plugin identifier for plugin-provided skills.
    pub plugin: Option<String>,
    pub origin: Origin,
    /// Mine only: uncommitted changed files in this skill's folder
    /// (None when the My Skills folder is not a git repo).
    pub git_changes: Option<u32>,
    /// Source this skill was forked from via "Make it mine".
    pub forked_from: Option<String>,
    /// Pins of this skill in registered projects (from their `quiver-pins.json`).
    #[serde(default)]
    pub pinned_in: Vec<PinRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: usize,
    pub managed: usize,
    pub unmanaged: usize,
    pub with_issues: usize,
    pub agents_detected: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub canonical_dir: String,
    pub agents: Vec<AgentInfo>,
    pub skills: Vec<Skill>,
    pub stats: Stats,
    pub scanned_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Path relative to the skill root, '/' separated.
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub skill: Skill,
    /// Raw SKILL.md including frontmatter.
    pub skill_md: String,
    /// SKILL.md body without frontmatter.
    pub body: String,
    /// Frontmatter as JSON for display.
    pub frontmatter: serde_json::Value,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Directory name the skill will be installed as.
    pub id: String,
    pub name: String,
    pub description: String,
    /// Path of the skill folder inside the source ("" for root).
    pub path: String,
    pub already_installed: bool,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSource {
    /// Opaque token used to refer to this resolution in `install`.
    pub token: String,
    /// "github" | "git" | "local" | "zip"
    pub kind: String,
    /// Human-readable label, e.g. "anthropics/skills".
    pub display: String,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub token: String,
    /// Candidate paths to install.
    pub paths: Vec<String>,
    /// Agents to link to. Empty = settings default.
    pub agents: Vec<String>,
    /// Replace an existing skill with the same id.
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpReport {
    pub ok: Vec<String>,
    pub skipped: Vec<OpMessage>,
    pub errors: Vec<OpMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpMessage {
    pub id: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStatus {
    UpToDate,
    Available,
    /// Source unknown or not checkable (e.g. hand-made skill).
    Untracked,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub id: String,
    pub status: UpdateStatus,
    pub source: Option<String>,
    pub current: Option<String>,
    pub latest: Option<String>,
    /// Installed content was edited since install; updating overwrites edits.
    pub locally_modified: bool,
    pub message: Option<String>,
    pub checked_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub name: String,
    /// Install source, e.g. "vercel-labs/agent-skills".
    pub source: String,
    pub installs: u64,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub name: String,
    pub skills_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Agents new skills are linked to. Empty = every detected, enabled agent.
    pub default_agents: Vec<String>,
    pub hidden_agents: Vec<String>,
    pub link_modes: BTreeMap<String, LinkMode>,
    pub custom_agents: Vec<CustomAgent>,
    pub auto_check_updates: bool,
    pub check_interval_hours: u32,
    pub scan_plugins: bool,
    /// When a new agent is detected, link every managed skill into it.
    pub auto_link_new_agents: bool,
    /// Universal mode: every skill is kept in every active agent automatically.
    /// New installs go everywhere, skills that appear in one agent's folder are
    /// adopted, new agents receive everything. Per-agent unlinks become exceptions.
    pub universal: bool,
    /// Folder holding the user's own skills (a git repo). `~` is expanded.
    pub my_skills_dir: String,
    /// Editor app used for "Edit"; None = auto-detect.
    pub editor: Option<String>,
    /// Registered project roots (see `project_add`). Only the project commands change this.
    pub projects: Vec<String>,
    /// Set by the app; never serialized back from the UI.
    #[serde(skip_deserializing)]
    pub github_token_source: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_agents: vec![],
            hidden_agents: vec![],
            link_modes: BTreeMap::new(),
            custom_agents: vec![],
            auto_check_updates: true,
            check_interval_hours: 12,
            scan_plugins: true,
            auto_link_new_agents: false,
            universal: false,
            my_skills_dir: "~/Skills".into(),
            editor: None,
            projects: vec![],
            github_token_source: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    /// (skill id, agent id) pairs that would be linked.
    pub links: Vec<(String, String)>,
    /// Unmanaged skills that would be adopted into the canonical store.
    pub adopt: Vec<String>,
    /// Broken links that would be removed.
    pub prune: Vec<String>,
    /// Conflicting skills that need a manual decision.
    pub conflicts: Vec<String>,
    /// Folders in My Skills not yet registered in the canonical store.
    #[serde(default)]
    pub register: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    /// Path relative to the My Skills folder.
    pub path: String,
    /// Porcelain status: "M", "A", "D", "R", "??".
    pub status: String,
    pub skill_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub when_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MySkillsStatus {
    pub dir: String,
    pub display_dir: String,
    pub exists: bool,
    pub git_available: bool,
    pub is_repo: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    /// "owner/repo" when the origin remote is on GitHub.
    pub github_repo: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitChange>,
    pub last_commit: Option<Commit>,
    /// Skill folders in the directory.
    pub count: usize,
    /// Set when the configured folder can't be used (overlaps an agent folder...).
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorApp {
    pub name: String,
    pub path: String,
}

/// How sure a discovered source is. Ordered weakest to strongest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchConfidence {
    /// Same skill name in the repo, different content (an older or edited copy).
    Name,
    /// SKILL.md is identical; other files differ.
    SkillMd,
    /// The whole folder is byte-identical to the repo's current version.
    Exact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMatch {
    pub id: String,
    /// "owner/repo"
    pub source: String,
    /// Path of SKILL.md in the repo.
    pub skill_path: String,
    pub confidence: MatchConfidence,
    pub installs: u64,
    /// A repo you already install from (or a well-known original collection).
    pub known: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceScan {
    /// Skills examined.
    pub checked: usize,
    /// Best match per skill that has one.
    pub matches: Vec<SourceMatch>,
    /// The skills.sh search rate-limited; `unchecked` were not searched.
    pub rate_limited: bool,
    pub unchecked: Vec<String>,
}

// ---------- Comparing conflicting copies ----------

/// One place a version of a skill lives as a real folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionLocation {
    pub path: String,
    /// Agents reading this folder (empty for the shared store).
    pub agent_ids: Vec<String>,
    pub kind: LocationKind,
}

/// A distinct content of a skill: every copy with the same bytes is one version.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersion {
    /// "v1", "v2", ... in the order Health lists the copies (shared copy first).
    pub id: String,
    /// Identifies this content across calls (see [`Location::content_hash`]).
    pub content_hash: String,
    /// The real folders holding exactly this content.
    pub locations: Vec<VersionLocation>,
    /// Every agent that sees this version: through a copy, a link, or by
    /// reading the shared store directly.
    pub agent_ids: Vec<String>,
    /// This is the content of the shared store (`~/.agents/skills`).
    pub shared: bool,
    /// Unix millis of the newest file in the folder.
    pub modified_ms: Option<i64>,
    pub file_count: usize,
    pub size_bytes: u64,
    /// The most recently modified version, only when it is strictly newer than all the others.
    pub newest: bool,
    /// `Some(true)`: differs from what was installed; `Some(false)`: still as
    /// installed; `None`: there is no install record to compare with.
    pub edited_since_install: Option<bool>,
}

/// How one file relates across all versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    /// Present everywhere with identical bytes.
    Same,
    /// Present everywhere, but the bytes differ.
    Changed,
    /// Missing from at least one version.
    Partial,
}

/// What a file's bytes are, for deciding whether a line diff makes sense.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileContent {
    Text,
    Binary,
    /// Bigger than the diff size cap.
    TooLarge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVariant {
    pub size: u64,
    /// SHA-256 of the bytes; equal digests mean identical files.
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCompare {
    /// Path relative to the skill root, '/' separated.
    pub path: String,
    pub status: FileStatus,
    pub content: FileContent,
    /// One entry per version, in `versions` order; `None` where the file doesn't exist.
    pub variants: Vec<Option<FileVariant>>,
}

/// Everything local about a conflict: no network involved.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyComparison {
    pub skill_id: String,
    pub name: String,
    pub versions: Vec<SkillVersion>,
    /// Every file in any version: `SKILL.md` first, then by path.
    pub files: Vec<FileCompare>,
    /// "owner/repo" when the skill was installed from GitHub; `compare_upstream` can check against it.
    pub upstream_source: Option<String>,
    /// Version ids to show first (left, right): the shared copy against the newest other one.
    pub suggested: Option<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpstreamStatus {
    /// GitHub answered; `matching_hashes` says which versions equal its latest.
    Checked,
    /// Not installed from GitHub, so there is nothing to compare with.
    NoSource,
    /// Offline, rate limited, or the folder is gone upstream. `message` says why.
    Unavailable,
}

/// Which versions equal the latest upstream folder on GitHub.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamCheck {
    pub status: UpstreamStatus,
    pub source: Option<String>,
    /// `content_hash` of every version identical to upstream's latest.
    pub matching_hashes: Vec<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RowKind {
    Equal,
    Insert,
    Delete,
    /// A line changed (or several lines changed together): both sides are filled.
    Replace,
}

/// One row of a side-by-side diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub kind: RowKind,
    /// 1-based line numbers; `None` on the side that has no line in this row.
    pub left_no: Option<usize>,
    pub right_no: Option<usize>,
    pub left: Option<String>,
    pub right: Option<String>,
    /// Changed spans inside the line as `[start, end)` UTF-16 offsets, so a
    /// JavaScript `slice` can cut at them. Empty = the whole line is the change.
    pub left_marks: Vec<(usize, usize)>,
    pub right_marks: Vec<(usize, usize)>,
}

/// A run of rows: either shown, or a long stretch of unchanged lines collapsed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBlock {
    pub collapsed: bool,
    pub rows: Vec<DiffRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    /// `Binary` and `TooLarge` come with no blocks: there is no line diff to show.
    pub content: FileContent,
    /// Both sides exist and are byte for byte equal.
    pub identical: bool,
    /// Size on each side; `None` where the file doesn't exist.
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub blocks: Vec<DiffBlock>,
    pub added: usize,
    pub removed: usize,
    /// The lines are the same and only line endings (or the final newline) differ.
    pub eol_only: bool,
}

// ---------- Pinned skills ----------

/// How healthy a pin is. Worst first: a missing folder beats edits, edits beat link trouble.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PinState {
    /// The folder matches the lock and every agent entry is in place.
    Ok,
    /// The pinned folder's content differs from the lock (see `changed_files`).
    Modified,
    /// The pinned folder is gone.
    Missing,
    /// The content is fine, but an agent's link or copy is missing or wrong.
    Links,
}

/// How a pin reaches agents that don't read `.agents/skills` themselves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum PinMode {
    /// A relative symlink to the pinned folder (portable through git on macOS and Linux).
    #[default]
    Symlink,
    /// A full copy of the pinned folder (for repos used on Windows).
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PinLinkKind {
    /// The agent reads `.agents/skills` itself; nothing to create.
    Native,
    Symlink,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PinnedFrom {
    /// Snapshot of the copy in `~/.agents/skills`.
    Shared,
    /// Downloaded from GitHub at a commit.
    Github,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinAgentLink {
    pub agent_id: String,
    /// Repo-relative, e.g. `.claude/skills/browser-qa-release`.
    pub dir: String,
    pub kind: PinLinkKind,
    pub ok: bool,
    /// Plain language; `None` when ok.
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    /// The pinned name (folder and frontmatter `name`).
    pub name: String,
    /// The original skill's name.
    pub skill: String,
    /// The ORIGINAL description (without the pin prefix).
    pub description: String,
    pub source: Option<SkillSource>,
    /// Full commit SHA when pinned from GitHub at a ref.
    pub git_ref: Option<String>,
    pub pinned_from: PinnedFrom,
    /// ISO 8601.
    pub pinned_at: String,
    pub hash: String,
    pub upstream_hash: Option<String>,
    pub state: PinState,
    /// Files added, removed or changed since the pin was made.
    pub changed_files: Vec<String>,
    /// One plain-language line per issue; empty when ok.
    pub problems: Vec<String>,
    /// This machine's shared copy hashes differently from what was pinned
    /// (`None`: there is no shared copy to compare, or it wasn't looked at).
    pub shared_changed: Option<bool>,
    /// Agents whose GLOBAL skills folder has a skill with the pin's name (a warning).
    pub name_clash: Vec<String>,
    pub mode: PinMode,
    pub agents: Vec<PinAgentLink>,
    /// Absolute path of the pinned folder.
    pub path: String,
}

/// A skill in a project that isn't a Quiver pin (e.g. from `npx skills add`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSkill {
    pub name: String,
    pub description: String,
    /// Repo-relative folder.
    pub dir: String,
    /// From the project's `skills-lock.json` when present.
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub path: String,
    /// `path` with the home folder shown as `~`.
    pub display_path: String,
    /// Folder name.
    pub name: String,
    /// Current git branch; `None` when not a repo or HEAD is detached.
    pub branch: Option<String>,
    pub is_repo: bool,
    pub exists: bool,
    pub pin_count: usize,
    /// Pins whose state isn't `ok`.
    pub problem_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub summary: ProjectSummary,
    pub pins: Vec<Pin>,
    pub other_skills: Vec<ProjectSkill>,
    /// Absolute path of `quiver-pins.json`; `None` when the project has none.
    pub lock_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRequest {
    /// Any folder inside the project; the git root is used when there is one.
    pub project: String,
    /// The skill to pin (a skill in the shared store).
    pub skill: String,
    /// The pinned name. Must differ from every skill name installed globally.
    pub name: String,
    /// Tag, branch or commit on the skill's GitHub source; `None` = pin the current shared copy.
    #[serde(default)]
    pub git_ref: Option<String>,
    /// Agents that get the pin; empty = the default agents (enabled and detected).
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub mode: PinMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameCheck {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRef {
    pub project: String,
    pub project_name: String,
    pub pin: String,
    pub state: PinState,
}

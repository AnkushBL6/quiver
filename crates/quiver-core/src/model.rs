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

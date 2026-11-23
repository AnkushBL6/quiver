// Mirror of crates/quiver-core/src/model.rs. Keep in sync.

export type LinkMode = "symlink" | "copy";

export interface AgentInfo {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  detected: boolean;
  enabled: boolean;
  skillsDir: string;
  extraDirs: string[];
  readsCanonical: boolean;
  linkMode: LinkMode;
  skillCount: number;
  note: string | null;
  custom: boolean;
  /** Installed app bundle for this agent (e.g. /Applications/Cursor.app), used for its icon. */
  appPath: string | null;
  /** Where this agent reads a repository's own skills, e.g. ".claude/skills". null: no project folder. */
  projectDir: string | null;
}

export type LocationKind = "canonical" | "directory" | "link" | "foreignLink" | "broken" | "plugin";

export interface Location {
  path: string;
  agentId: string | null;
  kind: LocationKind;
  target: string | null;
  contentHash: string | null;
  writable: boolean;
}

export type Presence = "native" | "linked" | "copied" | "local" | "foreign" | "broken" | "plugin" | "absent";

export interface AgentPresence {
  agentId: string;
  presence: Presence;
}

export type IssueKind =
  | "brokenLink" | "conflict" | "unmanaged" | "missingSkillMd" | "invalidFrontmatter"
  | "invalidName" | "nameMismatch" | "missingDescription" | "descriptionTooLong";

export interface Issue {
  kind: IssueKind;
  message: string;
  severity: "error" | "warning" | "info";
}

/** Where a skill comes from, from the user's point of view. */
export type Origin = "mine" | "installed" | "local" | "unmanaged" | "plugin";

export interface SkillSource {
  kind: "github" | "git" | "local" | "unknown" | "mine";
  source: string;
  url: string | null;
  skillPath: string | null;
  gitRef: string | null;
  installedAt: string | null;
  updatedAt: string | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string | null;
  license: string | null;
  allowedTools: string | null;
  managed: boolean;
  primaryPath: string | null;
  locations: Location[];
  presence: AgentPresence[];
  source: SkillSource | null;
  issues: Issue[];
  fileCount: number;
  sizeBytes: number;
  modifiedMs: number | null;
  readOnly: boolean;
  plugin: string | null;
  origin: Origin;
  /** Mine only: uncommitted changed files inside this skill's folder; null if ~/Skills isn't a git repo. */
  gitChanges: number | null;
  /** e.g. "anthropics/skills" when made mine from an installed skill. */
  forkedFrom: string | null;
  /** Projects that pin this skill under another name (from registered projects' pin files); [] if none. */
  pinnedIn: PinRef[];
}

export interface Stats {
  total: number;
  managed: number;
  unmanaged: number;
  withIssues: number;
  agentsDetected: number;
}

export interface Inventory {
  canonicalDir: string;
  agents: AgentInfo[];
  skills: Skill[];
  stats: Stats;
  scannedAtMs: number;
}

export interface FileEntry {
  path: string;
  size: number;
  isDir: boolean;
}

export interface SkillDetail {
  skill: Skill;
  skillMd: string;
  body: string;
  frontmatter: Record<string, unknown>;
  files: FileEntry[];
}

export interface Candidate {
  id: string;
  name: string;
  description: string;
  path: string;
  alreadyInstalled: boolean;
  issues: Issue[];
}

export interface ResolvedSource {
  token: string;
  kind: "github" | "git" | "local" | "zip";
  display: string;
  candidates: Candidate[];
}

export interface InstallRequest {
  token: string;
  paths: string[];
  agents: string[];
  overwrite: boolean;
}

export interface OpMessage { id: string; message: string }
export interface OpReport { ok: string[]; skipped: OpMessage[]; errors: OpMessage[] }

export type UpdateStatus = "upToDate" | "available" | "untracked" | "error";

export interface UpdateInfo {
  id: string;
  status: UpdateStatus;
  source: string | null;
  current: string | null;
  latest: string | null;
  locallyModified: boolean;
  message: string | null;
  checkedAtMs: number;
}

export interface SearchResult {
  id: string;
  name: string;
  source: string;
  installs: number;
  installed: boolean;
}

export interface CustomAgent { id: string; name: string; skillsDir: string }

export interface Settings {
  defaultAgents: string[];
  hiddenAgents: string[];
  linkModes: Record<string, LinkMode>;
  customAgents: CustomAgent[];
  autoCheckUpdates: boolean;
  checkIntervalHours: number;
  scanPlugins: boolean;
  autoLinkNewAgents: boolean;
  /** Every skill in every agent, automatically. Unlinks become exceptions. */
  universal: boolean;
  githubTokenSource: string | null; // "keychain" | "env" | "gh" | null (read-only)
  /** The user's own skills folder (a git repo). Default "~/Skills". */
  mySkillsDir: string;
  /** Editor app name, e.g. "Visual Studio Code"; null = auto-detect. */
  editor: string | null;
  /** Registered project roots (see Projects). Managed with project_add / project_remove. */
  projects: string[];
}

export interface SyncPlan {
  links: [string, string][];
  adopt: string[];
  prune: string[];
  conflicts: string[];
  /** Folders in My Skills not yet linked into the store (applied with `adopt`). */
  register?: string[];
}

export interface SyncOptions { link: boolean; adopt: boolean; prune: boolean }

// ── My Skills (the user's own, git-backed folder) ───────────────────────────

/** status: "M", "A", "D", "R", "??" */
export interface GitChange { path: string; status: string; skillId: string | null }
export interface Commit { hash: string; subject: string; whenMs: number }

export interface MySkillsStatus {
  dir: string;
  displayDir: string;
  exists: boolean;
  gitAvailable: boolean;
  isRepo: boolean;
  branch: string | null;
  remote: string | null;
  githubRepo: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  lastCommit: Commit | null;
  count: number;
  /** Set when the configured folder can't be used (e.g. it overlaps an agent folder). */
  problem: string | null;
}

export interface EditorApp { name: string; path: string }

/** exact = folder identical · skillMd = SKILL.md identical · name = same name, content differs. */
export type MatchConfidence = "exact" | "skillMd" | "name";
export interface SourceMatch {
  id: string;
  source: string; // owner/repo
  skillPath: string;
  confidence: MatchConfidence;
  installs: number;
  known: boolean;
}
export interface SourceScan {
  checked: number;
  matches: SourceMatch[];
  rateLimited: boolean;
  unchecked: string[];
}

// ── Comparing conflicting copies ────────────────────────────────────────────

export interface VersionLocation {
  path: string;
  /** Agents reading this folder (empty for the shared store). */
  agentIds: string[];
  kind: LocationKind;
}

/** A distinct content of a skill: every copy with the same bytes is one version. */
export interface SkillVersion {
  /** "v1", "v2"… in the order Health lists the copies (shared copy first). */
  id: string;
  /** Identifies this content across calls (same value as `Location.contentHash`). */
  contentHash: string;
  locations: VersionLocation[];
  /** Every agent that sees this version: through a copy, a link, or by reading the shared store. */
  agentIds: string[];
  /** The content of the shared store. */
  shared: boolean;
  modifiedMs: number | null;
  fileCount: number;
  sizeBytes: number;
  /** Strictly the most recently modified version. */
  newest: boolean;
  /** true: differs from what was installed · false: still as installed · null: no install record. */
  editedSinceInstall: boolean | null;
}

export type FileStatus = "same" | "changed" | "partial";
export type FileContent = "text" | "binary" | "tooLarge";

export interface FileVariant {
  size: number;
  /** Equal digests mean identical bytes. */
  digest: string;
}

export interface FileCompare {
  path: string;
  status: FileStatus;
  content: FileContent;
  /** One per version (same order as `versions`); null where the file doesn't exist. */
  variants: (FileVariant | null)[];
}

export interface CopyComparison {
  skillId: string;
  name: string;
  versions: SkillVersion[];
  files: FileCompare[];
  /** "owner/repo" when installed from GitHub: `compare_upstream` can run. */
  upstreamSource: string | null;
  /** Version ids to show first: [left, right]. */
  suggested: [string, string] | null;
}

export type UpstreamStatus = "checked" | "noSource" | "unavailable";

export interface UpstreamCheck {
  status: UpstreamStatus;
  source: string | null;
  /** `contentHash` of every version identical to the latest upstream folder. */
  matchingHashes: string[];
  message: string | null;
}

export type RowKind = "equal" | "insert" | "delete" | "replace";

export interface DiffRow {
  kind: RowKind;
  leftNo: number | null;
  rightNo: number | null;
  left: string | null;
  right: string | null;
  /** Changed spans as [start, end) UTF-16 offsets. Empty = the whole line. */
  leftMarks: [number, number][];
  rightMarks: [number, number][];
}

export interface DiffBlock {
  /** A long run of unchanged lines, hidden until expanded. Rows are still included. */
  collapsed: boolean;
  rows: DiffRow[];
}

export interface FileDiff {
  path: string;
  content: FileContent;
  identical: boolean;
  /** null where the file doesn't exist on that side. */
  leftSize: number | null;
  rightSize: number | null;
  blocks: DiffBlock[];
  added: number;
  removed: number;
  /** Same lines; only line endings differ. */
  eolOnly: boolean;
}

// ── Projects and pinned skills ──────────────────────────────────────────────
// A repo keeps its own fixed copy of a skill (under its own name) while every
// other project keeps using the shared one. See /tmp/quiver-pins-contract.md.

export type PinState = "ok" | "modified" | "missing" | "links";
export type PinMode = "symlink" | "copy";

export interface PinAgentLink {
  agentId: string;
  /** Repo-relative, e.g. ".claude/skills/browser-qa-release". */
  dir: string;
  kind: "native" | "symlink" | "copy";
  ok: boolean;
  /** Plain language. */
  problem: string | null;
}

export interface Pin {
  /** Pinned name (folder + frontmatter). */
  name: string;
  /** Original skill name. */
  skill: string;
  /** The original description, without the pin prefix. */
  description: string;
  source: SkillSource | null;
  /** Commit SHA when pinned from GitHub at a ref. */
  gitRef: string | null;
  pinnedFrom: "shared" | "github";
  /** ISO 8601. */
  pinnedAt: string;
  hash: string;
  upstreamHash: string | null;
  state: PinState;
  changedFiles: string[];
  /** Plain language, one per issue; empty when ok. */
  problems: string[];
  /** The shared copy on this machine moved on since pinning. Informational. null: no shared copy. */
  sharedChanged: boolean | null;
  /** Agents whose global skills folder already has a skill with this name. A warning. */
  nameClash: string[];
  mode: PinMode;
  agents: PinAgentLink[];
  /** Absolute path of the pin folder. */
  path: string;
}

/** A skill in the project that is not a Quiver pin (e.g. from `npx skills add`). */
export interface ProjectSkill {
  name: string;
  description: string;
  /** Repo-relative folder. */
  dir: string;
  /** From the skills CLI's project file when present. */
  source: string | null;
}

export interface ProjectSummary {
  path: string;
  /** Uses ~. */
  displayPath: string;
  /** Folder name. */
  name: string;
  /** Current git branch; null if not a repo or detached. */
  branch: string | null;
  isRepo: boolean;
  exists: boolean;
  pinCount: number;
  /** Pins whose state isn't "ok". */
  problemCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  pins: Pin[];
  otherSkills: ProjectSkill[];
  /** Absolute path of quiver-pins.json; null if there is none yet. */
  lockFile: string | null;
}

export interface PinRequest {
  project: string;
  skill: string;
  name: string;
  /** null = pin the current shared copy. */
  gitRef: string | null;
  /** Empty = the default (enabled and detected agents). */
  agents: string[];
  mode: PinMode;
}

export interface NameCheck {
  ok: boolean;
  message: string | null;
}

export interface PinRef {
  project: string;
  projectName: string;
  pin: string;
  state: PinState;
}

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

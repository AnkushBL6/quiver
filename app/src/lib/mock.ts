// Stateful in-memory backend used when the UI runs in a plain browser
// (website, product video, `pnpm dev`). It mimics the Rust core closely enough
// that every screen works end to end.
//
// URL flags: ?demo=empty (first run, nothing installed), ?demo=stress (300 skills).

import { toast } from "sonner";
import type {
  AgentInfo,
  AgentPresence,
  Candidate,
  EditorApp,
  GitChange,
  MySkillsStatus,
  Origin,
  FileEntry,
  InstallRequest,
  Inventory,
  Issue,
  LinkMode,
  Location,
  OpReport,
  Presence,
  ResolvedSource,
  SearchResult,
  Settings,
  Skill,
  SourceMatch,
  SkillDetail,
  SkillSource,
  SyncOptions,
  SyncPlan,
  UpdateInfo,
} from "./types";
import { REGISTRY } from "./mockRegistry";
import { fileManager } from "./ui";
import {
  DIRECTORY,
  HOME,
  LOCAL_SOURCES,
  REPOS,
  SEED_SKILLS,
  bodyFor,
  fileText,
  type RepoSkill,
} from "./mockData";

// ── helpers ──────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const demo = params.get("demo");
/** ?mine=missing | norepo | nogit | noremote: exercise the My Skills empty states. */
const mineMode = params.get("mine") ?? (demo === "empty" ? "missing" : null);
const CANON = `${HOME}/.agents/skills`;
const expand = (p: string) => (p.startsWith("~") ? HOME + p.slice(1) : p);
const tildify = (p: string) => (p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p);

let seed = 7;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const hex = (n = 7) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = (lo = 200, hi = 400) => sleep(lo + Math.random() * (hi - lo));
const DAY = 86_400_000;

// ── model ────────────────────────────────────────────────────────────────────

type EntryKind = "link" | "dir" | "broken" | "foreign" | "plugin";
interface Entry {
  kind: EntryKind;
  hash?: string;
  target?: string;
  path?: string;
}

interface MSkill {
  id: string;
  name: string;
  description: string;
  version: string | null;
  license: string | null;
  allowedTools: string | null;
  files: string[];
  body?: string;
  canonicalHash: string | null;
  entries: Record<string, Entry>;
  source: SkillSource | null;
  plugin: string | null;
  modifiedMs: number;
  upstream: { current: string; latest: string; modified: boolean; error?: string } | null;
  extraIssues: Issue[];
  /** Lives in the user's own ~/Skills folder. */
  mine?: boolean;
  forkedFrom?: string | null;
}

const DETECTED_BASE = [
  "claude-code", "codex", "antigravity", "cursor", "gemini-cli", "github-copilot",
  "opencode", "windsurf", "droid", "amp", "kiro-cli", "goose",
];
const DETECTED = demo === "stress" ? [...DETECTED_BASE, "cline", "roo", "continue"] : DETECTED_BASE;

let settings: Settings = {
  defaultAgents: [],
  hiddenAgents: [],
  linkModes: { windsurf: "copy" },
  customAgents: [],
  autoCheckUpdates: true,
  checkIntervalHours: 12,
  scanPlugins: true,
  autoLinkNewAgents: false,
  // Most people run Quiver in universal mode: every skill in every agent.
  universal: demo !== "empty",
  githubTokenSource: "gh",
  mySkillsDir: "~/Skills",
  editor: null,
};

// ── My Skills repo state ─────────────────────────────────────────────────────

const repo = {
  exists: mineMode !== "missing",
  gitAvailable: mineMode !== "nogit",
  isRepo: mineMode !== "missing" && mineMode !== "norepo" && mineMode !== "nogit",
  branch: "main" as string | null,
  remote: (mineMode === "noremote" ? null : "git@github.com:maya/skills.git") as string | null,
  ahead: 1,
  behind: 2,
  changes: [] as GitChange[],
  lastCommit: { hash: "4f2c9a1", subject: "typescript-house-style: prefer satisfies over casts", whenMs: Date.now() - 3 * 3600_000 } as MySkillsStatus["lastCommit"],
};
const mineDir = () => expand(settings.mySkillsDir);
const githubRepoOf = (remote: string | null) => remote?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;

const EDITORS: EditorApp[] = [
  { name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app" },
  { name: "Cursor", path: "/Applications/Cursor.app" },
  { name: "Zed", path: "/Applications/Zed.app" },
  { name: "TextEdit", path: "/System/Applications/TextEdit.app" },
];

const APP_PATHS: Record<string, string> = {
  "claude-code": "/Applications/Claude.app",
  antigravity: "/Applications/Antigravity.app",
  "github-copilot": "/Applications/Visual Studio Code.app",
};

/** Placeholder "app icons" so the real-icon path is visible in the browser. Generic shapes, no real logos. */
function placeholderIcon(id: string): string | null {
  const sq = "M50 4h28c22 0 30 8 30 30v28c0 22-8 30-30 30H50C28 92 20 84 20 62V34C20 12 28 4 50 4Z";
  const wrap = (defs: string, body: string) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 0 100 100">${defs}<path d="${sq}" fill="url(#g)"/><path d="${sq}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width=".8"/>${body}</svg>`,
    )}`;
  switch (id) {
    case "claude-code":
      return wrap(
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3532"/><stop offset="1" stop-color="#1f1c1a"/></linearGradient></defs>`,
        `<path d="M44 34l14 14-14 14" fill="none" stroke="#f2d9c4" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M64 64h22" stroke="#f2d9c4" stroke-width="7" stroke-linecap="round"/>`,
      );
    case "antigravity":
      return wrap(
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfd"/><stop offset="1" stop-color="#e6e8ec"/></linearGradient></defs>`,
        `<path d="M64 24 88 72H76L64 46 52 72H40Z" fill="#2f6fe4"/><circle cx="64" cy="80" r="5" fill="#2f6fe4"/>`,
      );
    case "github-copilot":
      return wrap(
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b9cf0"/><stop offset="1" stop-color="#1667c9"/></linearGradient></defs>`,
        `<path d="M54 30 38 48l16 18M74 30l16 18-16 18" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
  }
  return null;
}

const skills = new Map<string, MSkill>();

/** What find_sources "discovers" for the hand-added skills. */
const SOURCE_MATCHES: Record<string, SourceMatch> = {
  "remotion-best-practices": { id: "remotion-best-practices", source: "remotion-dev/skills", skillPath: "skills/remotion/SKILL.md", confidence: "exact", installs: 48_210, known: false },
  caveman: { id: "caveman", source: "juliusbrussee/caveman", skillPath: "skills/caveman/SKILL.md", confidence: "exact", installs: 31_377, known: false },
  "stripe-best-practices": { id: "stripe-best-practices", source: "stripe/ai", skillPath: "skills/stripe-best-practices/SKILL.md", confidence: "exact", installs: 22_948, known: false },
  "better-auth-best-practices": { id: "better-auth-best-practices", source: "better-auth/skills", skillPath: "better-auth-best-practices/SKILL.md", confidence: "skillMd", installs: 12_402, known: false },
  "cloudflare-workers": { id: "cloudflare-workers", source: "cloudflare/skills", skillPath: "skills/cloudflare-workers/SKILL.md", confidence: "skillMd", installs: 17_390, known: false },
  humanizer: { id: "humanizer", source: "blader/humanizer", skillPath: "SKILL.md", confidence: "name", installs: 16_844, known: false },
  "code-review": { id: "code-review", source: "anthropics/skills", skillPath: "skills/code-review/SKILL.md", confidence: "name", installs: 9_120, known: true },
};
const resolutions = new Map<string, { display: string; kind: ResolvedSource["kind"]; source: string; skills: RepoSkill[] }>();
let lastUpdateCheck = 0;

interface MAgent {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  skillsDir: string;
  extraDirs: string[];
  readsCanonical: boolean;
  note: string | null;
  custom: boolean;
  detected: boolean;
}

function agents(): MAgent[] {
  const base: MAgent[] = REGISTRY.map((a) => {
    const dirs = a.dirs.map(expand);
    const readDirs = a.readDirs.map(expand);
    const readsCanonical = dirs.includes(CANON) || readDirs.includes(CANON);
    return {
      id: a.id,
      name: a.name,
      tier: a.tier,
      skillsDir: dirs[0],
      extraDirs: [...dirs.slice(1), ...readDirs],
      readsCanonical,
      note: a.note,
      custom: false,
      detected: DETECTED.includes(a.id),
    };
  });
  for (const c of settings.customAgents) {
    base.push({
      id: c.id,
      name: c.name,
      tier: 3,
      skillsDir: expand(c.skillsDir),
      extraDirs: [],
      readsCanonical: expand(c.skillsDir) === CANON,
      note: null,
      custom: true,
      detected: true,
    });
  }
  return base;
}
const agentById = (id: string) => agents().find((a) => a.id === id);
const linkMode = (id: string): LinkMode => settings.linkModes[id] ?? "symlink";
const isEnabled = (id: string) => !settings.hiddenAgents.includes(id);
const activeAgents = () => agents().filter((a) => a.detected && isEnabled(a.id));

function sourceFor(src: string | undefined, id: string, daysAgo: number, skillPath?: string): SkillSource | null {
  if (!src) return null;
  if (src.startsWith("local:")) {
    const p = expand(src.slice(6));
    return { kind: "local", source: p, url: null, skillPath: null, gitRef: null, installedAt: iso(daysAgo + 20), updatedAt: iso(daysAgo) };
  }
  return {
    kind: "github",
    source: src,
    url: `https://github.com/${src}`,
    skillPath: skillPath ?? (src === "anthropics/skills" ? `skills/${id}/SKILL.md` : `${id}/SKILL.md`),
    gitRef: "main",
    installedAt: iso(daysAgo + 30),
    updatedAt: iso(daysAgo),
  };
}
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function linkEntry(agentId: string, hash: string): Entry {
  return linkMode(agentId) === "copy" ? { kind: "dir", hash } : { kind: "link" };
}

// ── seed ─────────────────────────────────────────────────────────────────────

function pickReach(reach: NonNullable<(typeof SEED_SKILLS)[number]["reach"]>): string[] {
  const writable = DETECTED.filter((id) => !agentById(id)?.readsCanonical);
  const shuffled = [...writable].sort(() => rand() - 0.5);
  switch (reach) {
    case "all":
      return writable;
    case "most":
      return writable.filter(() => rand() > 0.22);
    case "some":
      return ["claude-code", ...shuffled.filter((a) => a !== "claude-code").slice(0, 4)];
    case "few":
      return ["claude-code", ...shuffled.filter((a) => a !== "claude-code").slice(0, 1)];
    case "one":
      return ["claude-code"];
  }
}

function seedDefault() {
  for (const s of SEED_SKILLS) {
    const days = s.daysAgo ?? 10;
    const m: MSkill = {
      id: s.id,
      name: s.name ?? s.id,
      description: s.description,
      version: s.version ?? null,
      license: s.license ?? null,
      allowedTools: s.allowedTools ?? null,
      files: s.files ?? [],
      canonicalHash: null,
      entries: {},
      source: sourceFor(s.source, s.id, days),
      plugin: s.plugin ?? null,
      modifiedMs: Date.now() - days * DAY - Math.floor(rand() * 8 * 3600_000),
      upstream: null,
      extraIssues: [],
      mine: !!s.mine,
      forkedFrom: s.forkedFrom ?? null,
    };
    if (s.mine) {
      m.source = null;
      for (const [path, status] of s.changes ?? []) repo.changes.push({ path: `${s.id}/${path}`, status, skillId: s.id });
    }
    if (s.plugin) {
      const name = s.plugin.split("@")[0];
      m.entries["claude-code"] = {
        kind: "plugin",
        hash: hex(),
        path: `${HOME}/.claude/plugins/cache/claude-plugins-official/${name}/1.2.0/skills/${s.id}`,
      };
      m.source = null;
    } else if (s.only) {
      const h = hex();
      for (const a of s.only) m.entries[a] = { kind: "dir", hash: h };
    } else {
      m.canonicalHash = hex();
      for (const a of pickReach(s.reach ?? "all")) if (!s.missing?.includes(a)) m.entries[a] = linkEntry(a, m.canonicalHash);
      if (m.source?.kind === "github" && !m.mine) {
        const cur = hex();
        m.upstream = { current: cur, latest: cur, modified: false };
      }
    }
    skills.set(m.id, m);
  }

  repo.changes.push({ path: "README.md", status: "M", skillId: null });
  if (!repo.isRepo) repo.changes = [];
  if (!repo.exists) for (const s of skills.values()) if (s.mine) skills.delete(s.id);

  // Updates: four available, one of them edited locally.
  for (const id of ["pdf", "frontend-design", "systematic-debugging", "backend-patterns"]) {
    const s = skills.get(id)!;
    s.upstream!.latest = hex();
  }
  skills.get("systematic-debugging")!.upstream!.modified = true;

  // Problems: a local edit that conflicts with the shared copy, a broken link, and a SKILL.md without a description.
  skills.get("code-review")!.entries["claude-code"] = { kind: "dir", hash: hex() };
  skills.get("caveman")!.entries["claude-code"] = { kind: "broken", target: `${HOME}/code/caveman/skills/caveman` };
  skills.get("api-conventions")!.extraIssues.push({
    kind: "missingDescription",
    severity: "warning",
    message: "SKILL.md has no description, so agents can't tell when to use this skill.",
  });
}

const LONG_WORDS = [
  "enterprise", "observability", "pipeline", "configuration", "alerting", "runbook", "generator", "kubernetes",
  "migration", "assistant", "analyzer", "terraform", "accessibility", "localization", "compliance", "reviewer",
  "postgres", "graphql", "schema", "benchmark", "react", "native", "design", "tokens", "audit", "security",
];

function seedStress() {
  seedDefault();
  const writable = DETECTED.filter((id) => !agentById(id)?.readsCanonical);
  let i = 0;
  while (skills.size < 300) {
    i++;
    const n = i % 9 === 0 ? 14 : i % 4 === 0 ? 7 : 2 + (i % 3);
    const words = Array.from({ length: n }, (_, k) => LONG_WORDS[(i * 7 + k * 13) % LONG_WORDS.length]);
    const id = `${words.join("-")}-${i}`;
    const h = hex();
    const m: MSkill = {
      id,
      name: id,
      description:
        i % 5 === 0
          ? `An exceptionally long description for stress testing: ${words.join(" ")} ${"with lots of extra detail ".repeat(12)}`
          : `Helps with ${words.join(" ")} tasks.`,
      version: null,
      license: null,
      allowedTools: null,
      files: [],
      canonicalHash: i % 11 === 0 ? null : h,
      entries: {},
      source: i % 3 === 0 ? sourceFor(`stress-org-${i % 17}/skills-collection-${i % 5}`, id, i % 40) : null,
      plugin: null,
      modifiedMs: Date.now() - (i % 60) * DAY,
      upstream: null,
      extraIssues: [],
    };
    for (const a of writable) if (rand() > 0.45) m.entries[a] = m.canonicalHash ? linkEntry(a, h) : { kind: "dir", hash: h };
    if (!m.canonicalHash && Object.keys(m.entries).length === 0) m.entries["claude-code"] = { kind: "dir", hash: h };
    skills.set(id, m);
  }
}

if (demo === "empty") {
  /* nothing installed */
} else if (demo === "stress") seedStress();
else seedDefault();

// ── derive Inventory ─────────────────────────────────────────────────────────

function entryPath(agent: MAgent, s: MSkill, e: Entry) {
  return e.path ?? `${agent.skillsDir}/${s.id}`;
}

function presenceOf(s: MSkill, a: MAgent): Presence {
  const e = s.entries[a.id];
  if (e) {
    switch (e.kind) {
      case "link":
        return s.canonicalHash ? "linked" : "foreign";
      case "dir":
        return s.canonicalHash && e.hash === s.canonicalHash ? "copied" : "local";
      case "foreign":
        return "foreign";
      case "broken":
        return "broken";
      case "plugin":
        return "plugin";
    }
  }
  if (a.readsCanonical && s.canonicalHash) return "native";
  return "absent";
}

function hasConflict(s: MSkill): boolean {
  const hashes = new Set<string>();
  if (s.canonicalHash) hashes.add(s.canonicalHash);
  for (const [aid, e] of Object.entries(s.entries)) {
    if (e.kind !== "dir" || !e.hash) continue;
    // Copy-mode copies that are merely stale aren't a conflict on their own.
    if (s.canonicalHash && linkMode(aid) === "copy") continue;
    hashes.add(e.hash);
  }
  return hashes.size > 1;
}

function toSkill(s: MSkill, all: MAgent[]): Skill {
  const byId = new Map(all.map((a) => [a.id, a]));
  const locations: Location[] = [];
  const canonPath = `${CANON}/${s.id}`;
  if (s.canonicalHash) {
    locations.push({ path: canonPath, agentId: null, kind: "canonical", target: null, contentHash: s.canonicalHash, writable: true });
  }
  for (const [aid, e] of Object.entries(s.entries)) {
    const a = byId.get(aid);
    if (!a) continue;
    const path = entryPath(a, s, e);
    const kind: Location["kind"] =
      e.kind === "link" ? "link" : e.kind === "dir" ? "directory" : e.kind === "foreign" ? "foreignLink" : e.kind === "broken" ? "broken" : "plugin";
    locations.push({
      path,
      agentId: aid,
      kind,
      target: e.kind === "link" ? canonPath : (e.target ?? null),
      contentHash: e.kind === "broken" ? null : e.kind === "link" ? s.canonicalHash : (e.hash ?? null),
      writable: e.kind !== "plugin",
    });
  }

  const issues: Issue[] = [];
  for (const [aid, e] of Object.entries(s.entries)) {
    if (e.kind === "broken") {
      const a = byId.get(aid);
      issues.push({
        kind: "brokenLink",
        severity: "error",
        message: `Broken link in ${a?.name ?? aid}: ${tildify(a ? entryPath(a, s, e) : s.id)} → ${tildify(e.target ?? "?")} no longer exists.`,
      });
    }
  }
  if (hasConflict(s)) {
    const where = [
      ...(s.canonicalHash ? ["the canonical store"] : []),
      ...Object.entries(s.entries)
        .filter(([, e]) => e.kind === "dir")
        .map(([aid]) => byId.get(aid)?.name ?? aid),
    ];
    issues.push({
      kind: "conflict",
      severity: "warning",
      message: `${where.length} copies have different contents (${where.join(", ")}). Choose the one to keep.`,
    });
  }
  const realCopies = Object.entries(s.entries).filter(([, e]) => e.kind === "dir");
  if (!s.canonicalHash && !s.plugin && realCopies.length) {
    const names = realCopies.map(([aid]) => byId.get(aid)?.name ?? aid);
    issues.push({
      kind: "unmanaged",
      severity: "info",
      message:
        names.length === 1
          ? `Only in ${names[0]}'s folder. Make it universal to share it with every agent.`
          : `Separate copies in ${names.join(" and ")}. Make it universal to keep one copy for every agent.`,
    });
  }
  if (!s.canonicalHash && !s.plugin && !realCopies.length && Object.values(s.entries).every((e) => e.kind === "broken")) {
    issues.push({ kind: "missingSkillMd", severity: "error", message: "No readable SKILL.md: every location is a broken link." });
  }
  issues.push(...s.extraIssues);

  if (s.mine && s.canonicalHash) {
    // The canonical entry is a link into ~/Skills.
    locations[0] = { ...locations[0], target: `${mineDir()}/${s.id}` };
  }
  const primary = s.mine
    ? `${mineDir()}/${s.id}`
    : s.canonicalHash
    ? canonPath
    : (locations.find((l) => l.kind === "directory" || l.kind === "plugin" || l.kind === "foreignLink")?.path ?? null);
  const allFiles = ["SKILL.md", ...s.files];
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    version: s.version,
    license: s.license,
    allowedTools: s.allowedTools,
    managed: !!s.canonicalHash,
    primaryPath: primary,
    locations,
    presence: all.map<AgentPresence>((a) => ({ agentId: a.id, presence: presenceOf(s, a) })),
    source: s.mine ? mineSource(s) : s.source,
    issues,
    fileCount: primary ? allFiles.filter((f) => !f.endsWith("/")).length : 0,
    sizeBytes: primary ? 2_400 + s.files.length * 5_300 + s.description.length * 3 : 0,
    modifiedMs: primary ? s.modifiedMs : null,
    readOnly: !!s.plugin,
    plugin: s.plugin,
    origin: originOf(s),
    gitChanges: s.mine ? (repo.isRepo ? repo.changes.filter((c) => c.skillId === s.id).length : null) : null,
    forkedFrom: s.mine ? (s.forkedFrom ?? null) : null,
  };
}

function originOf(s: MSkill): Origin {
  if (s.mine) return "mine";
  if (s.plugin) return "plugin";
  if (!s.canonicalHash) return "unmanaged";
  if (s.source && (s.source.kind === "github" || s.source.kind === "git")) return "installed";
  return "local";
}

function mineSource(s: MSkill): SkillSource {
  const gh = githubRepoOf(repo.remote);
  return {
    kind: "mine",
    source: tildify(mineDir()),
    url: gh ? `https://github.com/${gh}/tree/${repo.branch ?? "main"}/${s.id}` : null,
    skillPath: `${s.id}/SKILL.md`,
    gitRef: repo.isRepo ? repo.branch : null,
    installedAt: null,
    updatedAt: null,
  };
}

function myStatus(): MySkillsStatus {
  const dir = mineDir();
  return {
    dir,
    displayDir: tildify(dir),
    exists: repo.exists,
    gitAvailable: repo.gitAvailable,
    isRepo: repo.isRepo,
    branch: repo.isRepo ? repo.branch : null,
    remote: repo.isRepo ? repo.remote : null,
    githubRepo: repo.isRepo ? githubRepoOf(repo.remote) : null,
    ahead: repo.isRepo && repo.remote ? repo.ahead : 0,
    behind: repo.isRepo && repo.remote ? repo.behind : 0,
    changes: repo.isRepo ? structuredClone(repo.changes) : [],
    lastCommit: repo.isRepo ? repo.lastCommit : null,
    count: [...skills.values()].filter((s) => s.mine).length,
    problem: null,
  };
}

function initMine() {
  if (!repo.exists) {
    repo.exists = true;
  }
  if (!repo.gitAvailable) return;
  if (!repo.isRepo) {
    repo.isRepo = true;
    repo.branch = "main";
    repo.remote = null;
    repo.ahead = 0;
    repo.behind = 0;
    repo.changes = [...skills.values()].filter((s) => s.mine).map((s) => ({ path: `${s.id}/`, status: "??", skillId: s.id }));
    repo.lastCommit = null;
  }
}

function makeMine(id: string) {
  const s = must(id);
  if (s.mine) throw `“${id}” is already one of your skills.`;
  if (s.plugin) throw `“${id}” is provided by the ${s.plugin.split("@")[0]} plugin and can't be moved.`;
  if (!s.canonicalHash) adoptSkill(s);
  initMine();
  s.forkedFrom = s.source && (s.source.kind === "github" || s.source.kind === "git") ? s.source.source : null;
  s.mine = true;
  s.source = null;
  s.upstream = null;
  s.modifiedMs = Date.now();
  if (repo.isRepo) repo.changes.push({ path: `${id}/`, status: "??", skillId: id });
}

function inventory(): Inventory {
  const all = agents();
  const list = [...skills.values()]
    .filter((s) => settings.scanPlugins || !s.plugin)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => toSkill(s, all));
  const agentInfos: AgentInfo[] = all.map((a) => ({
    id: a.id,
    name: a.name,
    tier: a.tier,
    detected: a.detected,
    enabled: isEnabled(a.id),
    skillsDir: a.skillsDir,
    extraDirs: a.extraDirs,
    readsCanonical: a.readsCanonical,
    linkMode: linkMode(a.id),
    skillCount: a.detected
      ? list.filter((s) => {
          const p = s.presence.find((x) => x.agentId === a.id)?.presence;
          return p && p !== "absent" && p !== "broken";
        }).length
      : 0,
    note: a.note,
    custom: a.custom,
    appPath: a.detected ? (APP_PATHS[a.id] ?? null) : null,
  }));
  return {
    canonicalDir: CANON,
    agents: agentInfos,
    skills: list,
    stats: {
      total: list.length,
      managed: list.filter((s) => s.managed).length,
      unmanaged: list.filter((s) => !s.managed && !s.plugin).length,
      withIssues: list.filter((s) => s.issues.length > 0).length,
      agentsDetected: agentInfos.filter((a) => a.detected).length,
    },
    scannedAtMs: Date.now(),
  };
}

// ── mutations ────────────────────────────────────────────────────────────────

function must(id: string): MSkill {
  const s = skills.get(id);
  if (!s) throw `Skill "${id}" not found.`;
  return s;
}

function adoptSkill(s: MSkill, fromPath?: string) {
  if (s.plugin) throw `"${s.id}" is provided by the ${s.plugin.split("@")[0]} plugin and is read-only.`;
  let winner: string | undefined;
  if (fromPath) {
    if (fromPath === `${CANON}/${s.id}`) winner = s.canonicalHash ?? undefined;
    else {
      for (const [aid, e] of Object.entries(s.entries)) {
        const a = agentById(aid);
        if (a && entryPath(a, s, e) === fromPath) winner = e.kind === "link" ? (s.canonicalHash ?? undefined) : e.hash;
      }
    }
    if (!winner) throw `No readable copy of "${s.id}" at ${tildify(fromPath)}.`;
  } else {
    if (hasConflict(s)) throw `"${s.id}" has conflicting copies. Choose the one to keep in Health first.`;
    winner = s.canonicalHash ?? Object.values(s.entries).find((e) => e.kind === "dir" || e.kind === "foreign")?.hash;
    if (!winner) throw `"${s.id}" has no readable copy to adopt.`;
  }
  s.canonicalHash = winner;
  for (const [aid, e] of Object.entries(s.entries)) {
    if (e.kind === "dir" || e.kind === "broken") s.entries[aid] = linkEntry(aid, winner);
  }
  if (s.upstream) s.upstream.modified = false;
  if (!s.source) {
    s.modifiedMs = Date.now();
  }
}

function link(s: MSkill, agentId: string, enabled: boolean) {
  const a = agentById(agentId);
  if (!a) throw `Unknown agent "${agentId}".`;
  if (s.plugin) throw `"${s.id}" comes from a plugin and can't be linked to other agents.`;
  if (!s.canonicalHash) adoptSkill(s);
  if (a.readsCanonical) {
    if (!enabled) throw `${a.name} reads ~/.agents/skills directly, so it always sees managed skills. Hide ${a.name} in Settings instead.`;
    delete s.entries[agentId];
    return;
  }
  if (enabled) s.entries[agentId] = linkEntry(agentId, s.canonicalHash!);
  else delete s.entries[agentId];
}

function removeSkill(id: string) {
  const s = must(id);
  if (s.plugin) throw `"${id}" is provided by a plugin. Uninstall the plugin from Claude Code instead.`;
  skills.delete(id);
  if (s.mine && repo.isRepo) {
    const wasNew = repo.changes.some((c) => c.skillId === id && c.status === "??");
    repo.changes = repo.changes.filter((c) => c.skillId !== id);
    if (!wasNew) repo.changes.push({ path: `${id}/SKILL.md`, status: "D", skillId: id });
  }
}

function plan(): SyncPlan {
  const active = activeAgents().filter((a) => !a.readsCanonical);
  const links: [string, string][] = [];
  const adopt: string[] = [];
  const prune: string[] = [];
  const conflicts: string[] = [];
  for (const s of skills.values()) {
    if (s.plugin) continue;
    const conflict = hasConflict(s);
    if (conflict) conflicts.push(s.id);
    const hasReal = Object.values(s.entries).some((e) => e.kind === "dir" || e.kind === "foreign");
    if (!s.canonicalHash && hasReal && !conflict) adopt.push(s.id);
    for (const [aid, e] of Object.entries(s.entries)) {
      if (e.kind === "broken") {
        const a = agentById(aid);
        if (a) prune.push(entryPath(a, s, e));
      }
    }
    if ((s.canonicalHash || (hasReal && !conflict)) && !conflict) {
      for (const a of active) if (!s.entries[a.id]) links.push([s.id, a.id]);
    }
  }
  return { links, adopt, prune, conflicts, register: [] };
}

function apply(o: SyncOptions): OpReport {
  const p = plan();
  const report: OpReport = { ok: [], skipped: [], errors: [] };
  const touched = new Set<string>();
  if (o.prune) {
    for (const s of [...skills.values()]) {
      for (const [aid, e] of Object.entries(s.entries)) {
        if (e.kind !== "broken") continue;
        if (s.canonicalHash) s.entries[aid] = linkEntry(aid, s.canonicalHash);
        else delete s.entries[aid];
        touched.add(s.id);
      }
      if (!s.canonicalHash && Object.keys(s.entries).length === 0) skills.delete(s.id);
    }
  }
  if (o.adopt) {
    for (const id of p.adopt) {
      try {
        adoptSkill(must(id));
        touched.add(id);
      } catch (e) {
        report.errors.push({ id, message: String(e) });
      }
    }
  }
  if (o.link) {
    for (const [id, aid] of p.links) {
      const s = skills.get(id);
      if (!s || !s.canonicalHash) {
        if (s && !o.adopt) report.skipped.push({ id, message: "Not adopted yet; enable “Adopt unmanaged skills”." });
        continue;
      }
      if (!s.entries[aid]) s.entries[aid] = linkEntry(aid, s.canonicalHash);
      touched.add(id);
    }
  }
  for (const id of p.conflicts) report.skipped.push({ id, message: "Conflicting copies need a manual decision." });
  report.ok = [...touched].sort();
  report.skipped = report.skipped.filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i);
  return report;
}

function resolve(input: string): ResolvedSource {
  const raw = input.trim();
  if (!raw) throw "Enter a GitHub repo, URL, or path.";
  let kind: ResolvedSource["kind"] = "github";
  let display = raw;
  let source = raw;
  let list: RepoSkill[] | undefined;
  let only: string | undefined;

  const local = LOCAL_SOURCES[raw] ?? LOCAL_SOURCES[tildify(raw)];
  if (local) {
    kind = local.kind;
    list = local.skills;
    display = tildify(raw);
    source = expand(raw);
  } else if (/^(\/|~|\.\/)/.test(raw)) {
    const isZip = raw.endsWith(".zip");
    const base = raw.replace(/\/$/, "").split("/").pop()!.replace(/\.zip$/, "");
    if (!base) throw `Can't read ${raw}.`;
    kind = isZip ? "zip" : "local";
    display = tildify(raw);
    source = expand(raw);
    list = [{ id: base.toLowerCase().replace(/[^a-z0-9-]+/g, "-"), path: "", description: "Skill from a local folder." }];
  } else {
    let m = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/[^/]+\/(.+?))?\/?$/);
    if (m) {
      source = `${m[1]}/${m[2]}`;
      only = m[3]?.replace(/\/SKILL\.md$/i, "").split("/").pop();
    } else if ((m = raw.match(/^(?:git@|https?:\/\/|ssh:\/\/)([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/))) {
      kind = "git";
      source = m[1] === "github.com" ? `${m[2]}/${m[3]}` : `${m[2]}/${m[3]}`;
      display = `${m[1]}/${m[2]}/${m[3]}`;
    } else if ((m = raw.match(/^([\w.-]+)\/([\w.-]+)(?:\/([\w.-]+))?$/))) {
      source = `${m[1]}/${m[2]}`;
      only = m[3];
    } else {
      throw `Couldn't understand “${raw}”. Try owner/repo, a GitHub URL, a git URL, or a local path.`;
    }
    if (kind === "github") display = only ? `${source}/${only}` : source;
    list = REPOS[source];
    if (!list) throw `No skills found in ${source}. The repository doesn't exist or has no SKILL.md files.`;
    if (only) {
      list = list.filter((s) => s.id === only);
      if (!list.length) throw `${source} has no skill named “${only}”.`;
    }
  }
  const token = `tok_${hex(12)}`;
  resolutions.set(token, { display, kind, source, skills: list });
  const candidates: Candidate[] = list.map((s) => ({
    id: s.id,
    name: s.id,
    description: s.description,
    path: s.path ?? (source === "anthropics/skills" ? `skills/${s.id}` : s.id),
    alreadyInstalled: skills.has(s.id),
    issues: s.invalid
      ? [{ kind: "missingDescription", severity: "error", message: "SKILL.md is missing the required description field." }]
      : [],
  }));
  return { token, kind, display, candidates };
}

function install(req: InstallRequest): OpReport {
  const r = resolutions.get(req.token);
  if (!r) throw "This source expired. Resolve it again.";
  const report: OpReport = { ok: [], skipped: [], errors: [] };
  const targets = req.agents.length
    ? req.agents
    : settings.defaultAgents.length
      ? settings.defaultAgents
      : activeAgents().map((a) => a.id);
  for (const path of req.paths) {
    const c = r.skills.find((s) => (s.path ?? (r.source === "anthropics/skills" ? `skills/${s.id}` : s.id)) === path);
    if (!c) {
      report.errors.push({ id: path, message: "Not part of this source." });
      continue;
    }
    if (c.invalid) {
      report.errors.push({ id: c.id, message: "SKILL.md is missing the required description field." });
      continue;
    }
    const existing = skills.get(c.id);
    if (existing && !req.overwrite) {
      report.skipped.push({ id: c.id, message: "Already installed. Turn on Overwrite to replace it." });
      continue;
    }
    if (existing?.plugin) {
      report.errors.push({ id: c.id, message: "A plugin provides a skill with this name." });
      continue;
    }
    const h = hex();
    const isRemote = r.kind === "github" || r.kind === "git";
    const m: MSkill = {
      id: c.id,
      name: c.id,
      description: c.description,
      version: null,
      license: null,
      allowedTools: null,
      files: existing?.files ?? [],
      canonicalHash: h,
      entries: {},
      source: isRemote
        ? {
            kind: r.kind === "git" ? "git" : "github",
            source: r.source,
            url: r.kind === "github" ? `https://github.com/${r.source}` : r.display,
            skillPath: `${path ? path + "/" : ""}SKILL.md`,
            gitRef: "main",
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : { kind: "local", source: r.source, url: null, skillPath: null, gitRef: null, installedAt: new Date().toISOString(), updatedAt: null },
      plugin: null,
      modifiedMs: Date.now(),
      upstream: isRemote ? { current: h, latest: h, modified: false } : null,
      extraIssues: [],
    };
    for (const aid of targets) {
      const a = agentById(aid);
      if (a && !a.readsCanonical) m.entries[aid] = linkEntry(aid, h);
    }
    skills.set(c.id, m);
    report.ok.push(c.id);
  }
  return report;
}

function updates(): UpdateInfo[] {
  lastUpdateCheck = Date.now();
  const out: UpdateInfo[] = [];
  for (const s of [...skills.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.plugin || !s.canonicalHash || s.mine) continue;
    const base = { id: s.id, source: s.source?.source ? tildify(s.source.source) : null, checkedAtMs: lastUpdateCheck };
    if (!s.upstream) {
      out.push({
        ...base,
        status: "untracked",
        current: null,
        latest: null,
        locallyModified: false,
        message: s.source?.kind === "local" ? "Installed from a local folder." : "No source recorded. Created by hand or copied in.",
      });
    } else if (s.upstream.error) {
      out.push({ ...base, status: "error", current: s.upstream.current, latest: null, locallyModified: false, message: s.upstream.error });
    } else {
      const avail = s.upstream.current !== s.upstream.latest;
      out.push({
        ...base,
        status: avail ? "available" : "upToDate",
        current: s.upstream.current,
        latest: s.upstream.latest,
        locallyModified: s.upstream.modified,
        message: avail ? (s.upstream.modified ? "You edited this skill since installing it." : null) : null,
      });
    }
  }
  return out;
}

function updateSkills(ids: string[], force: boolean): OpReport {
  const report: OpReport = { ok: [], skipped: [], errors: [] };
  for (const id of ids) {
    const s = skills.get(id);
    if (!s || !s.upstream) {
      report.errors.push({ id, message: "No upstream source to update from." });
      continue;
    }
    if (s.upstream.error) {
      report.errors.push({ id, message: s.upstream.error });
      continue;
    }
    if (s.upstream.current === s.upstream.latest) {
      report.skipped.push({ id, message: "Already up to date." });
      continue;
    }
    if (s.upstream.modified && !force) {
      report.skipped.push({ id, message: "Has local modifications. Update with force to overwrite them." });
      continue;
    }
    s.upstream.current = s.upstream.latest;
    s.upstream.modified = false;
    s.canonicalHash = hex();
    for (const [aid, e] of Object.entries(s.entries)) if (e.kind === "dir" && linkMode(aid) === "copy") e.hash = s.canonicalHash;
    s.modifiedMs = Date.now();
    if (s.source) s.source.updatedAt = new Date().toISOString();
    report.ok.push(id);
  }
  return report;
}

function detail(id: string): SkillDetail {
  const s = must(id);
  const sk = toSkill(s, agents());
  if (!sk.primaryPath) throw `“${id}” has no readable copy. Every location is a broken link.`;
  const fm: Record<string, unknown> = { name: s.name };
  if (s.description) fm.description = s.description;
  if (s.license) fm.license = s.license;
  if (s.version) fm.metadata = { version: s.version };
  if (s.allowedTools) fm["allowed-tools"] = s.allowedTools;
  const yaml = Object.entries(fm)
    .map(([k, v]) =>
      typeof v === "object" ? `${k}:\n${Object.entries(v as object).map(([a, b]) => `  ${a}: "${b}"`).join("\n")}` : `${k}: ${v}`,
    )
    .join("\n");
  const body = s.body ?? bodyFor(s.id, s.description, s.files);
  const files: FileEntry[] = ["SKILL.md", ...s.files]
    .map((f) => ({
      path: f.replace(/\/$/, ""),
      isDir: f.endsWith("/"),
      size: f.endsWith("/") ? 0 : f === "SKILL.md" ? body.length + yaml.length + 8 : 900 + ((f.length * 337) % 9000),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { skill: sk, skillMd: `---\n${yaml}\n---\n\n${body}`, body, frontmatter: fm, files };
}

// ── dispatcher ───────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
export function onMockChanged(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

type A = Record<string, unknown>;
const str = (a: A, k: string) => a[k] as string;

export async function handle(cmd: string, a: A): Promise<unknown> {
  switch (cmd) {
    case "scan":
      await latency(120, 260);
      return inventory();
    case "skill_detail":
      await latency(90, 180);
      return detail(str(a, "id"));
    case "read_skill_file": {
      await latency(60, 140);
      const s = must(str(a, "id"));
      const path = str(a, "path");
      if (path === "SKILL.md") return detail(s.id).skillMd;
      if (!s.files.includes(path)) throw `File not found: ${path}`;
      return fileText(s.id, path, s.description);
    }
    case "set_link":
      await latency();
      link(must(str(a, "id")), str(a, "agentId"), a.enabled as boolean);
      return inventory();
    case "set_link_agent": {
      await latency(200, 400);
      const report: OpReport = { ok: [], skipped: [], errors: [] };
      for (const id of (a.ids as string[]) ?? []) {
        try {
          link(must(id), str(a, "agentId"), a.enabled as boolean);
          report.ok.push(id);
        } catch (e) {
          report.errors.push({ id, message: typeof e === "string" ? e : String(e) });
        }
      }
      return report;
    }
    case "set_link_all": {
      await latency();
      const s = must(str(a, "id"));
      if (s.plugin) throw `"${s.id}" comes from a plugin and can't be linked to other agents.`;
      if (!s.canonicalHash) adoptSkill(s);
      for (const ag of activeAgents()) if (!ag.readsCanonical) link(s, ag.id, a.enabled as boolean);
      return inventory();
    }
    case "adopt":
      await latency(250, 450);
      adoptSkill(must(str(a, "id")), a.fromPath as string | undefined);
      return inventory();
    case "remove_skill":
      await latency();
      removeSkill(str(a, "id"));
      return inventory();
    case "create_skill": {
      await latency();
      const id = str(a, "id");
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw "Names must be lowercase letters, numbers and single hyphens.";
      if (skills.has(id)) throw `A skill named “${id}” already exists.`;
      if (id.length > 64) throw "Names can be at most 64 characters.";
      const description = str(a, "description") ?? "";
      if (description.length > 1024) throw "Descriptions can be at most 1024 characters.";
      initMine();
      const h = hex();
      const m: MSkill = {
        id, name: id, description, version: null, license: null, allowedTools: null, files: [],
        canonicalHash: h, entries: {}, source: null, plugin: null, modifiedMs: Date.now(), upstream: null, extraIssues: [],
        mine: true, forkedFrom: null,
        body: `# ${id}\n\n${description || "Describe what this skill does."}\n\n## Steps\n\n1. …\n`,
      };
      const targets = settings.universal || !settings.defaultAgents.length ? activeAgents().map((x) => x.id) : settings.defaultAgents;
      for (const aid of targets) if (!agentById(aid)?.readsCanonical) m.entries[aid] = linkEntry(aid, h);
      skills.set(id, m);
      if (repo.isRepo) repo.changes.push({ path: `${id}/SKILL.md`, status: "??", skillId: id });
      return null;
    }
    case "my_skills_status":
      await latency(60, 140);
      return myStatus();
    case "my_skills_init":
      await latency(250, 450);
      initMine();
      return myStatus();
    case "make_mine":
      await latency(300, 500);
      makeMine(str(a, "id"));
      return null;
    case "my_skills_commit": {
      await latency(250, 450);
      if (!repo.isRepo) throw `${tildify(mineDir())} isn't a git repository.`;
      const message = (str(a, "message") ?? "").trim();
      if (!message) throw "Write a commit message first.";
      const ids = (a.ids as string[]) ?? [];
      const picked = repo.changes.filter((c) => !ids.length || (c.skillId && ids.includes(c.skillId)));
      if (!picked.length) throw "Nothing to commit.";
      repo.changes = repo.changes.filter((c) => !picked.includes(c));
      const hash = hex(7);
      repo.lastCommit = { hash, subject: message.split("\n")[0], whenMs: Date.now() };
      repo.ahead++;
      return hash;
    }
    case "my_skills_pull": {
      await latency(500, 900);
      if (!repo.isRepo) throw `${tildify(mineDir())} isn't a git repository.`;
      if (!repo.remote) throw "No remote named “origin”. Add one with: git remote add origin <url>";
      const n = repo.behind;
      repo.behind = 0;
      return n ? `Pulled ${n} commit${n === 1 ? "" : "s"} from origin/${repo.branch}.` : "Already up to date.";
    }
    case "my_skills_push": {
      await latency(500, 900);
      if (!repo.isRepo) throw `${tildify(mineDir())} isn't a git repository.`;
      if (!repo.remote) throw "No remote named “origin”. Add one with: git remote add origin <url>";
      if (repo.behind) throw `origin/${repo.branch} has ${repo.behind} commit${repo.behind === 1 ? "" : "s"} you don't have. Pull first.`;
      const n = repo.ahead;
      repo.ahead = 0;
      return n ? `Pushed ${n} commit${n === 1 ? "" : "s"} to origin/${repo.branch}.` : "Everything is already pushed.";
    }
    case "open_in_editor": {
      await latency(40, 90);
      const s = must(str(a, "id"));
      const ed = settings.editor ?? EDITORS[0].name;
      toast(`Opened in ${ed}`, { description: tildify(toSkill(s, agents()).primaryPath ?? s.id) });
      return null;
    }
    case "list_editors":
      await latency(40, 90);
      return EDITORS;
    case "find_sources": {
      // The real lookup hits skills.sh and GitHub and takes 10–30 s; keep the demo snappy but visibly slow.
      await latency(2600, 3400);
      const ids = (a.ids as string[])?.length
        ? (a.ids as string[])
        : [...skills.values()].filter((s) => originOf(s) === "local").map((s) => s.id);
      if (params.get("sources") === "ratelimited") {
        const half = Math.ceil(ids.length / 2);
        return {
          checked: half,
          matches: ids.slice(0, half).flatMap((id) => (SOURCE_MATCHES[id] ? [SOURCE_MATCHES[id]] : [])),
          rateLimited: true,
          unchecked: ids.slice(half),
        };
      }
      return { checked: ids.length, matches: ids.flatMap((id) => (SOURCE_MATCHES[id] ? [SOURCE_MATCHES[id]] : [])), rateLimited: false, unchecked: [] };
    }
    case "track_source": {
      await latency(200, 400);
      const s = must(str(a, "id"));
      const src = str(a, "source");
      s.source = { kind: "github", source: src, url: `https://github.com/${src}`, skillPath: str(a, "skillPath"), gitRef: "main", installedAt: s.source?.installedAt ?? null, updatedAt: null };
      const cur = hex();
      // Identical folders are up to date; anything else differs from upstream, so an update is offered.
      s.upstream = { current: cur, latest: SOURCE_MATCHES[s.id]?.confidence === "exact" ? cur : hex(), modified: false };
      return null;
    }
    case "agent_icon":
      await latency(10, 40);
      return placeholderIcon(str(a, "agentId"));
    case "sync_plan":
      await latency(150, 300);
      return plan();
    case "sync_apply":
      await latency(500, 900);
      return apply(a.options as SyncOptions);
    case "resolve_source":
      await latency(450, 900);
      return resolve(str(a, "input"));
    case "install":
      await latency(600, 1100);
      return install(a.request as InstallRequest);
    case "check_updates":
      if (a.force || Date.now() - lastUpdateCheck > settings.checkIntervalHours * 3600_000) await latency(700, 1200);
      else await latency(60, 120);
      return updates();
    case "update_skills":
      await latency(600, 1000);
      return updateSkills(a.ids as string[], a.force as boolean);
    case "search": {
      await latency(250, 400);
      const q = str(a, "query").trim().toLowerCase();
      if (!q) return [];
      const words = q.split(/\s+/);
      return DIRECTORY.filter((d) => words.every((w) => `${d.id} ${d.description}`.toLowerCase().includes(w)))
        .sort((x, y) => y.installs - x.installs)
        .slice(0, 40)
        .map<SearchResult>((d) => ({ id: d.id, name: d.name, source: d.source, installs: d.installs, installed: skills.has(d.name) }));
    }
    case "get_settings":
      await latency(40, 90);
      return structuredClone(settings);
    case "save_settings": {
      await latency(120, 220);
      const next = structuredClone(a.settings as Settings);
      next.githubTokenSource = settings.githubTokenSource;
      if (!next.mySkillsDir?.trim()) next.mySkillsDir = "~/Skills";
      const turnedOn = next.universal && !settings.universal;
      settings = next;
      // Universal mode keeps everything everywhere, like the real backend.
      if (turnedOn) apply({ adopt: true, link: true, prune: true });
      return structuredClone(settings);
    }
    case "set_github_token": {
      await latency(150, 300);
      const t = a.token as string | null;
      settings.githubTokenSource = t ? "keychain" : null;
      if (t) {
        const ir = skills.get("incident-runbook");
        if (ir?.upstream) ir.upstream.error = undefined;
      }
      return structuredClone(settings);
    }
    case "reveal":
      await latency(30, 60);
      toast(`Reveal in ${fileManager}`, { description: tildify(str(a, "path")) });
      return null;
    case "open_path":
      await latency(30, 60);
      toast(`Open`, { description: tildify(str(a, "path")) });
      return null;
    default:
      throw `Unknown command: ${cmd}`;
  }
}

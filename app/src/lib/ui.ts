// Small UI-only helpers and types (not part of the IPC contract).

import type { AgentInfo, Issue, IssueKind, Pin, PinState, Presence, Skill } from "./types";

export type View = "library" | "mine" | "matrix" | "agents" | "updates" | "discover" | "health" | "projects" | "settings";

/** The Library's attention toggles: everything, only skills with problems, or only skills with updates. */
export type LibraryFilter = "all" | "issues" | "updates";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export const PRESENCE: Record<Presence, { label: string; help: string; on: boolean; toggleable: boolean }> = {
  native: {
    label: "Native",
    help: "This agent reads ~/.agents/skills directly, so the skill is visible without a link.",
    on: true,
    toggleable: false,
  },
  linked: { label: "Linked", help: "Symlinked to the canonical copy in ~/.agents/skills.", on: true, toggleable: true },
  copied: {
    label: "Copied",
    help: "A full copy that matches the canonical store (copy link mode). Refreshed on every update.",
    on: true,
    toggleable: true,
  },
  local: {
    label: "Local copy",
    help: "A real folder in this agent's skills directory that Quiver doesn't manage, or a copy that differs from the canonical store.",
    on: true,
    toggleable: true,
  },
  foreign: {
    label: "External link",
    help: "A symlink that points somewhere other than ~/.agents/skills.",
    on: true,
    toggleable: true,
  },
  broken: { label: "Broken link", help: "A symlink whose target no longer exists. Turn it on to repair it.", on: false, toggleable: true },
  plugin: { label: "Plugin", help: "Provided by one of this agent's plugins. Read-only.", on: true, toggleable: false },
  absent: { label: "Off", help: "This agent can't see the skill. Turn it on to link it.", on: false, toggleable: true },
};

export const isVisible = (p: Presence) => PRESENCE[p].on;

export function presenceFor(skill: Skill, agentId: string): Presence {
  return skill.presence.find((p) => p.agentId === agentId)?.presence ?? "absent";
}

/** Visible agents = detected and not hidden. */
export function visibleAgents(agents: AgentInfo[]) {
  return agents.filter((a) => a.detected && a.enabled);
}

/** Which agents see a skill, phrased for a card ("Not in Cursor", "Only in Claude Code"). Null when every active agent does. */
export interface CoverageNote {
  label: string;
  /** Full sentence for a tooltip. */
  detail: string;
  /** The one agent the label names, if it names one. */
  agent: AgentInfo | null;
}

/** `agents` should be the active ones (detected and enabled). Plugin skills are left out: they live inside one agent by design. */
export function coverageNote(skill: Skill, agents: AgentInfo[], presence: (agentId: string) => Presence): CoverageNote | null {
  if (skill.plugin || !agents.length) return null;
  const on: AgentInfo[] = [];
  const off: AgentInfo[] = [];
  for (const a of agents) (isVisible(presence(a.id)) ? on : off).push(a);
  if (!off.length) return null;
  if (!on.length) return { label: "Not in any agent", detail: "No agent can see this skill.", agent: null };
  if (on.length === 1) return { label: `Only in ${on[0].name}`, detail: `Only ${on[0].name} can see this skill.`, agent: on[0] };
  if (off.length === 1) return { label: `Not in ${off[0].name}`, detail: `Every agent except ${off[0].name} sees this skill.`, agent: off[0] };
  return { label: `Not in ${off.length} agents`, detail: `Not in ${listNames(off.map((a) => a.name))}.`, agent: null };
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Problems worth flagging: errors first, then warnings. Info notes (e.g. "only in one agent") have their own section. */
export function problemsOf(skill: Skill): Issue[] {
  return [...skill.issues.filter((i) => i.severity === "error"), ...skill.issues.filter((i) => i.severity === "warning")];
}

/** Short, plain labels for a card badge. */
export const PROBLEM_LABEL: Record<IssueKind, string> = {
  brokenLink: "Broken link",
  conflict: "Conflicting copies",
  unmanaged: "Not shared",
  missingSkillMd: "Missing SKILL.md",
  invalidFrontmatter: "Invalid SKILL.md",
  invalidName: "Invalid name",
  nameMismatch: "Name mismatch",
  missingDescription: "Needs a description",
  descriptionTooLong: "Description too long",
};

/** The Library section a skill belongs to: where it came from. */
export type SourceGroup =
  | { kind: "mine" }
  | { kind: "remote"; source: string; url: string | null; owner: string | null }
  | { kind: "local" }
  | { kind: "unmanaged" }
  | { kind: "plugin" };

export function sourceGroup(skill: Skill): SourceGroup {
  const s = skill.source;
  if (skill.origin !== "installed" || !s) return { kind: skill.origin === "installed" ? "local" : skill.origin };
  if (s.kind === "github") {
    const repo = s.source.split("/").slice(0, 2).join("/");
    return { kind: "remote", source: s.source, url: `https://github.com/${repo}`, owner: repo.split("/")[0] };
  }
  return { kind: "remote", source: s.source.replace(/^https?:\/\//, "").replace(/\.git$/, ""), url: s.url, owner: null };
}

export const groupKey = (g: SourceGroup) => (g.kind === "remote" ? `src:${g.source}` : g.kind);

/** Plugin name without the marketplace suffix: "figma@claude-plugins-official" → "figma". */
export const pluginName = (skill: Skill) => skill.plugin?.split("@")[0] ?? "";

export function matchesFilter(skill: Skill, f: LibraryFilter, updatable: Set<string>) {
  if (f === "issues") return problemsOf(skill).length > 0;
  if (f === "updates") return updatable.has(skill.id);
  return true;
}

/** Valid skill folder name: 1–64 chars, lowercase a–z0–9 and single hyphens, no leading/trailing hyphen. */
export function validateSkillName(id: string): string | null {
  if (!id) return null;
  if (id.length > 64) return "At most 64 characters.";
  if (/[A-Z]/.test(id)) return "Use lowercase letters only.";
  if (/[^a-z0-9-]/.test(id)) return "Only letters a–z, digits and hyphens.";
  if (id.startsWith("-") || id.endsWith("-")) return "Can't start or end with a hyphen.";
  if (id.includes("--")) return "Use single hyphens only.";
  return null;
}

// ── pinned skills ────────────────────────────────────────────────────────────

/** A skill can be pinned when it has a shared copy to take the files from. */
export const canPin = (skill: Skill) => skill.managed && !skill.plugin && !skill.readOnly;

/** The one-line, plain status shown on a pin card; null when the pin is fine. */
export interface PinStatus {
  label: string;
  /** The full story for a tooltip. */
  detail: string;
  tone: "amber" | "red";
}

function linkProblemLabel(problem: string | null, noun: "Link" | "Copy", where: string) {
  const t = (problem ?? "").toLowerCase();
  if (/text file|symlinks|checked out/.test(t)) return `Needs copies in ${where}`;
  if (/missing|gone|isn't there|not there/.test(t)) return `${noun} missing in ${where}`;
  if (/elsewhere|points/.test(t)) return `${noun} points elsewhere in ${where}`;
  if (/differ/.test(t)) return `Copy differs in ${where}`;
  return `${noun} problem in ${where}`;
}

export function pinStatus(pin: Pin, agents: AgentInfo[]): PinStatus | null {
  const detail = pin.problems.join("\n");
  switch (pin.state) {
    case "ok":
      return null;
    case "missing":
      return { label: "Folder missing", detail: detail || "The pinned folder isn't in the project any more.", tone: "red" };
    case "modified": {
      const files = pin.changedFiles;
      const shown = files.slice(0, 2).join(", ");
      return {
        label: `Files changed${shown ? `: ${shown}${files.length > 2 ? ` +${files.length - 2}` : ""}` : ""}`,
        detail: detail || "The pinned files were edited after pinning.",
        tone: "amber",
      };
    }
    case "links": {
      const bad = pin.agents.filter((a) => !a.ok);
      const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
      const noun = pin.mode === "copy" ? "Copy" : "Link";
      return {
        label: bad.length === 1 ? linkProblemLabel(bad[0].problem, noun, name(bad[0].agentId)) : `${noun}s need repair in ${bad.length || "some"} agents`,
        detail: detail || bad.map((a) => `${name(a.agentId)}: ${a.problem ?? "needs repair"}`).join("\n"),
        tone: "amber",
      };
    }
  }
}

/** "Claude Code, Cursor and 3 more": the familiar names first. */
export function summarizeAgents(list: { id: string; name: string }[]) {
  if (!list.length) return "No agents";
  const familiar = ["claude-code", "cursor"];
  const rank = (id: string) => (familiar.includes(id) ? familiar.indexOf(id) : 99);
  const sorted = [...list].sort((a, b) => rank(a.id) - rank(b.id));
  if (sorted.length <= 3) return listNames(sorted.map((a) => a.name));
  return `${sorted[0].name}, ${sorted[1].name} and ${sorted.length - 2} more`;
}

/** Worst state first, for sorting and badges. */
export const PIN_STATE_RANK: Record<PinState, number> = { missing: 0, modified: 1, links: 2, ok: 3 };

/** "Nov 23", with the year when it isn't this year. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** The first seven characters of a commit. */
export const shortRef = (ref: string | null | undefined) => (ref ? ref.slice(0, 7) : "");

// ── formatting ───────────────────────────────────────────────────────────────

export function tildify(p: string | null | undefined): string {
  if (!p) return "";
  // Windows: C:\Users\me\.claude\skills → ~/.claude/skills (agents document paths with `/` everywhere).
  const win = /^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/.exec(p);
  if (win) return "~" + p.slice(win[0].length).replace(/\\/g, "/");
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function timeAgo(ms: number | null | undefined) {
  if (!ms) return "never";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ── platform ─────────────────────────────────────────────────────────────────
// The look is native macOS; on Windows the window keeps its normal frame and the
// words and shortcuts follow Windows conventions.

const platformString = typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "";
export const isMac = /Mac|iPhone|iPad/.test(platformString);
export const isWindows = /Win/.test(platformString);
export const mod = isMac ? "⌘" : "Ctrl+";

/** "⇧⌘N" on a Mac, "Ctrl+Shift+N" elsewhere. */
export function shortcut(key: string, opts: { shift?: boolean } = {}) {
  return isMac ? `${opts.shift ? "⇧" : ""}⌘${key}` : `Ctrl+${opts.shift ? "Shift+" : ""}${key}`;
}

/** The command modifier is held: ⌘ on a Mac, Ctrl elsewhere (the Windows key is not a modifier here). */
export const hasMod = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey || e.ctrlKey : e.ctrlKey);

/** "Remove the focused skill": ⌘⌫ on a Mac; Delete (or Ctrl+Backspace) on Windows. */
export const isRemoveKey = (e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }) =>
  isMac
    ? hasMod(e) && e.key === "Backspace"
    : (e.key === "Delete" && !e.ctrlKey && !e.altKey && !e.shiftKey) || (e.ctrlKey && e.key === "Backspace");
export const removeHint = isMac ? "⌘⌫" : "Del";
/** The return key as shown next to a modifier: "⌘↩" / "Ctrl+Enter". */
export const enterKey = isMac ? "↩" : "Enter";

/** What the OS calls its file manager, trash and secret store. */
export const fileManager = isWindows ? "File Explorer" : "Finder";
export const trashName = isWindows ? "Recycle Bin" : "Trash";
export const secretStore = isWindows ? "Credential Manager" : "Keychain";

/** `dir` + `name` using the separator `dir` already uses (Windows paths come back with `\`). */
export function joinPath(dirOrNull: string | null | undefined, name: string) {
  const dir = dirOrNull ?? "";
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

/** Keep both ends of long identifiers visible: "react-kubernetes-…-kubernetes-144". */
export function middleTruncate(s: string, max = 40) {
  if (s.length <= max) return s;
  const tail = Math.floor((max - 1) * 0.4);
  return `${s.slice(0, max - 1 - tail)}…${s.slice(s.length - tail)}`;
}

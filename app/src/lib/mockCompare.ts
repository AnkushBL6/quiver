// Browser mock of the compare commands (compare_copies, compare_upstream,
// compare_file). Fixture file contents for the two demo conflicts live here, and
// the line diff is a small TypeScript port of crates/quiver-core/src/compare.rs
// so the demo shows what the real app shows: paired lines, intra-line marks,
// collapsed unchanged runs.

import type {
  CopyComparison,
  DiffBlock,
  DiffRow,
  FileCompare,
  FileContent,
  FileDiff,
  SkillVersion,
  VersionLocation,
} from "./types";

const DAY = 86_400_000;
const CONTEXT = 3;
const MIN_HIDDEN = 3;
const PAIR_MIN_SIMILARITY = 0.45;
const MAX_CELLS = 2_000_000;

// ── fixtures ─────────────────────────────────────────────────────────────────

const md = (...lines: string[]) => lines.join("\n") + "\n";

export interface FixtureVersion {
  files: Record<string, string>;
  modifiedDaysAgo: number;
  /** Differs from what was installed (null: no install record). */
  edited: boolean | null;
  /** Identical to the latest folder on GitHub. */
  matchesGithub?: boolean;
}

/** Per skill id, per role: "shared" for the shared store, else the agent id holding that copy. */
export const COMPARE_FIXTURES: Record<string, Record<string, FixtureVersion>> = {};

// ── writing-skills: three versions, a real bug fix in one of them ────────────

const WS_FRONT = [
  "---",
  "name: writing-skills",
  "description: Use when creating new skills, editing existing skills, or verifying skills work before deployment",
  "---",
  "",
];
const WS_HEAD = [
  "# Writing Skills",
  "",
  "## Overview",
  "",
  "**Writing skills is Test-Driven Development applied to process documentation.**",
  "",
  "Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.agents/skills` for Codex). You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).",
  "",
  "**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.",
  "",
  "## What is a skill?",
  "",
  "A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help future agent instances find and apply effective approaches.",
  "",
  "**Skills are:** reusable techniques, patterns, tools, reference guides.",
  "",
  "**Skills are NOT:** narratives about how you solved a problem once.",
  "",
  "## When to create a skill",
  "",
  "**Create when:**",
  "- The technique wasn't intuitively obvious to you",
  "- You would reference it again across projects",
  "- The pattern applies broadly (not project-specific)",
  "- Others would benefit",
  "",
  "**Don't create for:**",
  "- One-off solutions",
  "- Standard practices documented elsewhere",
  "- Project-specific conventions (put those in CLAUDE.md)",
  "",
  "## SKILL.md structure",
  "",
  "**Frontmatter (YAML):**",
  "- Only two fields are supported: `name` and `description`",
];
const WS_LIMITS_OLD = ["- Max 1024 characters total", "- `name`: letters, numbers, and hyphens only"];
const WS_LIMITS_FIXED = [
  "- `name`: max 64 characters; letters, numbers, and hyphens only",
  "- `description`: max 1024 characters",
];
const WS_DESC_OLD = [
  "- `description`: third person, describes ONLY when to use it, never what it does",
  '  - Start with "Use when..." to focus on triggering conditions',
  "  - Keep it under 500 characters if possible",
];
const WS_DESC_UPSTREAM = [
  "- `description`: third person, describes ONLY when to use it, never what it does",
  '  - Start with "Use when..." to focus on triggering conditions',
  "  - Keep it under 500 characters: it is loaded on every task, so every word costs context",
];
const WS_BODY = [
  "",
  "**Body:**",
  "- Overview: the core principle in one or two sentences",
  "- When to use: symptoms and situations, plus when NOT to use",
  "- Quick reference: a table or bullets for scanning",
  "- Common mistakes: what goes wrong, and the fix",
  "",
  "## Checklist",
  "",
  "1. Run a baseline: give a subagent the pressure scenario without the skill and record what it does",
  "2. Write the minimal skill that addresses those specific failures",
  "3. Run the same scenario with the skill and confirm the agent complies",
  "4. Close any loopholes the agent found, then re-test",
];
const WS_CHECK_FIXED = ["5. Check that `name` matches the folder name, or the skill won't load"];
const WS_TESTING_UPSTREAM = [
  "",
  "## Testing skills with subagents",
  "",
  "Pressure scenarios combine three or more pressures (time, sunk cost, authority) so the agent has a real reason to skip the rule. See `testing-skills-with-subagents.md` for templates.",
];
const WS_RENDER_OLD = [
  "",
  "## Rendering flowcharts",
  "",
  "Skills may include `dot` blocks for decision flows. Render them with:",
  "",
  "```bash",
  "./render-graphs.js ../some-skill",
  "```",
  "",
  "Each block is written next to the skill as `diagram-N.svg`.",
];
const WS_RENDER_FIXED = [
  "",
  "## Rendering flowcharts",
  "",
  "Skills may include `dot` blocks for decision flows. Render them with (needs Graphviz: `brew install graphviz`):",
  "",
  "```bash",
  "node render-graphs.js ../some-skill",
  "```",
  "",
  "Each block is written next to the skill as `diagram-N.svg`. Paths with spaces work.",
];

const SKILL_MD_ORIGINAL = md(...WS_FRONT, ...WS_HEAD, ...WS_LIMITS_OLD, ...WS_DESC_OLD, ...WS_BODY, ...WS_RENDER_OLD);
const SKILL_MD_UPSTREAM = md(...WS_FRONT, ...WS_HEAD, ...WS_LIMITS_OLD, ...WS_DESC_UPSTREAM, ...WS_BODY, ...WS_TESTING_UPSTREAM, ...WS_RENDER_OLD);
const SKILL_MD_FIXED = md(...WS_FRONT, ...WS_HEAD, ...WS_LIMITS_FIXED, ...WS_DESC_OLD, ...WS_BODY, ...WS_CHECK_FIXED, ...WS_RENDER_FIXED);

const RENDER_OLD = md(
  "#!/usr/bin/env node",
  "// Render the ```dot blocks of a skill's SKILL.md to SVG files next to it.",
  "const fs = require('fs');",
  "const path = require('path');",
  "const { execSync } = require('child_process');",
  "",
  "const skillDir = path.resolve(process.argv[2] || '.');",
  "const source = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');",
  "",
  "const blocks = [...source.matchAll(/```dot\\n([\\s\\S]*?)```/g)].map((m) => m[1]);",
  "",
  "blocks.forEach((dot, i) => {",
  "  const input = path.join(skillDir, `diagram-${i + 1}.dot`);",
  "  const output = path.join(skillDir, `diagram-${i + 1}.svg`);",
  "  fs.writeFileSync(input, dot);",
  "  execSync(`dot -Tsvg ${input} -o ${output}`);",
  "  console.log(`Wrote ${output}`);",
  "});",
);
const RENDER_FIXED = md(
  "#!/usr/bin/env node",
  "// Render the ```dot blocks of a skill's SKILL.md to SVG files next to it.",
  "const fs = require('fs');",
  "const path = require('path');",
  "const { execFileSync } = require('child_process');",
  "",
  "const skillDir = path.resolve(process.argv[2] || '.');",
  "const skillFile = path.join(skillDir, 'SKILL.md');",
  "if (!fs.existsSync(skillFile)) {",
  "  console.error(`No SKILL.md in ${skillDir}`);",
  "  process.exit(1);",
  "}",
  "const source = fs.readFileSync(skillFile, 'utf8');",
  "",
  "const blocks = [...source.matchAll(/```dot\\n([\\s\\S]*?)```/g)].map((m) => m[1]);",
  "if (blocks.length === 0) {",
  "  console.log('No dot blocks found, nothing to render.');",
  "  process.exit(0);",
  "}",
  "",
  "blocks.forEach((dot, i) => {",
  "  const input = path.join(skillDir, `diagram-${i + 1}.dot`);",
  "  const output = path.join(skillDir, `diagram-${i + 1}.svg`);",
  "  fs.writeFileSync(input, dot);",
  "  // Arguments, not a shell string: paths with spaces or quotes are safe.",
  "  execFileSync('dot', ['-Tsvg', input, '-o', output]);",
  "  console.log(`Wrote ${output}`);",
  "});",
);

const DOT_CONVENTIONS = md(
  "digraph conventions {",
  "  rankdir=TB;",
  '  node [shape=box, style="rounded,filled", fillcolor="#f4f4f6", fontname="Helvetica"];',
  '  decision [shape=diamond, fillcolor="#fff4d6"];',
  '  action [fillcolor="#e3f1ff"];',
  '  stop [shape=octagon, fillcolor="#ffe0dd"];',
  "}",
);
const PERSUASION = md(
  "# Persuasion principles for skill design",
  "",
  "Agents respond to the same levers people do. Use them on purpose.",
  "",
  "- **Authority:** imperative language (\"YOU MUST\") for rules that cannot bend",
  "- **Commitment:** make the agent announce which skill it is using",
  "- **Scarcity:** \"before proceeding\" ties a rule to a moment",
  "- **Social proof:** \"every time\" sets the norm",
);
const TESTING_MD = md(
  "# Testing skills with subagents",
  "",
  "A skill is only done when an agent that did not write it follows it under pressure.",
  "",
  "## Pressure scenario template",
  "",
  "1. Name the rule you want followed",
  "2. Add three pressures: a deadline, sunk cost, and an authority who says to skip it",
  "3. Offer a choice (A, B, C) so the agent must act, not discuss",
  "4. Record the exact rationalization it uses when it fails",
);

const WRITING_SKILLS: Record<string, FixtureVersion> = {
  // As installed from the repo, 41 days ago; upstream has moved on since.
  shared: {
    modifiedDaysAgo: 38,
    edited: false,
    files: {
      "SKILL.md": SKILL_MD_ORIGINAL,
      "render-graphs.js": RENDER_OLD,
      "graphviz-conventions.dot": DOT_CONVENTIONS,
      "persuasion-principles.md": PERSUASION,
      "assets/loop.png": "\u0000PNG loop v1",
    },
  },
  // Re-installed from GitHub more recently: byte for byte the latest upstream folder.
  cursor: {
    modifiedDaysAgo: 11,
    edited: true,
    matchesGithub: true,
    files: {
      "SKILL.md": SKILL_MD_UPSTREAM,
      "render-graphs.js": RENDER_OLD,
      "graphviz-conventions.dot": DOT_CONVENTIONS,
      "persuasion-principles.md": PERSUASION,
      "testing-skills-with-subagents.md": TESTING_MD,
      "assets/loop.png": "\u0000PNG loop v1",
    },
  },
  // The user's own fix: wrong frontmatter limits, a command that doesn't run, a script that breaks on paths with spaces.
  "claude-code": {
    modifiedDaysAgo: 2,
    edited: true,
    files: {
      "SKILL.md": SKILL_MD_FIXED,
      "render-graphs.js": RENDER_FIXED,
      "graphviz-conventions.dot": DOT_CONVENTIONS,
      "persuasion-principles.md": PERSUASION,
      "assets/loop.png": "\u0000PNG loop v2 redrawn",
    },
  },
};
COMPARE_FIXTURES["writing-skills"] = WRITING_SKILLS;

// ── code-review: two versions, no GitHub source ──────────────────────────────

const CR_FRONT = [
  "---",
  "name: code-review",
  "description: Review the current diff for correctness bugs, risky patterns, and missing tests. Reports findings ranked by severity with suggested fixes.",
  "---",
  "",
  "# Code Review",
  "",
  "## Steps",
  "",
];
const CODE_REVIEW_SHARED = md(
  ...CR_FRONT,
  "1. Run `git diff` against the merge base and read the whole change before commenting.",
  "2. For each file, look for: logic errors, unhandled errors, race conditions, and security issues.",
  "3. Check that new behavior has tests and that existing tests still describe the code.",
  "4. Report findings ranked by severity: bugs first, then risks, then nits.",
  "",
  "## Output",
  "",
  "- One finding per bullet: `file:line`, the problem, the fix.",
  "- End with a one-line verdict: ship it, ship after fixes, or needs rework.",
);
const CODE_REVIEW_EDITED = md(
  ...CR_FRONT,
  "1. Run `git diff $(git merge-base HEAD origin/main)...HEAD` and read the whole change before commenting.",
  "2. Skip generated files and lockfiles (`*.lock`, `dist/`, `*.snap`).",
  "3. For each file, look for: logic errors, unhandled errors, race conditions, and security issues.",
  "4. Check that new behavior has tests and that existing tests still describe the code.",
  "5. Report findings ranked by severity: bugs first, then risks, then nits.",
  "",
  "## Output",
  "",
  "- One finding per bullet: `file:line`, the problem, the fix.",
  "- Don't report style nits a formatter would fix.",
  "- End with a one-line verdict: ship it, ship after fixes, or needs rework.",
);
COMPARE_FIXTURES["code-review"] = {
  shared: { modifiedDaysAgo: 9, edited: null, files: { "SKILL.md": CODE_REVIEW_SHARED } },
  "claude-code": { modifiedDaysAgo: 4, edited: null, files: { "SKILL.md": CODE_REVIEW_EDITED } },
};

// ── comparison ───────────────────────────────────────────────────────────────

export interface MockGroup {
  hash: string;
  shared: boolean;
  /** Fixture key: "shared", or the agent id that holds this copy. */
  role: string;
  locations: VersionLocation[];
  agentIds: string[];
}

function fixtureFor(skillId: string, role: string): FixtureVersion {
  const f = COMPARE_FIXTURES[skillId]?.[role];
  if (!f) throw `“${skillId}” has copies that can't be compared here.`;
  return f;
}

/** Small stable digest: equal strings give equal digests. */
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + s.length.toString(16);
}

const isBinary = (text: string) => text.includes("\u0000");
const contentOf = (text: string): FileContent => (isBinary(text) ? "binary" : "text");

export function buildComparison(skillId: string, name: string, groups: MockGroup[], upstreamSource: string | null): CopyComparison {
  const now = Date.now();
  const fixtures = groups.map((g) => fixtureFor(skillId, g.role));
  const modified = fixtures.map((f) => now - f.modifiedDaysAgo * DAY);
  const top = Math.max(...modified);
  const newestIdx = groups.length > 1 && modified.filter((m) => m === top).length === 1 ? modified.indexOf(top) : -1;

  const versions: SkillVersion[] = groups.map((g, i) => ({
    id: `v${i + 1}`,
    contentHash: g.hash,
    locations: g.locations,
    agentIds: g.agentIds,
    shared: g.shared,
    modifiedMs: modified[i],
    fileCount: Object.keys(fixtures[i].files).length,
    sizeBytes: Object.values(fixtures[i].files).reduce((n, t) => n + t.length, 0),
    newest: i === newestIdx,
    editedSinceInstall: fixtures[i].edited,
  }));

  const paths = [...new Set(fixtures.flatMap((f) => Object.keys(f.files)))].sort((a, b) =>
    a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b),
  );
  const files: FileCompare[] = paths.map((path) => {
    const texts = fixtures.map((f) => f.files[path] ?? null);
    const present = texts.filter((t): t is string => t !== null);
    const status = present.length < texts.length ? "partial" : present.every((t) => t === present[0]) ? "same" : "changed";
    return {
      path,
      status,
      content: present.some(isBinary) ? "binary" : "text",
      variants: texts.map((t) => (t === null ? null : { size: t.length, digest: digest(t) })),
    };
  });

  const left = Math.max(0, groups.findIndex((g) => g.shared));
  let right = -1;
  groups.forEach((_, i) => {
    if (i !== left && (right < 0 || modified[i] > modified[right])) right = i;
  });
  return {
    skillId,
    name,
    versions,
    files,
    upstreamSource,
    suggested: right >= 0 ? [versions[left].id, versions[right].id] : null,
  };
}

/** SKILL.md body (no frontmatter) of one fixture version, so the skill sheet shows the same text. */
export function fixtureBody(skillId: string, role: string): string | undefined {
  return COMPARE_FIXTURES[skillId]?.[role]?.files["SKILL.md"]?.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
}

export function matchingUpstream(skillId: string, groups: MockGroup[]): string[] {
  return groups.filter((g) => fixtureFor(skillId, g.role).matchesGithub).map((g) => g.hash);
}

export function buildFileDiff(skillId: string, path: string, left: MockGroup, right: MockGroup): FileDiff {
  const a = fixtureFor(skillId, left.role).files[path];
  const b = fixtureFor(skillId, right.role).files[path];
  const out: FileDiff = {
    path,
    content: "text",
    identical: false,
    leftSize: a === undefined ? null : a.length,
    rightSize: b === undefined ? null : b.length,
    blocks: [],
    added: 0,
    removed: 0,
    eolOnly: false,
  };
  if (a !== undefined && a === b) return { ...out, identical: true, content: contentOf(a) };
  if ((a !== undefined && isBinary(a)) || (b !== undefined && isBinary(b))) return { ...out, content: "binary" };
  const d = diffText(a ?? "", b ?? "");
  return { ...out, blocks: d.blocks, added: d.added, removed: d.removed, eolOnly: d.eolOnly };
}

// ── line diff (port of compare.rs) ───────────────────────────────────────────

type Op = { kind: "equal" | "delete" | "insert"; a: number; b: number };

/** Longest-common-subsequence edit script. */
function editScript<T>(a: T[], b: T[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [...a.map((_, i) => ({ kind: "delete" as const, a: i, b: 0 })), ...b.map((_, j) => ({ kind: "insert" as const, a: n, b: j }))];
  }
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ kind: "equal", a: i++, b: j++ });
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) ops.push({ kind: "delete", a: i++, b: j });
    else ops.push({ kind: "insert", a: i, b: j++ });
  }
  while (i < n) ops.push({ kind: "delete", a: i++, b: j });
  while (j < m) ops.push({ kind: "insert", a: i, b: j++ });
  return ops;
}

const stripEol = (l: string) => l.replace(/\r?\n$/, "");
const splitLines = (s: string) => (s.match(/[^\n]*\n|[^\n]+$/g) ?? []).map(stripEol);

const oneSided = (kind: "insert" | "delete", index: number, text: string): DiffRow =>
  kind === "delete"
    ? { kind, leftNo: index + 1, rightNo: null, left: text, right: null, leftMarks: [], rightMarks: [] }
    : { kind, leftNo: null, rightNo: index + 1, left: null, right: text, leftMarks: [], rightMarks: [] };

const changedRow = (li: number, left: string, ri: number, right: string, marks?: Inline): DiffRow => ({
  kind: "replace",
  leftNo: li + 1,
  rightNo: ri + 1,
  left,
  right,
  leftMarks: marks?.left ?? [],
  rightMarks: marks?.right ?? [],
});

export function diffText(oldText: string, newText: string): { blocks: DiffBlock[]; added: number; removed: number; eolOnly: boolean } {
  if (oldText === newText) return { blocks: [], added: 0, removed: 0, eolOnly: false };
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = editScript(a, b);
  const rows: DiffRow[] = [];
  for (let k = 0; k < ops.length; ) {
    if (ops[k].kind === "equal") {
      rows.push({ kind: "equal", leftNo: ops[k].a + 1, rightNo: ops[k].b + 1, left: a[ops[k].a], right: b[ops[k].b], leftMarks: [], rightMarks: [] });
      k++;
      continue;
    }
    const start = k;
    while (k < ops.length && ops[k].kind !== "equal") k++;
    const run = ops.slice(start, k);
    const dels = run.filter((o) => o.kind === "delete").map((o) => o.a);
    const inss = run.filter((o) => o.kind === "insert").map((o) => o.b);
    if (!inss.length) dels.forEach((i) => rows.push(oneSided("delete", i, a[i])));
    else if (!dels.length) inss.forEach((j) => rows.push(oneSided("insert", j, b[j])));
    else replaceRows(a, b, dels, inss, rows);
  }
  if (rows.every((r) => r.kind === "equal")) return { blocks: [], added: 0, removed: 0, eolOnly: true };
  const added = rows.filter((r) => r.kind === "insert" || r.kind === "replace").length;
  const removed = rows.filter((r) => r.kind === "delete" || r.kind === "replace").length;
  return { blocks: collapse(rows, CONTEXT), added, removed, eolOnly: false };
}

type Step = { t: "pair"; i: number; j: number } | { t: "del"; i: number } | { t: "ins"; j: number };

/** Pair up the alike lines of a changed block, zip the rest level, leave any surplus alone. */
function replaceRows(a: string[], b: string[], delIdx: number[], insIdx: number[], out: DiffRow[]) {
  const old = delIdx.map((i) => a[i]);
  const neu = insIdx.map((j) => b[j]);
  let dels: number[] = [];
  let inss: number[] = [];
  const flush = () => {
    const n = Math.max(dels.length, inss.length);
    for (let k = 0; k < n; k++) {
      const i = dels[k];
      const j = inss[k];
      if (i !== undefined && j !== undefined) out.push(changedRow(delIdx[i], old[i], insIdx[j], neu[j]));
      else if (i !== undefined) out.push(oneSided("delete", delIdx[i], old[i]));
      else out.push(oneSided("insert", insIdx[j], neu[j]));
    }
    dels = [];
    inss = [];
  };
  for (const step of align(old, neu)) {
    if (step.t === "del") dels.push(step.i);
    else if (step.t === "ins") inss.push(step.j);
    else {
      flush();
      out.push(changedRow(delIdx[step.i], old[step.i], insIdx[step.j], neu[step.j], inline(old[step.i], neu[step.j])));
    }
  }
  flush();
}

function align(old: string[], neu: string[]): Step[] {
  const n = old.length;
  const m = neu.length;
  const sim = old.map((o) => neu.map((x) => (similarity(o, x) >= PAIR_MIN_SIMILARITY ? similarity(o, x) : 0)));
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let v = Math.max(best[i + 1][j], best[i][j + 1]);
      if (sim[i][j] > 0) v = Math.max(v, sim[i][j] + best[i + 1][j + 1]);
      best[i][j] = v;
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sim[i][j] > 0 && sim[i][j] + best[i + 1][j + 1] >= best[i][j]) steps.push({ t: "pair", i: i++, j: j++ });
    else if (best[i + 1][j] >= best[i][j]) steps.push({ t: "del", i: i++ });
    else steps.push({ t: "ins", j: j++ });
  }
  while (i < n) steps.push({ t: "del", i: i++ });
  while (j < m) steps.push({ t: "ins", j: j++ });
  return steps;
}

const similarity = (a: string, b: string) => (a === b ? 1 : inline(a, b).ratio);

type Cls = "word" | "space" | "other";
const cls = (ch: string): Cls => (/[\p{L}\p{N}_]/u.test(ch) ? "word" : /\s/.test(ch) ? "space" : "other");

function tokens(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let prev: Cls | null = null;
  for (const ch of s) {
    const k = cls(ch);
    if (prev !== null && (k === "other" || k !== prev)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
    prev = k;
  }
  if (cur) out.push(cur);
  return out;
}

interface Inline {
  ratio: number;
  left: [number, number][];
  right: [number, number][];
}

function inline(a: string, b: string): Inline {
  const ta = tokens(a);
  const tb = tokens(b);
  const blank = (t: string) => /^\s+$/.test(t);
  const weight = (ts: string[]) => ts.filter((t) => !blank(t)).reduce((n, t) => n + [...t].length, 0);
  const ops = editScript(ta, tb);
  let equal = 0;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const push = (list: [number, number][], at: number) => {
    const last = list[list.length - 1];
    if (last && (last[1] === at || (last[1] + 1 === at && blank(list === left ? ta[last[1]] : tb[last[1]])))) last[1] = at + 1;
    else list.push([at, at + 1]);
  };
  for (const op of ops) {
    if (op.kind === "equal") equal += blank(ta[op.a]) ? 0 : [...ta[op.a]].length;
    else if (op.kind === "delete") push(left, op.a);
    else push(right, op.b);
  }
  const total = weight(ta) + weight(tb);
  const offsets = (ts: string[]) => ts.reduce<number[]>((acc, t) => [...acc, acc[acc.length - 1] + t.length], [0]);
  const [oa, ob] = [offsets(ta), offsets(tb)];
  return {
    ratio: total === 0 ? 1 : (2 * equal) / total,
    left: left.map(([s, e]) => [oa[s], oa[e]]),
    right: right.map(([s, e]) => [ob[s], ob[e]]),
  };
}

function collapse(rows: DiffRow[], context: number): DiffBlock[] {
  const n = rows.length;
  const keep = new Array<boolean>(n).fill(false);
  rows.forEach((r, c) => {
    if (r.kind !== "equal") for (let k = Math.max(0, c - context); k <= Math.min(n - 1, c + context); k++) keep[k] = true;
  });
  for (let i = 0; i < n; ) {
    if (keep[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && !keep[i]) i++;
    if (i - start < MIN_HIDDEN) for (let k = start; k < i; k++) keep[k] = true;
  }
  const blocks: DiffBlock[] = [];
  rows.forEach((row, idx) => {
    const last = blocks[blocks.length - 1];
    if (last && last.collapsed === !keep[idx]) last.rows.push(row);
    else blocks.push({ collapsed: !keep[idx], rows: [row] });
  });
  return blocks;
}

// Browser mock of the projects and pinned-skills commands (projects_list … pin_compare_file).
// Pins live in memory per project, like quiver-pins.json would on disk: unregistering a project
// keeps its pins, and adding it back shows them again. mock.ts supplies the library and agents.

import type {
  CopyComparison,
  FileDiff,
  NameCheck,
  Pin,
  PinAgentLink,
  PinMode,
  PinRef,
  PinRequest,
  PinState,
  ProjectDetail,
  ProjectSkill,
  ProjectSummary,
  SkillSource,
} from "./types";
import { COMPARE_FIXTURES, buildComparison, buildFileDiff, type MockGroup } from "./mockCompare";
import { BROWSER_QA, DEPLOY_CHECKLIST } from "./mockPinFixtures";

COMPARE_FIXTURES["browser-qa"] = BROWSER_QA;
COMPARE_FIXTURES["deploy-checklist"] = DEPLOY_CHECKLIST;

const DAY = 86_400_000;
const NATIVE_DIR = ".agents/skills";
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What the pin mock needs to know about one library skill. */
export interface PinnableSkill {
  id: string;
  name: string;
  description: string;
  /** Hash of the shared copy; null when the skill has none. */
  hash: string | null;
  source: SkillSource | null;
  /** SKILL.md and the other text files, for skills without a hand-written fixture. */
  files: () => Record<string, string>;
  /** Agents whose own skills folder already has a skill with this id. */
  holders: string[];
  /** Agents that see the shared copy. */
  seenBy: string[];
}

export interface PinEnv {
  home: string;
  flags: URLSearchParams;
  /** True when the library is empty on purpose (?demo=empty). */
  empty: boolean;
  skill(id: string): PinnableSkill | null;
  /** Detected, enabled agents. */
  agents(): { id: string; name: string; projectDir: string | null }[];
}

interface MPin {
  name: string;
  skill: string;
  description: string;
  source: SkillSource | null;
  gitRef: string | null;
  pinnedFrom: "shared" | "github";
  pinnedAt: string;
  /** Which fixture the pin folder holds: the shared one, or the older one it was pinned from. */
  content: "shared" | "pinned";
  upstreamHash: string | null;
  edited: string[];
  /** Agents whose link or copy is broken. */
  broken: string[];
  missing: boolean;
  /** Agents with a global skill of the same name (shown as a warning). */
  clash: string[];
  mode: PinMode;
  agentIds: string[];
}

interface MProject {
  path: string;
  branch: string | null;
  isRepo: boolean;
  exists: boolean;
  pins: MPin[];
  others: ProjectSkill[];
}

/** A few characters of a fake commit SHA, stable for the same input. */
function fakeSha(input: string): string {
  let h = 0x811c9dc5;
  let out = "";
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) + round;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

export function createPinMock(env: PinEnv) {
  const expand = (p: string) => (p.startsWith("~") ? env.home + p.slice(1) : p).replace(/[\\/]+$/, "");
  const tildify = (p: string) => (p.startsWith(env.home) ? "~" + p.slice(env.home.length) : p);
  const sleep = (lo: number, hi: number) => new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

  /** Every repo the mock knows about, whether or not it is registered. */
  const disk = new Map<string, MProject>();
  /** Registered project roots, in the order they were added. */
  let registered: string[] = [];

  const repo = (path: string, branch: string | null, others: ProjectSkill[] = []): MProject => {
    const p: MProject = { path: expand(path), branch, isRepo: true, exists: true, pins: [], others };
    disk.set(p.path, p);
    return p;
  };

  // ── seed ───────────────────────────────────────────────────────────────────

  const acme = repo("~/code/acme-web", "release/2.4", [
    {
      name: "next-best-practices",
      description: "Next.js best practices: file conventions, server and client component boundaries, data fetching, metadata and image optimization.",
      dir: ".agents/skills/next-best-practices",
      source: "vercel-labs/next-skills",
    },
  ]);
  repo("~/code/docs-site", "main");
  repo("~/code/api-gateway", "main");
  repo("~/code/mobile-app", "develop");

  const bq = env.skill("browser-qa");
  const dc = env.skill("deploy-checklist");
  const problems = env.flags.get("pins") === "problems";
  if (bq?.hash) {
    acme.pins.push({
      name: "browser-qa-release",
      skill: "browser-qa",
      description: bq.description,
      source: bq.source,
      gitRef: null,
      pinnedFrom: "shared",
      pinnedAt: iso(12),
      content: "pinned",
      // The shared copy has changed since this was pinned.
      upstreamHash: "d41f08b",
      edited: [],
      broken: problems ? ["claude-code"] : [],
      missing: false,
      clash: [],
      mode: "symlink",
      agentIds: defaultAgents(),
    });
  }
  if (dc?.hash) {
    acme.pins.push({
      name: "deploy-checklist-pinned",
      skill: "deploy-checklist",
      description: dc.description,
      source: dc.source,
      gitRef: fakeSha("deploy-checklist@v1.4.0"),
      pinnedFrom: "github",
      pinnedAt: iso(4),
      content: "pinned",
      upstreamHash: dc.hash,
      edited: ["SKILL.md"],
      broken: [],
      missing: false,
      clash: problems ? ["claude-code"] : [],
      mode: "symlink",
      agentIds: defaultAgents(),
    });
  }
  registered = env.empty ? [] : [acme.path, expand("~/code/docs-site")];

  // ── derived views ──────────────────────────────────────────────────────────

  function defaultAgents(): string[] {
    return env.agents().filter((a) => a.projectDir).map((a) => a.id);
  }

  function pinHash(p: MPin) {
    return `sha256:${fakeSha(`${p.name}:${p.content}:${p.edited.join()}`)}${fakeSha(p.skill)}`.slice(0, 71);
  }

  function pinState(p: MPin): PinState {
    return p.missing ? "missing" : p.edited.length ? "modified" : p.broken.length ? "links" : "ok";
  }

  function toPin(m: MProject, p: MPin): Pin {
    const sk = env.skill(p.skill);
    const names = new Map(env.agents().map((a) => [a.id, a]));
    const agents: PinAgentLink[] = p.agentIds.flatMap((id): PinAgentLink[] => {
      const a = names.get(id);
      if (!a?.projectDir) return [];
      const native = a.projectDir === NATIVE_DIR;
      const bad = !native && p.broken.includes(id);
      return [
        {
          agentId: id,
          dir: `${a.projectDir}/${p.name}`,
          kind: native ? "native" : p.mode,
          ok: !bad,
          problem: bad ? (p.mode === "copy" ? "The copy is missing." : "The link is missing.") : null,
        },
      ];
    });
    const state = pinState(p);
    const list: string[] = [];
    if (p.missing) list.push("The pinned folder isn't in the project any more.");
    else {
      if (p.edited.length) list.push(`${p.edited.join(", ")} ${p.edited.length > 1 ? "were" : "was"} changed after pinning.`);
      for (const a of agents.filter((x) => !x.ok)) list.push(`${names.get(a.agentId)?.name ?? a.agentId}: ${a.problem!.toLowerCase()} (${a.dir})`);
    }
    return {
      name: p.name,
      skill: p.skill,
      description: p.description,
      source: p.source,
      gitRef: p.gitRef,
      pinnedFrom: p.pinnedFrom,
      pinnedAt: p.pinnedAt,
      hash: pinHash(p),
      upstreamHash: p.upstreamHash,
      state,
      changedFiles: p.missing ? [] : [...p.edited],
      problems: list,
      sharedChanged: sk?.hash ? sk.hash !== p.upstreamHash : null,
      nameClash: [...p.clash],
      mode: p.mode,
      agents,
      path: `${m.path}/${NATIVE_DIR}/${p.name}`,
    };
  }

  const summary = (m: MProject): ProjectSummary => ({
    path: m.path,
    displayPath: tildify(m.path),
    name: m.path.split("/").pop() || m.path,
    branch: m.isRepo ? m.branch : null,
    isRepo: m.isRepo,
    exists: m.exists,
    pinCount: m.pins.length,
    problemCount: m.pins.filter((p) => pinState(p) !== "ok").length,
  });

  const detail = (m: MProject): ProjectDetail => ({
    ...summary(m),
    pins: m.pins.map((p) => toPin(m, p)),
    otherSkills: m.others.map((o) => ({ ...o })),
    lockFile: m.pins.length ? `${m.path}/quiver-pins.json` : null,
  });

  // ── lookups and checks ─────────────────────────────────────────────────────

  function project(path: string): MProject {
    const key = expand(path);
    const known = disk.get(key);
    if (known) return known;
    if (key === env.home) throw "That's your home folder. Choose the folder of a project instead.";
    if (/^\/Users\/[^/]+\/\.(agents|claude)\b/.test(key)) throw "That folder holds your shared skills. Choose a project folder instead.";
    const fresh = repo(key, "main");
    return fresh;
  }

  const projectOf = (path: string) => {
    const m = disk.get(expand(path));
    if (!m) throw `Quiver doesn't know the project ${tildify(path)}.`;
    return m;
  };
  const pinOf = (m: MProject, name: string) => {
    const p = m.pins.find((x) => x.name === name);
    if (!p) throw `${summary(m).name} has no pin named “${name}”.`;
    return p;
  };

  function checkName(m: MProject, name: string): NameCheck {
    if (!name) return { ok: false, message: "Enter a name for the pinned copy." };
    if (name.length > 64) return { ok: false, message: "At most 64 characters." };
    if (/[A-Z]/.test(name)) return { ok: false, message: "Use lowercase letters only." };
    if (/[^a-z0-9-]/.test(name)) return { ok: false, message: "Only letters a–z, digits and hyphens." };
    if (!NAME_RE.test(name)) return { ok: false, message: "No leading, trailing or double hyphens." };
    if (m.pins.some((p) => p.name === name)) return { ok: false, message: `This project already has a pin named “${name}”.` };
    if (m.others.some((o) => o.dir.endsWith(`/${name}`) || o.name === name)) {
      return { ok: false, message: `This project already has a folder named “${name}”. Pick another name.` };
    }
    const holders = env.skill(name)?.holders ?? [];
    if (holders.length) {
      return {
        ok: false,
        message: `You already have a skill called “${name}”. Claude Code prefers your personal skills over a project's, so this pin would never be used. Pick another name.`,
      };
    }
    return { ok: true, message: null };
  }

  /** The shared copy and the pinned copy as the two sides of a comparison. */
  function sides(m: MProject, p: MPin) {
    const sk = env.skill(p.skill);
    if (!sk?.hash) throw `“${p.skill}” isn't in your library any more, so there's no shared copy to compare with.`;
    const f = (COMPARE_FIXTURES[sk.id] ??= {});
    f.shared ??= { modifiedDaysAgo: 5, edited: false, files: sk.files() };
    const pinnedRole = p.content === "pinned" && f.pinned ? "pinned" : "shared";
    const shared: MockGroup = {
      hash: sk.hash,
      shared: true,
      role: "shared",
      locations: [{ path: `${env.home}/.agents/skills/${sk.id}`, agentIds: [], kind: "canonical" }],
      agentIds: sk.seenBy,
    };
    const pinned: MockGroup = {
      hash: pinnedRole === "shared" ? sk.hash : fakeSha(`${p.name}@${p.pinnedFrom}`).slice(0, 7),
      shared: false,
      role: pinnedRole,
      locations: [{ path: `${m.path}/${NATIVE_DIR}/${p.name}`, agentIds: [], kind: "directory" }],
      agentIds: [],
    };
    return { sk, shared, pinned };
  }

  // ── mutations ──────────────────────────────────────────────────────────────

  function repin(p: MPin, gitRef: string | null) {
    const sk = env.skill(p.skill);
    if (!sk?.hash) throw `“${p.skill}” has no shared copy to pin. Install it again first.`;
    if (gitRef !== null) {
      if (sk.source?.kind !== "github") throw `“${sk.id}” didn't come from GitHub, so there is no version to look up.`;
      if (!gitRef.trim()) throw "Enter a tag, branch or commit.";
      if (/\s/.test(gitRef.trim())) throw `“${gitRef.trim()}” isn't a tag, branch or commit on ${sk.source.source}.`;
      const f = COMPARE_FIXTURES[sk.id];
      p.pinnedFrom = "github";
      p.gitRef = /^[0-9a-f]{40}$/.test(gitRef.trim()) ? gitRef.trim() : fakeSha(`${sk.id}@${gitRef.trim()}`);
      p.content = f?.pinned ? "pinned" : "shared";
      p.upstreamHash = p.content === "shared" ? sk.hash : `${sk.id}@${p.gitRef.slice(0, 7)}`;
    } else {
      p.pinnedFrom = "shared";
      p.gitRef = null;
      p.content = "shared";
      p.upstreamHash = sk.hash;
    }
    p.description = sk.description;
    p.source = sk.source;
    p.pinnedAt = new Date().toISOString();
    p.edited = [];
    p.broken = [];
    p.missing = false;
  }

  function create(req: PinRequest): ProjectDetail {
    const m = project(req.project);
    const name = req.name.trim();
    const check = checkName(m, name);
    if (!check.ok) throw check.message ?? "That name can't be used.";
    const sk = env.skill(req.skill);
    if (!sk?.hash) throw `“${req.skill}” has no shared copy to pin. Share it with your agents first.`;
    const known = new Set(env.agents().filter((a) => a.projectDir).map((a) => a.id));
    const agentIds = req.agents.length ? req.agents.filter((id) => known.has(id)) : defaultAgents();
    const pin: MPin = {
      name,
      skill: sk.id,
      description: sk.description,
      source: sk.source,
      gitRef: null,
      pinnedFrom: "shared",
      pinnedAt: new Date().toISOString(),
      content: "shared",
      upstreamHash: sk.hash,
      edited: [],
      broken: [],
      missing: false,
      clash: [],
      mode: req.mode,
      agentIds,
    };
    repin(pin, req.gitRef);
    m.pins.push(pin);
    return detail(m);
  }

  // ── public surface ─────────────────────────────────────────────────────────

  return {
    registered: () => [...registered],

    pinnedIn(skillId: string): PinRef[] {
      const refs: PinRef[] = [];
      for (const path of registered) {
        const m = disk.get(path);
        if (!m) continue;
        for (const p of m.pins) {
          if (p.skill === skillId) refs.push({ project: m.path, projectName: summary(m).name, pin: p.name, state: pinState(p) });
        }
      }
      return refs;
    },

    /** Returns undefined for commands that aren't about projects. */
    handle(cmd: string, a: Record<string, unknown>): Promise<unknown> | undefined {
      const str = (k: string) => a[k] as string;
      switch (cmd) {
        case "projects_list":
          return sleep(60, 140).then(() => registered.map((p) => summary(disk.get(p)!)));
        case "project_add":
          return sleep(150, 300).then(() => {
            const m = project(str("path"));
            if (!registered.includes(m.path)) registered = [...registered, m.path];
            return summary(m);
          });
        case "project_remove":
          return sleep(80, 160).then(() => {
            registered = registered.filter((p) => p !== expand(str("path")));
            return null;
          });
        case "project_detail":
          return sleep(90, 200).then(() => detail(projectOf(str("path"))));
        case "pin_check_name":
          return sleep(120, 260).then(() => checkName(projectOf(str("project")), str("name").trim()));
        case "pin_create":
          return sleep(700, 1000).then(() => create(a.request as PinRequest));
        case "pin_update":
          return sleep(600, 900).then(() => {
            const m = projectOf(str("project"));
            repin(pinOf(m, str("name")), (a.gitRef as string | null) ?? null);
            return detail(m);
          });
        case "pin_remove":
          return sleep(300, 500).then(() => {
            const m = projectOf(str("project"));
            pinOf(m, str("name"));
            m.pins = m.pins.filter((p) => p.name !== str("name"));
            return detail(m);
          });
        case "pin_sync":
          return sleep(400, 700).then(() => {
            const m = projectOf(str("project"));
            for (const p of m.pins) p.broken = [];
            return detail(m);
          });
        case "pin_compare":
          return sleep(120, 260).then((): CopyComparison => {
            const m = projectOf(str("project"));
            const p = pinOf(m, str("name"));
            const { sk, shared, pinned } = sides(m, p);
            return buildComparison(sk.id, p.name, [shared, pinned], null);
          });
        case "pin_compare_file":
          return sleep(60, 160).then((): FileDiff => {
            const m = projectOf(str("project"));
            const p = pinOf(m, str("name"));
            const { sk, shared, pinned } = sides(m, p);
            const side = (key: string) => {
              const g = [shared, pinned].find((x) => x.hash === str(key));
              if (!g) throw "That copy changed since the comparison was loaded. Reload it.";
              return g;
            };
            return buildFileDiff(sk.id, str("path"), side("leftHash"), side("rightHash"));
          });
        default:
          return undefined;
      }
    },
  };
}

export type PinMock = ReturnType<typeof createPinMock>;

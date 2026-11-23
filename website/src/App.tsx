import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, Check, Copy, FolderSync, GitBranch, HeartPulse, Layers, PenLine, SearchCheck,
  Plus, RefreshCw, ShieldCheck, Sparkles, Terminal, Trash2, Zap,
} from "lucide-react";
import registry from "../../crates/quiver-core/agents.json";

const REPO = "https://github.com/AnkushBL6/quiver";
const DOWNLOAD = `${REPO}/releases/latest`;

type AgentDef = { id: string; name: string; tier: number; globalDirs: string[] };
const AGENTS = (registry as { agents: AgentDef[] }).agents;

function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return <img src="./icon.png" width={size} height={size} alt="" className={className} />;
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className="sticky top-0 z-50 transition-[background-color,border-color] duration-200"
      style={{
        background: scrolled ? "var(--bar)" : "transparent",
        backdropFilter: scrolled ? "saturate(1.8) blur(20px)" : undefined,
        WebkitBackdropFilter: scrolled ? "saturate(1.8) blur(20px)" : undefined,
        borderBottom: `1px solid ${scrolled ? "var(--line)" : "transparent"}`,
      }}
    >
      <div className="wrap flex h-14 items-center justify-between">
        <a href="#" className="flex items-center gap-2 font-semibold tracking-tight" style={{ color: "var(--fg)", textDecoration: "none" }}>
          <Logo size={30} />
          <span className="text-[17px]">Quiver</span>
        </a>
        <nav className="hidden items-center gap-8 text-[14px] md:flex">
          {[["Features", "#features"], ["How it works", "#how"], ["Agents", "#agents"], ["CLI", "#cli"], ["FAQ", "#faq"]].map(([l, h]) => (
            <a key={h} href={h} className="navlink">{l}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href={REPO} className="btn btn-ghost btn-sm" aria-label="GitHub"><Github size={15} /> <span className="hidden sm:inline">GitHub</span></a>
          <a href={DOWNLOAD} className="btn btn-primary btn-sm"><ArrowDownToLine size={15} /> Download</a>
        </div>
      </div>
    </header>
  );
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : `Copy command: ${text}`}
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}
      className="group inline-flex max-w-full items-start gap-3 rounded-[10px] px-3.5 py-2.5 text-left font-mono text-[13px] leading-[1.5]"
      style={{ background: "var(--control)", boxShadow: "0 0 0 0.5px var(--control-border), var(--control-shadow)" }}
    >
      <span aria-hidden="true" style={{ color: "var(--fg-3)" }}>$</span>
      <span className="min-w-0 [overflow-wrap:anywhere]" style={{ color: "var(--fg)" }}>
        {text.split(/(?<=\/)/).map((part, i) => <Fragment key={i}>{i > 0 && <wbr />}{part}</Fragment>)}
      </span>
      <span className="mt-[3px] shrink-0">
        {done ? <Check size={14} style={{ color: "var(--accent-text)" }} /> : <Copy size={14} className="opacity-50 transition-opacity group-hover:opacity-100" style={{ color: "var(--fg-2)" }} />}
      </span>
    </button>
  );
}

function Hero() {
  return (
    <section className="pb-20 pt-16 md:pb-28 md:pt-24">
      <div className="wrap text-center">
        <a href={REPO} className="fade-up eyebrow inline-block hover:underline" style={{ textUnderlineOffset: 3 }}>
          Free and open source · MIT · macOS
        </a>
        <h1 className="fade-up mx-auto mt-4 max-w-[860px] text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[56px] md:text-[72px]" style={{ animationDelay: "60ms" }}>
          One skill library for every coding agent.
        </h1>
        <p className="lead fade-up mx-auto mt-6 max-w-[640px] md:text-[21px]" style={{ animationDelay: "120ms" }}>
          Install an Agent Skill once. Claude Code, Codex, Antigravity, Cursor and {AGENTS.length - 4}+ other agents see it right away. Quiver keeps them in sync, up to date and free of broken links.
        </p>
        <div className="fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: "180ms" }}>
          <a href={DOWNLOAD} className="btn btn-primary btn-lg w-full max-w-[280px] sm:w-auto"><ArrowDownToLine size={18} /> Download for macOS</a>
          <a href={REPO} className="btn btn-ghost btn-lg w-full max-w-[280px] sm:w-auto"><Github size={18} /> Star on GitHub</a>
        </div>
        <p className="fade-up mt-5 text-balance text-[13px]" style={{ color: "var(--fg-2)", animationDelay: "220ms" }}>
          Universal app for Apple Silicon and Intel · macOS 12+ · under 7 MB
        </p>
      </div>

      <div className="wrap mt-14 md:mt-16">
        <DemoWindow />
        <p className="mt-5 text-center text-[13px]" style={{ color: "var(--fg-2)" }}>
          The real Quiver interface, running in your browser on demo data. Click around.
        </p>
      </div>
    </section>
  );
}

// The demo is a desktop app. Below DEMO_MIN_W the iframe keeps a desktop-sized
// viewport and is scaled down to fit, instead of squeezing the app into a phone width.
const DEMO_MIN_W = 960;

function DemoWindow() {
  const [loaded, setLoaded] = useState(false);
  const [w, setW] = useState(1100);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vw = Math.max(w, DEMO_MIN_W);
  const vh = (vw * 780) / 1240;
  const scale = w / vw;
  return (
    <div className="window mx-auto max-w-[1100px]">
      <div ref={box} className="relative" style={{ height: vh * scale }}>
        {!loaded && (
          <div className="absolute inset-0 grid place-items-center" style={{ background: "var(--bg-2)" }}>
            <div className="flex items-center gap-2 text-[14px]" style={{ color: "var(--fg-2)" }}><Logo size={26} /> Loading demo…</div>
          </div>
        )}
        <iframe
          src="./demo/index.html"
          title="Quiver live demo"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className="absolute left-0 top-0"
          style={{ border: 0, width: vw, height: vh, transform: `scale(${scale})`, transformOrigin: "0 0", opacity: loaded ? 1 : 0, transition: "opacity 300ms ease-out" }}
        />
      </div>
    </div>
  );
}

const SCATTER = [
  { dir: "~/.claude/skills", n: 41, broken: 75 },
  { dir: "~/.gemini/config/skills", n: 33, broken: 0 },
  { dir: "~/.cursor/skills", n: 0, broken: 0 },
  { dir: "~/.factory/skills", n: 8, broken: 0 },
  { dir: "~/.config/opencode/skills", n: 1, broken: 0 },
  { dir: "~/.copilot/skills", n: 0, broken: 0 },
];

function Film() {
  return (
    <section className="pb-20 md:pb-28">
      <div className="wrap">
        <div className="mx-auto max-w-[720px] text-center">
          <div className="eyebrow">Watch</div>
          <h2 className="h2 mt-3">Quiver in under a minute.</h2>
        </div>
        <div className="window mx-auto mt-10 max-w-[1000px]">
          <video
            className="block h-auto w-full"
            src="./quiver-product.mp4"
            poster="./quiver-poster.png"
            controls
            playsInline
            preload="none"
            muted
          />
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="section band">
      <div className="wrap grid items-center gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <div className="eyebrow">The problem</div>
          <h2 className="h2 mt-3">Every agent keeps its own folder of skills.</h2>
          <p className="lead mt-5">
            Skills you install for Claude Code don't show up in Codex. The copy you fixed in Cursor drifts away from the one in Antigravity. Uninstall something and a symlink breaks in a folder you forgot about.
          </p>
          <p className="lead mt-4">
            On one real developer's Mac, the first scan found <b className="font-semibold" style={{ color: "var(--fg)" }}>219 skills spread across 18 agents</b>. 116 of them were visible to only one agent, and one folder held 75 broken links.
          </p>
        </div>
        <div className="card overflow-hidden p-0">
          <div className="hair-b flex items-center gap-2 px-4 py-3 text-[13px] font-medium" style={{ color: "var(--fg-2)" }}>
            <FolderSync size={14} /> Before Quiver
          </div>
          <div>
            {SCATTER.map((s, i) => (
              <div key={s.dir} className={`flex items-center justify-between gap-3 px-4 py-3 font-mono text-[13px] ${i ? "hair-t" : ""}`}>
                <span className="min-w-0 truncate" style={{ color: "var(--fg-2)" }}>{s.dir}</span>
                <span className="flex shrink-0 items-center gap-2.5">
                  {s.broken > 0 && <span className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium" style={{ background: "var(--red-soft)", color: "var(--red)" }}>{s.broken} broken</span>}
                  <span style={{ color: s.n ? "var(--fg)" : "var(--fg-2)" }}>{s.n} {s.n === 1 ? "skill" : "skills"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  const targets = ["Claude Code", "Antigravity", "Cursor", "Copilot", "Droid", "OpenCode"];
  const natives = ["Codex", "Warp", "Zed", "Pi", "Cline"];
  return (
    <section id="how" className="section">
      <div className="wrap">
        <div className="mx-auto max-w-[720px] text-center">
          <div className="eyebrow">How it works</div>
          <h2 className="h2 mt-3">One real copy. A link in every agent.</h2>
          <p className="lead mt-5">
            Quiver keeps each skill once in <code className="font-mono text-[0.9em]">~/.agents/skills</code>, the shared location the <code className="font-mono text-[0.9em]">skills</code> CLI also uses. Agents that read it natively need nothing. Every other agent gets a symlink in its own folder.
          </p>
        </div>

        {/* Wide screens: the diagram. */}
        <div className="mx-auto mt-14 hidden max-w-[960px] lg:block">
          <svg viewBox="0 0 960 340" className="h-auto w-full" role="img" aria-label="Diagram: the canonical store links into each agent">
            {targets.map((t, i) => {
              const x = 80 + i * 160;
              return (
                <g key={t}>
                  <path d={`M${480 + (x - 480) * 0.2} 128 C ${480 + (x - 480) * 0.2} 190, ${x} 190, ${x} 252`} fill="none" stroke="var(--accent)" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="4 6" strokeLinecap="round" />
                  <rect x={x - 66} y="252" width="132" height="58" rx="10" style={{ fill: "var(--card)", stroke: "var(--card-border)" }} />
                  <text x={x} y="277" textAnchor="middle" fontSize="14" fontWeight="600" style={{ fill: "var(--fg)" }}>{t}</text>
                  <text x={x} y="296" textAnchor="middle" fontSize="11.5" style={{ fill: "var(--fg-2)", fontFamily: "var(--font-mono)" }}>symlink</text>
                </g>
              );
            })}
            <rect x="330" y="40" width="300" height="88" rx="14" style={{ fill: "var(--accent-solid)" }} />
            <text x="480" y="78" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" style={{ fontFamily: "var(--font-mono)" }}>~/.agents/skills</text>
            <text x="480" y="102" textAnchor="middle" fontSize="13" fill="#fff">one real copy of every skill</text>
            <text x="662" y="70" fontSize="12.5" style={{ fill: "var(--fg-2)" }}>read natively by</text>
            <text x="662" y="90" fontSize="13.5" fontWeight="600" style={{ fill: "var(--fg)" }}>{natives.join(" · ")}</text>
          </svg>
        </div>

        {/* Narrow screens: the same diagram as a stack, so the type stays readable. */}
        <div className="mx-auto mt-12 max-w-[560px] lg:hidden">
          <div className="mx-auto max-w-[340px] rounded-[12px] px-5 py-4 text-center" style={{ background: "var(--accent-solid)", color: "#fff" }}>
            <div className="font-mono text-[16px] font-semibold">~/.agents/skills</div>
            <div className="mt-1 text-[13px]">one real copy of every skill</div>
          </div>
          <div aria-hidden="true" className="mx-auto h-8 w-0" style={{ borderLeft: "1.5px dashed color-mix(in srgb, var(--accent) 60%, transparent)" }} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {targets.map((t) => (
              <div key={t} className="card px-3 py-3 text-center">
                <div className="text-[14px] font-semibold">{t}</div>
                <div className="mt-0.5 font-mono text-[11.5px]" style={{ color: "var(--fg-2)" }}>symlink</div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-[13px]" style={{ color: "var(--fg-2)" }}>
            Read natively by <span className="font-semibold" style={{ color: "var(--fg)" }}>{natives.join(" · ")}</span>
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-[960px] gap-4 md:grid-cols-3">
          {[
            ["1", "Scan", "Quiver finds every skill in every agent's folder, plus plugin-provided ones, in under 100 ms."],
            ["2", "Make universal", "One click moves stranded skills into the shared store and links them everywhere. Conflicting copies are shown side by side."],
            ["3", "Stay in sync", "Install, update or remove once. Quiver watches the folders and keeps every agent current."],
          ].map(([n, t, d]) => (
            <div key={n} className="card p-6">
              <div className="grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>{n}</div>
              <div className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{t}</div>
              <p className="mt-1.5 text-[15px] leading-[1.5]" style={{ color: "var(--fg-2)" }}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: Layers, title: "Every skill, one library", body: "Search and filter everything installed on your Mac. A matrix view shows exactly which agent sees which skill, and you can toggle any cell." },
  { icon: Sparkles, title: "Universal mode", body: "Turn it on once and every skill stays in every agent. New installs, skills added to any one agent, and newly installed agents are all handled for you. No checkboxes." },
  { icon: PenLine, title: "Your own skills, kept apart", body: "Skills you write live in ~/Skills, a git repo you own. Every agent sees them, updates never touch them, and Quiver commits, pulls and pushes for you. Fork any installed skill with Make it mine." },
  { icon: SearchCheck, title: "Finds lost sources", body: "Skills copied in by hand never update. Quiver finds where each one came from and checks it against the repo's git tree hash, then tracks it for updates." },
  { icon: Zap, title: "Install from anywhere", body: "Install from owner/repo, GitHub links, skills.sh, any git URL, a folder or a .zip. Drag and drop works too. Each new skill is linked to every agent you use." },
  { icon: RefreshCw, title: "Updates", body: "One GitHub request per repo checks every skill. Quiver follows skills that moved upstream and asks before overwriting your local edits." },
  { icon: HeartPulse, title: "Health checks", body: "Finds broken links, conflicting copies and invalid SKILL.md frontmatter, then fixes them with one click." },
  { icon: ShieldCheck, title: "Safe by default", body: "Nothing is deleted: replaced folders go to the Trash. Downloads are checked against GitHub's git hashes. No telemetry and no account." },
  { icon: GitBranch, title: "Works with the skills CLI", body: "Quiver shares ~/.agents/.skill-lock.json with npx skills and keeps fields it doesn't recognize, so you can use both." },
  { icon: Terminal, title: "A CLI too", body: "The same Rust core ships as a quiver command for scripts, dotfiles and CI. Every command supports --json." },
];

function Features() {
  return (
    <section id="features" className="section band">
      <div className="wrap">
        <div className="max-w-[640px]">
          <div className="eyebrow">Features</div>
          <h2 className="h2 mt-3">Manage every skill from one app.</h2>
        </div>
        <div className="mt-12 grid gap-x-16 md:mt-14 md:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="hair-t flex gap-4 py-7 last:border-b md:nth-last-2:border-b" style={{ borderColor: "var(--line)" }}>
              <Icon size={22} strokeWidth={1.75} className="mt-[1px] shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
              <div>
                <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-[1.5]" style={{ color: "var(--fg-2)" }}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Agents() {
  const [all, setAll] = useState(false);
  const shown = all ? AGENTS : AGENTS.slice(0, 32);
  return (
    <section id="agents" className="section">
      <div className="wrap">
        <div className="mx-auto max-w-[720px] text-center">
          <div className="eyebrow">Supported agents</div>
          <h2 className="h2 mt-3">{AGENTS.length} agents supported.</h2>
          <p className="lead mt-5">Paths are checked against each agent's actual binary, not copied from old docs. If yours is missing, it's one JSON entry in a PR, or add it as a custom agent in Settings.</p>
        </div>
        <div className="mx-auto mt-12 flex max-w-[1000px] flex-wrap justify-center gap-2">
          {shown.map((a) => (
            <div key={a.id} title={a.globalDirs[0]} className="card flex items-center gap-2 !rounded-full py-1.5 pl-1.5 pr-3.5 text-[14px]" style={{ fontWeight: a.tier === 1 ? 600 : 400 }}>
              <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full text-[10.5px] font-semibold" style={{ background: "var(--fill)", color: "var(--fg-2)" }}>{a.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)}</span>
              {a.name}
            </div>
          ))}
          {!all && (
            <button type="button" onClick={() => setAll(true)} className="rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors hover:brightness-95" style={{ color: "var(--accent-text)", background: "var(--accent-soft)" }}>
              + {AGENTS.length - 32} more
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const CLI_LINES: [string, string][] = [
  ["$ quiver install anthropics/skills --skill pdf", ""],
  ["Installing 1 skill(s) from anthropics/skills", "dim"],
  ["✓ pdf", "ok"],
  ["$ quiver list --agent cursor", ""],
  ["● pdf                          18/18 agents", ""],
  ["● frontend-design              18/18 agents", ""],
  ["$ quiver outdated", ""],
  ["↑ xlsx                         anthropics/skills", "accent"],
  ["1 up to date · 1 available · 0 untracked · 0 errors", "dim"],
  ["$ quiver doctor --apply", ""],
  ["41 skill(s) to make universal, 75 broken link(s), 0 conflict(s)", "dim"],
  ["116 done, 0 error(s)", "ok"],
];

function Cli() {
  const cls = (k: string) => (k === "ok" ? "term-ok" : k === "accent" ? "term-accent" : k === "dim" ? "term-dim" : "");
  return (
    <section id="cli" className="section band">
      <div className="wrap grid items-center gap-12 md:grid-cols-[1fr_1.15fr] md:gap-16">
        <div className="min-w-0">
          <div className="eyebrow">For the terminal</div>
          <h2 className="h2 mt-3">The same engine, as a CLI.</h2>
          <p className="lead mt-5">Quiver's core is a Rust library. The desktop app and the <code className="font-mono text-[0.9em]">quiver</code> command share it, so scripts, dotfiles and CI get exactly the same behavior.</p>
          <div className="mt-7"><CopyLine text="cargo install --git https://github.com/AnkushBL6/quiver quiver-cli" /></div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-[12px]" style={{ background: "var(--term-bg)", color: "var(--term-fg)", boxShadow: "var(--term-shadow)" }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--term-line)" }}>
            {["var(--tl-red)", "var(--tl-amber)", "var(--tl-green)"].map((c) => <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />)}
            <span className="ml-3 font-mono text-[12px] term-dim">zsh</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.75] sm:text-[13px]">
            {CLI_LINES.map(([t, k], i) => (
              <div key={i} className={cls(k)} style={{ marginTop: t.startsWith("$") && i ? 10 : 0 }}>{t}</div>
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ["What is an Agent Skill?", "A folder with a SKILL.md file (instructions plus optional scripts and resources) that a coding agent loads when it's relevant. The format is an open standard documented at agentskills.io and supported by most coding agents."],
  ["Does Quiver change how my agents work?", "No. Agents read skills from their usual folders. Quiver only manages what's in those folders, using symlinks that point at the shared store. If an agent doesn't follow symlinks, switch it to copy mode in Settings and Quiver keeps the copies in sync."],
  ["What happens to the skills I already have?", "Nothing, until you decide. Quiver scans and shows everything. When you choose Make universal, it moves the skill into ~/.agents/skills, leaves a link where it was, and links it to your other agents. Replaced folders go to the Trash."],
  ["Is it compatible with npx skills?", "Yes. Both tools use ~/.agents/skills and the same lockfile (~/.agents/.skill-lock.json). Quiver preserves fields it doesn't recognize."],
  ["Does it send data anywhere?", "Quiver has no telemetry and no account. It contacts GitHub only to install and check updates, and skills.sh only when you search. An optional GitHub token, for private repos and higher rate limits, is stored in your macOS Keychain."],
  ["Windows or Linux?", "The Rust core and CLI already build on Linux. Desktop builds for Windows and Linux are on the roadmap, and contributions are welcome."],
];

function Faq() {
  return (
    <section id="faq" className="section">
      <div className="wrap max-w-[820px]">
        <div className="eyebrow text-center">FAQ</div>
        <h2 className="h2 mt-3 text-center">Questions</h2>
        <div className="hair-t hair-b mt-12">
          {FAQ.map(([q, a], i) => (
            <details key={q} className={`group py-5 ${i ? "hair-t" : ""}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {q}
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 transition-transform duration-200 group-open:rotate-45" style={{ color: "var(--fg-2)" }} />
              </summary>
              <p className="mt-3 max-w-[680px] text-[15.5px] leading-[1.55]" style={{ color: "var(--fg-2)" }}>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="band pb-12 pt-20 md:pt-28">
      <div className="wrap text-center">
        <Logo size={80} className="mx-auto" />
        <h2 className="h2 mx-auto mt-4 max-w-[620px]">Install a skill once. Use it everywhere.</h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={DOWNLOAD} className="btn btn-primary btn-lg w-full max-w-[280px] sm:w-auto"><ArrowDownToLine size={18} /> Download for macOS</a>
          <a href={REPO} className="btn btn-ghost btn-lg w-full max-w-[280px] sm:w-auto">Read the source <ArrowRight size={16} /></a>
        </div>
        <div className="hair-t mt-20 flex flex-col items-center justify-between gap-3 pt-6 text-[13px] md:flex-row" style={{ color: "var(--fg-2)" }}>
          <span>© 2026 Quiver contributors · MIT License</span>
          <span className="flex items-center gap-1.5"><Trash2 size={13} aria-hidden="true" /> Nothing is ever deleted outright. It goes to the Trash.</span>
          <span className="flex gap-5">
            <a href={REPO} className="navlink">GitHub</a>
            <a href={`${REPO}/issues`} className="navlink">Issues</a>
            <a href="https://agentskills.io" className="navlink">Agent Skills spec</a>
          </span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Film />
        <Problem />
        <How />
        <Features />
        <Agents />
        <Cli />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

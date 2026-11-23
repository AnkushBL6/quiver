import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, Compass, CornerDownLeft, FileText, Grid3x3, HeartPulse, Library, Plus, RefreshCw, Search, Settings, SquarePen, User, Users } from "lucide-react";
import { cx, mod, shortcut, type View } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { AgentAvatar } from "./identity";
import { Kbd } from "./ui";
import { Sheet } from "./overlay";
import { SIDEBAR_ORDER } from "./Sidebar";

interface Cmd {
  id: string;
  group: "Actions" | "Go to" | "Skills" | "Agents";
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useNav();
  return (
    <Sheet open={paletteOpen} onClose={() => setPaletteOpen(false)} width={560} label="Command palette">
      {paletteOpen && <Palette close={() => setPaletteOpen(false)} />}
    </Sheet>
  );
}

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s\-/]/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 1;
  // subsequence match
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 0.5 : 0;
}

function Palette({ close }: { close: () => void }) {
  const { inventory } = useData();
  const { rescan, checkUpdates } = useActions();
  const { go, openInstall, setNewSkillOpen } = useNav();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<Cmd[]>(() => {
    const nav = (view: View, label: string, icon: ReactNode): Cmd => ({
      id: `go:${view}`,
      group: "Go to",
      label,
      icon,
      hint: view === "settings" ? `${mod},` : `${mod}${SIDEBAR_ORDER.indexOf(view) + 1}`,
      run: () => go(view),
    });
    const cmds: Cmd[] = [
      { id: "new", group: "Actions", label: "New Skill…", icon: <SquarePen size={14} />, hint: `${mod}N`, keywords: "create write my own", run: () => setNewSkillOpen(true) },
      { id: "install", group: "Actions", label: "Install Skill…", icon: <Plus size={14} />, hint: shortcut("N", { shift: true }), keywords: "add github", run: () => openInstall() },
      { id: "rescan", group: "Actions", label: "Rescan skill folders", icon: <RefreshCw size={14} />, hint: `${mod}R`, keywords: "refresh reload", run: () => void rescan() },
      { id: "check", group: "Actions", label: "Check for updates", icon: <ArrowDownToLine size={14} />, run: () => { go("updates"); void checkUpdates(true); } },
      { id: "universal", group: "Actions", label: "Make everything universal…", icon: <HeartPulse size={14} />, keywords: "sync adopt health fix", run: () => go("health") },
      nav("library", "Library", <Library size={14} />),
      nav("mine", "My Skills", <User size={14} />),
      nav("discover", "Discover", <Compass size={14} />),
      nav("matrix", "Matrix", <Grid3x3 size={14} />),
      nav("agents", "Agents", <Users size={14} />),
      nav("updates", "Updates", <ArrowDownToLine size={14} />),
      nav("health", "Health", <HeartPulse size={14} />),
      nav("settings", "Settings", <Settings size={14} />),
    ];
    for (const s of inventory?.skills ?? []) {
      cmds.push({
        id: `skill:${s.id}`,
        group: "Skills",
        label: s.name,
        hint: s.source?.source && s.source.kind === "github" ? s.source.source : undefined,
        keywords: `${s.id} ${s.description}`,
        icon: <FileText size={14} />,
        run: () => (s.origin === "mine" ? go("mine", { selectedId: s.id }) : go("library", { selectedId: s.id, filter: "all", agentFilter: null })),
      });
    }
    for (const a of inventory?.agents.filter((x) => x.detected) ?? []) {
      cmds.push({
        id: `agent:${a.id}`,
        group: "Agents",
        label: `${a.name} skills`,
        hint: String(a.skillCount),
        icon: <AgentAvatar id={a.id} name={a.name} size={16} />,
        run: () => go("library", { agentFilter: a.id, filter: "all", selectedId: null }),
      });
    }
    return cmds;
  }, [inventory, go, openInstall, rescan, checkUpdates, setNewSkillOpen]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return all.filter((c) => c.group !== "Skills" && c.group !== "Agents");
    return all
      .map((c) => ({ c, s: Math.max(score(c.label, query) * 2, score(c.keywords ?? "", query) * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.c);
  }, [all, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c) return;
    close();
    c.run();
  };

  let lastGroup = "";
  return (
    <div className="flex max-h-[460px] flex-col">
      <div className="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Search size={17} strokeWidth={2} className="text-fg-3" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search skills, agents and commands"
          spellCheck={false}
          className="h-full flex-1 bg-transparent text-[17px] placeholder:text-fg-3 focus-visible:outline-none"
          aria-label="Command"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runAt(active);
            }
          }}
        />
        <Kbd>esc</Kbd>
      </div>
      <div ref={listRef} className="scroll min-h-0 flex-1 p-1.5" role="listbox">
        {results.length === 0 && <div className="px-3 py-8 text-center text-[12.5px] text-fg-3">No results for “{q}”</div>}
        {results.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-fg-3">{header}</div>}
              <button
                type="button"
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => runAt(i)}
                className={cx(
                  "flex h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px]",
                  i === active ? "row-sel" : "text-fg",
                )}
              >
                <span className="flex w-4 shrink-0 justify-center text-fg-2">{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-[11.5px] text-fg-3">{c.hint}</span>}
                {i === active && <CornerDownLeft size={12} className="shrink-0 text-fg-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

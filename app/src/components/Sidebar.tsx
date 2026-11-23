import { ArrowDownCircle, Compass, Grid3x3, HeartPulse, Library, Plus, RefreshCw, Settings, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { isTauri } from "../lib/api";
import { cx, isWindows, mod, shortcut, type View } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { Badge, Tooltip } from "./ui";

/** Sidebar order defines ⌘1…⌘7 (Ctrl+1…Ctrl+7 on Windows). */
export const SIDEBAR: { group: string | null; items: { view: View; label: string; icon: ReactNode }[] }[] = [
  {
    group: null,
    items: [
      { view: "library", label: "Library", icon: <Library size={15} strokeWidth={1.8} /> },
      { view: "mine", label: "My Skills", icon: <User size={15} strokeWidth={1.8} /> },
      { view: "discover", label: "Discover", icon: <Compass size={15} strokeWidth={1.8} /> },
    ],
  },
  {
    group: "Manage",
    items: [
      { view: "matrix", label: "Matrix", icon: <Grid3x3 size={15} strokeWidth={1.8} /> },
      { view: "agents", label: "Agents", icon: <Users size={15} strokeWidth={1.8} /> },
      { view: "updates", label: "Updates", icon: <ArrowDownCircle size={15} strokeWidth={1.8} /> },
      { view: "health", label: "Health", icon: <HeartPulse size={15} strokeWidth={1.8} /> },
    ],
  },
];
export const SIDEBAR_ORDER: View[] = SIDEBAR.flatMap((g) => g.items.map((i) => i.view));

export function Sidebar() {
  const { inventory, updates, scanning, mySkills } = useData();
  const { rescan } = useActions();
  const { nav, go, openInstall } = useNav();

  const updateCount = updates?.filter((u) => u.status === "available").length ?? 0;
  const issueCount = inventory
    ? inventory.skills.filter((s) => s.issues.some((i) => i.severity !== "info") || (!s.managed && !s.plugin)).length
    : 0;
  const mineCount = inventory?.skills.filter((s) => s.origin === "mine").length ?? 0;
  const dirty = (mySkills?.changes.length ?? 0) > 0;

  const right: Partial<Record<View, ReactNode>> = {
    library: inventory ? <Count n={inventory.skills.length} /> : null,
    mine: (
      <span className="flex items-center gap-1.5">
        {dirty && (
          <Tooltip content={`${mySkills!.changes.length} uncommitted change${mySkills!.changes.length === 1 ? "" : "s"}`} side="right">
            <span aria-label="Uncommitted changes" className="h-[6px] w-[6px] rounded-full bg-[var(--q-glyph-amber)]" />
          </Tooltip>
        )}
        {inventory && mineCount > 0 && <Count n={mineCount} />}
      </span>
    ),
    updates: <Badge count={updateCount} />,
    health: <Badge count={issueCount} />,
  };

  let n = 0;
  return (
    <aside className="sidebar relative flex h-full w-[208px] shrink-0 flex-col">
      {/* Top strip: room for the macOS traffic lights. On Windows the native title bar is
          already above the window, so only a small gap is left. */}
      <div data-tauri-drag-region className={cx("relative shrink-0", isTauri && isWindows ? "h-3" : "h-[52px]")}>
        {!isTauri && <FakeTrafficLights />}
      </div>

      <nav className="scroll flex min-h-0 flex-1 flex-col px-2.5" aria-label="Sections">
        {SIDEBAR.map((g, gi) => (
          <div key={gi} className={cx("flex flex-col gap-px", gi > 0 && "mt-3")}>
            {g.group && (
              <div data-tauri-drag-region className="px-2 pb-1 text-[11px] font-semibold text-fg-3">
                {g.group}
              </div>
            )}
            {g.items.map((it) => {
              n++;
              return (
                <SidebarItem
                  key={it.view}
                  active={nav.view === it.view}
                  icon={it.icon}
                  onClick={() => go(it.view)}
                  right={right[it.view]}
                  shortcut={`${mod}${n}`}
                >
                  {it.label}
                </SidebarItem>
              );
            })}
          </div>
        ))}
        <div className="flex-1" data-tauri-drag-region />
      </nav>

      <div className="flex flex-col gap-px px-2.5 pb-2">
        <SidebarItem icon={<Plus size={15} strokeWidth={1.8} />} onClick={() => openInstall()} shortcut={shortcut("N", { shift: true })}>
          Install Skill…
        </SidebarItem>
        <SidebarItem active={nav.view === "settings"} icon={<Settings size={15} strokeWidth={1.8} />} onClick={() => go("settings")} shortcut={`${mod},`}>
          Settings
        </SidebarItem>
      </div>

      <div className="flex h-[30px] items-center justify-between gap-2 px-4 text-[11px] text-fg-3">
        <span className="truncate tabular-nums">
          {inventory ? `${inventory.stats.agentsDetected} agents · ${inventory.stats.total} skills` : "Scanning…"}
        </span>
        <Tooltip content={`Rescan (${mod}R)`} side="top">
          <button
            type="button"
            aria-label="Rescan"
            onClick={() => void rescan()}
            className="flex h-5 w-5 items-center justify-center rounded text-fg-3 hover:bg-hover hover:text-fg-2"
          >
            <RefreshCw size={11} className={scanning ? "spin" : undefined} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-[12px] text-fg-3 tabular-nums">{n}</span>;
}

function SidebarItem({
  active,
  icon,
  children,
  onClick,
  right,
  shortcut,
}: {
  active?: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  right?: ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${children} (${shortcut})` : undefined}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-[28px] items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-fg",
        active ? "bg-[var(--q-sidebar-sel)]" : "hover:bg-[rgba(0,0,0,0.03)] dark:hover:bg-[rgba(255,255,255,0.03)]",
      )}
    >
      <span className="flex w-[18px] justify-center text-accent">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {right}
    </button>
  );
}

/** Browser-only stand-in for the macOS window controls so screenshots look right. */
function FakeTrafficLights() {
  return (
    <div className="absolute top-[20px] left-[20px] flex gap-2" aria-hidden>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span key={c} className="h-3 w-3 rounded-full" style={{ background: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.18)" }} />
      ))}
    </div>
  );
}

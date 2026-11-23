import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUpCircle, ChevronDown, ChevronRight, Download, ExternalLink, Library as LibraryIcon, Plus, Search, SearchX, Share2, SquarePen, X } from "lucide-react";
import type { Skill } from "../lib/types";
import {
  coverageNote,
  cx,
  groupKey,
  matchesFilter,
  mod,
  shortcut,
  plural,
  problemsOf,
  sourceGroup,
  visibleAgents,
  type SourceGroup,
} from "../lib/ui";
import { usePersistent, useSearchShortcut } from "../lib/hooks";
import { api } from "../lib/api";
import { effectivePresence, useData, useNav } from "../state/store";
import { useSkillActions } from "../state/skillActions";
import { AgentIcon } from "../components/identity";
import { CardGrid, GridSkeleton, GroupIcon, SkillCard, useRovingGrid, type CardInfo } from "../components/SkillGrid";
import { Button, EmptyState, SearchField, Spinner, Toolbar, ToolbarTitle } from "../components/ui";
import { MenuItem, Popover } from "../components/overlay";
import { SkillSheet } from "./SkillDetail";
import { FindSourcesSheet } from "./FindSources";

interface Section {
  key: string;
  group: SourceGroup;
  title: string;
  subtitle?: string;
  skills: Skill[];
}

const ORDER: Record<SourceGroup["kind"], number> = { mine: 0, remote: 1, local: 2, unmanaged: 3, plugin: 4 };
const NO_IDS: string[] = [];

export function LibraryView() {
  const { inventory, updates, overrides, mySkills } = useData();
  const { nav, go, select, openInstall, setNewSkillOpen } = useNav();
  const { remove, update, shareWithAll, byId } = useSkillActions();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useSearchShortcut(searchRef);
  const [collapsed, setCollapsed] = usePersistent<Record<string, boolean>>("library.collapsed", { plugin: true });
  const [findIds, setFindIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const agents = useMemo(() => (inventory ? visibleAgents(inventory.agents) : []), [inventory]);
  const updatable = useMemo(() => new Set(updates?.filter((u) => u.status === "available").map((u) => u.id)), [updates]);
  const agentFilter = nav.agentFilter ? inventory?.agents.find((a) => a.id === nav.agentFilter) : undefined;
  const filter = nav.filter;
  const all = useMemo(() => inventory?.skills ?? [], [inventory]);
  const total = all.length;

  const updateIds = useMemo(() => all.filter((s) => updatable.has(s.id)).map((s) => s.id), [all, updatable]);
  const issueCount = useMemo(() => all.filter((s) => problemsOf(s).length > 0).length, [all]);

  // A toggle whose skills are all dealt with switches itself off.
  useEffect(() => {
    if ((filter === "updates" && updates && !updateIds.length) || (filter === "issues" && inventory && !issueCount)) go("library", { filter: "all" });
  }, [filter, updateIds.length, issueCount, updates, inventory, go]);

  // What each card shows besides its text: update, and which agents see it.
  const info = useMemo(() => {
    const m = new Map<string, CardInfo>();
    for (const s of all) {
      m.set(s.id, { hasUpdate: updatable.has(s.id), coverage: coverageNote(s, agents, (a) => effectivePresence(overrides, s, a)) });
    }
    return m;
  }, [all, updatable, agents, overrides]);

  const searching = q.length > 0 || filter !== "all" || !!agentFilter;
  const sections = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    const sizes = new Map<string, number>();
    for (const s of all) {
      const k = groupKey(sourceGroup(s));
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
    }
    const map = new Map<string, Section>();
    for (const s of all) {
      if (!matchesFilter(s, filter, updatable)) continue;
      if (agentFilter) {
        const p = effectivePresence(overrides, s, agentFilter.id);
        if (p === "absent" || p === "broken") continue;
      }
      if (words.length) {
        const hay = `${s.name} ${s.id} ${s.description} ${s.source?.source ?? ""} ${s.plugin ?? ""} ${s.forkedFrom ?? ""}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      const g = sourceGroup(s);
      const key = groupKey(g);
      let sec = map.get(key);
      if (!sec) {
        sec = { key, group: g, ...sectionText(g, mySkills?.displayDir), skills: [] };
        map.set(key, sec);
      }
      sec.skills.push(s);
    }
    const list = [...map.values()];
    for (const sec of list) sec.skills.sort((a, b) => a.name.localeCompare(b.name));
    // Sources by size (in the whole library, so the order holds while searching), then name.
    return list.sort(
      (a, b) => ORDER[a.group.kind] - ORDER[b.group.kind] || (sizes.get(b.key) ?? 0) - (sizes.get(a.key) ?? 0) || a.title.localeCompare(b.title),
    );
  }, [all, q, filter, agentFilter, updatable, overrides, mySkills?.displayDir]);

  const isCollapsed = useCallback((key: string) => !searching && !!collapsed[key], [searching, collapsed]);
  const order = useMemo(() => sections.flatMap((s) => (isCollapsed(s.key) ? [] : s.skills.map((x) => x.id))), [sections, isCollapsed]);
  const shown = useMemo(() => sections.reduce((n, s) => n + s.skills.length, 0), [sections]);
  const tabbable = activeId && order.includes(activeId) ? activeId : (order[0] ?? null);

  const open = useCallback(
    (id: string) => {
      setActiveId(id);
      select(id);
    },
    [select],
  );
  const focusCard = (id: string) =>
    requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(`[data-card][data-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest" });
    });
  const closeSheet = () => {
    const id = nav.selectedId;
    select(null);
    if (id) {
      setActiveId(id);
      focusCard(id);
    }
  };
  const onDelete = useCallback(
    (id: string) => {
      const s = byId(id);
      if (s) void remove(s);
    },
    [byId, remove],
  );
  const onGridKeys = useRovingGrid(gridRef, onDelete);

  const sheetSkill = nav.selectedId ? (byId(nav.selectedId) ?? null) : null;
  // A deep link or a skill that just got removed: nothing to show.
  useEffect(() => {
    if (inventory && nav.selectedId && !inventory.skills.some((s) => s.id === nav.selectedId)) select(null);
  }, [inventory, nav.selectedId, select]);

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(key));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  };

  const sectionAction = (sec: Section): ReactNode => {
    const g = sec.group;
    if (g.kind === "mine")
      return (
        <SectionAction icon={<SquarePen size={13} />} onClick={() => setNewSkillOpen(true)}>
          New Skill
        </SectionAction>
      );
    if (g.kind === "remote") {
      const ids = all.filter((s) => groupKey(sourceGroup(s)) === sec.key && updatable.has(s.id)).map((s) => s.id);
      if (!ids.length) return null;
      return (
        <SectionAction icon={<ArrowUpCircle size={13} />} busy={busy.has(sec.key)} onClick={() => void withBusy(sec.key, () => update(ids))}>
          Update All ({ids.length})
        </SectionAction>
      );
    }
    if (g.kind === "local")
      return (
        <SectionAction icon={<Search size={13} />} onClick={() => setFindIds(NO_IDS)}>
          Find Sources
        </SectionAction>
      );
    if (g.kind === "unmanaged") {
      const shareable = all.filter(
        (s) => s.origin === "unmanaged" && !s.readOnly && !s.issues.some((i) => i.kind === "conflict" || i.kind === "missingSkillMd"),
      );
      if (!shareable.length) return null;
      return (
        <SectionAction icon={<Share2 size={13} />} busy={busy.has(sec.key)} onClick={() => void withBusy(sec.key, () => shareWithAll(shareable))}>
          Share with All Agents
        </SectionAction>
      );
    }
    return null;
  };

  const attention = updateIds.length > 0 || issueCount > 0 || !!agentFilter;

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--q-canvas)]">
      <Toolbar className="bg-surface">
        <ToolbarTitle sub={inventory ? (searching && shown !== total ? `${shown} of ${plural(total, "skill")}` : plural(total, "skill")) : " "}>Library</ToolbarTitle>
        <div data-tauri-drag-region className="min-w-4 flex-1" />
        <span
          className="w-[clamp(180px,32vw,340px)]"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && tabbable) {
              e.preventDefault();
              focusCard(tabbable);
            }
          }}
        >
          <SearchField
            ref={searchRef}
            large
            value={query}
            onChange={setQuery}
            placeholder="Search skills"
            aria-label="Search skills"
            className="w-full"
          />
        </span>
        <AddMenu onNew={() => setNewSkillOpen(true)} onInstall={() => openInstall()} />
      </Toolbar>

      {attention && (
        <div className="flex min-h-[42px] shrink-0 flex-wrap items-center gap-x-5 gap-y-1 px-6 py-1.5">
          {updateIds.length > 0 && (
            <AttentionItem
              icon={<ArrowUpCircle size={14} strokeWidth={2.1} className="text-accent" />}
              active={filter === "updates"}
              onToggle={() => go("library", { filter: filter === "updates" ? "all" : "updates" })}
              label={`${plural(updateIds.length, "update")} available`}
              action={
                <button
                  type="button"
                  disabled={busy.has("all-updates")}
                  onClick={() => void withBusy("all-updates", () => update(updateIds))}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline disabled:opacity-50"
                >
                  {busy.has("all-updates") && <Spinner size={11} />}
                  Update All
                </button>
              }
            />
          )}
          {issueCount > 0 && (
            <AttentionItem
              icon={<AlertTriangle size={14} strokeWidth={2.1} className="text-[var(--q-glyph-amber)]" />}
              active={filter === "issues"}
              onToggle={() => go("library", { filter: filter === "issues" ? "all" : "issues" })}
              label={`${plural(issueCount, "skill")} need${issueCount === 1 ? "s" : ""} attention`}
              action={
                filter !== "issues" && (
                  <button type="button" onClick={() => go("library", { filter: "issues" })} className="text-[12.5px] font-medium text-accent-text hover:underline">
                    Review
                  </button>
                )
              }
            />
          )}
          {agentFilter && (
            <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-accent-soft pr-1 pl-2 text-[12.5px] text-accent-text">
              <AgentIcon id={agentFilter.id} name={agentFilter.name} size={14} />
              Seen by {agentFilter.name}
              <button
                type="button"
                aria-label={`Stop showing only ${agentFilter.name}'s skills`}
                onClick={() => go("library", { agentFilter: null })}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full hover:bg-accent-soft"
              >
                <X size={11} strokeWidth={2.6} />
              </button>
            </span>
          )}
        </div>
      )}

      <div ref={gridRef} className={cx("@container scroll min-h-0 flex-1", !attention && "pt-1.5")} onKeyDown={onGridKeys} onFocus={(e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")?.dataset.id;
        if (id) setActiveId(id);
      }}>
        {!inventory ? (
          <GridSkeleton />
        ) : total === 0 ? (
          <EmptyState
            className="pt-24"
            icon={<LibraryIcon />}
            title="No Skills Yet"
            action={
              <div className="flex gap-2">
                <Button onClick={() => setNewSkillOpen(true)}>New Skill…</Button>
                <Button variant="primary" onClick={() => openInstall()}>
                  Install a Skill…
                </Button>
              </div>
            }
          >
            Skills teach your coding agents how to do things. Install some from GitHub, or write your own; every agent you use gets them.
          </EmptyState>
        ) : sections.length === 0 ? (
          q ? (
            <EmptyState
              className="pt-24"
              icon={<SearchX />}
              title={`No Results for “${query.trim()}”`}
              action={
                <Button variant="primary" icon={<Search size={13} />} onClick={() => go("discover", { query: query.trim() })}>
                  Search skills.sh for “{query.trim()}”
                </Button>
              }
            >
              Nothing in your library matches. Thousands more skills are a search away.
            </EmptyState>
          ) : (
            <EmptyState
              className="pt-24"
              icon={<SearchX />}
              title={agentFilter ? `${agentFilter.name} Has No Skills` : "Nothing Here"}
              action={<Button onClick={() => go("library", { filter: "all", agentFilter: null })}>Show All Skills</Button>}
            />
          )
        ) : (
          <div className="pb-8">
            {sections.map((sec) => (
              <LibrarySection
                key={sec.key}
                section={sec}
                collapsed={isCollapsed(sec.key)}
                canCollapse={!searching}
                onToggle={() => setCollapsed({ ...collapsed, [sec.key]: !collapsed[sec.key] })}
                action={sectionAction(sec)}
              >
                <CardGrid className="px-6 pb-7">
                  {sec.skills.map((s) => (
                    <SkillCard key={s.id} skill={s} info={info.get(s.id)!} tabbable={s.id === tabbable} onOpen={open} />
                  ))}
                </CardGrid>
              </LibrarySection>
            ))}
          </div>
        )}
      </div>

      <SkillSheet
        skill={sheetSkill}
        order={order}
        onNavigate={(id) => {
          setActiveId(id);
          select(id);
        }}
        onClose={closeSheet}
        onFindSource={setFindIds}
      />
      <FindSourcesSheet ids={findIds} onClose={() => setFindIds(null)} />
    </div>
  );
}

function sectionText(g: SourceGroup, mineDir: string | undefined): { title: string; subtitle?: string } {
  switch (g.kind) {
    case "mine":
      return { title: "Yours", subtitle: mineDir ?? "~/Skills" };
    case "remote":
      return { title: g.source };
    case "local":
      return { title: "Added by hand", subtitle: "No source recorded, so these don't get updates." };
    case "unmanaged":
      return { title: "Only in one agent", subtitle: "Not shared yet" };
    case "plugin":
      return { title: "From plugins", subtitle: "Read-only" };
  }
}

function LibrarySection({
  section,
  collapsed,
  canCollapse,
  onToggle,
  action,
  children,
}: {
  section: Section;
  collapsed: boolean;
  canCollapse: boolean;
  onToggle: () => void;
  action: ReactNode;
  children: ReactNode;
}) {
  const { group, title, subtitle, skills } = section;
  const id = `section-${section.key.replace(/[^a-z0-9]/gi, "-")}`;
  const titleNode = (
    <h2 id={id} className="truncate text-[15px] leading-5 font-semibold tracking-[-0.012em]">
      {title}
    </h2>
  );
  return (
    <section aria-labelledby={id} className="lazy-section">
      <div className="section-bar sticky top-0 z-10 flex h-[52px] items-center gap-2 px-6">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${title}` : `Hide ${title}`}
          disabled={!canCollapse}
          onClick={onToggle}
          className="-ml-1.5 flex h-[30px] shrink-0 items-center gap-1.5 rounded-[7px] pr-1 pl-1 hover:bg-hover disabled:hover:bg-transparent"
        >
          <ChevronRight size={13} strokeWidth={2.6} className={cx("text-fg-3 transition-transform duration-150", !collapsed && "rotate-90", !canCollapse && "opacity-40")} />
          <GroupIcon group={group} size={24} />
        </button>
        <div className="flex min-w-0 items-baseline gap-2">
          {group.kind === "remote" && group.url ? (
            <button
              type="button"
              onClick={() => void api.openPath(group.url!).catch(() => window.open(group.url!, "_blank"))}
              className="group/link flex min-w-0 items-center gap-1 rounded hover:text-accent-text"
              title={`Open ${group.url.replace(/^https:\/\//, "")}`}
            >
              {titleNode}
              <ExternalLink size={11.5} strokeWidth={2.2} className="shrink-0 self-center text-fg-3 opacity-0 transition-opacity group-hover/link:opacity-100" />
            </button>
          ) : (
            <button type="button" onClick={onToggle} disabled={!canCollapse} className="min-w-0 text-left">
              {titleNode}
            </button>
          )}
          <span className="shrink-0 text-[13px] text-fg-3 tabular-nums">{skills.length}</span>
          {subtitle && <span className="hidden min-w-0 truncate text-[12.5px] text-fg-3 @min-[560px]:inline">{subtitle}</span>}
        </div>
        <div className="min-w-2 flex-1" />
        {action}
      </div>
      {!collapsed && children}
    </section>
  );
}

function SectionAction({ icon, children, onClick, busy }: { icon: ReactNode; children: ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-[12.5px] font-medium text-accent-text hover:bg-accent-soft disabled:opacity-60"
    >
      {busy ? <Spinner size={12} className="text-accent-text" /> : icon}
      {children}
    </button>
  );
}

function AttentionItem({
  icon,
  label,
  active,
  onToggle,
  action,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        title={active ? "Show all skills" : "Show only these"}
        className={cx(
          "inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px]",
          active ? "bg-accent-soft text-accent-text" : "-mr-1.5 -ml-2.5 text-fg hover:bg-hover",
        )}
      >
        {icon}
        {label}
        {active && <X size={11} strokeWidth={2.6} className="ml-0.5" />}
      </button>
      {action && (
        <>
          <span className="text-fg-3" aria-hidden>
            ·
          </span>
          {action}
        </>
      )}
    </span>
  );
}

function AddMenu({ onNew, onInstall }: { onNew: () => void; onInstall: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <Button ref={ref} size="lg" icon={<Plus size={14} strokeWidth={2.2} />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="ml-1.5">
        Add
        <ChevronDown size={12} strokeWidth={2.4} className="-mr-0.5 text-fg-2" />
      </Button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" className="w-[250px]">
        <MenuItem icon={<SquarePen size={13} />} hint={`${mod}N`} onSelect={pick(onNew)}>
          New Skill…
        </MenuItem>
        <MenuItem icon={<Download size={13} />} hint={shortcut("N", { shift: true })} onSelect={pick(onInstall)}>
          Install from GitHub or File…
        </MenuItem>
      </Popover>
    </>
  );
}

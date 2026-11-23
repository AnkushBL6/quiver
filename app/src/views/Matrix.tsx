import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { AlertTriangle, Grid3x3, Link2, MoreHorizontal, SearchX, Unlink } from "lucide-react";
import type { AgentInfo, Presence, Skill } from "../lib/types";
import { PRESENCE, cx, middleTruncate, visibleAgents } from "../lib/ui";
import { effectivePresence, overrideKey, useActions, useData, useNav } from "../state/store";
import { AgentAvatar, PresenceDot, presenceStyle } from "../components/identity";
import { EmptyState, SearchField, Segmented, Skeleton, Toolbar, ToolbarTitle, TooltipBubble } from "../components/ui";
import { MenuItem, MenuLabel, MenuSeparator, Popover, useConfirm } from "../components/overlay";
import { useSearchShortcut } from "../lib/hooks";

const ROW = 34;
const HEADER = 124;
const NAME_W = 280;
const COL = 40;
const END_W = 84;
const OVERSCAN = 8;

type Scope = "all" | "managed" | "unmanaged";

function cellState(skill: Skill, agent: AgentInfo, p: Presence) {
  const meta = PRESENCE[p];
  const locked = skill.readOnly || !meta.toggleable || (agent.readsCanonical && skill.managed);
  return { on: meta.on, locked };
}

export function MatrixView() {
  const { inventory, overrides } = useData();
  const { toggleLink, toggleAll, bulkAgent } = useActions();
  const { go } = useNav();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const q = useDeferredValue(query.trim().toLowerCase());
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  const agents = useMemo(() => (inventory ? visibleAgents(inventory.agents) : []), [inventory]);
  const rows = useMemo(() => {
    if (!inventory) return [];
    return inventory.skills.filter((s) => {
      if (scope === "managed" && !s.managed) return false;
      if (scope === "unmanaged" && (s.managed || s.plugin)) return false;
      if (!q) return true;
      return `${s.name} ${s.id} ${s.source?.source ?? ""}`.toLowerCase().includes(q);
    });
  }, [inventory, q, scope]);

  // Virtualisation
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport((v) => ({ ...v, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, [inventory]);
  const raf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) setViewport({ top: el.scrollTop, height: el.clientHeight });
    });
    setHover(null);
  };
  const bodyTop = Math.max(0, viewport.top - HEADER);
  const start = Math.max(0, Math.floor(bodyTop / ROW) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((bodyTop + viewport.height) / ROW) + OVERSCAN);
  const width = NAME_W + agents.length * COL + END_W;

  // One delegated tooltip for the whole grid.
  const [hover, setHover] = useState<{ row: number; col: number; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const onPointerOver = (e: PointerEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    clearTimeout(hoverTimer.current);
    if (!cell) {
      setHover(null);
      setHoverCol(null);
      return;
    }
    const [r, c] = cell.dataset.cell!.split(":").map(Number);
    setHoverCol(c);
    const rect = cell.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHover({ row: r, col: c, rect }), hover ? 0 : 380);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const onCell = useCallback(
    (skill: Skill, agent: AgentInfo, p: Presence) => {
      const { on, locked } = cellState(skill, agent, p);
      if (locked) return;
      void toggleLink(skill.id, agent.id, !on);
    },
    [toggleLink],
  );

  // Menus
  const menuAnchor = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<{ type: "col"; agent: AgentInfo } | { type: "row"; skill: Skill } | null>(null);
  const openMenu = (el: HTMLElement, m: NonNullable<typeof menu>) => {
    menuAnchor.current = el;
    setMenu(m);
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const colTargets = (agent: AgentInfo, enabled: boolean) =>
    rows
      .filter((s) => !s.issues.some((i) => i.kind === "conflict"))
      .filter((s) => {
        const p = effectivePresence(overrides, s, agent.id);
        const { on, locked } = cellState(s, agent, p);
        if (locked) return false;
        return enabled ? !on : p === "linked" || p === "copied";
      })
      .map((s) => s.id);

  const bulkCol = async (agent: AgentInfo, enabled: boolean) => {
    closeMenu();
    const ids = colTargets(agent, enabled);
    if (!enabled && ids.length > 3) {
      const ok = await confirm({
        title: `Unlink ${ids.length} skills from ${agent.name}?`,
        message: `${agent.name} will stop seeing them. The skills stay in ~/.agents/skills and other agents keep them.`,
        confirmLabel: "Unlink",
        destructive: true,
      });
      if (!ok) return;
    }
    void bulkAgent(agent.id, ids, enabled);
  };

  if (!inventory) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar>
          <ToolbarTitle>Matrix</ToolbarTitle>
        </Toolbar>
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      </div>
    );
  }

  const hovered = hover ? { skill: rows[hover.row], agent: agents[hover.col] } : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar>
        <ToolbarTitle sub={`${rows.length} skills × ${agents.length} agents`}>Matrix</ToolbarTitle>
        <div data-tauri-drag-region className="flex-1" />
        <Segmented<Scope>
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All" },
            { value: "managed", label: "Managed" },
            { value: "unmanaged", label: "Unmanaged" },
          ]}
        />
        <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Filter skills" width={200} aria-label="Filter skills" />
      </Toolbar>

      {inventory.skills.length === 0 || agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center bg-surface">
          <EmptyState icon={<Grid3x3 size={20} />} title={agents.length === 0 ? "No agents detected" : "No skills yet"}>
            {agents.length === 0
              ? "Install a coding agent, or unhide one in Settings, to see it here."
              : "Install a skill and it shows up here, one row per skill and one column per agent."}
          </EmptyState>
        </div>
      ) : (
        <div
          ref={scroller}
          onScroll={onScroll}
          onPointerOver={onPointerOver}
          onPointerLeave={() => {
            clearTimeout(hoverTimer.current);
            setHover(null);
            setHoverCol(null);
          }}
          className="scroll relative min-h-0 flex-1 bg-surface"
        >
          <div style={{ width, minWidth: "100%" }}>
            {/* Column headers */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: HEADER, width }}>
              <div
                className="sticky left-0 z-30 flex shrink-0 items-end border-r border-line bg-surface px-4 pb-2.5 text-[12px] font-semibold text-fg-2"
                style={{ width: NAME_W }}
              >
                Skill
              </div>
              {agents.map((a, c) => (
                <button
                  key={a.id}
                  type="button"
                  title={`${a.name}: link or unlink every skill shown`}
                  onClick={(e) => openMenu(e.currentTarget, { type: "col", agent: a })}
                  className={cx(
                    "group flex shrink-0 flex-col items-center justify-end gap-1.5 pb-2 transition-colors duration-75",
                    hoverCol === c || (menu?.type === "col" && menu.agent.id === a.id) ? "bg-row-hover" : "hover:bg-row-hover",
                  )}
                  style={{ width: COL }}
                >
                  <span
                    className={cx(
                      "max-h-[84px] overflow-hidden text-[11.5px] font-medium text-ellipsis whitespace-nowrap",
                      hoverCol === c ? "text-fg" : "text-fg-2",
                    )}
                    style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                  >
                    {a.name}
                  </span>
                  <AgentAvatar id={a.id} name={a.name} size={18} />
                </button>
              ))}
              <div className="flex shrink-0 items-end justify-end px-3 pb-2.5 text-[12px] font-semibold text-fg-2" style={{ width: END_W }}>
                Reach
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState icon={<SearchX size={20} />} title="No matching skills" className="sticky left-0 w-[min(100%,600px)]">
                Try a different filter.
              </EmptyState>
            ) : (
              <div className="relative" style={{ height: rows.length * ROW }}>
                {rows.slice(start, end).map((s, k) => {
                  const r = start + k;
                  return (
                    <MatrixRow
                      key={s.id}
                      index={r}
                      skill={s}
                      agents={agents}
                      overrides={overrides}
                      width={width}
                      onCell={onCell}
                      onOpen={() => go("library", { selectedId: s.id, filter: "all", agentFilter: null })}
                      onMenu={(el) => openMenu(el, { type: "row", skill: s })}
                      menuOpen={menu?.type === "row" && menu.skill.id === s.id}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <Legend />

      {hover && hovered?.skill && hovered.agent && (
        <TooltipBubble rect={hover.rect} side="top" content={<CellTip skill={hovered.skill} agent={hovered.agent} />} />
      )}

      <Popover anchor={menuAnchor} open={!!menu} onClose={closeMenu} align={menu?.type === "row" ? "end" : "center"}>
        {menu?.type === "col" && (
          <>
            <MenuLabel>{menu.agent.name}</MenuLabel>
            <MenuItem icon={<Link2 size={14} />} hint={colTargets(menu.agent, true).length} disabled={!colTargets(menu.agent, true).length} onSelect={() => void bulkCol(menu.agent, true)}>
              Link every skill shown
            </MenuItem>
            <MenuItem icon={<Unlink size={14} />} hint={colTargets(menu.agent, false).length} disabled={!colTargets(menu.agent, false).length} onSelect={() => void bulkCol(menu.agent, false)}>
              Unlink every skill shown
            </MenuItem>
            {menu.agent.readsCanonical && (
              <div className="max-w-[230px] px-2 pt-1.5 pb-1 text-[11px] leading-snug text-fg-3">
                {menu.agent.name} reads ~/.agents/skills directly, so managed skills are always visible.
              </div>
            )}
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                closeMenu();
                go("library", { agentFilter: menu.agent.id, filter: "all", selectedId: null });
              }}
            >
              Show in Library
            </MenuItem>
          </>
        )}
        {menu?.type === "row" && (
          <>
            <MenuLabel>{menu.skill.name}</MenuLabel>
            <MenuItem
              icon={<Link2 size={14} />}
              disabled={menu.skill.readOnly}
              onSelect={() => {
                closeMenu();
                void toggleAll(menu.skill.id, true);
              }}
            >
              Link to every agent
            </MenuItem>
            <MenuItem
              icon={<Unlink size={14} />}
              disabled={menu.skill.readOnly}
              onSelect={() => {
                closeMenu();
                void toggleAll(menu.skill.id, false);
              }}
            >
              Unlink from every agent
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                closeMenu();
                go("library", { selectedId: menu.skill.id, filter: "all", agentFilter: null });
              }}
            >
              Open details
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  );
}

const MatrixRow = memo(function MatrixRow({
  index,
  skill,
  agents,
  overrides,
  width,
  onCell,
  onOpen,
  onMenu,
  menuOpen,
}: {
  index: number;
  skill: Skill;
  agents: AgentInfo[];
  overrides: Map<string, Presence>;
  width: number;
  onCell: (s: Skill, a: AgentInfo, p: Presence) => void;
  onOpen: () => void;
  onMenu: (el: HTMLElement) => void;
  menuOpen: boolean;
}) {
  let reach = 0;
  const cells = agents.map((a) => {
    const p = effectivePresence(overrides, skill, a.id);
    if (PRESENCE[p].on) reach++;
    return p;
  });
  const issue = skill.issues.find((i) => i.severity === "error") ?? skill.issues.find((i) => i.severity === "warning");
  return (
    <div
      className="group absolute left-0 flex border-b border-line hover:bg-row-hover"
      style={{ top: index * ROW, height: ROW, width }}
    >
      <button
        type="button"
        onClick={onOpen}
        title={skill.name}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface px-4 text-left group-hover:bg-row-hover"
        style={{ width: NAME_W }}
      >
        <span className={cx("truncate text-[12.5px]", skill.managed ? "text-fg" : "text-fg-2")}>{middleTruncate(skill.name, skill.managed || skill.plugin ? 38 : 26)}</span>
        {issue && <AlertTriangle size={11} className={cx("shrink-0", issue.severity === "error" ? "text-red" : "text-amber")} />}
      </button>
      {agents.map((a, c) => {
        const p = cells[c];
        const { on, locked } = cellState(skill, a, p);
        const pending = overrides.has(overrideKey(skill.id, a.id));
        return (
          <div key={a.id} className="flex shrink-0 items-center justify-center" style={{ width: COL }}>
            <button
              type="button"
              data-cell={`${index}:${c}`}
              aria-label={`${skill.name} in ${a.name}: ${PRESENCE[p].label}`}
              aria-pressed={on}
              aria-disabled={locked}
              onClick={() => onCell(skill, a, p)}
              className={cx(
                "group flex h-[22px] w-[22px] items-center justify-center rounded-[6px]",
                locked ? "cursor-default" : "hover:bg-hover",
                pending && "animate-pulse",
              )}
            >
              <span
                className={cx(
                  "block h-[12px] w-[12px] rounded-[4px] transition-[transform,box-shadow,background-color] duration-100 ease-out",
                  !locked && "group-active:scale-90",
                  !on && !locked && "group-hover:shadow-[inset_0_0_0_1.5px_var(--p-native-ring)]",
                )}
                style={presenceStyle(p)}
              />
            </button>
          </div>
        );
      })}
      <div className="flex shrink-0 items-center justify-end gap-1 pr-2 pl-3" style={{ width: END_W }}>
        <span className={cx("text-[11.5px] tabular-nums", reach === 0 ? "text-fg-3" : "text-fg-2")}>
          {reach}/{agents.length}
        </span>
        <button
          type="button"
          aria-label={`Bulk actions for ${skill.name}`}
          onClick={(e) => onMenu(e.currentTarget)}
          className={cx(
            "flex h-6 w-6 items-center justify-center rounded-md text-fg-3 hover:bg-press hover:text-fg",
            menuOpen ? "bg-press opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
});

function CellTip({ skill, agent }: { skill: Skill; agent: AgentInfo }) {
  const { overrides } = useData();
  const p = effectivePresence(overrides, skill, agent.id);
  const { on, locked } = cellState(skill, agent, p);
  return (
    <div className="max-w-[240px]">
      <div className="font-medium">
        {agent.name} · {PRESENCE[p].label}
      </div>
      <div className="mt-0.5 text-white/70">
        {skill.readOnly
          ? "Plugin skills are read-only."
          : agent.readsCanonical && skill.managed
            ? `${agent.name} reads ~/.agents/skills directly.`
            : PRESENCE[p].help}
      </div>
      {!locked && <div className="mt-1 text-white/50">Click to {on ? "unlink" : p === "broken" ? "repair" : "link"}</div>}
    </div>
  );
}

const LEGEND: Presence[] = ["linked", "native", "copied", "local", "foreign", "broken", "plugin", "absent"];

function Legend() {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 overflow-x-auto border-t border-line bg-surface px-4 text-[11px] text-fg-2">
      {LEGEND.map((p) => (
        <span key={p} className="flex shrink-0 items-center gap-1.5" title={PRESENCE[p].help}>
          <PresenceDot presence={p} size={10} />
          {PRESENCE[p].label}
        </span>
      ))}
    </div>
  );
}

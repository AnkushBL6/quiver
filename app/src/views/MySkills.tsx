import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Folder, GitBranch, GitCommitHorizontal, SquarePen, TerminalSquare, User } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { GitChange, MySkillsStatus } from "../lib/types";
import { coverageNote, cx, enterKey, fileManager, isWindows, mod, plural, timeAgo, visibleAgents } from "../lib/ui";
import { effectivePresence, useActions, useData, useNav } from "../state/store";
import { useSkillActions } from "../state/skillActions";
import { GitHubMark } from "../components/identity";
import { Button, Checkbox, EmptyState, IconButton, Skeleton, Spinner, TextArea, Toolbar, ToolbarTitle, Tooltip } from "../components/ui";
import { CardGrid, SkillCard, useRovingGrid, type CardInfo } from "../components/SkillGrid";
import { SkillSheet } from "./SkillDetail";

export function MySkillsView() {
  const { inventory, mySkills, overrides } = useData();
  const { nav, select, setNewSkillOpen } = useNav();
  const { remove, byId, reveal } = useSkillActions();
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const agents = useMemo(() => (inventory ? visibleAgents(inventory.agents) : []), [inventory]);
  // Most recently edited first: that's what you come back to.
  const skills = useMemo(
    () =>
      inventory
        ? inventory.skills.filter((s) => s.origin === "mine").sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0) || a.name.localeCompare(b.name))
        : null,
    [inventory],
  );
  const info = useMemo(() => {
    const m = new Map<string, CardInfo>();
    for (const s of skills ?? []) m.set(s.id, { hasUpdate: false, coverage: coverageNote(s, agents, (a) => effectivePresence(overrides, s, a)) });
    return m;
  }, [skills, agents, overrides]);
  const order = useMemo(() => skills?.map((s) => s.id) ?? [], [skills]);
  const tabbable = activeId && order.includes(activeId) ? activeId : (order[0] ?? null);
  const onDelete = useCallback(
    (id: string) => {
      const s = byId(id);
      if (s) void remove(s);
    },
    [byId, remove],
  );
  const onGridKeys = useRovingGrid(gridRef, onDelete);
  const open = useCallback(
    (id: string) => {
      setActiveId(id);
      select(id);
    },
    [select],
  );
  const closeSheet = () => {
    const id = nav.selectedId;
    select(null);
    if (id)
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-card][data-id="${CSS.escape(id)}"]`)?.focus());
  };

  const selected = skills?.find((s) => s.id === nav.selectedId) ?? null;
  useEffect(() => {
    if (skills && nav.selectedId && !selected) select(null);
  }, [skills, nav.selectedId, selected, select]);
  const st = mySkills;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <Toolbar>
          <ToolbarTitle sub={st ? [st.displayDir, st.branch].filter(Boolean).join(" · ") : " "}>My Skills</ToolbarTitle>
          <div data-tauri-drag-region className="flex-1" />
          {st?.isRepo && <SyncButtons st={st} />}
          <IconButton label={`New Skill (${mod}N)`} onClick={() => setNewSkillOpen(true)}>
            <SquarePen size={15} strokeWidth={1.8} />
          </IconButton>
        </Toolbar>

        {!st ? (
          <div className="p-5">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !st.exists ? (
          <Setup st={st} />
        ) : (
          <>
            <RepoBar st={st} onReveal={() => reveal(st.dir)} />
            {st.problem && (
              <Notice icon={<AlertTriangle size={14} className="text-amber" />}>
                {st.problem} Choose another folder in Settings.
              </Notice>
            )}
            {!st.gitAvailable ? (
              <Notice icon={<TerminalSquare size={14} />}>
                Git isn't installed, so changes to {st.displayDir} aren't versioned.{" "}
                {isWindows ? (
                  <>
                    Install Git for Windows with <code className="font-mono text-[11px]">winget install Git.Git</code> (or from git-scm.com), then reopen Quiver.
                  </>
                ) : (
                  <>
                    Install the Xcode Command Line Tools with <code className="font-mono text-[11px]">xcode-select --install</code>, then reopen Quiver.
                  </>
                )}
              </Notice>
            ) : !st.isRepo ? (
              <InitRepo st={st} />
            ) : (
              <Changes st={st} />
            )}
            <div
              ref={gridRef}
              className="scroll min-h-0 flex-1 bg-[var(--q-canvas)]"
              onKeyDown={onGridKeys}
              onFocus={(e) => {
                const id = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")?.dataset.id;
                if (id) setActiveId(id);
              }}
            >
              {skills && skills.length === 0 ? (
                <EmptyState
                  className="pt-20"
                  icon={<User />}
                  title="No Skills Yet"
                  action={
                    <Button variant="primary" onClick={() => setNewSkillOpen(true)}>
                      New Skill…
                    </Button>
                  }
                >
                  Write your own skill, or open an installed one and choose Make It Mine. Folders you drop into {st.displayDir} show up here too.
                </EmptyState>
              ) : (
                <>
                  <div className="flex h-[44px] items-center px-6 pt-1">
                    <span className="text-[13px] font-semibold text-fg-2">
                      Skills <span className="font-normal text-fg-3 tabular-nums">{skills?.length ?? ""}</span>
                    </span>
                  </div>
                  <CardGrid className="px-6 pb-8">
                    {skills?.map((s) => <SkillCard key={s.id} skill={s} info={info.get(s.id)!} tabbable={s.id === tabbable} onOpen={open} />)}
                  </CardGrid>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <SkillSheet skill={selected} order={order} onNavigate={open} onClose={closeSheet} />
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function RepoBar({ st, onReveal }: { st: MySkillsStatus; onReveal: () => void }) {
  const openUrl = (url: string) => void api.openPath(url).catch(() => window.open(url, "_blank"));
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
      <Folder size={28} strokeWidth={1.3} className="shrink-0 fill-[color-mix(in_srgb,var(--q-accent)_28%,transparent)] text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{st.displayDir}</span>
          <button type="button" onClick={onReveal} className="shrink-0 text-[12px] text-accent-text hover:underline">
            Reveal in {fileManager}
          </button>
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-2">
          {st.isRepo && st.branch && (
            <span className="inline-flex items-center gap-1">
              <GitBranch size={11} /> {st.branch}
            </span>
          )}
          {st.githubRepo ? (
            <button type="button" onClick={() => openUrl(`https://github.com/${st.githubRepo}`)} className="inline-flex items-center gap-1 hover:text-fg">
              <GitHubMark size={11} /> {st.githubRepo}
            </button>
          ) : st.remote ? (
            <span className="truncate">{st.remote}</span>
          ) : st.isRepo ? (
            <span className="text-fg-3">No remote</span>
          ) : null}
          {st.isRepo && st.remote && (st.ahead > 0 || st.behind > 0) && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {st.ahead > 0 && (
                <span className="inline-flex items-center" title={`${plural(st.ahead, "commit")} to push`}>
                  <ArrowUp size={10} strokeWidth={2.4} />
                  {st.ahead}
                </span>
              )}
              {st.behind > 0 && (
                <span className="inline-flex items-center" title={`${plural(st.behind, "commit")} to pull`}>
                  <ArrowDown size={10} strokeWidth={2.4} />
                  {st.behind}
                </span>
              )}
            </span>
          )}
          {st.lastCommit && (
            <span className="min-w-0 truncate text-fg-3">
              {timeAgo(st.lastCommit.whenMs)}: {st.lastCommit.subject}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SyncButtons({ st }: { st: MySkillsStatus }) {
  const { refreshMySkills, rescan } = useActions();
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const go = async (which: "pull" | "push") => {
    setBusy(which);
    try {
      const msg = which === "pull" ? await api.mySkillsPull() : await api.mySkillsPush();
      toast(msg);
      await Promise.all([refreshMySkills(), which === "pull" ? rescan({ quiet: true }) : null]);
    } catch (e) {
      toast.error(which === "pull" ? "Couldn't pull" : "Couldn't push", { description: errorMessage(e) });
    }
    setBusy(null);
  };
  const noRemote = !st.remote;
  return (
    <>
      <IconButton label={noRemote ? "Pull (no remote)" : `Pull${st.behind ? ` ${plural(st.behind, "commit")}` : ""}`} disabled={noRemote || !!busy} onClick={() => void go("pull")}>
        {busy === "pull" ? <Spinner size={14} /> : <Counted n={st.behind} icon={<ArrowDown size={15} strokeWidth={1.8} />} />}
      </IconButton>
      <IconButton label={noRemote ? "Push (no remote)" : `Push${st.ahead ? ` ${plural(st.ahead, "commit")}` : ""}`} disabled={noRemote || !!busy} onClick={() => void go("push")}>
        {busy === "push" ? <Spinner size={14} /> : <Counted n={st.ahead} icon={<ArrowUp size={15} strokeWidth={1.8} />} />}
      </IconButton>
    </>
  );
}

function Counted({ n, icon }: { n: number; icon: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {icon}
      {n > 0 && <span className="text-[11px] tabular-nums">{n}</span>}
    </span>
  );
}

// ── Changes + commit ─────────────────────────────────────────────────────────

const STATUS: Record<string, { letter: string; label: string; cls: string }> = {
  M: { letter: "M", label: "Modified", cls: "text-fg-2" },
  A: { letter: "A", label: "Added", cls: "text-green" },
  "??": { letter: "A", label: "New", cls: "text-green" },
  D: { letter: "D", label: "Deleted", cls: "text-red" },
  R: { letter: "R", label: "Renamed", cls: "text-fg-2" },
};

function Changes({ st }: { st: MySkillsStatus }) {
  const { inventory } = useData();
  const { refreshMySkills, rescan } = useActions();
  const [message, setMessage] = useState("");
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, GitChange[]>();
    for (const c of st.changes) {
      const k = c.skillId ?? "";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [st.changes]);

  if (!st.changes.length) {
    return (
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line px-5 text-[12px] text-fg-3">
        <GitCommitHorizontal size={13} />
        No uncommitted changes
      </div>
    );
  }

  const skillKeys = groups.map(([k]) => k).filter((k) => k !== "");
  const everything = unchecked.size === 0;
  const ids = everything ? [] : skillKeys.filter((k) => !unchecked.has(k));
  const nothing = !everything && ids.length === 0;
  const fileCount = everything
    ? st.changes.length
    : st.changes.filter((c) => c.skillId && ids.includes(c.skillId)).length;
  const nameOf = (id: string) => inventory?.skills.find((s) => s.id === id)?.name ?? id;

  const commit = async () => {
    if (!message.trim() || nothing || busy) return;
    setBusy(true);
    try {
      const hash = await api.mySkillsCommit(message.trim(), ids);
      toast(`Committed ${plural(fileCount, "file")}`, { description: `${hash} ${message.trim().split("\n")[0]}` });
      setMessage("");
      setUnchecked(new Set());
      await Promise.all([refreshMySkills(), rescan({ quiet: true })]);
    } catch (e) {
      toast.error("Couldn't commit", { description: errorMessage(e) });
    }
    setBusy(false);
  };

  return (
    <div className="shrink-0 border-b border-line px-5 py-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-ml-1 flex items-center gap-1 rounded px-1 text-[12px] font-semibold text-fg-2 hover:text-fg"
      >
        <ChevronRight size={11} strokeWidth={2.6} className={cx("text-fg-3 transition-transform duration-150", open && "rotate-90")} />
        Uncommitted Changes <span className="font-normal text-fg-3 tabular-nums">{st.changes.length}</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] gap-4">
          <div className="scroll max-h-[148px] pr-1">
            {groups.map(([k, files]) => {
              const other = k === "";
              const checked = other ? everything : !unchecked.has(k);
              return (
                <div key={k || "_other"} className="mb-1.5">
                  <div className="flex h-[20px] items-center gap-2">
                    <Tooltip content={other && !everything ? "Files outside a skill folder are committed only with everything." : ""}>
                      <span>
                        <Checkbox
                          checked={checked}
                          disabled={other}
                          label={other ? "Other files" : `Include ${nameOf(k)}`}
                          onChange={(v) =>
                            setUnchecked((u) => {
                              const n = new Set(u);
                              if (v) n.delete(k);
                              else n.add(k);
                              return n;
                            })
                          }
                        />
                      </span>
                    </Tooltip>
                    <span className={cx("truncate text-[12.5px]", other && "text-fg-2")}>{other ? "Other files" : nameOf(k)}</span>
                  </div>
                  {files.map((f) => {
                    const s = STATUS[f.status] ?? { letter: f.status, label: f.status, cls: "text-fg-2" };
                    const rel = f.skillId && f.path.startsWith(`${f.skillId}/`) ? f.path.slice(f.skillId.length + 1) || "(folder)" : f.path;
                    return (
                      <div key={f.path} className="flex h-[18px] items-center gap-2 pl-[22px] text-[11.5px]">
                        <span title={s.label} className={cx("w-3 text-center font-mono text-[10.5px] font-semibold", s.cls)}>
                          {s.letter}
                        </span>
                        <span className="truncate font-mono text-[11px] text-fg-2">{rel}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <TextArea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
              placeholder="Commit message"
              aria-label="Commit message"
              rows={3}
              className="h-[66px] w-full text-[12.5px]"
            />
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-[11px] text-fg-3 tabular-nums">{nothing ? "Nothing selected" : plural(fileCount, "file")}</span>
              <Button type="submit" variant="primary" disabled={!message.trim() || nothing} loading={busy}>
                Commit <span className="opacity-70">{mod}{enterKey}</span>
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Empty states ─────────────────────────────────────────────────────────────

function Setup({ st }: { st: MySkillsStatus }) {
  const { setMySkills, rescan } = useActions();
  const [busy, setBusy] = useState(false);
  const init = async () => {
    setBusy(true);
    try {
      setMySkills(await api.mySkillsInit());
      await rescan({ quiet: true });
      toast(`Created ${st.displayDir}`);
    } catch (e) {
      toast.error(`Couldn't create ${st.displayDir}`, { description: errorMessage(e) });
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={<Folder />}
        title="Keep Your Own Skills in One Place"
        action={
          <Button variant="primary" size="lg" loading={busy} onClick={() => void init()}>
            Create {st.displayDir}
          </Button>
        }
      >
        Quiver keeps the skills you write in {st.displayDir}, a folder you own{st.gitAvailable ? " and version with git" : ""}. Every agent sees them, and
        updates never touch them. You can choose another folder in Settings.
      </EmptyState>
    </div>
  );
}

function InitRepo({ st }: { st: MySkillsStatus }) {
  const { setMySkills } = useActions();
  const [busy, setBusy] = useState(false);
  return (
    <Notice
      icon={<GitBranch size={14} />}
      action={
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setMySkills(await api.mySkillsInit());
              toast(`${st.displayDir} is now a git repository`);
            } catch (e) {
              toast.error("Couldn't initialise the repository", { description: errorMessage(e) });
            }
            setBusy(false);
          }}
        >
          Turn into Git Repo
        </Button>
      }
    >
      {st.displayDir} isn't a git repository yet. Turn it into one to track changes and sync with GitHub.
    </Notice>
  );
}

function Notice({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-2.5 text-[12px] leading-snug text-fg-2">
      <span className="shrink-0 text-fg-3">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

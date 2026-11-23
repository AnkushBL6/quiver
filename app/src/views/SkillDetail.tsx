// The skill sheet: a large, readable sheet over the Library (and My Skills).
// SKILL.md is the hero; actions, problems, agents, files and details sit around it.

import { useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type ReactNode, type TableHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  GitCompareArrows,
  MoreHorizontal,
  Pencil,
  Pin,
  Search,
  Share2,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { AgentInfo, Issue, PinRef, Skill, SkillDetail } from "../lib/types";
import {
  PRESENCE,
  canPin,
  cx,
  fileManager,
  formatBytes,
  isRemoveKey,
  isVisible,
  joinPath,
  listNames,
  plural,
  pluginName,
  problemsOf,
  removeHint,
  sourceGroup,
  tildify,
  trashName,
  visibleAgents,
} from "../lib/ui";
import { usePersistent } from "../lib/hooks";
import { effectivePresence, useActions, useData, useNav } from "../state/store";
import { useSkillActions } from "../state/skillActions";
import { AgentIcon } from "../components/identity";
import { GroupIcon } from "../components/SkillGrid";
import { Button, IconButton, InfoList, Segmented, Skeleton, Spinner, Switch, Tooltip } from "../components/ui";
import { MenuItem, MenuSeparator, Popover, Sheet } from "../components/overlay";
import { CompareSheet } from "./CompareSheet";

/** Fetch SKILL.md + file list; refetch on each scan but keep showing the old one meanwhile. */
export function useSkillDetail(id: string) {
  const { inventory } = useData();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannedAt = inventory?.scannedAtMs;
  useEffect(() => {
    let alive = true;
    api
      .skillDetail(id)
      .then((d) => {
        if (alive) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, scannedAt]);
  return { detail, error };
}

/** Real copies that differ from the shared one (copy-mode copies that match it aren't a conflict). */
function divergentCopies(skill: Skill) {
  const canonical = skill.locations.find((l) => l.kind === "canonical");
  return skill.locations.filter((l) => l.kind === "directory" && (!canonical || l.contentHash !== canonical.contentHash));
}

const openUrl = (url: string) => void api.openPath(url).catch(() => window.open(url, "_blank"));

// ── Sheet ────────────────────────────────────────────────────────────────────

/**
 * Opens when `skill` is set. `order` is the grid order, for ← / → to step through skills.
 * `onFindSource` lets a hand-added skill look for its upstream (the Library's Find Sources sheet).
 */
export function SkillSheet({
  skill,
  order,
  onNavigate,
  onClose,
  onFindSource,
}: {
  skill: Skill | null;
  order: string[];
  onNavigate: (id: string) => void;
  onClose: () => void;
  onFindSource?: (ids: string[]) => void;
}) {
  const i = skill ? order.indexOf(skill.id) : -1;
  const prev = i > 0 ? order[i - 1] : null;
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null;

  useEffect(() => {
    if (!skill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      // Only when this sheet is the top layer (no confirm or menu over it).
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (document.querySelector("[data-popover]") || !dialogs[dialogs.length - 1]?.querySelector("[data-skill-sheet]")) return;
      const to = e.key === "ArrowLeft" ? prev : next;
      if (!to) return;
      e.preventDefault();
      onNavigate(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skill, prev, next, onNavigate]);

  return (
    <Sheet open={!!skill} onClose={onClose} width={820} maxHeight="88vh" label={skill?.name ?? "Skill"}>
      {skill && (
        <SheetBody
          key={skill.id}
          skill={skill}
          prev={prev}
          next={next}
          position={i >= 0 ? `${i + 1} of ${order.length}` : null}
          onNavigate={onNavigate}
          onClose={onClose}
          onFindSource={onFindSource}
        />
      )}
    </Sheet>
  );
}

function SheetBody({
  skill,
  prev,
  next,
  position,
  onNavigate,
  onClose,
  onFindSource,
}: {
  skill: Skill;
  prev: string | null;
  next: string | null;
  position: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onFindSource?: (ids: string[]) => void;
}) {
  const { inventory, updates, overrides, mySkills } = useData();
  const { run } = useActions();
  const { go, openPinSheet } = useNav();
  const { remove, makeMine, openInEditor, reveal, update, shareWithAll, editorName, mineDir } = useSkillActions();
  const { detail, error: detailError } = useSkillDetail(skill.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Stepping to another skill remounts the body: keep keyboard focus inside the sheet.
  useEffect(() => {
    const dialog = root.current?.closest<HTMLElement>('[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, []);

  const allAgents = inventory?.agents ?? [];
  const agents = useMemo(() => visibleAgents(allAgents), [allAgents]);
  const group = sourceGroup(skill);
  const updateInfo = updates?.find((u) => u.id === skill.id && u.status === "available");
  const mine = skill.origin === "mine";
  const path = skill.primaryPath;
  const problems = problemsOf(skill);
  const conflict = skill.issues.some((x) => x.kind === "conflict");
  const canShare = !skill.managed && !skill.readOnly && !conflict && !skill.issues.some((x) => x.kind === "missingSkillMd");
  const canMakeMine = !mine && !skill.readOnly && !conflict && !!path;
  const gh = mine ? mySkills?.githubRepo : null;
  const seenBy = agents.filter((a) => isVisible(effectivePresence(overrides, skill, a.id)));

  const doRemove = async () => {
    if (await remove(skill)) onClose();
  };
  const doAdopt = async (fromPath?: string) => {
    setBusy("adopt");
    const ok = await run(() => api.adopt(skill.id, fromPath), fromPath ? `Kept ${tildify(fromPath)}` : `${skill.name} is now shared`);
    setBusy(null);
    return ok;
  };
  const doUpdate = async () => {
    setBusy("update");
    await update([skill.id]);
    setBusy(null);
  };
  const doShare = async () => {
    setBusy("share");
    await shareWithAll([skill]);
    setBusy(null);
  };

  // ⌘⌫ (Delete on Windows) removes, like in the grid.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isRemoveKey(e)) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (!root.current || !dialogs[dialogs.length - 1]?.contains(root.current)) return;
      e.preventDefault();
      void doRemove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // One plain sentence about where it's from.
  let from: ReactNode;
  if (group.kind === "mine") from = <>Yours · <span className="font-mono text-[12px]">{tildify(path) || mineDir}</span></>;
  else if (group.kind === "remote")
    from = (
      <>
        From{" "}
        {group.url ? (
          <button type="button" onClick={() => openUrl(group.url!)} className="text-accent-text hover:underline">
            {group.source}
          </button>
        ) : (
          group.source
        )}
      </>
    );
  else if (group.kind === "local") from = skill.source?.kind === "local" ? <>Added by hand from <span className="font-mono text-[12px]">{tildify(skill.source.source)}</span></> : "Added by hand";
  else if (group.kind === "unmanaged") from = seenBy.length ? `Only in ${listNames(seenBy.map((a) => a.name))}` : "Not in any agent";
  else from = `From the ${pluginName(skill)} plugin`;

  // Primary first, at most three buttons; everything else goes in the … menu.
  const buttons: ReactNode[] = [];
  const shown = new Set<string>();
  const add = (key: string, node: ReactNode) => {
    if (buttons.length >= 3) return;
    shown.add(key);
    buttons.push(<span key={key}>{node}</span>);
  };
  const primaryTaken = () => buttons.length > 0;
  if (updateInfo)
    add(
      "update",
      <Button variant="primary" size="lg" icon={<ArrowUpCircle size={14} />} loading={busy === "update"} onClick={() => void doUpdate()}>
        Update{updateInfo.locallyModified ? "…" : ""}
      </Button>,
    );
  if (skill.origin === "unmanaged" && canShare)
    add(
      "share",
      <Button variant={primaryTaken() ? "secondary" : "primary"} size="lg" icon={<Share2 size={13} />} loading={busy === "share"} onClick={() => void doShare()}>
        Share with All Agents
      </Button>,
    );
  if (mine) {
    add(
      "edit",
      <Button variant={primaryTaken() ? "secondary" : "primary"} size="lg" icon={<Pencil size={13} />} onClick={() => openInEditor(skill)}>
        Edit in {editorName}
      </Button>,
    );
  }
  if (canMakeMine)
    add(
      "mine",
      <Tooltip content={`Move it into ${mineDir} so you can edit and version it.`}>
        <Button size="lg" icon={<User size={13} />} onClick={() => void makeMine(skill)}>
          Make It Mine…
        </Button>
      </Tooltip>,
    );
  if (group.kind === "local" && onFindSource)
    add(
      "find",
      <Button size="lg" icon={<Search size={13} />} onClick={() => onFindSource([skill.id])}>
        Find Source
      </Button>,
    );
  if (group.kind === "remote" && group.url)
    add(
      "github",
      <Button size="lg" icon={<ExternalLink size={13} />} onClick={() => openUrl(skill.source?.url ?? group.url!)}>
        View on GitHub
      </Button>,
    );
  if (path)
    add(
      "reveal",
      <Button size="lg" icon={<FolderOpen size={13} />} onClick={() => reveal(path)}>
        Reveal in {fileManager}
      </Button>,
    );

  return (
    <div ref={root} data-skill-sheet className="flex min-h-0 flex-1 flex-col">
      {/* Bar: step through skills, the name once the header scrolls away, close */}
      <div className={cx("relative z-10 flex h-[46px] shrink-0 items-center gap-1 px-3 transition-[border-color] duration-150", scrolled ? "border-b border-line" : "border-b border-transparent")}>
        <IconButton label="Previous Skill (←)" disabled={!prev} onClick={() => prev && onNavigate(prev)}>
          <ChevronLeft size={17} strokeWidth={2} />
        </IconButton>
        <IconButton label="Next Skill (→)" disabled={!next} onClick={() => next && onNavigate(next)}>
          <ChevronRight size={17} strokeWidth={2} />
        </IconButton>
        <div className="pointer-events-none absolute inset-x-28 flex justify-center">
          <span className={cx("truncate text-[13px] font-semibold transition-opacity duration-150", scrolled ? "opacity-100" : "opacity-0")} aria-hidden={!scrolled}>
            {skill.name}
          </span>
        </div>
        <div className="flex-1" />
        {position && <span className="mr-1 text-[11.5px] text-fg-3 tabular-nums">{position}</span>}
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </IconButton>
      </div>

      <div className="scroll min-h-0 flex-1" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 72)}>
        <div className="px-11 pt-3 pb-10">
          {/* Header */}
          <div className="flex items-start gap-4">
            <span className="mt-0.5">
              <GroupIcon group={group} size={52} agent={group.kind === "unmanaged" ? (seenBy[0] ?? null) : null} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="selectable text-[24px] leading-[30px] font-semibold tracking-[-0.022em] break-words">{skill.name}</h2>
              <div className="mt-0.5 text-[13px] text-fg-2">{from}</div>
              {skill.pinnedIn.length > 0 && <PinnedIn refs={skill.pinnedIn} onOpen={(project) => go("projects", { selectedId: project })} />}
            </div>
          </div>
          <p className={cx("selectable mt-4 max-w-[680px] text-[15px] leading-[1.55]", skill.description ? "text-fg" : "text-fg-3")}>
            {skill.description || "No description in SKILL.md, so agents can't tell when to use this skill."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {buttons}
            <MoreMenu
              skill={skill}
              shown={shown}
              gh={gh ?? null}
              canMakeMine={canMakeMine}
              onRemove={() => void doRemove()}
              onMakeMine={() => void makeMine(skill)}
              onPin={canPin(skill) ? () => openPinSheet({ skill: skill.id }) : undefined}
            />
          </div>

          {skill.readOnly && (
            <p className="mt-4 text-[12.5px] leading-snug text-fg-2">
              This skill comes with the {pluginName(skill)} plugin, so it's read-only. Manage it with the plugin in its agent.
            </p>
          )}

          {problems.length > 0 && (
            <div className="mt-6 flex flex-col gap-2">
              {problems.map((issue, n) => (
                <Problem key={n} issue={issue} skill={skill} agents={allAgents} busy={busy} onAdopt={doAdopt} onRemove={doRemove} />
              ))}
            </div>
          )}

          {/* SKILL.md, the hero */}
          <SkillMdSection skill={skill} detail={detail} error={detailError} />

          {/* The rest, collapsed by default */}
          <div className="mt-8">
            <SheetSection
              id="agents"
              title="Agents"
              summary={skill.readOnly ? "Plugin" : seenBy.length === agents.length ? "All" : `${seenBy.length} of ${agents.length}`}
            >
              <AgentSwitchList skill={skill} agents={agents} />
            </SheetSection>
            <SheetSection id="files" title="Files" summary={detail ? String(detail.files.filter((f) => !f.isDir).length) : undefined}>
              {detail ? <Files detail={detail} /> : <Skeleton className="h-16 w-full" />}
            </SheetSection>
            <SheetSection id="details" title="Details">
              <InfoList rows={detailRows(skill, mine ? mySkills?.isRepo : undefined)} />
            </SheetSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoreMenu({
  skill,
  shown,
  gh,
  canMakeMine,
  onRemove,
  onMakeMine,
  onPin,
}: {
  skill: Skill;
  shown: Set<string>;
  gh: string | null;
  canMakeMine: boolean;
  onRemove: () => void;
  onMakeMine: () => void;
  /** Absent when the skill has no shared copy to pin. */
  onPin?: () => void;
}) {
  const { reveal } = useSkillActions();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const path = skill.primaryPath;
  const mine = skill.origin === "mine";
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const copy = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));
  return (
    <>
      <Button ref={ref} size="lg" aria-label="More actions" onClick={() => setOpen((o) => !o)} className="w-[34px] px-0">
        <MoreHorizontal size={18} strokeWidth={2.8} />
      </Button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="start" className="w-[230px]">
        {path && !mine && (
          <MenuItem icon={<FileText size={13} />} onSelect={pick(() => void api.openPath(joinPath(path, "SKILL.md")).catch((e) => toast.error(errorMessage(e))))}>
            Open SKILL.md
          </MenuItem>
        )}
        {path && !shown.has("reveal") && (
          <MenuItem icon={<FolderOpen size={13} />} onSelect={pick(() => reveal(path))}>
            Reveal in {fileManager}
          </MenuItem>
        )}
        {path && (
          <MenuItem icon={<Copy size={13} />} onSelect={pick(() => copy(path, "Path"))}>
            Copy Path
          </MenuItem>
        )}
        {gh && (
          <>
            <MenuItem icon={<Copy size={13} />} onSelect={pick(() => copy(`npx skills add ${gh} --skill ${skill.id}`, "Install command"))}>
              Copy Install Command
            </MenuItem>
            {skill.source?.url && (
              <MenuItem icon={<ExternalLink size={13} />} onSelect={pick(() => openUrl(skill.source!.url!))}>
                View on GitHub
              </MenuItem>
            )}
          </>
        )}
        {canMakeMine && !shown.has("mine") && (
          <MenuItem icon={<User size={13} />} onSelect={pick(onMakeMine)}>
            Make It Mine…
          </MenuItem>
        )}
        {onPin && (
          <MenuItem icon={<Pin size={13} />} onSelect={pick(onPin)}>
            Pin to a Project…
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={13} />} danger disabled={skill.readOnly} onSelect={pick(onRemove)} hint={removeHint}>
          Move to {trashName}…
        </MenuItem>
      </Popover>
    </>
  );
}

/** "Pinned in acme-web (as browser-qa-release)": projects that keep their own copy of this skill. */
function PinnedIn({ refs, onOpen }: { refs: PinRef[]; onOpen: (project: string) => void }) {
  const shown = refs.slice(0, 2);
  const more = refs.length - shown.length;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[13px] leading-[19px] text-fg-2">
      <Pin size={12} strokeWidth={2.2} className="mr-0.5 shrink-0 text-fg-3" aria-hidden />
      <span>Pinned in</span>
      {shown.map((r, i) => (
        <span key={`${r.project}\u0000${r.pin}`} className="inline-flex items-center gap-1">
          <button type="button" onClick={() => onOpen(r.project)} className="rounded text-accent-text hover:underline" title={`Open ${r.projectName}`}>
            {r.projectName}
          </button>
          <span>(as <span className="font-mono text-[12px]">{r.pin}</span>)</span>
          {r.state !== "ok" && <AlertTriangle size={12} strokeWidth={2.2} className="shrink-0 text-amber" aria-label="Needs attention" />}
          {i < shown.length - 1 && more === 0 ? <span>and</span> : i < shown.length - 1 ? <span>,</span> : null}
        </span>
      ))}
      {more > 0 && <span>and {more} more</span>}
    </div>
  );
}

/** Collapsible section below the body; open state is remembered. */
function SheetSection({ id, title, summary, children }: { id: string; title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = usePersistent(`sheet.${id}`, false);
  return (
    <section className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-[44px] w-full items-center gap-1.5 text-left text-[13.5px] font-semibold text-fg hover:text-fg"
      >
        <ChevronRight size={13} strokeWidth={2.5} className={cx("shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} />
        {title}
        {summary && <span className="font-normal text-fg-3 tabular-nums">{summary}</span>}
      </button>
      {open && <div className="anim-fade pb-5 pl-[20px]">{children}</div>}
    </section>
  );
}

function detailRows(skill: Skill, isRepo: boolean | undefined): [ReactNode, ReactNode][] {
  const rows: [ReactNode, ReactNode][] = [];
  if (skill.primaryPath)
    rows.push([
      "Location",
      <span className="inline-flex items-baseline gap-2">
        <span className="font-mono text-[11.5px] break-all">{tildify(skill.primaryPath)}</span>
      </span>,
    ]);
  if (skill.origin === "mine") {
    rows.push([
      "Git",
      isRepo === false || skill.gitChanges === null ? (
        <span className="text-fg-2">Not under version control</span>
      ) : skill.gitChanges ? (
        <span className="text-amber">{plural(skill.gitChanges, "uncommitted change")}</span>
      ) : (
        "Committed"
      ),
    ]);
    if (skill.forkedFrom) rows.push(["Forked from", skill.forkedFrom]);
  } else if (skill.plugin) {
    rows.push(["Plugin", skill.plugin]);
  } else if (skill.source && skill.origin === "installed") {
    rows.push([
      "Source",
      skill.source.url ? (
        <button type="button" className="text-accent-text hover:underline" onClick={() => openUrl(skill.source!.url!)}>
          {skill.source.source}
        </button>
      ) : (
        skill.source.source
      ),
    ]);
    if (skill.source.gitRef) rows.push(["Branch", skill.source.gitRef]);
  }
  if (skill.version) rows.push(["Version", skill.version]);
  if (skill.license) rows.push(["License", skill.license]);
  if (skill.fileCount) rows.push(["Size", `${formatBytes(skill.sizeBytes)} · ${plural(skill.fileCount, "file")}`]);
  if (skill.modifiedMs) rows.push(["Modified", new Date(skill.modifiedMs).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })]);
  if (skill.allowedTools) rows.push(["Tools", <span className="font-mono text-[11.5px]">{skill.allowedTools}</span>]);
  return rows;
}

// ── Agents ───────────────────────────────────────────────────────────────────

function AgentSwitchList({ skill, agents }: { skill: Skill; agents: AgentInfo[] }) {
  const { overrides, settings } = useData();
  const { toggleLink, toggleAll } = useActions();
  const togglable = agents.filter((a) => PRESENCE[effectivePresence(overrides, skill, a.id)].toggleable && !a.readsCanonical);
  const allOn = togglable.every((a) => PRESENCE[effectivePresence(overrides, skill, a.id)].on);

  return (
    <div className="max-w-[560px]">
      <div className="mb-2 flex items-start gap-3">
        <p className="flex-1 text-[12.5px] leading-snug text-fg-2">
          {skill.readOnly
            ? "Plugin skills live inside their agent and can't be shared."
            : settings?.universal
              ? "Universal mode keeps this in every agent; switch one off to make an exception."
              : "Choose which agents can use this skill."}
        </p>
        {!skill.readOnly && agents.length > 0 && (
          <button type="button" onClick={() => void toggleAll(skill.id, !allOn)} className="shrink-0 rounded px-1 text-[12.5px] text-accent-text hover:underline">
            {allOn ? "Turn All Off" : "Turn All On"}
          </button>
        )}
      </div>
      {agents.length === 0 && <div className="py-2 text-[12.5px] text-fg-3">No agents detected.</div>}
      {agents.map((a) => {
        const p = effectivePresence(overrides, skill, a.id);
        const meta = PRESENCE[p];
        const pending = overrides.has(`${skill.id}\u0000${a.id}`);
        const canToggle = !skill.readOnly && meta.toggleable && !(a.readsCanonical && skill.managed);
        const reason = skill.readOnly ? "Plugin skills are read-only." : a.readsCanonical && skill.managed ? `${a.name} reads ~/.agents/skills directly.` : meta.help;
        const quiet = p === "linked" || p === "absent" || p === "native";
        return (
          <div key={a.id} className="flex h-[32px] items-center gap-2.5">
            <AgentIcon id={a.id} name={a.name} size={20} muted={!meta.on} />
            <span className={cx("min-w-0 flex-1 truncate text-[13px]", !meta.on && "text-fg-2")}>{a.name}</span>
            <Tooltip content={reason} side="left">
              <span className={cx("inline-flex items-center gap-1 text-[12px]", p === "broken" ? "text-red" : "text-fg-3")}>
                {pending ? <Spinner size={10} /> : p === "broken" ? <AlertTriangle size={11} /> : null}
                {quiet && p !== "native" ? "" : meta.label}
              </span>
            </Tooltip>
            <Switch
              size="sm"
              checked={meta.on}
              disabled={!canToggle}
              tone={canToggle ? "accent" : "muted"}
              label={`${a.name}: ${meta.label}`}
              onChange={(v) => void toggleLink(skill.id, a.id, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Problems ─────────────────────────────────────────────────────────────────

/** Plain-language title and explanation for a problem. */
function explain(issue: Issue, skill: Skill, agents: AgentInfo[]): { title: string; text: string } {
  const name = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? id) : "The shared copy");
  switch (issue.kind) {
    case "brokenLink": {
      const who = listNames(skill.locations.filter((l) => l.kind === "broken").map((l) => name(l.agentId)));
      return {
        title: "Broken link",
        text: `${who || "An agent"} can't see this skill: its link points to a folder that no longer exists.${skill.managed ? " Repair puts a fresh link to the shared copy in its place." : ""}`,
      };
    }
    case "conflict": {
      const copies = divergentCopies(skill).map((l) => name(l.agentId));
      return {
        title: "Conflicting copies",
        text: `${listNames(copies) || "An agent"} ${copies.length === 1 ? "has its own copy" : "have their own copies"} that differ${copies.length === 1 ? "s" : ""} from the shared one. Pick the copy to keep; the others become links to it.`,
      };
    }
    case "missingSkillMd":
      return { title: "Missing SKILL.md", text: "There's no readable SKILL.md: every copy is a broken link, so no agent can use this skill." };
    case "missingDescription":
      return { title: "Needs a description", text: "SKILL.md has no description, so agents can't tell when to use this skill. Add one line that says what it's for." };
    case "invalidFrontmatter":
      return { title: "SKILL.md can't be read", text: issue.message };
    case "invalidName":
      return { title: "Invalid name", text: issue.message };
    case "nameMismatch":
      return { title: "Name doesn't match the folder", text: issue.message };
    case "descriptionTooLong":
      return { title: "Description too long", text: issue.message };
    default:
      return { title: "Needs attention", text: issue.message };
  }
}

function Problem({
  issue,
  skill,
  agents,
  busy,
  onAdopt,
  onRemove,
}: {
  issue: Issue;
  skill: Skill;
  agents: AgentInfo[];
  busy: string | null;
  onAdopt: (fromPath?: string) => Promise<boolean>;
  onRemove: () => Promise<void>;
}) {
  const { toggleLink } = useActions();
  const { openInEditor } = useSkillActions();
  const [expanded, setExpanded] = useState(issue.kind === "conflict");
  const [comparing, setComparing] = useState(false);
  const error = issue.severity === "error";
  const Icon = error ? AlertOctagon : AlertTriangle;
  const broken = skill.locations.filter((l) => l.kind === "broken");
  const conflictLocs = [...skill.locations.filter((l) => l.kind === "canonical"), ...divergentCopies(skill)];
  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? id) : "Shared copy");
  const { title, text } = explain(issue, skill, agents);

  let fix: ReactNode = null;
  if (issue.kind === "brokenLink") {
    fix = skill.managed ? (
      <Button icon={<Wrench size={12} />} onClick={() => broken.forEach((l) => l.agentId && void toggleLink(skill.id, l.agentId, true))}>
        Repair
      </Button>
    ) : (
      <Button onClick={() => void onRemove()}>Remove Link</Button>
    );
  } else if (issue.kind === "missingSkillMd") {
    fix = <Button onClick={() => void onRemove()}>Remove</Button>;
  } else if (issue.kind === "conflict") {
    fix = (
      <div className="flex gap-2">
        <Button variant="primary" icon={<GitCompareArrows size={12} />} onClick={() => setComparing(true)}>
          Compare
        </Button>
        <Button onClick={() => setExpanded((e) => !e)}>{expanded ? "Hide Copies" : "Choose…"}</Button>
      </div>
    );
  } else if (skill.primaryPath && !skill.readOnly) {
    fix =
      skill.origin === "mine" ? (
        <Button icon={<Pencil size={12} />} onClick={() => openInEditor(skill)}>
          Edit
        </Button>
      ) : (
        <Button onClick={() => void api.openPath(joinPath(skill.primaryPath, "SKILL.md")).catch((e) => toast.error(errorMessage(e)))}>Edit SKILL.md</Button>
      );
  }

  return (
    <div className={cx("rounded-[10px] px-4 py-3", error ? "bg-red-soft" : "bg-amber-soft")}>
      <div className="flex items-start gap-3">
        <Icon size={16} strokeWidth={2.1} className={cx("mt-[2px] shrink-0", error ? "text-red" : "text-amber")} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-fg">{title}</div>
          <div className="selectable mt-0.5 text-[13px] leading-[1.5] text-fg-2" title={issue.message}>
            {text}
          </div>
        </div>
        {fix && <div className="shrink-0 pt-0.5">{fix}</div>}
      </div>
      {issue.kind === "conflict" && expanded && (
        <div className="anim-fade mt-3 ml-7 flex flex-col overflow-hidden rounded-[8px] border-[0.5px] border-line-2 bg-elevated">
          {conflictLocs.map((l, n) => (
            <div key={l.path} className={cx("flex items-center gap-2.5 px-3 py-2", n > 0 && "border-t border-line")}>
              {l.agentId ? <AgentIcon id={l.agentId} name={agentName(l.agentId)} size={18} /> : <Folder size={16} className="text-accent" />}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px]">{agentName(l.agentId)}</div>
                <div className="truncate font-mono text-[11px] text-fg-3" title={l.path}>
                  {tildify(l.path)}
                </div>
              </div>
              <Button size="sm" onClick={() => void api.openPath(joinPath(l.path, "SKILL.md"))}>
                View
              </Button>
              <Button size="sm" loading={busy === "adopt"} onClick={() => void onAdopt(l.path)}>
                Keep This One
              </Button>
            </div>
          ))}
        </div>
      )}
      {issue.kind === "conflict" && <CompareSheet skill={comparing ? skill : null} onClose={() => setComparing(false)} onKeep={onAdopt} />}
    </div>
  );
}

// ── SKILL.md ─────────────────────────────────────────────────────────────────

/** Drop a leading "# Title" that only repeats the skill's name (the header already shows it). */
function withoutTitle(body: string, skill: Skill) {
  const m = body.match(/^\s*#\s+(.+?)\s*\n/);
  if (!m) return body;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(m[1]) === norm(skill.name) || norm(m[1]) === norm(skill.id) ? body.slice(m[0].length) : body;
}

function SkillMdSection({ skill, detail, error }: { skill: Skill; detail: SkillDetail | null; error: string | null }) {
  const [mode, setMode] = usePersistent<"preview" | "raw">("skillmd.mode", "preview");
  const body = useMemo(() => (detail ? withoutTitle(detail.body, skill) : ""), [detail, skill]);
  return (
    <section className="mt-8 border-t border-line pt-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="section-title">SKILL.md</span>
        <Segmented
          size="sm"
          label="SKILL.md view"
          value={mode}
          onChange={setMode}
          options={[
            { value: "preview", label: "Formatted" },
            { value: "raw", label: "Raw" },
          ]}
        />
      </div>
      {error ? (
        <div className="flex items-start gap-2 text-[13px] text-red">
          <AlertOctagon size={14} className="mt-px shrink-0" />
          {error}
        </div>
      ) : !detail ? (
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ) : mode === "raw" ? (
        <pre className="selectable overflow-x-auto rounded-[8px] border-[0.5px] border-line bg-surface-2 p-4 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-fg">
          {detail.skillMd}
        </pre>
      ) : (
        <div className="md md-reader selectable">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MdLink, table: MdTable }}>
            {body}
          </ReactMarkdown>
        </div>
      )}
    </section>
  );
}

function MdTable(props: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="md-table">
      <table {...props} />
    </div>
  );
}

function MdLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = props.href ?? "";
  const external = /^https?:/.test(href);
  return (
    <a
      {...props}
      onClick={(e) => {
        e.preventDefault();
        if (external) openUrl(href);
      }}
      title={href}
    />
  );
}

// ── Files ────────────────────────────────────────────────────────────────────

function Files({ detail }: { detail: SkillDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = detail.skill.id;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setContent(null);
    setError(null);
    api
      .readSkillFile(id, open)
      .then((t) => alive && setContent(t))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, open]);

  if (open) {
    return (
      <div className="anim-slide overflow-hidden rounded-[8px] border-[0.5px] border-line-2">
        <div className="flex h-[30px] items-center gap-1 border-b border-line bg-surface-2 pr-1 pl-1">
          <button type="button" onClick={() => setOpen(null)} className="flex h-[22px] items-center gap-0.5 rounded px-1 text-[12.5px] text-accent-text hover:bg-hover">
            <ChevronLeft size={13} /> Files
          </button>
          <span className="truncate font-mono text-[11.5px] text-fg-2">{open}</span>
          <div className="flex-1" />
          {detail.skill.primaryPath && (
            <IconButton label="Open in Default App" className="h-[22px] min-w-[24px]" onClick={() => void api.openPath(joinPath(detail.skill.primaryPath, open))}>
              <ExternalLink size={12} />
            </IconButton>
          )}
        </div>
        {error ? (
          <div className="p-3 text-[12.5px] text-red">{error}</div>
        ) : content === null ? (
          <div className="p-3">
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <pre className="selectable scroll max-h-[420px] p-3 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-fg">{content}</pre>
        )}
      </div>
    );
  }

  return (
    <div className="flex max-w-[560px] flex-col" role="tree" aria-label="Files">
      {detail.files.map((f) => {
        const depth = f.path.split("/").length - 1;
        const name = f.path.split("/").pop();
        return (
          <button
            key={f.path}
            type="button"
            role="treeitem"
            disabled={f.isDir}
            onClick={() => setOpen(f.path)}
            className={cx("flex h-[26px] w-full items-center gap-1.5 rounded-[5px] pr-2 text-left text-[13px]", !f.isDir && "hover:bg-hover")}
            style={{ paddingLeft: 4 + depth * 16 }}
          >
            {f.isDir ? (
              <Folder size={14} strokeWidth={1.8} className="shrink-0 fill-[color-mix(in_srgb,var(--q-accent)_30%,transparent)] text-accent" />
            ) : f.path === "SKILL.md" ? (
              <FileText size={14} strokeWidth={1.7} className="shrink-0 text-fg-2" />
            ) : (
              <File size={14} strokeWidth={1.7} className="shrink-0 text-fg-3" />
            )}
            <span className="flex-1 truncate">{name}</span>
            {!f.isDir && <span className="text-[11.5px] text-fg-3 tabular-nums">{formatBytes(f.size)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// One project: its pinned skills as cards (same language as the Library), the other skills found in the
// repo, how to check pins in CI, and removing the project from Quiver.

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Info,
  MoreHorizontal,
  Pin as PinIcon,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type { AgentInfo, Pin, ProjectDetail, ProjectSkill, ProjectSummary } from "../lib/types";
import { cx, fileManager, hasMod, listNames, mod, pinStatus, plural, shortDate, shortRef, summarizeAgents } from "../lib/ui";
import { usePersistent } from "../lib/hooks";
import { useData, useNav } from "../state/store";
import { useProjectDetail, usePinActions } from "../state/pinActions";
import { useSkillActions } from "../state/skillActions";
import { AgentIcon, GitHubMark } from "../components/identity";
import { Tag } from "../components/SkillGrid";
import { Button, Chip, IconButton, Skeleton, Toolbar, ToolbarTitle } from "../components/ui";
import { MenuItem, MenuSeparator, Popover, useConfirm } from "../components/overlay";
import { PinCompareSheet } from "./CompareSheet";
import { UpdatePinSheet } from "./PinSheet";

const CI_COMMAND = "quiver pins verify";

export function ProjectPage({ summary }: { summary: ProjectSummary }) {
  const { inventory } = useData();
  const { go, openPinSheet, flash, setFlash } = useNav();
  const { removeProject, removePin, repairLinks, updatePin } = usePinActions();
  const { reveal } = useSkillActions();
  const confirm = useConfirm();
  const { detail, error } = useProjectDetail(summary.path);
  const [comparing, setComparing] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const agents = useMemo(() => inventory?.agents ?? [], [inventory]);
  const project: ProjectSummary = detail ?? summary;
  const pins = useMemo(() => [...(detail?.pins ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [detail]);
  const comparingPin = pins.find((p) => p.name === comparing) ?? null;
  const updatingPin = pins.find((p) => p.name === updating) ?? null;
  const back = () => go("projects", { selectedId: null });

  // ⌘[ / Ctrl+[ goes back to the list, like Finder and Safari.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.shiftKey || e.altKey || e.key !== "[") return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      go("projects", { selectedId: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // A pin that was just created: scroll to it; its card flashes, then the highlight is dropped.
  const flashed = flash && flash.project === summary.path && pins.some((p) => p.name === flash.pin) ? flash.pin : null;
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flashed) return;
    grid.current?.querySelector<HTMLElement>(`[data-pin="${CSS.escape(flashed)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flashed, setFlash]);

  const updateToShared = async (pin: Pin) => {
    if (pin.state === "modified") {
      const ok = await confirm({
        title: `Replace your edits to “${pin.name}”?`,
        message: `You changed ${pin.changedFiles.length ? listNames(pin.changedFiles.slice(0, 3)) : "the pinned files"} in ${project.name}. Updating to the shared version discards those edits.`,
        confirmLabel: "Update Pin",
        destructive: true,
      });
      if (!ok) return false;
    }
    return updatePin(project, pin, null);
  };

  const needsRepair = pins.some((p) => p.state === "links");

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--q-canvas)]">
      <Toolbar className="bg-surface">
        <IconButton label={`All Projects (${mod}[)`} onClick={back}>
          <ChevronLeft size={17} strokeWidth={2} />
        </IconButton>
        <ToolbarTitle sub={project.displayPath}>{project.name}</ToolbarTitle>
        <span className="ml-1.5">
          <BranchTag project={project} />
        </span>
        <div data-tauri-drag-region className="min-w-4 flex-1" />
        {needsRepair && (
          <Button size="lg" icon={<Wrench size={13} />} onClick={() => void repairLinks(project)}>
            Repair Links
          </Button>
        )}
        <Button size="lg" variant="primary" icon={<PinIcon size={13} />} disabled={!project.exists} onClick={() => openPinSheet({ project: project.path })}>
          Pin a Skill…
        </Button>
        <ProjectMenu project={project} onReveal={() => reveal(project.path)} onRemove={() => void removeProject(project)} />
      </Toolbar>

      <div className="scroll min-h-0 flex-1">
        <div className="mx-auto max-w-[940px] px-6 pt-3 pb-10">
          {!project.exists && (
            <div className="mt-2 mb-3 flex items-start gap-2.5 rounded-[10px] bg-amber-soft px-3.5 py-3 text-[12.5px] leading-snug">
              <AlertTriangle size={15} className="mt-[1px] shrink-0 text-amber" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">This folder isn't on disk any more</div>
                <div className="text-fg-2">Move it back to {project.displayPath}, or remove the project from Quiver.</div>
              </div>
              <Button size="sm" onClick={() => void removeProject(project)}>
                Remove…
              </Button>
            </div>
          )}

          <SectionHead title="Pinned skills" count={pins.length > 0 ? pins.length : undefined}>
            Pinned skills are part of the repo, so commit them with your code. Everyone, and CI, gets the same version.
          </SectionHead>

          {error && !detail ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-soft p-3 text-[12.5px] text-red">
              <AlertTriangle size={14} /> {error}
            </div>
          ) : !detail ? (
            <PinGrid>
              {[0, 1].map((i) => (
                <div key={i} className="pin-card flex h-[148px] flex-col gap-2.5 rounded-[10px] px-4 pt-4">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-2.5 w-3/4" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              ))}
            </PinGrid>
          ) : pins.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-line-2 px-6 py-9 text-center">
              <PinIcon size={26} strokeWidth={1.4} className="mx-auto text-fg-3" />
              <div className="mt-2 text-[14px] font-semibold text-fg-2">Nothing pinned yet</div>
              <p className="mx-auto mt-1 max-w-[380px] text-[12px] leading-[1.45] text-fg-3">
                Pin a skill to keep {project.name} on one version while the shared copy moves on.
              </p>
              <Button className="mt-3.5" size="lg" variant="primary" icon={<PinIcon size={13} />} disabled={!project.exists} onClick={() => openPinSheet({ project: project.path })}>
                Pin a Skill…
              </Button>
            </div>
          ) : (
            <PinGrid gridRef={grid}>
              {pins.map((p) => (
                <PinCard
                  key={p.name}
                  pin={p}
                  agents={agents}
                  flash={flashed === p.name}
                  onCompare={() => setComparing(p.name)}
                  onUpdate={() => setUpdating(p.name)}
                  onRepair={() => void repairLinks(project)}
                  onRemove={() => void removePin(project, p)}
                  onReveal={() => reveal(p.path)}
                  onOpenSkill={() => go("library", { selectedId: p.skill, filter: "all", agentFilter: null })}
                />
              ))}
            </PinGrid>
          )}

          {detail && detail.otherSkills.length > 0 && <OtherSkills skills={detail.otherSkills} />}
          {detail && <CiCheck detail={detail} onReveal={(path) => reveal(path)} />}
        </div>
      </div>

      <PinCompareSheet project={project} pin={comparingPin} onUpdate={updateToShared} onClose={() => setComparing(null)} />
      <UpdatePinSheet project={project} pin={updatingPin} onClose={() => setUpdating(null)} />
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function PinGrid({ children, gridRef }: { children: ReactNode; gridRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={gridRef} className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gridAutoRows: "1fr" }}>
      {children}
    </div>
  );
}

function SectionHead({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="mb-3 pt-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] leading-5 font-semibold tracking-[-0.012em]">{title}</h2>
        {count !== undefined && <span className="text-[13px] text-fg-3 tabular-nums">{count}</span>}
      </div>
      {children && <p className="mt-0.5 text-[12.5px] leading-snug text-fg-3">{children}</p>}
    </div>
  );
}

export function BranchTag({ project }: { project: ProjectSummary }) {
  if (!project.isRepo) {
    return (
      <Tag title="Pins still work, but there's no branch to tie them to.">Not a git repository</Tag>
    );
  }
  return <Tag icon={<GitBranch size={11.5} strokeWidth={2.2} />}>{project.branch ?? "Detached HEAD"}</Tag>;
}

function ProjectMenu({ project, onReveal, onRemove }: { project: ProjectSummary; onReveal: () => void; onRemove: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <Button ref={ref} size="lg" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-[34px] px-0">
        <MoreHorizontal size={18} strokeWidth={2.8} />
      </Button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" className="w-[270px]">
        <MenuItem icon={<FolderOpen size={13} />} disabled={!project.exists} onSelect={pick(onReveal)}>
          Show in {fileManager}
        </MenuItem>
        <MenuItem icon={<Copy size={13} />} onSelect={pick(() => void navigator.clipboard?.writeText(project.path).then(() => toast("Path copied")))}>
          Copy Path
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={13} />} danger onSelect={pick(onRemove)}>
          Remove Project from Quiver…
        </MenuItem>
      </Popover>
    </>
  );
}

function PinCard({
  pin,
  agents,
  flash,
  onCompare,
  onUpdate,
  onRepair,
  onRemove,
  onReveal,
  onOpenSkill,
}: {
  pin: Pin;
  agents: AgentInfo[];
  flash: boolean;
  onCompare: () => void;
  onUpdate: () => void;
  onRepair: () => void;
  onRemove: () => void;
  onReveal: () => void;
  onOpenSkill: () => void;
}) {
  const { inventory } = useData();
  const status = pinStatus(pin, agents);
  const inLibrary = !!inventory?.skills.some((s) => s.id === pin.skill);
  const canCompare = pin.state !== "missing" && pin.sharedChanged !== null;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const reached = pin.agents.map((a) => byId.get(a.agentId)).filter((a): a is AgentInfo => !!a);
  const clash = pin.nameClash.map((id) => byId.get(id)?.name ?? id);
  const menu = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <article data-pin={pin.name} aria-label={pin.name} className={cx("pin-card flex min-h-[148px] min-w-0 flex-col rounded-[10px] px-4 pt-3.5 pb-3", flash && "flash")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="selectable truncate text-[13.5px] leading-[18px] font-semibold tracking-[-0.01em]" title={pin.name}>
            {pin.name}
          </h3>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] leading-[17px] text-fg-2">
            <span className="shrink-0">from</span>
            {inLibrary ? (
              <button type="button" onClick={onOpenSkill} className="min-w-0 truncate rounded text-accent-text hover:underline" title={`Show ${pin.skill} in the Library`}>
                {pin.skill}
              </button>
            ) : (
              <span className="min-w-0 truncate">{pin.skill}</span>
            )}
            <span className="shrink-0 text-fg-3" aria-hidden>
              ·
            </span>
            <span className="shrink-0" title={new Date(pin.pinnedAt).toLocaleString()}>
              Pinned {shortDate(pin.pinnedAt)}
            </span>
            {pin.pinnedFrom === "github" && pin.gitRef && (
              <span className="inline-flex shrink-0 items-center gap-1 text-fg-3" title={`Pinned from GitHub at ${pin.gitRef}`}>
                <span aria-hidden>·</span>
                <GitHubMark size={11} />
                <span className="font-mono text-[11px]">{shortRef(pin.gitRef)}</span>
              </span>
            )}
          </div>
        </div>
        <Button
          ref={menu}
          size="sm"
          variant="ghost"
          aria-label={`Actions for ${pin.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="-mt-0.5 -mr-1.5 h-[24px] w-[28px] px-0"
        >
          <MoreHorizontal size={16} strokeWidth={2.6} />
        </Button>
        <Popover anchor={menu} open={open} onClose={() => setOpen(false)} align="end" className="w-[230px]">
          <MenuItem icon={<GitCompareArrows size={13} />} disabled={!canCompare} onSelect={pick(onCompare)}>
            Compare with Shared
          </MenuItem>
          <MenuItem icon={<RefreshCw size={13} />} disabled={pin.state === "missing"} onSelect={pick(onUpdate)}>
            Update Pin…
          </MenuItem>
          {pin.state === "links" && (
            <MenuItem icon={<Wrench size={13} />} onSelect={pick(onRepair)}>
              Repair Links
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={<FolderOpen size={13} />} disabled={pin.state === "missing"} onSelect={pick(onReveal)}>
            Show in {fileManager}
          </MenuItem>
          <MenuItem icon={<Copy size={13} />} onSelect={pick(() => void navigator.clipboard?.writeText(`/${pin.name}`).then(() => toast(`Copied /${pin.name}`)))}>
            Copy /{pin.name}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={13} />} danger onSelect={pick(onRemove)}>
            Remove Pin…
          </MenuItem>
        </Popover>
      </div>

      <p className={cx("line-clamp-2 mt-2 text-[12.5px] leading-[17px] break-words", pin.description ? "text-fg-2" : "text-fg-3")}>
        {pin.description || "No description"}
      </p>

      {(status || pin.sharedChanged === true) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {status && (
            <Tag
              tone={status.tone}
              title={<span className="whitespace-pre-line">{status.detail}</span>}
              icon={<AlertTriangle size={11.5} strokeWidth={2.3} />}
            >
              {status.label}
            </Tag>
          )}
          {pin.sharedChanged === true && (
            <Tag tone="accent" title={`The shared ${pin.skill} has changed since this was pinned. ${pin.name} keeps the older version until you update it.`} icon={<Info size={11.5} strokeWidth={2.3} />}>
              Shared version has changed
            </Tag>
          )}
        </div>
      )}

      {clash.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-amber">
          <AlertTriangle size={12.5} strokeWidth={2.2} className="mt-[2px] shrink-0" />
          <span>
            {listNames(clash)} already {clash.length === 1 ? "has" : "have"} a skill called “{pin.name}” and may use that instead of this pin.
          </span>
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-2 pt-3">
        {pin.state === "links" ? (
          <Button size="md" variant="primary" icon={<Wrench size={12.5} />} onClick={onRepair}>
            Repair Links
          </Button>
        ) : null}
        <Button size="md" icon={<GitCompareArrows size={12.5} />} disabled={!canCompare} onClick={onCompare}>
          Compare with Shared
        </Button>
        {reached.length > 0 && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-3" title={`${summarizeAgents(reached)} · ${pin.mode === "copy" ? "copies" : "links"}`}>
            <span className="flex shrink-0 -space-x-1">
              {reached.slice(0, 3).map((a) => (
                <AgentIcon key={a.id} id={a.id} name={a.name} size={15} />
              ))}
            </span>
            <span className="shrink-0 tabular-nums">{plural(reached.length, "agent")}</span>
          </span>
        )}
      </div>
    </article>
  );
}

function OtherSkills({ skills }: { skills: ProjectSkill[] }) {
  return (
    <section className="mt-9">
      <SectionHead title="Other skills in this project" count={skills.length}>
        Added by other tools, such as <span className="font-mono text-[11.5px]">npx skills</span>. Quiver leaves them alone.
      </SectionHead>
      <div className="pin-card divide-y divide-line overflow-hidden rounded-[10px]">
        {skills.map((s) => (
          <div key={s.dir} className="flex items-start gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{s.name}</div>
              <div className="line-clamp-2 text-[12px] leading-snug text-fg-2">{s.description || "No description"}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
              {s.source && <Chip>{s.source}</Chip>}
              <span className="font-mono text-[11px] text-fg-3">{s.dir}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CiCheck({ detail, onReveal }: { detail: ProjectDetail; onReveal: (path: string) => void }) {
  const [open, setOpen] = usePersistent("projects.ci", false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <section className="mt-9">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-ml-1 flex items-center gap-1 rounded px-1 py-1 text-[13px] font-semibold text-fg-2 hover:text-fg"
      >
        <ChevronRight size={12} strokeWidth={2.6} className={cx("text-fg-3 transition-transform duration-150", open && "rotate-90")} />
        Check in CI
      </button>
      {open && (
        <div className="anim-fade mt-2 max-w-[640px] pl-[17px]">
          <div className="flex items-center gap-2">
            <code className="selectable min-w-0 flex-1 truncate rounded-[7px] border-[0.5px] border-line-2 bg-surface px-3 py-[6px] font-mono text-[12.5px]">{CI_COMMAND}</code>
            <Button
              size="lg"
              icon={copied ? <Check size={13} strokeWidth={2.6} className="text-green" /> : <Copy size={13} />}
              onClick={() =>
                void navigator.clipboard?.writeText(CI_COMMAND).then(() => setCopied(true), () => toast.error("Couldn't copy the command"))
              }
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-fg-2">
            Checks that every pinned skill still matches <span className="font-mono text-[11.5px]">quiver-pins.json</span> and fails the build if one was edited or is missing. It works offline, so CI needs no access to your own skills.
            {detail.lockFile && (
              <>
                {" "}
                <button type="button" onClick={() => onReveal(detail.lockFile!)} className="rounded text-accent-text hover:underline">
                  Show the file in {fileManager}
                </button>
                .
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

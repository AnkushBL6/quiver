// "Pin a Skill": give one project its own fixed copy of a skill. Also the smaller "Update Pin"
// sheet, which shares the version choice (current shared version, or a GitHub tag/branch/commit).

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, ChevronRight, Loader2, Pin as PinIcon } from "lucide-react";
import { api, errorMessage, pickProjectFolder } from "../lib/api";
import type { AgentInfo, NameCheck, Pin, PinMode, ProjectSummary, Skill, SkillSource } from "../lib/types";
import { canPin, cx, hasMod, isWindows, listNames, plural, summarizeAgents, validateSkillName, visibleAgents } from "../lib/ui";
import { useDebounced } from "../lib/hooks";
import { useData, useNav } from "../state/store";
import { usePinActions } from "../state/pinActions";
import { AgentIcon } from "../components/identity";
import { Button, Checkbox, SearchField, Segmented, Select, TextField } from "../components/ui";
import { Sheet } from "../components/overlay";

const NATIVE_DIR = ".agents/skills";
const ADD_PROJECT = "\u0000add";
const NONE = "\u0000none";

// ── The sheet ────────────────────────────────────────────────────────────────

export function PinSheet() {
  const { pinSheet, closePinSheet } = useNav();
  return (
    <Sheet open={pinSheet.open} onClose={closePinSheet} width={600} label="Pin a Skill">
      {pinSheet.open && <PinForm initialSkill={pinSheet.skill} initialProject={pinSheet.project} close={closePinSheet} />}
    </Sheet>
  );
}

function PinForm({ initialSkill, initialProject, close }: { initialSkill: string | null; initialProject: string | null; close: () => void }) {
  const { inventory, projects } = useData();
  const { addProject, createPin } = usePinActions();
  const fixedProject = initialProject !== null;
  const [projectPath, setProjectPath] = useState<string | null>(() => initialProject ?? (projects?.length === 1 ? projects[0].path : null));
  const project = projects?.find((p) => p.path === projectPath) ?? null;

  const pinnable = useMemo(() => (inventory?.skills ?? []).filter(canPin), [inventory]);
  const [skillId, setSkillId] = useState<string | null>(() => (initialSkill && pinnable.some((s) => s.id === initialSkill) ? initialSkill : null));
  const skill = pinnable.find((s) => s.id === skillId) ?? null;

  const [name, setName] = useState(() => (skillId ? `${skillId}-pinned` : ""));
  const [nameTouched, setNameTouched] = useState(false);
  const [versionKind, setVersionKind] = useState<"shared" | "github">("shared");
  const [ref, setRef] = useState("");
  const [mode, setMode] = useState<PinMode>(isWindows ? "copy" : "symlink");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [name, projectPath, skillId, versionKind, ref, mode]);

  const github = skill?.source?.kind === "github" ? skill.source : null;
  useEffect(() => {
    if (!github && versionKind === "github") setVersionKind("shared");
  }, [github, versionKind]);

  // ── agents
  const agents = useMemo(() => visibleAgents(inventory?.agents ?? []).filter((a) => a.projectDir), [inventory]);
  const native = useMemo(() => agents.filter((a) => a.projectDir === NATIVE_DIR), [agents]);
  const folders = useMemo(() => groupByFolder(agents.filter((a) => a.projectDir !== NATIVE_DIR)), [agents]);
  const folderIds = useMemo(() => folders.flatMap((f) => f.agents.map((a) => a.id)), [folders]);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = the default: every agent
  const selected = useMemo(() => new Set(picked ?? folderIds), [picked, folderIds]);
  const included = useMemo(() => [...agents.filter((a) => selected.has(a.id) || a.projectDir === NATIVE_DIR)], [agents, selected]);
  const isDefault = folderIds.every((id) => selected.has(id));

  // ── name validation: instant rules first, then the project's own check (debounced)
  const trimmed = name.trim();
  const local = validateSkillName(trimmed);
  const settled = useDebounced(trimmed, 350);
  const checkKey = project && skill && !local && trimmed ? `${project.path}\u0000${trimmed}` : null;
  const [checked, setChecked] = useState<{ key: string; res: NameCheck | null } | null>(null);
  useEffect(() => {
    if (!project || !settled || validateSkillName(settled)) return;
    const key = `${project.path}\u0000${settled}`;
    let alive = true;
    api
      .pinCheckName(project.path, settled)
      .then((res) => alive && setChecked({ key, res }))
      .catch(() => alive && setChecked({ key, res: null }));
    return () => {
      alive = false;
    };
  }, [project, settled]);
  const verdict = checkKey && checked?.key === checkKey ? checked.res : undefined; // undefined: still checking
  const checking = !!checkKey && checked?.key !== checkKey;
  const nameOk = !!trimmed && !local && (!project || verdict?.ok === true);

  const chooseSkill = (s: Skill) => {
    setSkillId(s.id);
    if (!nameTouched) setName(`${s.id}-pinned`);
  };

  const canSubmit = !!project && !!skill && nameOk && !checking && (versionKind === "shared" || !!ref.trim()) && included.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit || !project || !skill) return;
    setBusy(true);
    setError(null);
    try {
      await createPin(
        {
          project: project.path,
          skill: skill.id,
          name: trimmed,
          gitRef: versionKind === "github" ? ref.trim() : null,
          agents: isDefault ? [] : included.map((a) => a.id),
          mode,
        },
        project.name,
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const [changingSkill, setChangingSkill] = useState(false);
  const picking = !skill || changingSkill;
  useEffect(() => {
    // ⌘F / Ctrl+F: find a skill.
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      setChangingSkill(true);
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="shrink-0 px-5 pt-5">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <PinIcon size={14} className="text-fg-2" /> Pin a Skill
        </div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-2">
          The project keeps its own copy, so it stays on this version even when the shared skill changes. Your other projects keep using the shared one.
        </p>
      </div>

      <div className="scroll mt-4 min-h-0 flex-1 px-5 pb-1">
        <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-x-3 gap-y-4">
          <Label>Project:</Label>
          <div className="min-w-0">
            {fixedProject && project ? (
              <ProjectLine project={project} />
            ) : !projects?.length ? (
              <Button
                onClick={async () => {
                  const added = await addProject();
                  if (added) setProjectPath(added.path);
                }}
              >
                Add Project…
              </Button>
            ) : (
              <Select
                label="Project"
                value={projectPath ?? NONE}
                className="max-w-full"
                onChange={async (v) => {
                  if (v === ADD_PROJECT) {
                    const chosen = await pickProjectFolder(projects.map((p) => p.path)).catch(() => null);
                    if (!chosen) return;
                    const added = await addProject(chosen);
                    if (added) setProjectPath(added.path);
                  } else setProjectPath(v === NONE ? null : v);
                }}
                options={[
                  ...(projectPath ? [] : [{ value: NONE, label: "Choose a project…" }]),
                  ...projects.map((p) => ({ value: p.path, label: `${p.name}  ·  ${p.displayPath}` })),
                  { value: ADD_PROJECT, label: "Add Project…" },
                ]}
              />
            )}
          </div>

          <Label>Skill:</Label>
          <div className="min-w-0">
            {picking ? (
              <SkillPicker
                skills={pinnable}
                selected={skillId}
                inputRef={searchRef}
                autoFocus={!skill}
                onPick={(s) => {
                  chooseSkill(s);
                  setChangingSkill(false);
                }}
              />
            ) : (
              skill && (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{skill.name}</div>
                    <div className="line-clamp-2 text-[12px] leading-snug text-fg-2">{skill.description || "No description"}</div>
                  </div>
                  <button type="button" className="shrink-0 rounded px-1 text-[12px] text-accent-text hover:underline" onClick={() => setChangingSkill(true)}>
                    Change…
                  </button>
                </div>
              )
            )}
          </div>

          <Label>Name:</Label>
          <div className="min-w-0">
            <TextField
              data-autofocus={skill ? true : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              placeholder={skill ? `${skill.id}-pinned` : "browser-qa-release"}
              mono
              maxLength={80}
              className={cx("w-full", trimmed && (local || verdict?.ok === false) && "border-red")}
              aria-invalid={!!(trimmed && (local || verdict?.ok === false))}
              aria-describedby="pin-name-note"
            />
            <div id="pin-name-note" className="mt-1.5 text-[11.5px] leading-snug">
              <NameStatus name={trimmed} local={local} checking={checking} verdict={verdict} hasProject={!!project} hasSkill={!!skill} />
              {verdict?.ok !== false && (
                <div className="mt-0.5 text-fg-3">Claude Code prefers your personal skills over a project's, so the pinned copy gets its own name.</div>
              )}
            </div>
          </div>

          <Label>Version:</Label>
          <VersionChoice kind={versionKind} onKind={setVersionKind} gitRef={ref} onRef={setRef} source={github} sourceKnown={!!skill} />

          <Label>Agents:</Label>
          <AgentsChoice agents={agents} native={native} folders={folders} selected={selected} included={included} onChange={setPicked} />

          <Label>Mode:</Label>
          <div className="min-w-0">
            <Segmented
              value={mode}
              onChange={setMode}
              label="How agents reach the pinned copy"
              options={[
                { value: "symlink", label: "Links" },
                { value: "copy", label: "Copies" },
              ]}
            />
            <div className="mt-1.5 text-[11.5px] leading-snug text-fg-3">
              {mode === "symlink"
                ? "Each agent folder links to the pinned folder, so the repo holds one copy. Use copies if this repo is used on Windows."
                : "Each agent folder gets its own full copy. Works everywhere, including Windows."}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-3 border-t border-line px-5 py-3">
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-red">{error}</span>
        <Button size="lg" className="min-w-[76px]" onClick={close}>
          Cancel
        </Button>
        <Button size="lg" type="submit" variant="primary" className="min-w-[96px]" disabled={!canSubmit} loading={busy}>
          Pin Skill
        </Button>
      </div>
    </form>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="pt-[4px] text-right text-[13px]">{children}</div>;
}

function ProjectLine({ project }: { project: ProjectSummary }) {
  return (
    <div className="min-w-0 pt-[3px]">
      <span className="text-[13px] font-medium">{project.name}</span>
      <span className="ml-2 font-mono text-[11.5px] text-fg-3">{project.displayPath}</span>
    </div>
  );
}

function NameStatus({
  name,
  local,
  checking,
  verdict,
  hasProject,
  hasSkill,
}: {
  name: string;
  local: string | null;
  checking: boolean;
  verdict: NameCheck | null | undefined;
  hasProject: boolean;
  hasSkill: boolean;
}) {
  if (!name) return null;
  if (local) return <div className="text-red">{local}</div>;
  if (!hasProject || !hasSkill) return null;
  if (checking) {
    return (
      <div className="flex items-center gap-1.5 text-fg-3">
        <Loader2 size={11} className="spin" /> Checking the name…
      </div>
    );
  }
  if (verdict && !verdict.ok) return <div className="text-red">{verdict.message ?? "That name can't be used."}</div>;
  if (verdict?.ok) {
    return (
      <div className="flex items-start gap-1.5 text-green">
        <Check size={12} strokeWidth={2.6} className="mt-[3px] shrink-0" />
        <span>
          Available. In Claude Code, use <span className="font-mono">/{name}</span>.
        </span>
      </div>
    );
  }
  return null;
}

// ── Skill picker ─────────────────────────────────────────────────────────────

function SkillPicker({
  skills,
  selected,
  onPick,
  inputRef,
  autoFocus,
}: {
  skills: Skill[];
  selected: string | null;
  onPick: (s: Skill) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  autoFocus: boolean;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return skills
      .filter((s) => !words.length || words.every((w) => `${s.name} ${s.description} ${s.source?.source ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [skills, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div>
      <SearchField
        ref={inputRef}
        data-autofocus={autoFocus ? true : undefined}
        value={query}
        onChange={setQuery}
        placeholder="Search your library"
        aria-label="Search your library"
        className="w-full"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            // Choose the highlighted skill; don't submit the form.
            e.preventDefault();
            if (results[active]) onPick(results[active]);
          }
        }}
      />
      <div ref={listRef} role="listbox" aria-label="Skills you can pin" className="scroll mt-1.5 h-[148px] rounded-[7px] border-[0.5px] border-line-2 bg-surface-2 p-1">
        {results.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="option"
            data-index={i}
            aria-selected={s.id === selected}
            onClick={() => onPick(s)}
            onMouseMove={() => active !== i && setActive(i)}
            className={cx("flex w-full items-center gap-2 rounded-[5px] px-2 py-[4px] text-left", i === active ? "bg-[var(--q-sel)]" : "hover:bg-hover")}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{s.name}</span>
              <span className="block truncate text-[11.5px] text-fg-3">{s.description || "No description"}</span>
            </span>
            {s.id === selected && <Check size={13} strokeWidth={2.6} className="shrink-0 text-accent" />}
          </button>
        ))}
        {!results.length && (
          <p className="px-2 py-3 text-[12px] text-fg-3">
            {skills.length ? "Nothing in your library matches." : "No skill in your library has a shared copy to pin yet."}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Version choice ───────────────────────────────────────────────────────────

function RadioRow({
  checked,
  disabled,
  onSelect,
  title,
  note,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  note: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx(disabled && "opacity-55")}>
      <button type="button" role="radio" aria-checked={checked} disabled={disabled} onClick={onSelect} className="flex w-full items-start gap-2 rounded text-left">
        <span
          aria-hidden
          className={cx(
            "mt-[3px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full",
            checked
              ? "bg-accent shadow-[inset_0_0.5px_0_rgba(255,255,255,0.25)]"
              : "border-[0.5px] border-[rgba(0,0,0,0.3)] bg-white shadow-[0_0.5px_1px_rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.22)] dark:bg-[rgba(255,255,255,0.08)]",
          )}
        >
          {checked && <span className="h-[5px] w-[5px] rounded-full bg-white" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-[20px]">{title}</span>
          <span className="block text-[11.5px] leading-snug text-fg-3">{note}</span>
        </span>
      </button>
      {children && <div className="mt-1.5 pl-[22px]">{children}</div>}
    </div>
  );
}

/** Current shared version, or a tag, branch or commit on GitHub (only for skills that came from GitHub). */
export function VersionChoice({
  kind,
  onKind,
  gitRef,
  onRef,
  source,
  sourceKnown,
}: {
  kind: "shared" | "github";
  onKind: (k: "shared" | "github") => void;
  gitRef: string;
  onRef: (v: string) => void;
  /** The skill's GitHub source; null when it didn't come from GitHub. */
  source: SkillSource | null;
  /** False until a skill is chosen. */
  sourceKnown: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div role="radiogroup" aria-label="Version to pin" className="flex min-w-0 flex-col gap-2.5 pt-[3px]">
      <RadioRow checked={kind === "shared"} onSelect={() => onKind("shared")} title="Current shared version" note="Exactly what your agents use right now." />
      <RadioRow
        checked={kind === "github"}
        disabled={!source}
        onSelect={() => {
          onKind("github");
          requestAnimationFrame(() => input.current?.focus());
        }}
        title="A GitHub version"
        note={
          source
            ? `A tag, branch or commit from ${source.source}.`
            : sourceKnown
              ? "Only skills installed from GitHub have versions to choose from."
              : "Choose a skill first."
        }
      >
        {kind === "github" && source && (
          <>
            <TextField
              ref={input}
              value={gitRef}
              onChange={(e) => onRef(e.target.value)}
              placeholder="v1.4.0, main or a commit"
              mono
              className="w-full"
              aria-label="Tag, branch or commit"
            />
            <div className="mt-1 text-[11.5px] leading-snug text-fg-3">Quiver looks up the exact commit today and pins that one.</div>
          </>
        )}
      </RadioRow>
    </div>
  );
}

// ── Agents choice ────────────────────────────────────────────────────────────

interface Folder {
  dir: string;
  agents: AgentInfo[];
}

function groupByFolder(agents: AgentInfo[]): Folder[] {
  const map = new Map<string, AgentInfo[]>();
  for (const a of agents) map.set(a.projectDir!, [...(map.get(a.projectDir!) ?? []), a]);
  return [...map.entries()].map(([dir, list]) => ({ dir, agents: list }));
}

function AgentsChoice({
  agents,
  native,
  folders,
  selected,
  included,
  onChange,
}: {
  agents: AgentInfo[];
  native: AgentInfo[];
  folders: Folder[];
  selected: Set<string>;
  included: AgentInfo[];
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  if (!agents.length) {
    return <div className="pt-[4px] text-[12px] text-fg-2">None of your agents read skills from a project folder.</div>;
  }
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group -ml-1 flex max-w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[13px]"
      >
        <ChevronRight size={11} strokeWidth={2.6} className={cx("shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} />
        <span className="flex shrink-0 -space-x-1">
          {included.slice(0, 4).map((a) => (
            <AgentIcon key={a.id} id={a.id} name={a.name} size={16} />
          ))}
        </span>
        <span className="min-w-0 truncate">{summarizeAgents(included)}</span>
      </button>
      {!open && included.length === 0 && <div className="mt-1 text-[11.5px] text-red">Choose at least one agent.</div>}

      {open && (
        <div className="anim-fade mt-1.5 rounded-[8px] border-[0.5px] border-line-2 bg-surface-2 p-2.5">
          {folders.map((f) => (
            <div key={f.dir} className="mb-2 last:mb-0">
              <div className="mb-0.5 flex items-baseline gap-1.5 text-[11.5px] text-fg-3">
                <span className="font-mono">{f.dir}</span>
                {f.agents.length > 1 && <span>shared by {f.agents.length} agents</span>}
              </div>
              {f.agents.map((a) => (
                <div key={a.id} onClick={() => toggle(a.id)} className="flex h-[24px] items-center gap-2 text-[12.5px]">
                  <Checkbox checked={selected.has(a.id)} onChange={() => toggle(a.id)} label={a.name} />
                  <AgentIcon id={a.id} name={a.name} size={16} />
                  <span className="truncate">{a.name}</span>
                </div>
              ))}
            </div>
          ))}
          {native.length > 0 && (
            <div className={cx(folders.length > 0 && "border-t border-line pt-2")}>
              <div className="mb-0.5 flex items-baseline gap-1.5 text-[11.5px] text-fg-3">
                <span className="font-mono">{NATIVE_DIR}</span>
                <span>shared by {native.length} agents, no link needed</span>
              </div>
              <div className="flex items-start gap-2 text-[12.5px] leading-snug text-fg-2">
                <span className="mt-[3px] flex shrink-0 -space-x-1">
                  {native.slice(0, 5).map((a) => (
                    <AgentIcon key={a.id} id={a.id} name={a.name} size={16} />
                  ))}
                </span>
                <span className="min-w-0">{listNames(native.map((a) => a.name))} read this folder directly.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Update Pin ───────────────────────────────────────────────────────────────

/** Move an existing pin to the current shared version, or to a GitHub tag, branch or commit. */
export function UpdatePinSheet({ project, pin, onClose }: { project: ProjectSummary | null; pin: Pin | null; onClose: () => void }) {
  return (
    <Sheet open={!!pin && !!project} onClose={onClose} width={460} label={pin ? `Update ${pin.name}` : "Update pin"}>
      {pin && project && <UpdateForm key={pin.name} project={project} pin={pin} onClose={onClose} />}
    </Sheet>
  );
}

function UpdateForm({ project, pin, onClose }: { project: ProjectSummary; pin: Pin; onClose: () => void }) {
  const { inventory } = useData();
  const { updatePin } = usePinActions();
  const [kind, setKind] = useState<"shared" | "github">("shared");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const known = inventory?.skills.find((s) => s.id === pin.skill)?.source ?? pin.source;
  const source = known?.kind === "github" ? known : null;
  const ok = kind === "shared" || !!ref.trim();

  return (
    <form
      className="flex flex-col"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        const done = await updatePin(project, pin, kind === "github" ? ref.trim() : null);
        setBusy(false);
        if (done) onClose();
      }}
    >
      <div className="px-5 pt-5">
        <div className="text-[13px] font-semibold">Update Pin</div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-2">
          Choose the version <span className="font-mono text-[11px]">{pin.name}</span> in {project.name} should hold from now on. Other projects aren't affected.
        </p>
      </div>
      <div className="mt-4 grid grid-cols-[78px_minmax(0,1fr)] items-start gap-x-3 px-5">
        <Label>Version:</Label>
        <VersionChoice kind={kind} onKind={setKind} gitRef={ref} onRef={setRef} source={source} sourceKnown />
      </div>
      {pin.state === "modified" && (
        <p className="mx-5 mt-4 text-[12px] leading-snug text-amber">
          {pin.changedFiles.length ? `Your edits to ${listNames(pin.changedFiles.slice(0, 3))}${pin.changedFiles.length > 3 ? ` and ${plural(pin.changedFiles.length - 3, "other file")}` : ""} in this project will be replaced.` : "Your edits to the pinned files will be replaced."}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2 px-5 pb-4">
        <Button size="lg" className="min-w-[76px]" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" type="submit" variant="primary" className="min-w-[96px]" disabled={!ok} loading={busy}>
          Update Pin
        </Button>
      </div>
    </form>
  );
}

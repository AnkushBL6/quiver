// Compare conflicting copies of a skill: one column per version on top, the files that
// differ below, and a side-by-side diff of the selected file. Opens from Health.
// The same sheet compares a project's pinned copy with the shared one (PinCompareSheet).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeftRight, FileMinus, FilePen, FilePlus, GitCompareArrows, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { AgentInfo, CopyComparison, FileCompare, FileDiff, Pin, Skill, SkillVersion, UpstreamCheck } from "../lib/types";
import { cx, formatBytes, listNames, plural, shortRef, tildify, timeAgo, visibleAgents } from "../lib/ui";
import { useData } from "../state/store";
import { AgentIcon, GitHubMark } from "../components/identity";
import { DiffView } from "../components/DiffView";
import { Button, Chip, IconButton, Select, Skeleton, Spinner } from "../components/ui";
import { Sheet, isTopLayer } from "../components/overlay";

// ── data ─────────────────────────────────────────────────────────────────────

/** What a sheet compares: where the two sides come from. The key identifies it across renders. */
interface Source {
  key: string;
  compare: () => Promise<CopyComparison>;
  file: (path: string, leftHash: string, rightHash: string) => Promise<FileDiff>;
  /** Only copies with a GitHub source can ask GitHub. */
  upstream: (() => Promise<UpstreamCheck>) | null;
}

/** The local comparison first; then, separately, GitHub (it can be slow or offline and never holds anything up). */
function useComparison(source: Source) {
  const { inventory } = useData();
  const scannedAt = inventory?.scannedAtMs;
  const ref = useRef(source);
  ref.current = source;
  const key = source.key;
  const [data, setData] = useState<CopyComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<UpstreamCheck | "loading" | null>(null);

  useEffect(() => {
    let alive = true;
    ref.current
      .compare()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [key, scannedAt]);

  // Ask again only when what's on disk changed, not on every rescan.
  const signature = data ? data.versions.map((v) => v.contentHash).join() : null;
  const checkable = !!data?.upstreamSource && !!source.upstream;
  useEffect(() => {
    const ask = ref.current.upstream;
    if (!checkable || !ask) {
      setUpstream(null);
      return;
    }
    let alive = true;
    setUpstream("loading");
    ask()
      .then((u) => alive && setUpstream(u))
      .catch((e) => alive && setUpstream({ status: "unavailable", source: null, matchingHashes: [], message: errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, [key, checkable, signature]);

  return { data, error, upstream };
}

function useFileDiff(source: Source, path: string | null, leftHash: string | null, rightHash: string | null) {
  const cache = useRef(new Map<string, FileDiff>());
  const ref = useRef(source);
  ref.current = source;
  const key = path && leftHash && rightHash ? [path, leftHash, rightHash].join("\u0000") : null;
  const [state, setState] = useState<{ key: string; diff?: FileDiff; error?: string } | null>(null);
  useEffect(() => {
    if (!key || !path || !leftHash || !rightHash) return;
    const hit = cache.current.get(key);
    if (hit) {
      setState({ key, diff: hit });
      return;
    }
    let alive = true;
    ref.current
      .file(path, leftHash, rightHash)
      .then((diff) => {
        cache.current.set(key, diff);
        if (alive) setState({ key, diff });
      })
      .catch((e) => alive && setState({ key, error: errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, [source.key, key, path, leftHash, rightHash]);
  const current = state?.key === key ? state : null;
  return { diff: current?.diff ?? null, error: current?.error ?? null, loading: !!key && !current };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const versionNumber = (v: SkillVersion) => v.id.replace(/^v/, "");
const versionName = (v: SkillVersion) => `Version ${versionNumber(v)}`;

function holderNames(v: SkillVersion, agents: AgentInfo[]) {
  return visibleAgents(agents)
    .filter((a) => v.agentIds.includes(a.id))
    .map((a) => a.name);
}

/** "Shared copy", "Cursor", "Claude Code and Codex": who has it, in a few words. */
function holderLabel(v: SkillVersion, agents: AgentInfo[]) {
  if (v.shared) return "Shared copy";
  const names = holderNames(v, agents);
  return names.length ? listNames(names.slice(0, 2)) + (names.length > 2 ? ` +${names.length - 2}` : "") : tildify(v.locations[0]?.path);
}

/** The path "Keep This Version" hands to the keep flow: the shared copy if this version has it, else the first copy. */
function keepPath(v: SkillVersion) {
  return (v.locations.find((l) => l.kind === "canonical") ?? v.locations[0])?.path ?? null;
}

type PairState = "changed" | "onlyLeft" | "onlyRight";
interface PairFile {
  file: FileCompare;
  state: PairState;
}

/** How each file differs between two versions (files that are the same, or in neither, are left out). */
function pairFiles(files: FileCompare[], li: number, ri: number): { changed: PairFile[]; same: number } {
  const changed: PairFile[] = [];
  let same = 0;
  for (const file of files) {
    const a = file.variants[li];
    const b = file.variants[ri];
    if (!a && !b) continue;
    if (a && b && a.digest === b.digest) same++;
    else changed.push({ file, state: !a ? "onlyRight" : !b ? "onlyLeft" : "changed" });
  }
  return { changed, same };
}

// ── sheet ────────────────────────────────────────────────────────────────────

/** What the sheet is for: choosing between conflicting copies, or comparing a pin with the shared copy. */
type Mode =
  | { kind: "copies"; skill: Skill; onKeep: (path: string) => Promise<boolean> }
  | { kind: "pin"; project: { path: string; name: string }; pin: Pin; onUpdate: () => Promise<boolean> };

/** How a version is named: "Version 2" for conflicting copies, "Shared copy" / "Pinned in acme-web" for a pin. */
interface Naming {
  name: (v: SkillVersion) => string;
  /** Name plus who has it, for the diff headers and pickers. */
  label: (v: SkillVersion) => string;
}

const sheetProps = {
  width: 1120,
  maxHeight: "calc(100vh - 76px)",
  className: "h-[calc(100vh-76px)]",
};

/** Opens when `skill` is set. `onKeep` is the existing keep flow: it resolves true when it worked. */
export function CompareSheet({
  skill,
  onKeep,
  onClose,
}: {
  skill: Skill | null;
  onKeep: (path: string) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!skill} onClose={onClose} {...sheetProps} label={skill ? `Compare copies of ${skill.name}` : "Compare copies"}>
      {skill && <CompareBody key={skill.id} mode={{ kind: "copies", skill, onKeep }} onClose={onClose} />}
    </Sheet>
  );
}

/**
 * A project's pinned copy against the shared one. Opens when `pin` is set. `onUpdate` re-pins from the
 * shared version and resolves true when it worked; the sheet closes then.
 */
export function PinCompareSheet({
  project,
  pin,
  onUpdate,
  onClose,
}: {
  project: { path: string; name: string };
  pin: Pin | null;
  onUpdate: (pin: Pin) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!pin} onClose={onClose} {...sheetProps} label={pin ? `Compare ${pin.name} with the shared ${pin.skill}` : "Compare with shared"}>
      {pin && <CompareBody key={`${project.path}\u0000${pin.name}`} mode={{ kind: "pin", project, pin, onUpdate: () => onUpdate(pin) }} onClose={onClose} />}
    </Sheet>
  );
}

function CompareBody({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const { inventory } = useData();
  const agents = inventory?.agents ?? [];
  const subjectId = mode.kind === "copies" ? mode.skill.id : `${mode.project.path}\u0000${mode.pin.name}`;
  const source = useMemo<Source>(
    () =>
      mode.kind === "copies"
        ? {
            key: mode.skill.id,
            compare: () => api.compareCopies(mode.skill.id),
            file: (path, l, r) => api.compareFile(mode.skill.id, path, l, r),
            upstream: () => api.compareUpstream(mode.skill.id),
          }
        : {
            key: subjectId,
            compare: () => api.pinCompare(mode.project.path, mode.pin.name),
            file: (path, l, r) => api.pinCompareFile(mode.project.path, mode.pin.name, path, l, r),
            upstream: null,
          },
    // A source is identified by the skill, or by the project and the pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjectId],
  );
  const naming: Naming =
    mode.kind === "pin"
      ? (() => {
          const name = (v: SkillVersion) => (v.shared ? "Shared copy" : `Pinned in ${mode.project.name}`);
          return { name, label: name };
        })()
      : { name: versionName, label: (v) => `${versionName(v)} · ${holderLabel(v, agents)}` };
  const { data, error, upstream } = useComparison(source);
  const root = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<[string, string] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const versions = data?.versions ?? [];
  const byHash = useMemo(() => new Map(versions.map((v) => [v.contentHash, v])), [versions]);

  // The two versions on screen: the user's pick while it is still valid, else the suggested pair.
  const pair = useMemo<[SkillVersion, SkillVersion] | null>(() => {
    if (!data) return null;
    const a = pick && byHash.get(pick[0]);
    const b = pick && byHash.get(pick[1]);
    if (a && b && a !== b) return [a, b];
    if (mode.kind === "pin") {
      // What you have on the left, what updating would give you on the right: green lines are what an update adds.
      const shared = data.versions.find((v) => v.shared);
      const pinned = data.versions.find((v) => !v.shared);
      return shared && pinned ? [pinned, shared] : null;
    }
    const l = data.versions.find((v) => v.id === data.suggested?.[0]);
    const r = data.versions.find((v) => v.id === data.suggested?.[1]);
    return l && r ? [l, r] : null;
  }, [data, pick, byHash, mode.kind]);
  const [left, right] = pair ?? [null, null];

  const { changed, same } = useMemo(() => {
    if (!data || !left || !right) return { changed: [], same: 0 };
    return pairFiles(data.files, versions.indexOf(left), versions.indexOf(right));
  }, [data, left, right, versions]);

  // SKILL.md if it changed, else the first changed file.
  const active = changed.find((c) => c.file.path === chosen) ?? changed.find((c) => c.file.path === "SKILL.md") ?? changed[0] ?? null;
  const { diff, error: diffError, loading: diffLoading } = useFileDiff(source, active?.file.path ?? null, left?.contentHash ?? null, right?.contentHash ?? null);

  // ↑ / ↓ move between files.
  const activeIndex = active ? changed.indexOf(active) : -1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      const dialog = root.current?.closest<HTMLElement>('[role="dialog"]');
      if (!dialog || !isTopLayer(dialog) || !changed.length) return;
      e.preventDefault();
      const next = Math.max(0, Math.min(changed.length - 1, activeIndex + (e.key === "ArrowDown" ? 1 : -1)));
      setChosen(changed[next].file.path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changed, activeIndex]);

  const keep = async (v: SkillVersion) => {
    if (mode.kind !== "copies") return;
    const path = keepPath(v);
    if (!path) return;
    setBusy(v.id);
    const ok = await mode.onKeep(path);
    setBusy(null);
    if (ok) onClose();
  };
  const updatePin = async () => {
    if (mode.kind !== "pin") return;
    setBusy("update");
    const ok = await mode.onUpdate();
    setBusy(null);
    if (ok) onClose();
  };

  const swap = () => left && right && setPick([right.contentHash, left.contentHash]);
  // Choosing the version already shown on the other side swaps the two.
  const choose = (side: 0 | 1, hash: string) => {
    if (!left || !right) return;
    const [l, r] = [left.contentHash, right.contentHash];
    if (side === 0) setPick(hash === r ? [r, l] : [hash, r]);
    else setPick(hash === l ? [r, l] : [l, hash]);
  };

  const checking = upstream === "loading";
  const upstreamDown = upstream && upstream !== "loading" && upstream.status === "unavailable";
  const matches = (v: SkillVersion) => !!upstream && upstream !== "loading" && upstream.status === "checked" && upstream.matchingHashes.includes(v.contentHash);

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-4">
        <GitCompareArrows size={16} className="text-fg-2" />
        <h2 className="text-[13px] font-semibold">{mode.kind === "pin" ? "Compare with shared" : "Compare copies"}</h2>
        <span className="min-w-0 truncate text-[13px] text-fg-2">{mode.kind === "pin" ? mode.pin.name : mode.skill.name}</span>
        <div className="flex-1" />
        {checking && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
            <Spinner size={12} /> Checking GitHub…
          </span>
        )}
        {upstreamDown && (
          <span className="text-[11.5px] text-fg-3" title={upstream.message ?? undefined}>
            Couldn't check GitHub
          </span>
        )}
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </IconButton>
      </div>

      {error ? (
        <div className="m-5 flex items-center gap-2 rounded-lg bg-red-soft p-3 text-[12.5px] text-red">
          <AlertTriangle size={14} /> {error}
        </div>
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 p-5">
          <Skeleton className="h-[150px] rounded-[10px]" />
          <Skeleton className="h-[150px] rounded-[10px]" />
        </div>
      ) : !left || !right ? (
        <p className="m-6 text-[13px] text-fg-2">Every copy of {data.name} is identical, so there's nothing to compare.</p>
      ) : (
        <>
          {mode.kind === "pin" ? (
            <p className="shrink-0 px-5 pt-3 text-[13px] leading-[1.5] text-fg-2">
              {changed.length === 0
                ? `The pinned ${mode.pin.skill} in ${mode.project.name} matches the shared one.`
                : `${mode.project.name} keeps its own copy of ${mode.pin.skill}, so changes to the shared one don't reach it. Updating the pin replaces the pinned files with the shared version${mode.pin.state === "modified" ? " and discards your edits to them" : ""}. Your other projects aren't affected.`}
            </p>
          ) : (
            <p className="shrink-0 px-5 pt-3 text-[13px] leading-[1.5] text-fg-2">
              <span className="font-medium text-fg">{plural(versions.length, "version")}</span> of {data.name} exist.
              {versions.length > 2 ? " Choose the two to compare. " : " "}
              Find the one with the fix, then keep it: every agent will use it and the other copies become links.
            </p>
          )}

          <div className="grid shrink-0 grid-cols-2 gap-3 px-5 pt-3 pb-4">
            {([left, right] as const).map((v, side) => (
              <VersionCard
                key={side}
                version={v}
                agents={agents}
                versions={versions}
                naming={naming}
                pin={mode.kind === "pin" ? { project: mode.project.name, pin: mode.pin } : null}
                onPick={mode.kind === "copies" && versions.length > 2 ? (hash) => choose(side as 0 | 1, hash) : undefined}
                matchesGithub={matches(v)}
                busy={busy === v.id}
                disabled={!!busy}
                onKeep={mode.kind === "copies" ? () => void keep(v) : undefined}
              />
            ))}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)] border-t border-line">
            <FileList items={changed} active={active} same={same} onSelect={setChosen} left={left} right={right} naming={naming} />
            <div className="flex min-h-0 min-w-0 flex-col border-l border-line">
              {active ? (
                <>
                  <div className="flex h-[34px] shrink-0 items-center gap-3 border-b border-line px-3">
                    <span className="selectable min-w-0 truncate font-mono text-[12px] font-medium" title={active.file.path}>
                      {active.file.path}
                    </span>
                    {diff && diff.content === "text" && (diff.added > 0 || diff.removed > 0) && (
                      <span className="flex shrink-0 gap-2 text-[11.5px] font-medium tabular-nums">
                        <span className="text-green">+{diff.added}</span>
                        <span className="text-red">−{diff.removed}</span>
                      </span>
                    )}
                    <div className="flex-1" />
                    <IconButton label="Swap sides" onClick={swap}>
                      <ArrowLeftRight size={14} />
                    </IconButton>
                  </div>
                  <DiffBody
                    state={active.state}
                    diff={diff}
                    error={diffError}
                    loading={diffLoading}
                    left={left}
                    right={right}
                    naming={naming}
                  />
                </>
              ) : (
                <p className="m-6 text-[13px] text-fg-2">
                  {mode.kind === "pin"
                    ? "The pinned copy and the shared copy have identical files."
                    : `${versionName(left)} and ${versionName(right)} have identical files.${versions.length > 2 ? " Pick a different pair above." : ""}`}
                </p>
              )}
            </div>
          </div>

          {mode.kind === "pin" && (
            <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-3">
                Pinned copies live in the repo, so commit the update with your code.
              </span>
              <Button size="lg" onClick={onClose} disabled={busy === "update"}>
                Close
              </Button>
              <Button
                size="lg"
                variant="primary"
                loading={busy === "update"}
                disabled={changed.length === 0 && mode.pin.state === "ok" && mode.pin.pinnedFrom === "shared"}
                title={changed.length === 0 && mode.pin.state === "ok" && mode.pin.pinnedFrom === "shared" ? "The pin already matches the shared version" : undefined}
                onClick={() => void updatePin()}
              >
                Update Pin to Shared Version
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── version column ───────────────────────────────────────────────────────────

function VersionCard({
  version: v,
  agents,
  versions,
  naming,
  pin,
  onPick,
  matchesGithub,
  busy,
  disabled,
  onKeep,
}: {
  version: SkillVersion;
  agents: AgentInfo[];
  versions: SkillVersion[];
  naming: Naming;
  /** Set when comparing a pin: the card describes the shared copy or the project's pinned copy. */
  pin: { project: string; pin: Pin } | null;
  onPick?: (hash: string) => void;
  matchesGithub: boolean;
  busy: boolean;
  disabled: boolean;
  /** Absent when the sheet has no "keep" step (comparing a pin). */
  onKeep?: () => void;
}) {
  const holders = visibleAgents(agents).filter((a) => v.agentIds.includes(a.id));
  const names = holders.map((a) => a.name);
  const who = names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : listNames(names);
  const edited = v.editedSinceInstall === true && !matchesGithub;
  const where = v.locations[0] ? tildify(v.locations[0].path) : "";
  const extra = v.locations.length - 1;

  if (pin) {
    // Comparing a pin: two short cards, so the diff keeps most of the sheet.
    return (
      <section aria-label={naming.name(v)} className="flex min-w-0 flex-col rounded-[10px] border-[0.5px] border-line-2 bg-surface-2 px-3.5 py-3">
        <div className="flex min-h-[22px] flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[14px] font-semibold">{naming.name(v)}</h3>
          {v.shared && pin.pin.sharedChanged === true && (
            <Chip tone="accent" className="h-[20px] text-[11.5px]" title="The shared copy changed after this project pinned it">
              Changed since pinned
            </Chip>
          )}
          {!v.shared && pin.pin.state === "modified" && (
            <Chip tone="amber" className="h-[20px] text-[11.5px]" title={pin.pin.changedFiles.join("\n") || undefined}>
              Edited in this project
            </Chip>
          )}
          {!v.shared && pin.pin.pinnedFrom === "github" && pin.pin.gitRef && (
            <Chip className="h-[20px] text-[11.5px]" title={`Pinned from GitHub at ${pin.pin.gitRef}`}>
              <GitHubMark size={11} /> {shortRef(pin.pin.gitRef)}
            </Chip>
          )}
        </div>
        <div className="mt-1 text-[12.5px] text-fg-2">
          {v.shared ? "Used by every project without its own pin" : `Used only in ${pin.project}`}
          <span className="text-fg-3"> · </span>
          <span title={v.modifiedMs ? new Date(v.modifiedMs).toLocaleString() : undefined}>Modified {timeAgo(v.modifiedMs)}</span>
          <span className="text-fg-3"> · </span>
          {plural(v.fileCount, "file")}
        </div>
        <div className="mt-2 flex items-baseline gap-3 font-mono text-[11px] text-fg-3">
          <span className="min-w-0 flex-1 truncate" title={v.locations.map((l) => l.path).join("\n")}>
            {where}
          </span>
          <span className="shrink-0 text-[10.5px]" title="A short fingerprint of this version's contents">
            {v.contentHash.slice(0, 7)}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={naming.name(v)} className="flex min-w-0 flex-col rounded-[10px] border-[0.5px] border-line-2 bg-surface-2 p-3.5">
      <div className="flex items-center gap-2">
        {onPick ? (
          <Select
            label="Version to show in this column"
            value={v.contentHash}
            onChange={onPick}
            options={versions.map((x) => ({ value: x.contentHash, label: naming.label(x) }))}
            className="min-w-0 max-w-full [&_select]:h-[24px] [&_select]:font-semibold"
          />
        ) : (
          <h3 className="text-[14px] font-semibold">{naming.name(v)}</h3>
        )}
        {!onPick && v.shared && <span className="text-[12px] text-fg-3">Shared copy</span>}
      </div>

      <div className="mt-2.5 flex min-h-[20px] items-center gap-2 text-[12.5px]">
        {holders.length > 0 && (
          <span className="flex shrink-0 -space-x-1">
            {holders.slice(0, 5).map((a) => (
              <AgentIcon key={a.id} id={a.id} name={a.name} size={18} />
            ))}
          </span>
        )}
        <span className="min-w-0 truncate" title={names.join(", ")}>
          {who || "Only on disk, no agent reads it yet"}
        </span>
      </div>

      <div className="mt-1 text-[12.5px] text-fg-2">
        <span title={v.modifiedMs ? new Date(v.modifiedMs).toLocaleString() : undefined}>Modified {timeAgo(v.modifiedMs)}</span>
        <span className="text-fg-3"> · </span>
        {plural(v.fileCount, "file")}
      </div>

      <div className="mt-2 flex min-h-[20px] flex-wrap items-center gap-1.5">
        {v.newest && (
          <Chip tone="accent" className="h-[20px] text-[11.5px]" title="Changed more recently than the other versions">
            Newest
          </Chip>
        )}
        {matchesGithub && (
          <Chip tone="green" className="h-[20px] text-[11.5px]" title="Identical to the latest version on GitHub">
            <GitHubMark size={11} /> Matches GitHub
          </Chip>
        )}
        {edited && (
          <Chip tone="amber" className="h-[20px] text-[11.5px]" title="Different from the version that was installed">
            Edited since install
          </Chip>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-fg-3" title={v.locations.map((l) => l.path).join("\n")}>
            {where}
            {extra > 0 && ` +${extra} more`}
          </div>
          <div className="font-mono text-[10.5px] text-fg-3" title="A short fingerprint of this version's contents">
            {v.contentHash.slice(0, 7)}
          </div>
        </div>
        {onKeep && (
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={disabled}
            onClick={onKeep}
            title="Use this version everywhere; the other copies become links to it"
          >
            Keep This Version
          </Button>
        )}
      </div>
    </section>
  );
}

// ── file list ────────────────────────────────────────────────────────────────

const STATE_ICON = {
  changed: { Icon: FilePen, tone: "text-amber", label: "Changed" },
  onlyLeft: { Icon: FileMinus, tone: "text-red", label: "Only in the left version" },
  onlyRight: { Icon: FilePlus, tone: "text-green", label: "Only in the right version" },
} as const;

function FileList({
  items,
  active,
  same,
  onSelect,
  left,
  right,
  naming,
}: {
  items: PairFile[];
  active: PairFile | null;
  same: number;
  onSelect: (path: string) => void;
  left: SkillVersion;
  right: SkillVersion;
  naming: Naming;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active?.file.path]);

  return (
    <div className="flex min-h-0 flex-col bg-surface">
      <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-line px-3 text-[11.5px] font-semibold text-fg-3">
        <span>What's different</span>
        <span className="font-normal tabular-nums">{items.length ? plural(items.length, "file") : ""}</span>
      </div>
      <div ref={list} role="listbox" aria-label="Files that differ" className="scroll min-h-0 flex-1 p-1.5">
        {items.map(({ file, state }) => {
          const { Icon, tone, label } = STATE_ICON[state];
          const selected = active?.file.path === file.path;
          const slash = file.path.lastIndexOf("/");
          const detail =
            state === "onlyLeft" ? `Only in ${naming.name(left)}` : state === "onlyRight" ? `Only in ${naming.name(right)}` : label;
          return (
            <button
              key={file.path}
              type="button"
              role="option"
              aria-selected={selected}
              title={`${file.path} · ${detail}`}
              onClick={() => onSelect(file.path)}
              className={cx(
                "flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[12.5px]",
                selected ? "bg-[var(--q-sel)]" : "hover:bg-hover",
              )}
            >
              <Icon size={14} className={cx("shrink-0", tone)} aria-label={detail} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-fg-3">{slash >= 0 ? file.path.slice(0, slash + 1) : ""}</span>
                <span className="font-medium">{file.path.slice(slash + 1)}</span>
              </span>
            </button>
          );
        })}
        {!items.length && <p className="px-2 py-3 text-[12.5px] text-fg-3">No files differ.</p>}
      </div>
      {same > 0 && items.length > 0 && <div className="shrink-0 border-t border-line px-3 py-2 text-[11.5px] text-fg-3">{plural(same, "identical file")} not shown</div>}
    </div>
  );
}

// ── diff body ────────────────────────────────────────────────────────────────

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <div className="text-[13px] font-semibold">{title}</div>
      {children && <div className="max-w-[420px] text-[12.5px] leading-[1.5] text-fg-2">{children}</div>}
    </div>
  );
}

function DiffBody({
  state,
  diff,
  error,
  loading,
  left,
  right,
  naming,
}: {
  state: PairState;
  diff: FileDiff | null;
  error: string | null;
  loading: boolean;
  left: SkillVersion;
  right: SkillVersion;
  naming: Naming;
}) {
  if (error) {
    return (
      <div className="m-4 flex items-center gap-2 rounded-lg bg-red-soft p-3 text-[12.5px] text-red">
        <AlertTriangle size={14} /> {error}
      </div>
    );
  }
  if (loading || !diff) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[62, 88, 74, 40, 81, 56].map((w, i) => (
          <Skeleton key={i} className="h-[14px]" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  const size = (n: number | null) => (n === null ? "missing" : formatBytes(n).replace(" ", "\u00a0"));
  const sizes = `${naming.name(left)} is ${size(diff.leftSize)} and ${naming.name(right)} is ${size(diff.rightSize)}`;
  if (diff.content === "binary") {
    return (
      <Notice title="This file can't be shown as text">
        It's a binary file, or not plain UTF-8 text, so there are no lines to compare. The two versions are different. {sizes}.
      </Notice>
    );
  }
  if (diff.content === "tooLarge") {
    return <Notice title="This file is too large to compare line by line">It's bigger than 512 KB. {sizes}.</Notice>;
  }
  if (diff.eolOnly) {
    return <Notice title="Only the line endings differ">The text is the same; one version uses Windows line endings and the other doesn't.</Notice>;
  }
  return (
    <>
      {state !== "changed" && (
        <div className="shrink-0 border-b border-line bg-[var(--q-diff-gap)] px-3 py-1.5 text-[12px] text-fg-2">
          This file only exists in {naming.name(state === "onlyLeft" ? left : right)}.
        </div>
      )}
      <DiffView
        key={`${diff.path}\u0000${left.contentHash}\u0000${right.contentHash}`}
        blocks={diff.blocks}
        leftLabel={naming.label(left)}
        rightLabel={naming.label(right)}
      />
    </>
  );
}

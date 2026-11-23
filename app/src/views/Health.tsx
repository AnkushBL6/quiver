import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, FileWarning, Folder, GitCompareArrows, GitMerge, Link2, Link2Off, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { AgentInfo, OpReport, Skill, SyncOptions, SyncPlan } from "../lib/types";
import { cx, joinPath, plural, tildify } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { AgentAvatar } from "../components/identity";
import { Button, Checkbox, Skeleton, Toolbar, ToolbarTitle } from "../components/ui";
import { CompareSheet } from "./CompareSheet";

/** Run sync_apply, report the outcome, and refresh. Shared with onboarding. */
export async function applySync(options: SyncOptions, rescan: (o?: { quiet?: boolean }) => Promise<void>): Promise<OpReport | null> {
  try {
    const r = await api.syncApply(options);
    const parts: string[] = [];
    if (r.ok.length) parts.push(`${plural(r.ok.length, "skill")} updated`);
    if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
    if (r.errors.length) {
      toast.error(`Finished with ${plural(r.errors.length, "error")}`, {
        description: r.errors.slice(0, 3).map((e) => `${e.id}: ${e.message}`).join("\n"),
      });
    } else {
      toast.success("Everything is in sync", { description: parts.join(" · ") || undefined });
    }
    await rescan({ quiet: true });
    return r;
  } catch (e) {
    toast.error("Sync failed", { description: errorMessage(e) });
    return null;
  }
}

export function usePlan() {
  const { inventory } = useData();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannedAt = inventory?.scannedAtMs;
  const refresh = useCallback(() => {
    let alive = true;
    api
      .syncPlan()
      .then((p) => {
        if (alive) {
          setPlan(p);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (scannedAt === undefined) return;
    return refresh();
  }, [scannedAt, refresh]);
  return { plan, error };
}

export function HealthView() {
  const { inventory } = useData();
  const { rescan, run } = useActions();
  const { go } = useNav();
  const { plan, error } = usePlan();
  const [opts, setOpts] = useState<SyncOptions>({ adopt: true, link: true, prune: true });
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ conflicts: true });
  const [comparing, setComparing] = useState<string | null>(null);

  const agentsById = useMemo(() => new Map(inventory?.agents.map((a) => [a.id, a])), [inventory]);
  const skillsById = useMemo(() => new Map(inventory?.skills.map((s) => [s.id, s])), [inventory]);

  const linksByAgent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [sid, aid] of plan?.links ?? []) m.set(aid, [...(m.get(aid) ?? []), sid]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [plan]);

  const otherIssues = useMemo(
    () =>
      (inventory?.skills ?? []).flatMap((s) =>
        s.issues
          .filter((i) => !["brokenLink", "conflict", "unmanaged"].includes(i.kind))
          .map((i) => ({ skill: s, issue: i })),
      ),
    [inventory],
  );

  const counts = {
    adopt: (plan?.adopt.length ?? 0) + (plan?.register?.length ?? 0),
    link: plan?.links.length ?? 0,
    prune: plan?.prune.length ?? 0,
    conflicts: plan?.conflicts.length ?? 0,
  };
  const selectedWork = (opts.adopt ? counts.adopt : 0) + (opts.link ? counts.link : 0) + (opts.prune ? counts.prune : 0);
  const allClear = plan && counts.adopt + counts.link + counts.prune + counts.conflicts === 0;

  const apply = async () => {
    setApplying(true);
    await applySync(opts, rescan);
    setApplying(false);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar>
        <ToolbarTitle sub={plan ? (allClear ? "All clear" : undefined) : "Analyzing…"}>Health</ToolbarTitle>
        <div data-tauri-drag-region className="flex-1" />
        <Button variant="primary" icon={<Sparkles size={13} />} disabled={!plan || selectedWork === 0} loading={applying} onClick={() => void apply()}>
          Apply{selectedWork ? ` ${selectedWork} change${selectedWork === 1 ? "" : "s"}` : ""}
        </Button>
      </Toolbar>

      <div className="scroll min-h-0 flex-1 bg-surface">
        <div className="mx-auto max-w-[860px] p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-soft p-3 text-[12.5px] text-red">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {!plan ? (
            <div className="grid grid-cols-4 gap-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-[84px] rounded-[10px]" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border-[0.5px] border-line-2 lg:grid-cols-4 [&>*+*]:border-l [&>*+*]:border-line">
                <Stat icon={<Sparkles size={14} />} tone="accent" value={counts.adopt} label="Unmanaged to adopt" />
                <Stat icon={<Link2 size={14} />} tone="blue" value={counts.link} label="Missing links" />
                <Stat icon={<Link2Off size={14} />} tone="red" value={counts.prune} label="Broken links" />
                <Stat icon={<GitMerge size={14} />} tone="amber" value={counts.conflicts} label="Conflicts" />
              </div>

              {allClear && (
                <div className="mt-5 flex items-center gap-3 rounded-[10px] border-[0.5px] border-line-2 bg-surface-2 px-4 py-3.5">
                  <CheckCircle2 size={18} className="text-green" />
                  <div>
                    <div className="text-[13px] font-medium">{inventory?.skills.length ? "Every skill is universal" : "Nothing to fix"}</div>
                    <div className="text-[12px] text-fg-2">
                      {inventory?.skills.length
                        ? "All skills live in ~/.agents/skills and every agent can see them."
                        : "Install a skill and Quiver keeps it linked into every agent."}
                    </div>
                  </div>
                </div>
              )}

              {counts.conflicts > 0 && (
                <Section
                  title="Conflicts"
                  subtitle="Copies with the same name but different contents. Compare them, then choose the one to keep; the others are replaced by links."
                  count={counts.conflicts}
                  open={!!open.conflicts}
                  onToggle={() => setOpen((o) => ({ ...o, conflicts: !o.conflicts }))}
                  icon={<GitMerge size={14} className="text-amber" />}
                  tall
                >
                  {plan.conflicts.map((id) => {
                    const s = skillsById.get(id);
                    return s ? (
                      <ConflictRow
                        key={id}
                        skill={s}
                        agents={agentsById}
                        onCompare={() => setComparing(id)}
                        onKeep={(path) => run(() => api.adopt(id, path), `Kept ${tildify(path)} for ${s.name}`)}
                      />
                    ) : null;
                  })}
                </Section>
              )}

              {counts.adopt > 0 && (
                <Section
                  title="Adopt unmanaged skills"
                  subtitle="Move them into ~/.agents/skills and replace the copies with links."
                  count={counts.adopt}
                  checked={opts.adopt}
                  onCheck={(v) => setOpts((o) => ({ ...o, adopt: v }))}
                  open={!!open.adopt}
                  onToggle={() => setOpen((o) => ({ ...o, adopt: !o.adopt }))}
                  icon={<Sparkles size={14} className="text-accent-text" />}
                >
                  {(plan.register ?? []).map((id) => (
                    <ItemRow key={`register-${id}`}>
                      <span className="truncate font-medium">{id}</span>
                      <span className="truncate text-fg-3">new in My Skills</span>
                    </ItemRow>
                  ))}
                  {plan.adopt.map((id) => {
                    const s = skillsById.get(id);
                    const where = s?.locations.filter((l) => l.kind === "directory").map((l) => agentsById.get(l.agentId ?? "")?.name ?? l.agentId) ?? [];
                    return (
                      <ItemRow key={id} onClick={() => go("library", { selectedId: id, filter: "all", agentFilter: null })}>
                        <span className="truncate font-medium">{s?.name ?? id}</span>
                        <span className="truncate text-fg-3">in {where.join(", ")}</span>
                      </ItemRow>
                    );
                  })}
                </Section>
              )}

              {counts.link > 0 && (
                <Section
                  title="Link missing skills"
                  subtitle="Give every detected agent every managed skill."
                  count={counts.link}
                  checked={opts.link}
                  onCheck={(v) => setOpts((o) => ({ ...o, link: v }))}
                  open={!!open.link}
                  onToggle={() => setOpen((o) => ({ ...o, link: !o.link }))}
                  icon={<Link2 size={14} className="text-blue" />}
                >
                  {linksByAgent.map(([aid, ids]) => {
                    const a = agentsById.get(aid);
                    return (
                      <ItemRow key={aid}>
                        <AgentAvatar id={aid} name={a?.name ?? aid} size={18} />
                        <span className="w-[130px] shrink-0 truncate font-medium">{a?.name ?? aid}</span>
                        <span className="w-[70px] shrink-0 text-fg-2 tabular-nums">+{plural(ids.length, "skill")}</span>
                        <span className="min-w-0 truncate text-fg-3">{ids.slice(0, 6).join(", ")}{ids.length > 6 ? "…" : ""}</span>
                      </ItemRow>
                    );
                  })}
                </Section>
              )}

              {counts.prune > 0 && (
                <Section
                  title="Prune broken links"
                  subtitle="Repair links for managed skills; delete the ones that point nowhere."
                  count={counts.prune}
                  checked={opts.prune}
                  onCheck={(v) => setOpts((o) => ({ ...o, prune: v }))}
                  open={!!open.prune}
                  onToggle={() => setOpen((o) => ({ ...o, prune: !o.prune }))}
                  icon={<Link2Off size={14} className="text-red" />}
                >
                  {plan.prune.map((p) => (
                    <ItemRow key={p}>
                      <span className="min-w-0 truncate font-mono text-[11.5px]">{tildify(p)}</span>
                    </ItemRow>
                  ))}
                </Section>
              )}

              {otherIssues.length > 0 && (
                <Section
                  title="Other issues"
                  subtitle="Problems in SKILL.md that Quiver can't fix for you."
                  count={otherIssues.length}
                  open={!!open.other}
                  onToggle={() => setOpen((o) => ({ ...o, other: !o.other }))}
                  icon={<FileWarning size={14} className="text-amber" />}
                >
                  {otherIssues.map(({ skill, issue }, i) => (
                    <ItemRow key={skill.id + i} onClick={() => go("library", { selectedId: skill.id, filter: "all", agentFilter: null })}>
                      <span className="w-[160px] shrink-0 truncate font-medium">{skill.name}</span>
                      <span className="min-w-0 truncate text-fg-2">{issue.message}</span>
                    </ItemRow>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      <CompareSheet
        skill={comparing ? (skillsById.get(comparing) ?? null) : null}
        onClose={() => setComparing(null)}
        onKeep={(path) => {
          const s = comparing ? skillsById.get(comparing) : null;
          return s ? run(() => api.adopt(s.id, path), `Kept ${tildify(path)} for ${s.name}`) : Promise.resolve(false);
        }}
      />
    </div>
  );
}

function Stat({ icon, value, label, tone }: { icon: ReactNode; value: number; label: string; tone: "accent" | "blue" | "red" | "amber" }) {
  const color = { accent: "text-fg", blue: "text-fg", red: "text-red", amber: "text-amber" }[tone];
  return (
    <div className="px-4 py-3">
      <div className={cx("text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums", value ? color : "text-fg-3")}>{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-fg-2">
        <span className="text-fg-3 [&_svg]:h-[12px] [&_svg]:w-[12px]">{icon}</span>
        {label}
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  checked,
  onCheck,
  open,
  onToggle,
  icon,
  tall,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  checked?: boolean;
  onCheck?: (v: boolean) => void;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  /** Rows are big (copies of a conflict): leave room for a few before scrolling. */
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-[10px] border-[0.5px] border-line-2">
      <div className="flex items-center gap-3 px-3.5 py-3">
        {onCheck ? <Checkbox checked={!!checked} onChange={onCheck} label={title} /> : icon}
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">
              {title} <span className="font-normal text-fg-3 tabular-nums">· {count}</span>
            </div>
            <div className="truncate text-[12px] text-fg-2">{subtitle}</div>
          </div>
          <ChevronRight size={14} className={cx("shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} />
        </button>
      </div>
      {open && <div className={cx("anim-fade scroll border-t border-line", tall ? "max-h-[620px]" : "max-h-[340px]")}>{children}</div>}
    </div>
  );
}

function ItemRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "flex h-[34px] items-center gap-2.5 border-b border-line pr-3.5 pl-[42px] text-[12.5px] last:border-b-0",
        onClick && "hover:bg-hover",
      )}
    >
      {children}
    </div>
  );
}

function ConflictRow({
  skill,
  agents,
  onCompare,
  onKeep,
}: {
  skill: Skill;
  agents: Map<string, AgentInfo>;
  onCompare: () => void;
  onKeep: (path: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const locs = skill.locations.filter((l) => l.kind === "canonical" || l.kind === "directory");
  const hashes = [...new Set(locs.map((l) => l.contentHash))];
  return (
    <div className="border-b border-line px-3.5 py-3 last:border-b-0">
      <div className="flex items-center gap-2 pl-[28px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium">{skill.name}</span>
            <span className="text-[12px] text-fg-3">
              {locs.length} copies · {hashes.length} versions
            </span>
          </div>
          <div className="text-[12px] text-fg-2">Not sure which to keep? See what differs and which one has the fix.</div>
        </div>
        <Button variant="primary" icon={<GitCompareArrows size={13} />} onClick={onCompare}>
          Compare
        </Button>
      </div>
      <div className="mt-2 ml-[28px] overflow-hidden rounded-lg border border-line">
        {locs.map((l, i) => {
          const a = l.agentId ? agents.get(l.agentId) : null;
          const v = hashes.indexOf(l.contentHash);
          return (
            <div key={l.path} className={cx("flex items-center gap-2.5 px-2.5 py-2", i > 0 && "border-t border-line")}>
              {a ? (
                <AgentAvatar id={a.id} name={a.name} size={18} />
              ) : (
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-accent-soft text-accent-text">
                  <Folder size={11} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12px] font-medium">
                  {a?.name ?? "Canonical store"}
                  <span className="rounded bg-surface-3 px-1 text-[10px] font-normal text-fg-2">
                    Version {v + 1}
                    <span className="font-mono text-fg-3"> · {l.contentHash?.slice(0, 7)}</span>
                  </span>
                </div>
                <div className="truncate font-mono text-[10.5px] text-fg-3">{tildify(l.path)}</div>
              </div>
              <Button size="sm" onClick={() => void api.openPath(joinPath(l.path, "SKILL.md"))}>
                View
              </Button>
              <Button
                size="sm"
                loading={busy === l.path}
                disabled={!!busy && busy !== l.path}
                onClick={async () => {
                  setBusy(l.path);
                  await onKeep(l.path);
                  setBusy(null);
                }}
              >
                Keep This One
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

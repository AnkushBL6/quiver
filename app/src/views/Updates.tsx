import { useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, ArrowUpCircle, CheckCircle2, ChevronRight, CircleDashed, PenLine, RefreshCw, User } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { SourceMatch, SourceScan, UpdateInfo } from "../lib/types";
import { cx, plural, timeAgo } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { Button, EmptyState, IconButton, Skeleton, Toolbar, ToolbarTitle, Tooltip } from "../components/ui";
import { useSkillActions } from "../state/skillActions";

export function UpdatesView() {
  const { updates, checkingUpdates, inventory } = useData();
  const { checkUpdates, rescan } = useActions();
  const { go } = useNav();
  const { update } = useSkillActions();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [scan, setScan] = useState<SourceScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [tracking, setTracking] = useState<string | null>(null);

  const findSources = async (ids: string[]) => {
    setScanning(true);
    try {
      const r = await api.findSources(ids);
      setScan(r);
      if (!r.matches.length) toast("No upstream found", { description: `Checked ${plural(r.checked, "skill")} against skills.sh and GitHub.` });
      if (r.rateLimited) toast("Search was rate-limited", { description: `${plural(r.unchecked.length, "skill")} weren't checked. Try again later.` });
    } catch (e) {
      toast.error("Couldn't search for sources", { description: errorMessage(e) });
    }
    setScanning(false);
  };

  const track = async (m: SourceMatch) => {
    setTracking(m.id);
    try {
      await api.trackSource(m.id, m.source, m.skillPath);
      toast(`${nameOf(m.id)} now follows ${m.source}`);
      setScan((sc) => (sc ? { ...sc, matches: sc.matches.filter((x) => x.id !== m.id) } : sc));
      await Promise.all([checkUpdates(true), rescan({ quiet: true })]);
    } catch (e) {
      toast.error(`Couldn't track ${nameOf(m.id)}`, { description: errorMessage(e) });
    }
    setTracking(null);
  };

  const available = updates?.filter((u) => u.status === "available") ?? [];
  const errors = updates?.filter((u) => u.status === "error") ?? [];
  const upToDate = updates?.filter((u) => u.status === "upToDate") ?? [];
  // The user's own skills have no upstream by design: keep them out of "Not tracked".
  const isMine = (id: string) => inventory?.skills.find((s) => s.id === id)?.origin === "mine";
  const untracked = updates?.filter((u) => u.status === "untracked" && !isMine(u.id)) ?? [];
  const mineCount = inventory?.skills.filter((s) => s.origin === "mine").length ?? 0;
  const checkedAt = updates?.[0]?.checkedAtMs;
  const nameOf = (id: string) => inventory?.skills.find((s) => s.id === id)?.name ?? id;

  const onBusy = (ids: string[], on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
      return n;
    });
  const updateOne = (u: UpdateInfo) => update([u.id], onBusy);
  const updateAll = () => update(available.map((u) => u.id), onBusy);

  const open = (id: string) => go("library", { selectedId: id, filter: "all", agentFilter: null });

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar>
        <ToolbarTitle sub={checkingUpdates ? "Checking…" : checkedAt ? `Checked ${timeAgo(checkedAt)}` : undefined}>Updates</ToolbarTitle>
        <div data-tauri-drag-region className="flex-1" />
        <IconButton label="Check Now" disabled={checkingUpdates} onClick={() => void checkUpdates(true)}>
          <RefreshCw size={14} strokeWidth={1.8} className={checkingUpdates ? "spin" : undefined} />
        </IconButton>
        <Button variant="primary" disabled={!available.length || busy.size > 0} loading={busy.size > 1} onClick={() => void updateAll()}>
          Update All{available.length ? ` (${available.length})` : ""}
        </Button>
      </Toolbar>

      <div className="scroll min-h-0 flex-1 bg-surface">
        <div className="mx-auto max-w-[860px] p-5">
          {!updates ? (
            checkingUpdates ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-[52px] rounded-lg" />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ArrowUpCircle size={20} />}
                title="Check for updates"
                action={
                  <Button variant="primary" onClick={() => void checkUpdates(true)}>
                    Check now
                  </Button>
                }
              >
                Quiver compares every skill installed from GitHub or git with its upstream source.
              </EmptyState>
            )
          ) : updates.length === 0 ? (
            <EmptyState icon={<ArrowUpCircle size={20} />} title="Nothing to check">
              Install skills from GitHub or git and Quiver will keep them up to date.
            </EmptyState>
          ) : (
            <>
              {available.length === 0 && errors.length === 0 && (
                <div className="mb-5 flex items-center gap-3 rounded-[10px] border-[0.5px] border-line-2 bg-surface-2 px-4 py-3.5">
                  <CheckCircle2 size={18} className="text-green" />
                  <div>
                    <div className="text-[13px] font-medium">Everything is up to date</div>
                    <div className="text-[12px] text-fg-2">{plural(upToDate.length, "skill")} checked against upstream.</div>
                  </div>
                </div>
              )}

              {available.length > 0 && (
                <Group title="Available" count={available.length}>
                  {available.map((u) => (
                    <Row key={u.id} onOpen={() => open(u.id)} name={nameOf(u.id)} source={u.source}>
                      <span className="flex items-center gap-1 font-mono text-[11px] text-fg-3">
                        {u.current?.slice(0, 7)} <ArrowRight size={10} /> <span className="text-accent-text">{u.latest?.slice(0, 7)}</span>
                      </span>
                      {u.locallyModified && (
                        <Tooltip content="You edited this skill since installing it. Updating overwrites your edits.">
                          <span>
                            <span className="inline-flex items-center gap-1 text-[11.5px] text-amber">
                              <PenLine size={11} /> Edited
                            </span>
                          </span>
                        </Tooltip>
                      )}
                      <Button size="sm" variant={u.locallyModified ? "secondary" : "primary"} loading={busy.has(u.id)} onClick={() => void updateOne(u)}>
                        {u.locallyModified ? "Update…" : "Update"}
                      </Button>
                    </Row>
                  ))}
                </Group>
              )}

              {errors.length > 0 && (
                <Group title="Couldn’t Check" count={errors.length}>
                  {errors.map((u) => (
                    <Row key={u.id} onOpen={() => open(u.id)} name={nameOf(u.id)} source={u.source} message={u.message} icon={<AlertCircle size={14} className="text-red" />}>
                      {/token|private|404|rate/i.test(u.message ?? "") && (
                        <Button size="sm" onClick={() => go("settings")}>
                          Add Token
                        </Button>
                      )}
                    </Row>
                  ))}
                </Group>
              )}

              {upToDate.length > 0 && (
                <div className="mb-5">
                  <button
                    type="button"
                    onClick={() => setShowUpToDate((s) => !s)}
                    className="mb-2 flex items-center gap-1 text-[12px] font-semibold text-fg-2 hover:text-fg-2"
                    aria-expanded={showUpToDate}
                  >
                    <ChevronRight size={11} strokeWidth={2.6} className={cx("text-fg-3 transition-transform duration-150", showUpToDate && "rotate-90")} />
                    Up to Date <span className="font-normal text-fg-3">{upToDate.length}</span>
                  </button>
                  {showUpToDate && (
                    <div className="anim-fade overflow-hidden rounded-lg border border-line">
                      {upToDate.map((u, i) => (
                        <Row key={u.id} flat first={i === 0} onOpen={() => open(u.id)} name={nameOf(u.id)} source={u.source} icon={<CheckCircle2 size={14} className="text-green" />}>
                          <span className="font-mono text-[11px] text-fg-3">{u.current?.slice(0, 7)}</span>
                        </Row>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {untracked.length > 0 && (
                <Group
                  title="Not Tracked"
                  count={untracked.length}
                  hint="No upstream to compare against."
                  right={
                    <Button size="sm" loading={scanning} onClick={() => void findSources(untracked.map((u) => u.id))}>
                      Find Sources
                    </Button>
                  }
                >
                  {untracked.map((u) => {
                    const m = scan?.matches.find((x) => x.id === u.id);
                    return (
                      <Row
                        key={u.id}
                        onOpen={() => open(u.id)}
                        name={nameOf(u.id)}
                        source={m ? null : u.source}
                        message={m ? `Found in ${m.source} · ${CONFIDENCE[m.confidence]}${m.known ? " · a repo you use" : ""}` : u.message}
                        icon={<CircleDashed size={14} className="text-fg-3" />}
                      >
                        {m && (
                          <Button size="sm" loading={tracking === m.id} onClick={() => void track(m)}>
                            Track
                          </Button>
                        )}
                      </Row>
                    );
                  })}
                </Group>
              )}

              {mineCount > 0 && (
                <button
                  type="button"
                  onClick={() => go("mine")}
                  className="mt-1 flex items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg-2"
                >
                  <User size={12} /> {plural(mineCount, "skill")} of your own aren’t checked. They live in your My Skills folder.
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CONFIDENCE: Record<SourceMatch["confidence"], string> = {
  exact: "identical",
  skillMd: "same SKILL.md",
  name: "same name, different content",
};

function Group({ title, count, hint, right, children }: { title: string; count: number; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-fg-2">
          {title} <span className="font-normal text-fg-3">{count}</span>
        </span>
        {hint && <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-3">{hint}</span>}
        {right}
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        {Array.isArray(children)
          ? children.map((c, i) => (
              <div key={i} className={cx(i > 0 && "border-t border-line")}>
                {c}
              </div>
            ))
          : children}
      </div>
    </div>
  );
}

function Row({
  name,
  source,
  message,
  icon,
  children,
  onOpen,
  flat,
  first,
}: {
  name: string;
  source: string | null;
  message?: string | null;
  icon?: ReactNode;
  children?: ReactNode;
  onOpen: () => void;
  flat?: boolean;
  first?: boolean;
}) {
  return (
    <div className={cx("flex min-h-[48px] items-center gap-3 px-3.5 py-2", flat && !first && "border-t border-line")}>
      {icon ?? <ArrowUpCircle size={14} className="text-accent-text" />}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-medium hover:underline">{name}</div>
        <div className="truncate text-[11.5px] text-fg-3">
          {source}
          {message && <span className={cx(source && "before:mx-1 before:content-['·']")}>{message}</span>}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

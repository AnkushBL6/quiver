// "Find sources" for skills added by hand: look each one up on skills.sh / GitHub,
// show what matched and how sure we are, and record the upstream so updates work.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Clock, SearchX } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { MatchConfidence, SourceMatch, SourceScan } from "../lib/types";
import { cx, plural } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { Button, Spinner } from "../components/ui";
import { Sheet } from "../components/overlay";
import { OwnerAvatar, Tag } from "../components/SkillGrid";

const CONFIDENCE: Record<MatchConfidence, { label: string; tone: "green" | "accent" | "amber"; help: string; rank: number }> = {
  exact: { label: "Identical", tone: "green", help: "Every file matches the repo.", rank: 0 },
  skillMd: { label: "Same SKILL.md", tone: "accent", help: "SKILL.md matches; other files differ, so the next check offers an update.", rank: 1 },
  name: { label: "Same name, different content", tone: "amber", help: "Only the name matches. Tracking it offers that repo's version as an update.", rank: 2 },
};

/** `ids` empty = every skill added by hand. Null keeps the sheet closed. */
export function FindSourcesSheet({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  return (
    <Sheet open={ids !== null} onClose={onClose} width={620} label="Find Sources">
      {ids !== null && <FindSources ids={ids} onClose={onClose} />}
    </Sheet>
  );
}

function FindSources({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { inventory } = useData();
  const { rescan, checkUpdates } = useActions();
  const { go } = useNav();
  const [scan, setScan] = useState<SourceScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const nameOf = useCallback((id: string) => inventory?.skills.find((s) => s.id === id)?.name ?? id, [inventory]);
  // Count once, up front: tracking moves skills out of "Added by hand".
  const [total] = useState(() => (ids.length ? ids.length : (inventory?.skills.filter((s) => s.origin === "local").length ?? 0)));

  useEffect(() => {
    let alive = true;
    setScan(null);
    setError(null);
    setElapsed(0);
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    api
      .findSources(ids)
      .then((r) => alive && setScan(r))
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => clearInterval(tick));
    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, [ids, attempt]);

  const matches = useMemo(
    () => [...(scan?.matches ?? [])].sort((a, b) => CONFIDENCE[a.confidence].rank - CONFIDENCE[b.confidence].rank || nameOf(a.id).localeCompare(nameOf(b.id))),
    [scan, nameOf],
  );
  const verified = matches.filter((m) => m.confidence !== "name" && !tracked.has(m.id));

  const track = async (list: SourceMatch[]) => {
    setBusy((b) => new Set([...b, ...list.map((m) => m.id)]));
    const ok: string[] = [];
    for (const m of list) {
      try {
        await api.trackSource(m.id, m.source, m.skillPath);
        ok.push(m.id);
      } catch (e) {
        toast.error(`Couldn't track ${nameOf(m.id)}`, { description: errorMessage(e) });
      }
    }
    setTracked((t) => new Set([...t, ...ok]));
    setBusy((b) => {
      const n = new Set(b);
      list.forEach((m) => n.delete(m.id));
      return n;
    });
    if (ok.length) {
      toast.success(ok.length === 1 ? `${nameOf(ok[0])} now gets updates from ${list[0].source}` : `${plural(ok.length, "skill")} now get updates`);
      await Promise.all([rescan({ quiet: true }), checkUpdates(true)]);
    }
  };

  const unmatched = scan ? Math.max(0, scan.checked - scan.matches.length) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-5 pb-4">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Find Sources</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-fg-2">
          Quiver looks up {total === 1 ? `“${nameOf(ids[0])}”` : plural(total, "hand-added skill")} on skills.sh and GitHub and compares the files. Track a
          match to get updates from it; your copy isn't changed.
        </p>
      </div>

      <div className="scroll min-h-[140px] flex-1 border-y border-line">
        {error ? (
          <div className="flex flex-col items-center px-8 py-10 text-center">
            <div className="text-[13.5px] font-semibold text-fg-2">Couldn't search</div>
            <div className="mt-1 max-w-[380px] text-[12.5px] text-fg-3">{error}</div>
            <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
              Try Again
            </Button>
          </div>
        ) : !scan ? (
          <div className="flex flex-col items-center px-8 py-12 text-center" role="status" aria-live="polite">
            <Spinner size={20} />
            <div className="mt-3 text-[13.5px] font-medium">
              Checking {plural(total, "skill")}…
            </div>
            <div className="mt-1 text-[12px] text-fg-3 tabular-nums">
              This can take up to 30 seconds{elapsed >= 2 ? ` · ${elapsed} s` : ""}
            </div>
          </div>
        ) : (
          <>
            {scan.rateLimited && (
              <div className="flex items-start gap-3 border-b border-line bg-amber-soft px-6 py-3">
                <Clock size={15} className="mt-0.5 shrink-0 text-amber" />
                <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
                  <div className="font-semibold">GitHub's rate limit was reached</div>
                  <div className="text-fg-2">
                    {plural(scan.unchecked.length, "skill")} weren't checked. Try again in a few minutes, or add a GitHub token in{" "}
                    <button
                      type="button"
                      className="text-accent-text hover:underline"
                      onClick={() => {
                        onClose();
                        go("settings");
                      }}
                    >
                      Settings
                    </button>{" "}
                    for a higher limit.
                  </div>
                </div>
                <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Try Again
                </Button>
              </div>
            )}
            {matches.length === 0 ? (
              <div className="flex flex-col items-center px-8 py-10 text-center">
                <SearchX size={26} strokeWidth={1.4} className="text-fg-3" />
                <div className="mt-2 text-[13.5px] font-semibold text-fg-2">No sources found</div>
                <div className="mt-1 max-w-[360px] text-[12.5px] text-fg-3">
                  None of these skills match a public repo. They stay as they are; you can still edit them or make them yours.
                </div>
              </div>
            ) : (
              <ul className="py-1">
                {matches.map((m) => {
                  const c = CONFIDENCE[m.confidence];
                  const done = tracked.has(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-6 py-2.5 [&+&]:border-t [&+&]:border-line">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2 text-[13px]">
                          <span className="truncate font-semibold">{nameOf(m.id)}</span>
                          <ArrowRight size={12} className="shrink-0 text-fg-3" />
                          <OwnerAvatar owner={m.source.split("/")[0]} size={16} />
                          <span className="truncate text-fg-2">{m.source}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Tag tone={c.tone} title={c.help}>
                            {c.label}
                          </Tag>
                          {m.known && <span className="text-[11.5px] text-fg-3">You already install from this repo</span>}
                        </div>
                      </div>
                      {done ? (
                        <span className="inline-flex h-[24px] items-center gap-1 px-2 text-[12.5px] text-green">
                          <Check size={13} strokeWidth={2.6} /> Tracking
                        </span>
                      ) : (
                        <Button loading={busy.has(m.id)} onClick={() => void track([m])}>
                          Track
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-6 py-3.5">
        <span className={cx("mr-auto text-[12px] text-fg-3", !scan && "invisible")}>
          {scan && unmatched > 0 ? `No match for ${plural(unmatched, "skill")}` : scan ? `Checked ${plural(scan.checked, "skill")}` : "."}
        </span>
        <Button size="lg" onClick={onClose}>
          Done
        </Button>
        {verified.length > 0 && (
          <Button size="lg" variant="primary" loading={verified.some((m) => busy.has(m.id))} onClick={() => void track(verified)}>
            Track All Verified ({verified.length})
          </Button>
        )}
      </div>
    </div>
  );
}

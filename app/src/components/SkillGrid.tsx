// The Library's visual grid: cards grouped by where each skill came from.
// Shared by the Library and My Skills.

import { memo, useCallback, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { AlertOctagon, AlertTriangle, ArrowUpCircle, GitFork, Hand, Puzzle, Unlink, User } from "lucide-react";
import type { Skill } from "../lib/types";
import { PROBLEM_LABEL, cx, isRemoveKey, plural, problemsOf, type CoverageNote, type SourceGroup } from "../lib/ui";
import { AgentIcon } from "./identity";
import { Skeleton, Tooltip } from "./ui";

// ── Source identity ──────────────────────────────────────────────────────────

/** Neutral rounded tile with a glyph or letter, like a generic app icon. */
function Tile({ size, children, accent }: { size: number; children: ReactNode; accent?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center",
        accent ? "bg-accent text-white bg-[image:linear-gradient(to_bottom,rgba(255,255,255,0.16),rgba(255,255,255,0))]" : "text-fg-2",
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: accent ? undefined : "var(--q-tile)",
        boxShadow: accent ? "inset 0 0 0 0.5px rgba(0,0,0,0.12)" : "var(--q-tile-ring)",
        fontSize: Math.round(size * 0.46),
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

const failedAvatars = new Set<string>();

/** GitHub owner avatar, lazy-loaded, with a neutral initial when it fails or we're offline. */
export function OwnerAvatar({ owner, size = 24 }: { owner: string; size?: number }) {
  const [failed, setFailed] = useState(() => failedAvatars.has(owner));
  const [loaded, setLoaded] = useState(false);
  const letter = (owner.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  if (failed) return <Tile size={size}>{letter}</Tile>;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {!loaded && (
        <span className="absolute inset-0">
          <Tile size={size}>{letter}</Tile>
        </span>
      )}
      <img
        src={`https://github.com/${encodeURIComponent(owner)}.png?size=${size > 32 ? 128 : 64}`}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => {
          failedAvatars.add(owner);
          setFailed(true);
        }}
        className={cx("relative shrink-0 object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.24), boxShadow: "var(--q-tile-ring)" }}
      />
    </span>
  );
}

/** Icon for a Library section (and the skill sheet header). */
export function GroupIcon({ group, size = 24, agent }: { group: SourceGroup; size?: number; agent?: { id: string; name: string } | null }) {
  const glyph = Math.round(size * 0.56);
  switch (group.kind) {
    case "mine":
      return (
        <Tile size={size} accent>
          <User size={glyph} strokeWidth={2.2} />
        </Tile>
      );
    case "remote":
      return group.owner ? <OwnerAvatar owner={group.owner} size={size} /> : <Tile size={size}>{(group.source.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase()}</Tile>;
    case "local":
      return (
        <Tile size={size}>
          <Hand size={glyph} strokeWidth={1.9} />
        </Tile>
      );
    case "unmanaged":
      return agent ? (
        <AgentIcon id={agent.id} name={agent.name} size={size} />
      ) : (
        <Tile size={size}>
          <Unlink size={glyph} strokeWidth={1.9} />
        </Tile>
      );
    case "plugin":
      return (
        <Tile size={size}>
          <Puzzle size={glyph} strokeWidth={1.9} />
        </Tile>
      );
  }
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function Tag({ tone = "neutral", icon, children, title }: { tone?: "neutral" | "accent" | "green" | "red" | "amber"; icon?: ReactNode; children: ReactNode; title?: ReactNode }) {
  const tones = {
    neutral: "bg-[var(--q-hover)] text-fg-2 dark:bg-[rgba(255,255,255,0.07)]",
    accent: "bg-accent-soft text-accent-text",
    green: "bg-green-soft text-green",
    red: "bg-red-soft text-red",
    amber: "bg-amber-soft text-amber",
  };
  const tag = (
    <span className={cx("inline-flex h-[20px] max-w-full min-w-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap", tones[tone])}>
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
  return title ? <Tooltip content={title}>{tag}</Tooltip> : tag;
}

// ── Card ─────────────────────────────────────────────────────────────────────

export interface CardInfo {
  hasUpdate: boolean;
  coverage: CoverageNote | null;
}

export const SkillCard = memo(function SkillCard({
  skill,
  info,
  tabbable,
  onOpen,
}: {
  skill: Skill;
  info: CardInfo;
  tabbable: boolean;
  onOpen: (id: string) => void;
}) {
  const problems = problemsOf(skill);
  const worst = problems[0];
  const changes = skill.origin === "mine" ? (skill.gitChanges ?? 0) : 0;
  const forked = skill.origin === "mine" ? skill.forkedFrom : null;
  const { hasUpdate, coverage } = info;
  const hasFooter = hasUpdate || !!worst || !!coverage || changes > 0 || !!forked;

  const status = [
    hasUpdate && "Update available",
    worst && PROBLEM_LABEL[worst.kind],
    coverage?.label,
    changes > 0 && plural(changes, "uncommitted change"),
    forked && `Forked from ${forked}`,
  ].filter(Boolean);

  return (
    <button
      type="button"
      data-card
      data-id={skill.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onOpen(skill.id)}
      aria-label={[skill.name, ...status, skill.description || "No description"].join(". ")}
      className="skill-card group flex min-h-[104px] w-full min-w-0 scroll-mt-[60px] scroll-mb-4 flex-col rounded-[10px] px-4 pt-3.5 pb-3 text-left"
    >
      <span className="block w-full truncate text-[13.5px] leading-[18px] font-semibold tracking-[-0.01em] text-fg" title={skill.name.length > 30 ? skill.name : undefined}>
        {skill.name}
      </span>
      <span className={cx("line-clamp-2 mt-1 text-[12.5px] leading-[17px] break-words", skill.description ? "text-fg-2" : "text-fg-3")}>
        {skill.description || "No description"}
      </span>
      {hasFooter && (
        <span className="mt-auto flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pt-3">
          {hasUpdate && (
            <Tag tone="accent" icon={<ArrowUpCircle size={11.5} strokeWidth={2.3} />}>
              Update available
            </Tag>
          )}
          {worst && (
            <Tag
              tone={worst.severity === "error" ? "red" : "amber"}
              icon={worst.severity === "error" ? <AlertOctagon size={11.5} strokeWidth={2.3} /> : <AlertTriangle size={11.5} strokeWidth={2.3} />}
            >
              {PROBLEM_LABEL[worst.kind]}
              {problems.length > 1 ? ` +${problems.length - 1}` : ""}
            </Tag>
          )}
          {coverage && (
            <Tag icon={coverage.agent ? <AgentIcon id={coverage.agent.id} name={coverage.agent.name} size={13} /> : undefined}>{coverage.label}</Tag>
          )}
          {changes > 0 && (
            <span className="inline-flex h-[20px] items-center gap-1.5 px-0.5 text-[11.5px] text-fg-2">
              <span className="h-[6px] w-[6px] rounded-full bg-[var(--q-glyph-amber)]" aria-hidden />
              {plural(changes, "change")}
            </span>
          )}
          {forked && (
            <span className="inline-flex h-[20px] min-w-0 items-center gap-1 px-0.5 text-[11.5px] text-fg-3">
              <GitFork size={11} strokeWidth={2} className="shrink-0" />
              <span className="truncate">Forked from {forked}</span>
            </span>
          )}
        </span>
      )}
    </button>
  );
});

/** Responsive, equal-height card grid. */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("grid gap-3", className)} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(228px, 1fr))", gridAutoRows: "1fr" }}>
      {children}
    </div>
  );
}

export function GridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="px-6 pt-4">
      <Skeleton className="mb-4 h-4 w-40" />
      <CardGrid>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skill-card flex h-[104px] flex-col gap-2 rounded-[10px] px-4 pt-4">
            <Skeleton className="h-3" style={{ width: `${40 + ((i * 37) % 35)}%` }} />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5" style={{ width: `${55 + ((i * 23) % 35)}%` }} />
          </div>
        ))}
      </CardGrid>
    </div>
  );
}

// ── Keyboard: roving focus across every visible card ────────────────────────

/**
 * Arrow keys move focus between cards (left/right in reading order, up/down to the
 * nearest card in the row above or below, across sections), Home/End jump to the ends,
 * ⌘⌫ (Delete on Windows) asks to remove the focused skill. Enter and Space are the card button's own click.
 */
export function useRovingGrid(container: RefObject<HTMLElement | null>, onDelete?: (id: string) => void) {
  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const el = e.target as HTMLElement;
      if (!el.matches("[data-card]") || !container.current) return;
      if (isRemoveKey(e)) {
        e.preventDefault();
        if (el.dataset.id) onDelete?.(el.dataset.id);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cards = [...container.current.querySelectorAll<HTMLElement>("[data-card]")];
      const i = cards.indexOf(el);
      let next: HTMLElement | undefined;
      if (e.key === "ArrowRight") next = cards[i + 1];
      else if (e.key === "ArrowLeft") next = cards[i - 1];
      else if (e.key === "Home") next = cards[0];
      else if (e.key === "End") next = cards[cards.length - 1];
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const r = el.getBoundingClientRect();
        const cx0 = r.left + r.width / 2;
        const down = e.key === "ArrowDown";
        const rows = cards
          .map((c) => ({ c, r: c.getBoundingClientRect() }))
          .filter(({ r: o }) => (down ? o.top > r.top + 4 : o.top < r.top - 4));
        if (rows.length) {
          const rowTop = down ? Math.min(...rows.map((x) => x.r.top)) : Math.max(...rows.map((x) => x.r.top));
          next = rows
            .filter((x) => Math.abs(x.r.top - rowTop) < 4)
            .sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - cx0) - Math.abs(b.r.left + b.r.width / 2 - cx0))[0]?.c;
        }
      } else return;
      e.preventDefault();
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    },
    [container, onDelete],
  );
}

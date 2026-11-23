// Side-by-side line diff: two panes (old on the left, new on the right) that scroll
// together vertically and each scroll sideways on their own, so long lines stay readable.
// Rows have a fixed height and never wrap, which keeps the two panes aligned.

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { DiffBlock, DiffRow } from "../lib/types";
import { cx, plural } from "../lib/ui";

type Side = "left" | "right";

type Item =
  | { type: "row"; row: DiffRow; key: string }
  | { type: "gap"; block: number; count: number; key: string };

/** Rows in order, with each collapsed block either expanded in place or folded into one bar. */
function flatten(blocks: DiffBlock[], open: ReadonlySet<number>): Item[] {
  const items: Item[] = [];
  blocks.forEach((b, bi) => {
    if (b.collapsed && !open.has(bi)) {
      items.push({ type: "gap", block: bi, count: b.rows.length, key: `g${bi}` });
      return;
    }
    b.rows.forEach((row, ri) => items.push({ type: "row", row, key: `${bi}.${ri}` }));
  });
  return items;
}

/** Text with the changed spans (UTF-16 offsets from the core) highlighted. */
function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  if (!marks.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <span key={i} className="diff-mark">
        {text.slice(s, e)}
      </span>,
    );
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

const Line = memo(function Line({ row, side }: { row: DiffRow; side: Side }) {
  const text = side === "left" ? row.left : row.right;
  const no = side === "left" ? row.leftNo : row.rightNo;
  const marks = side === "left" ? row.leftMarks : row.rightMarks;
  const tone = row.kind === "equal" ? "" : text === null ? "empty" : side === "left" ? "del" : "add";
  return (
    <div className={cx("diff-row", tone)}>
      <span className="diff-no">{no ?? ""}</span>
      <span className="diff-text">{text === null ? "" : <Marked text={text} marks={marks} />}</span>
    </div>
  );
});

export function DiffView({
  blocks,
  leftLabel,
  rightLabel,
}: {
  blocks: DiffBlock[];
  /** Column titles, e.g. "Version 1 · Shared copy". */
  leftLabel: ReactNode;
  rightLabel: ReactNode;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const items = useMemo(() => flatten(blocks, open), [blocks, open]);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const expand = useCallback((block: number) => setOpen((o) => new Set(o).add(block)), []);

  // Keep the panes level: whichever one is scrolled drags the other along.
  const follow = (from: Side) => () => {
    const a = (from === "left" ? left : right).current;
    const b = (from === "left" ? right : left).current;
    if (a && b && Math.abs(b.scrollTop - a.scrollTop) > 0.5) b.scrollTop = a.scrollTop;
  };

  const pane = (side: Side) => (
    <div className="diff-lines">
      {items.map((it) =>
        it.type === "row" ? (
          <Line key={it.key} row={it.row} side={side} />
        ) : (
          <div
            key={it.key}
            className="diff-row gap"
            onClick={() => expand(it.block)}
            aria-hidden={side === "right"}
          >
            {side === "left" && (
              <button
                type="button"
                onClick={() => expand(it.block)}
                className="sticky left-0 flex h-full items-center gap-1.5 pr-3 pl-[14px] hover:underline"
              >
                <ChevronsUpDown size={12} />
                Show {plural(it.count, "unchanged line")}
              </button>
            )}
          </div>
        ),
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 border-b border-line bg-surface-2 text-[11.5px] font-medium text-fg-2">
        <div className="truncate border-r border-line px-3 py-1.5">{leftLabel}</div>
        <div className="truncate px-3 py-1.5">{rightLabel}</div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={left} onScroll={follow("left")} className="diff-pane diff-pane-left selectable min-w-0 flex-1 overflow-auto border-r border-line">
          {pane("left")}
        </div>
        <div ref={right} onScroll={follow("right")} className="diff-pane scroll selectable min-w-0 flex-1">
          {pane("right")}
        </div>
      </div>
    </div>
  );
}

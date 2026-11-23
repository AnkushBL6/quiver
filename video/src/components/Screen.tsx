import { ReactNode } from "react";
import { Img, interpolate, staticFile } from "remotion";
import boxesJson from "../../public/capture/boxes.json";
import { appear, C, easeOut, keys, SHADOW_WINDOW } from "../theme";

/** Captures are 1240×780 CSS px at 2x (see scripts/capture.mjs). All coordinates below are in that space. */
export const APP_W = 1240;
export const APP_H = 780;

export type Layer = { src: string; at: number; fade?: number };
export type Cam = [frame: number, scale: number, fx: number, fy: number];
export type Pt = [frame: number, x: number, y: number];

export const cap = (name: string) => staticFile(`capture/${name}.png`);

export function Shot({ src, style }: { src: string; style?: React.CSSProperties }) {
  return <Img src={cap(src)} style={{ position: "absolute", left: 0, top: 0, width: APP_W, height: APP_H, ...style }} />;
}

/**
 * The app viewport: stacked screenshot layers that cross-fade, a camera that pushes in on a focus point
 * (never revealing empty edges), and a cursor that lives in the same coordinate space.
 */
export function Screen({
  frame,
  width,
  layers,
  cam = [[0, 1, APP_W / 2, APP_H / 2]],
  cursor,
  clicks = [],
  cursorFade,
  children,
}: {
  frame: number;
  width: number;
  layers: Layer[];
  cam?: Cam[];
  cursor?: Pt[];
  clicks?: number[];
  cursorFade?: [number, number];
  children?: ReactNode;
}) {
  const k = width / APP_W;
  const height = APP_H * k;
  const s = keys(frame, cam.map((c) => [c[0], c[1]]));
  const fx = keys(frame, cam.map((c) => [c[0], c[2]]));
  const fy = keys(frame, cam.map((c) => [c[0], c[3]]));
  const z = k * s;
  const tx = Math.min(0, Math.max(width - APP_W * z, width / 2 - fx * z));
  const ty = Math.min(0, Math.max(height - APP_H * z, height / 2 - fy * z));

  return (
    <div style={{ position: "relative", width, height, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: APP_W, height: APP_H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>
        {layers.map((l, i) => (
          <Shot key={i} src={l.src} style={{ opacity: i === 0 ? 1 : appear(frame, l.at, l.fade ?? 10) }} />
        ))}
        {children}
        {cursor && <Cursor frame={frame} path={cursor} clicks={clicks} fade={cursorFade} />}
      </div>
    </div>
  );
}

export function Cursor({ frame, path, clicks, fade }: { frame: number; path: Pt[]; clicks: number[]; fade?: [number, number] }) {
  const x = keys(frame, path.map((p) => [p[0], p[1]]));
  const y = keys(frame, path.map((p) => [p[0], p[2]]));
  let press = 1;
  let ring: ReactNode = null;
  for (const c of clicks) {
    if (frame >= c - 3 && frame <= c + 6) press = Math.min(press, interpolate(frame, [c - 3, c, c + 6], [1, 0.82, 1]));
    if (frame >= c && frame < c + 16) {
      const t = appear(frame, c, 16, easeOut);
      ring = (
        <div
          style={{
            position: "absolute",
            left: x - 18,
            top: y - 18,
            width: 36,
            height: 36,
            borderRadius: 18,
            border: "2px solid rgba(0,122,255,0.6)",
            background: "rgba(0,122,255,0.12)",
            transform: `scale(${0.4 + t * 0.9})`,
            opacity: 1 - t,
          }}
        />
      );
    }
  }
  const opacity = fade ? Math.min(appear(frame, fade[0], 8), 1 - appear(frame, fade[1], 10)) : 1;
  return (
    <>
      {ring}
      <svg
        width={22}
        height={32}
        viewBox="0 0 22 32"
        style={{ position: "absolute", left: x - 3, top: y - 2, opacity, transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.28))" }}
      >
        <path d="M3 2 L3 25 L8.6 19.8 L12.4 28.6 L16.1 27 L12.4 18.4 L19.8 18.4 Z" fill="#111" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </>
  );
}

/**
 * Rounded corners, a hairline and a neutral shadow around the app screenshot. The traffic lights are part of the
 * capture (the app draws them in the browser), so no extra chrome is added.
 */
export function Window({ children, radius = 14 }: { children: ReactNode; radius?: number }) {
  return (
    <div style={{ borderRadius: radius, overflow: "hidden", boxShadow: SHADOW_WINDOW, background: "white" }}>
      {children}
    </div>
  );
}

/**
 * A tall still scrolled under a fixed frame (the Library grid, the skill sheet). `ix`/`iy` is the image position
 * (CSS px, in the image's own space) of the frame's top-left corner at offset 0. Layers cross-fade over the first.
 */
export function ScrollPane({
  x,
  y,
  w,
  h,
  ix,
  iy,
  imgW,
  offset,
  layers,
  radius,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  ix: number;
  iy: number;
  imgW: number;
  offset: number;
  layers: { src: string; imgH: number; opacity?: number }[];
  radius?: string;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, overflow: "hidden", borderRadius: radius }}>
      {layers.map((l, i) => (
        <Img key={i} src={cap(l.src)} style={{ position: "absolute", left: -ix, top: -iy - offset, width: imgW, height: l.imgH, opacity: i === 0 ? 1 : (l.opacity ?? 1) }} />
      ))}
    </div>
  );
}

// ── Matrix fill: reveal matrix-after cell by cell over matrix-before ────────────────────────────────────
// Geometry from app/src/views/Matrix.tsx: sidebar 208, toolbar 52, HEADER 124, NAME_W 280, COL 40, ROW 34, END_W 84.
const SIDEBAR = 209; // 208 px sidebar plus its 1 px border
const GRID_X = 488;
const GRID_Y = 176;
const COLS = 12;
const CLIP_BOTTOM = 748; // legend bar

function Piece({ src, x, y, w, h, style }: { src: string; x: number; y: number; w: number; h: number; style?: React.CSSProperties }) {
  const hh = Math.max(0, Math.min(h, CLIP_BOTTOM - y));
  if (hh <= 0) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: hh, overflow: "hidden", ...style }}>
      <Img src={cap(src)} style={{ position: "absolute", left: -x, top: -y, width: APP_W, height: APP_H }} />
    </div>
  );
}

export function cellDelay(r: number, c: number, step = 1.9) {
  return (c + r * 0.75) * step;
}

// Which cells and rows differ between matrix-before and matrix-after, measured by scripts/capture.mjs.
// Only these animate; everything that was already linked stays put underneath.
const CHANGED = boxesJson as unknown as { "matrix.cells": [number, number][]; "matrix.rows": number[] };
const CELLS = CHANGED["matrix.cells"];
const ROWS_CHANGED = CHANGED["matrix.rows"];
export const FILL_SPAN = Math.max(...CELLS.map(([r, c]) => cellDelay(r, c)), ...ROWS_CHANGED.map((r) => cellDelay(r, COLS - 1))) + 14;

export function MatrixFill({ frame, start, after = "matrix-after", step = 1.9 }: { frame: number; start: number; after?: string; step?: number }) {
  if (frame < start) return null;
  const pieces: ReactNode[] = [];
  for (const r of ROWS_CHANGED) {
    const y = GRID_Y + r * 34;
    pieces.push(<Piece key={`n${r}`} src={after} x={SIDEBAR} y={y + 1} w={GRID_X - SIDEBAR} h={33} style={{ opacity: appear(frame, start + cellDelay(r, 0, step) + 6, 12) }} />);
    pieces.push(<Piece key={`r${r}`} src={after} x={GRID_X + COLS * 40} y={y + 1} w={84} h={33} style={{ opacity: appear(frame, start + cellDelay(r, COLS - 1, step), 10) }} />);
  }
  for (const [r, c] of CELLS) {
    const t = appear(frame, start + cellDelay(r, c, step), 14);
    if (t <= 0) continue;
    const cx = GRID_X + c * 40 + 20;
    const cy = GRID_Y + r * 34 + 17;
    pieces.push(
      <Piece
        key={`c${r}-${c}`}
        src={after}
        x={cx - 12}
        y={cy - 12}
        w={24}
        h={24}
        style={{ opacity: Math.min(1, t * 2.2), transform: `scale(${0.45 + 0.55 * t})`, borderRadius: 6 }}
      />,
    );
  }
  // Everything else (sidebar badges, counts) settles once the grid is done.
  pieces.push(<Shot key="all" src={after} style={{ opacity: appear(frame, start + FILL_SPAN * (step / 1.9) - 4, 12) }} />);
  return <>{pieces}</>;
}

/** Slides a tightly cropped toast from `src` up into place. */
export function Toast({ frame, at, src, box }: { frame: number; at: number; src: string; box: { x: number; y: number; w: number; h: number } }) {
  const t = appear(frame, at, 16);
  if (t <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        overflow: "hidden",
        borderRadius: 9,
        opacity: t,
        transform: `translateY(${(1 - t) * 16}px)`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <Img src={cap(src)} style={{ position: "absolute", left: -box.x, top: -box.y, width: APP_W, height: APP_H }} />
    </div>
  );
}

/** Progressive left-to-right reveal of a typed input (from a still with the text already typed) plus a caret. */
export function Typing({ frame, start, chars, perChar = 2, src, box }: { frame: number; start: number; chars: number; perChar?: number; src: string; box: { x: number; y: number; h: number; textW: number; coverW: number; bg?: string; caretH?: number } }) {
  if (frame < start - 10) return null;
  const n = Math.max(0, Math.min(chars, Math.floor((frame - start) / perChar)));
  const w = (n / chars) * box.textW;
  const caretOn = n < chars || Math.floor(frame / 15) % 2 === 0;
  return (
    <>
      <div style={{ position: "absolute", left: box.x - 2, top: box.y, width: box.coverW, height: box.h, background: box.bg ?? "#fff" }} />
      <div style={{ position: "absolute", left: box.x, top: box.y, width: w, height: box.h, overflow: "hidden" }}>
        <Img src={cap(src)} style={{ position: "absolute", left: -box.x, top: -box.y, width: APP_W, height: APP_H }} />
      </div>
      {caretOn && <div style={{ position: "absolute", left: box.x + w + 1, top: box.y + box.h / 2 - (box.caretH ?? 16) / 2, width: 1.5, height: box.caretH ?? 16, background: C.accent }} />}
    </>
  );
}

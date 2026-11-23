import { Easing, interpolate } from "remotion";

// Native macOS look, matching the app's tokens (app/src/index.css): system blue, neutral greys,
// white cards on #f5f5f7, system font. No gradients, no glow.
export const C = {
  accent: "#007aff",
  accentSoft: "rgba(0, 122, 255, 0.13)",
  accentText: "#006ee0",
  ink: "#1d1d1f",
  ink2: "#6e6e73",
  ink3: "#a1a1a6",
  canvas: "#f5f5f7",
  card: "#ffffff",
  line: "rgba(0, 0, 0, 0.1)",
  hairline: "rgba(0, 0, 0, 0.075)",
  chip: "rgba(0, 0, 0, 0.055)",
  red: "#e0382e",
  amber: "#d27a00",
  green: "#1f9f44",
};

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif';
export const MONO = '"SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace';

/** Soft, neutral elevation for cards and windows (no tinted shadows). */
export const SHADOW_CARD = "0 0 0 0.5px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05), 0 12px 32px -14px rgba(0,0,0,0.16)";
export const SHADOW_WINDOW =
  "0 0 0 1px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08), 0 30px 80px -14px rgba(0,0,0,0.30), 0 60px 120px -40px rgba(0,0,0,0.22)";

export const FPS = 30;

/** Ease-out for things entering; ease-in-out for camera and cursor moves. */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.45, 0, 0.2, 1);

/** 0 → 1 over `dur` frames starting at `start`, eased out. */
export function appear(frame: number, start: number, dur = 15, easing = easeOut) {
  return interpolate(frame, [start, start + dur], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Piecewise interpolation through [frame, value] keys with ease-in-out per segment. */
export function keys(frame: number, ks: [number, number][], easing = easeInOut) {
  if (ks.length === 1 || frame <= ks[0][0]) return ks[0][1];
  for (let i = 0; i < ks.length - 1; i++) {
    const [f0, v0] = ks[i];
    const [f1, v1] = ks[i + 1];
    if (frame <= f1) return interpolate(frame, [f0, f1], [v0, v1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }
  return ks[ks.length - 1][1];
}

/** Scene-level fade in/out so neighbouring sequences can cross-dissolve. */
export function sceneFade(frame: number, dur: number, fadeIn = 12, fadeOut = 9) {
  const a = fadeIn ? appear(frame, 0, fadeIn) : 1;
  const b = fadeOut ? 1 - appear(frame, dur - fadeOut, fadeOut, Easing.bezier(0.4, 0, 1, 1)) : 1;
  return Math.min(a, b);
}

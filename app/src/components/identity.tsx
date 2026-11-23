import { memo, useEffect, useId, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import type { Presence } from "../lib/types";
import { cx } from "../lib/ui";

const MARK_SQUIRCLE = "M63.00 32.00L62.97 42.41L62.89 45.73L62.76 48.12L62.57 50.05L62.33 51.69L62.03 53.11L61.68 54.37L61.27 55.49L60.79 56.51L60.26 57.42L59.66 58.24L58.99 58.99L58.24 59.66L57.42 60.26L56.51 60.79L55.49 61.27L54.37 61.68L53.11 62.03L51.69 62.33L50.05 62.57L48.12 62.76L45.73 62.89L42.41 62.97L32.00 63.00L21.59 62.97L18.27 62.89L15.88 62.76L13.95 62.57L12.31 62.33L10.89 62.03L9.63 61.68L8.51 61.27L7.49 60.79L6.58 60.26L5.76 59.66L5.01 58.99L4.34 58.24L3.74 57.42L3.21 56.51L2.73 55.49L2.32 54.37L1.97 53.11L1.67 51.69L1.43 50.05L1.24 48.12L1.11 45.73L1.03 42.41L1.00 32.00L1.03 21.59L1.11 18.27L1.24 15.88L1.43 13.95L1.67 12.31L1.97 10.89L2.32 9.63L2.73 8.51L3.21 7.49L3.74 6.58L4.34 5.76L5.01 5.01L5.76 4.34L6.58 3.74L7.49 3.21L8.51 2.73L9.63 2.32L10.89 1.97L12.31 1.67L13.95 1.43L15.88 1.24L18.27 1.11L21.59 1.03L32.00 1.00L42.41 1.03L45.73 1.11L48.12 1.24L50.05 1.43L51.69 1.67L53.11 1.97L54.37 2.32L55.49 2.73L56.51 3.21L57.42 3.74L58.24 4.34L58.99 5.01L59.66 5.76L60.26 6.58L60.79 7.49L61.27 8.51L61.68 9.63L62.03 10.89L62.33 12.31L62.57 13.95L62.76 15.88L62.89 18.27L62.97 21.59Z";

export function Logo({ size = 22 }: { size?: number }) {
  // Small-size rendition of the app icon (assets/icon.svg): a leather quiver with three fletched arrows.
  const id = useId().replace(/:/g, "");
  // Large sizes show the full app icon (public/app-icon.svg, same art as assets/icon.svg).
  if (size >= 40)
    return <img src={`${import.meta.env.BASE_URL}app-icon.svg`} alt="" aria-hidden draggable={false} width={size} height={size} className="shrink-0" style={{ width: size, height: size }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf8f3" />
          <stop offset="1" stopColor="#e6dccb" />
        </linearGradient>
        <linearGradient id={`${id}lt`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#874a21" />
          <stop offset=".4" stopColor="#cc8e55" />
          <stop offset="1" stopColor="#6f3b19" />
        </linearGradient>
      </defs>
      <path d={MARK_SQUIRCLE} fill={`url(#${id}bg)`} />
      <path d={MARK_SQUIRCLE} fill="none" stroke="#000" strokeOpacity=".1" strokeWidth=".8" />
      <g transform="translate(33.5 31) scale(.92) rotate(16)">
        <ellipse cx="0" cy="-6.5" rx="7.4" ry="2.1" fill="#341a0b" />
        <g transform="translate(-1.5 0) rotate(-13 0 6)"><rect x="-.75" y="-30" width="1.5" height="34" rx=".75" fill="#ead6ae"/><path d="M-.6 -28.5L-3.6 -27.6C-3.8 -23.5 -2.8 -20.5 -.6 -18.5ZM.6 -28.5L3.6 -27.6C3.8 -23.5 2.8 -20.5 .6 -18.5Z" fill="#dd5644"/></g><g transform="translate(1.5 0) rotate(13 0 6)"><rect x="-.75" y="-29" width="1.5" height="33" rx=".75" fill="#ead6ae"/><path d="M-.6 -27.5L-3.6 -26.6C-3.8 -22.5 -2.8 -19.5 -.6 -17.5ZM.6 -27.5L3.6 -26.6C3.8 -22.5 2.8 -19.5 .6 -17.5Z" fill="#3f86cc"/></g><g transform="translate(0 0) rotate(-1 0 6)"><rect x="-.75" y="-34" width="1.5" height="38" rx=".75" fill="#ead6ae"/><path d="M-.6 -32.5L-3.6 -31.6C-3.8 -27.5 -2.8 -24.5 -.6 -22.5ZM.6 -32.5L3.6 -31.6C3.8 -27.5 2.8 -24.5 .6 -22.5Z" fill="#ecb43a"/></g>
        <path d="M-7.4 -6.5Q0 -2.6 7.4 -6.5L6 24Q0 28.4 -6 24Z" fill={`url(#${id}lt)`} />
        <path d="M-7.6 -7Q0 -3 7.6 -7L7.5 -3.6Q0 .4 -7.5 -3.6Z" fill="#5a2f13" />
        <path d="M-6.4 17.5Q0 20.6 6.4 17.5L6.3 20.6Q0 23.8 -6.3 20.6Z" fill="#5a2f13" />
      </g>
    </svg>
  );
}

export function GitHubMark({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="currentColor" className="shrink-0">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ── Agent identity ───────────────────────────────────────────────────────────
// The installed app's real icon when the backend can find it (agent_icon), else
// a neutral monochrome glyph. Icons are fetched once per agent and cached.

const iconCache = new Map<string, string | null>();
const iconRequests = new Map<string, Promise<string | null>>();

function useAgentIcon(id: string): string | null {
  const [src, setSrc] = useState<string | null>(() => iconCache.get(id) ?? null);
  useEffect(() => {
    if (iconCache.has(id)) {
      setSrc(iconCache.get(id) ?? null);
      return;
    }
    let alive = true;
    let req = iconRequests.get(id);
    if (!req) {
      req = api.agentIcon(id).catch(() => null);
      iconRequests.set(id, req);
    }
    void req.then((v) => {
      iconCache.set(id, v);
      if (alive) setSrc(v);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return src;
}

export const AgentIcon = memo(function AgentIcon({
  id,
  name,
  size = 20,
  muted,
}: {
  id: string;
  name: string;
  size?: number;
  muted?: boolean;
}) {
  const src = useAgentIcon(id);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        width={size}
        height={size}
        className={cx("shrink-0 object-contain", muted && "opacity-50 grayscale")}
        style={{ width: size, height: size }}
      />
    );
  }
  // Monochrome fallback: a soft gray rounded square with the initial, like a generic document icon.
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center bg-[linear-gradient(to_bottom,#fdfdfd,#e9e9ec)] font-semibold text-[#6d6d72] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.16),0_0.5px_1px_rgba(0,0,0,0.08)] dark:bg-[linear-gradient(to_bottom,#5a5a5e,#454549)] dark:text-[#d6d6da] dark:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.12)]",
        muted && "opacity-50",
      )}
      style={{
        width: size * 0.86,
        height: size * 0.86,
        margin: size * 0.07,
        borderRadius: Math.max(3, Math.round(size * 0.22)),
        fontSize: Math.max(8, Math.round(size * 0.46)),
        letterSpacing: "-0.02em",
      }}
    >
      {letter}
    </span>
  );
});

/** Back-compat alias: every agent mark in the app goes through AgentIcon. */
export const AgentAvatar = AgentIcon;

/** Small square glyph for a presence state. Pure CSS so it's cheap in big grids. */
export function presenceStyle(p: Presence): CSSProperties {
  switch (p) {
    case "linked":
      return { background: "var(--p-linked)" };
    case "native":
      return { background: "var(--p-native)", boxShadow: "inset 0 0 0 1.5px var(--p-native-ring)" };
    case "copied":
      return { background: "var(--p-copied)" };
    case "local":
      return { background: "var(--p-local)" };
    case "foreign":
      return { background: "var(--p-foreign)" };
    case "broken":
      return { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--p-broken)" };
    case "plugin":
      return {
        background: "repeating-linear-gradient(135deg, var(--p-plugin) 0 2px, transparent 2px 4px)",
        boxShadow: "inset 0 0 0 1px var(--p-plugin)",
      };
    case "absent":
      return { background: "var(--p-absent)" };
  }
}

export function PresenceDot({ presence, size = 8, className }: { presence: Presence; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block shrink-0", className)}
      style={{ width: size, height: size, borderRadius: size <= 8 ? 2.5 : 4, ...presenceStyle(presence) }}
    />
  );
}

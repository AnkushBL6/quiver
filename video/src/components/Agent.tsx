import { ReactNode } from "react";

// Same identity as the app (app/src/components/identity.tsx): a neutral grey tile with the agent's initial,
// and the three generic app marks the mock backend ships (Claude Code, Antigravity, Copilot).
const SQUIRCLE = "M50 4h28c22 0 30 8 30 30v28c0 22-8 30-30 30H50C28 92 20 84 20 62V34C20 12 28 4 50 4Z";

function Mark({ size, top, bottom, ring, children }: { size: number; top: string; bottom: string; ring?: string; children: ReactNode }) {
  const id = `g${top.slice(1)}${bottom.slice(1)}`;
  return (
    <svg width={size} height={size} viewBox="14 0 100 100" style={{ flexShrink: 0, filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.12))" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <path d={SQUIRCLE} fill={`url(#${id})`} />
      <path d={SQUIRCLE} fill="none" stroke={ring ?? "#000"} strokeOpacity={0.12} strokeWidth={0.8} />
      {children}
    </svg>
  );
}

export function AgentAvatar({ name, size = 64 }: { name: string; size?: number }) {
  if (name === "Claude Code")
    return (
      <Mark size={size} top="#3a3532" bottom="#1f1c1a">
        <path d="M44 34l14 14-14 14" fill="none" stroke="#f2d9c4" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M64 64h22" stroke="#f2d9c4" strokeWidth={7} strokeLinecap="round" />
      </Mark>
    );
  if (name === "Antigravity")
    return (
      <Mark size={size} top="#fdfdfd" bottom="#e6e8ec">
        <path d="M64 24 88 72H76L64 46 52 72H40Z" fill="#2f6fe4" />
        <circle cx="64" cy="80" r="5" fill="#2f6fe4" />
      </Mark>
    );
  if (name === "Copilot" || name === "GitHub Copilot")
    return (
      <Mark size={size} top="#3b9cf0" bottom="#1667c9">
        <path d="M54 30 38 48l16 18M74 30l16 18-16 18" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
      </Mark>
    );
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: "linear-gradient(to bottom, #fdfdfd, #e9e9ec)",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.16), 0 1px 2px rgba(0,0,0,0.08)",
        color: "#6d6d72",
        fontWeight: 620,
        fontSize: Math.round(size * 0.46),
        letterSpacing: "-0.02em",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

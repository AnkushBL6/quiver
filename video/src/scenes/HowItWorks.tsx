import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AgentAvatar } from "../components/Agent";
import { Caption } from "../components/Caption";
import { appear, C, FONT, MONO, SHADOW_CARD, sceneFade } from "../theme";

const TARGETS = [
  { name: "Claude Code", dir: "~/.claude/skills" },
  { name: "Antigravity", dir: "~/.gemini/config/skills" },
  { name: "Cursor", dir: "~/.cursor/skills" },
  { name: "Copilot", dir: "~/.copilot/skills" },
  { name: "Droid", dir: "~/.factory/skills" },
  { name: "OpenCode", dir: "~/.config/opencode/skills" },
];
const NATIVE = ["Codex", "Warp", "Zed", "Cline"];

const W = 1720;
const STORE = { x: W / 2, y: 40, w: 560, h: 170 };
const CARD_Y = 470;
const CARD_W = 256;
const CARD_H = 150;

export function HowItWorks({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  const store = appear(f, 8, 18);
  const step = (W - CARD_W) / (TARGETS.length - 1);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur), alignItems: "center" }}>
      <Caption size={72} style={{ marginTop: 92 }}>One real copy. A link in every agent.</Caption>
      <div style={{ position: "relative", width: W, height: 660, marginTop: 70 }}>
        <svg width={W} height={660} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {TARGETS.map((t, i) => {
            const x = CARD_W / 2 + i * step;
            const d = `M${STORE.x} ${STORE.y + STORE.h} C ${STORE.x} ${STORE.y + STORE.h + 150}, ${x} ${CARD_Y - 140}, ${x} ${CARD_Y}`;
            const draw = appear(f, 30 + i * 5, 24);
            const flow = appear(f, 30 + i * 5 + 24, 10);
            return (
              <g key={t.name}>
                <path d={d} pathLength={1} fill="none" stroke={C.accent} strokeOpacity={0.35} strokeWidth={3} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
                <path d={d} pathLength={1} fill="none" stroke={C.accent} strokeWidth={4} strokeLinecap="round" strokeDasharray="0.03 0.09" strokeDashoffset={-(f / 90)} opacity={flow * 0.9} />
              </g>
            );
          })}
        </svg>
        {/* Store */}
        <div
          style={{
            position: "absolute",
            left: STORE.x - STORE.w / 2,
            top: STORE.y,
            width: STORE.w,
            height: STORE.h,
            borderRadius: 30,
            background: C.accent,
            backgroundImage: "linear-gradient(to bottom, rgba(255,255,255,0.16), rgba(255,255,255,0))",
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12), 0 24px 50px -22px rgba(0,0,0,0.35)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: store,
            transform: `scale(${0.94 + store * 0.06})`,
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em" }}>~/.agents/skills</div>
          <div style={{ fontFamily: FONT, fontSize: 26, opacity: 0.88, marginTop: 10 }}>one real copy of every skill</div>
        </div>
        {/* Natively read */}
        <div style={{ position: "absolute", left: STORE.x + STORE.w / 2 + 48, top: STORE.y + 30, opacity: appear(f, 84, 16) }}>
          <div style={{ fontSize: 24, color: C.ink3, fontWeight: 500 }}>read natively by</div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            {NATIVE.map((n) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 24, fontWeight: 600, color: C.ink2 }}>
                <AgentAvatar name={n} size={34} />
                {n}
              </div>
            ))}
          </div>
        </div>
        {/* Agents */}
        {TARGETS.map((t, i) => {
          const a = appear(f, 46 + i * 5, 16);
          return (
            <div
              key={t.name}
              style={{
                position: "absolute",
                left: i * step,
                top: CARD_Y,
                width: CARD_W,
                height: CARD_H,
                borderRadius: 22,
                background: "white",
                boxShadow: SHADOW_CARD,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                opacity: a,
                transform: `translateY(${(1 - a) * 16}px)`,
              }}
            >
              <AgentAvatar name={t.name} size={52} />
              <div style={{ fontSize: 26, fontWeight: 640, color: C.ink, letterSpacing: "-0.015em" }}>{t.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 18, color: C.accent, display: "flex", alignItems: "center", gap: 6 }}>↳ symlink</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

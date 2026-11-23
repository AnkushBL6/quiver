import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AgentAvatar } from "../components/Agent";
import { Caption } from "../components/Caption";
import { appear, C, sceneFade } from "../theme";

const AGENTS = ["Claude Code", "Codex", "Antigravity", "Cursor", "Gemini CLI", "Copilot", "OpenCode", "Windsurf", "Droid", "Amp", "Kiro"];

export function Hook({ dur, stagger = 3 }: { dur: number; stagger?: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur, 0), alignItems: "center", justifyContent: "center" }}>
      <Caption size={84}>You use more than one coding agent.</Caption>
      <div style={{ display: "flex", gap: 14, marginTop: 84 }}>
        {[...AGENTS, "+60"].map((a, i) => {
          const t = appear(f, 14 + i * stagger, 16);
          const more = a === "+60";
          return (
            <div key={a} style={{ width: 132, display: "flex", flexDirection: "column", alignItems: "center", opacity: t, transform: `translateY(${(1 - t) * 22}px) scale(${0.92 + t * 0.08})` }}>
              {more ? (
                <div style={{ width: 92, height: 92, borderRadius: 26, border: `2px dashed ${C.ink3}`, color: C.ink2, fontSize: 30, fontWeight: 650, display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "-0.02em" }}>
                  +60
                </div>
              ) : (
                <AgentAvatar name={a} size={92} />
              )}
              <div style={{ marginTop: 16, fontSize: 22, fontWeight: 560, color: C.ink2, whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{more ? "more" : a}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

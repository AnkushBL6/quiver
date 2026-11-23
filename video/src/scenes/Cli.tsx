import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Caption } from "../components/Caption";
import { appear, C, MONO, sceneFade } from "../theme";

// Output mirrors crates/quiver-cli/src/main.rs (report() and the doctor summary).
type Line = { cmd?: string; out?: string; color?: string; at: number };
const CPF = 1.5; // characters per frame while typing

const SCRIPT: Line[] = [
  { cmd: "quiver install anthropics/skills --skill pdf", at: 20 },
  { out: "✓ pdf", color: "#30d158", at: 0 },
  { cmd: "quiver doctor --apply", at: 0 },
  { out: "6 skill(s) to make universal, 223 missing link(s), 3 broken link(s), 0 conflict(s)", color: "#c7c7cc", at: 0 },
  { out: "232 done, 0 error(s)", color: "#30d158", at: 0 },
];

// Lay out the timeline: each command types, then its output appears.
let t = 0;
const TIMED = SCRIPT.map((l) => {
  if (l.cmd) {
    const start = Math.max(t, l.at) + (t ? 14 : 0);
    t = start + Math.ceil(l.cmd.length / CPF);
    return { ...l, start, end: t };
  }
  const start = t + 8;
  t = start;
  return { ...l, start, end: start };
});

export function Cli({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  const win = appear(f, 4, 20);
  const activeIdx = TIMED.findIndex((l) => l.cmd && f >= l.start && f < l.end);
  const lastStarted = TIMED.filter((l) => f >= l.start).length;
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur), alignItems: "center" }}>
      <Caption size={72} style={{ marginTop: 92 }}>The same Rust core, as a CLI.</Caption>
      <div
        style={{
          marginTop: 110,
          width: 1540,
          height: 430,
          borderRadius: 22,
          background: "#1e1e1e",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.05), 0 40px 100px -24px rgba(0,0,0,0.45)",
          overflow: "hidden",
          opacity: win,
          transform: `translateY(${(1 - win) * 40}px)`,
        }}
      >
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />
          ))}
          <div style={{ flex: 1, textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 20, fontWeight: 500, marginRight: 70 }}>zsh</div>
        </div>
        <div style={{ padding: "34px 44px", fontFamily: MONO, fontSize: 27, lineHeight: 1.75, color: "#f2f2f7" }}>
          {TIMED.map((l, i) => {
            if (f < l.start) return null;
            if (l.cmd) {
              const n = Math.min(l.cmd.length, Math.floor((f - l.start) * CPF));
              const showCaret = i === activeIdx || (i === lastStarted - 1 && Math.floor(f / 16) % 2 === 0);
              return (
                <div key={i} style={{ marginTop: i ? 18 : 0, whiteSpace: "pre" }}>
                  <span style={{ color: "#0a84ff" }}>❯ </span>
                  {l.cmd.slice(0, n)}
                  {showCaret && <span style={{ display: "inline-block", width: 15, height: 30, background: "#f2f2f7", verticalAlign: "-5px", marginLeft: 2 }} />}
                </div>
              );
            }
            const a = appear(f, l.start, 8);
            return (
              <div key={i} style={{ color: l.color, opacity: a, whiteSpace: "pre" }}>
                {l.out}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

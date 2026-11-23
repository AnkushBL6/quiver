import { AbsoluteFill, interpolateColors, useCurrentFrame } from "remotion";
import { AgentAvatar } from "../components/Agent";
import { Caption } from "../components/Caption";
import { appear, C, MONO, SHADOW_CARD, sceneFade } from "../theme";

type Chip = { name: string; tag?: string; kind?: "drift" | "broken" };
const ROWS: { dir: string; agent: string; skills: Chip[] }[] = [
  { dir: "~/.claude/skills", agent: "Claude Code", skills: [{ name: "pdf" }, { name: "frontend-design" }, { name: "code-review", tag: "v2", kind: "drift" }, { name: "caveman", kind: "broken" }] },
  { dir: "~/.gemini/config/skills", agent: "Antigravity", skills: [{ name: "pdf" }, { name: "code-review", tag: "v1", kind: "drift" }, { name: "brainstorming" }] },
  { dir: "~/.cursor/skills", agent: "Cursor", skills: [{ name: "humanizer", tag: "v2", kind: "drift" }, { name: "docx", kind: "broken" }] },
  { dir: "~/.factory/skills", agent: "Droid", skills: [{ name: "frontend-design" }, { name: "pdf", kind: "broken" }] },
  { dir: "~/.config/opencode/skills", agent: "OpenCode", skills: [] },
  { dir: "~/.copilot/skills", agent: "Copilot", skills: [{ name: "humanizer", tag: "v1", kind: "drift" }] },
];

const MARK = 96; // frame where the problems light up

function SkillChip({ chip, f, delay }: { chip: Chip; f: number; delay: number }) {
  const t = appear(f, delay, 14);
  const m = chip.kind ? appear(f, MARK + delay * 0.15, 14) : 0;
  const fg = chip.kind === "broken" ? C.red : chip.kind === "drift" ? C.amber : C.ink2;
  const bg = chip.kind === "broken" ? "rgba(224,56,46,0.11)" : "rgba(210,122,0,0.13)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderRadius: 12,
        fontFamily: MONO,
        fontSize: 24,
        background: interpolateColors(m, [0, 1], [C.chip, bg]),
        color: interpolateColors(m, [0, 1], [C.ink2, fg]),
        boxShadow: chip.kind === "broken" ? `inset 0 0 0 ${1.5 * m}px rgba(224,56,46,0.45)` : undefined,
        whiteSpace: "nowrap",
        flexShrink: 0,
        opacity: t,
        transform: `translateY(${(1 - t) * 10}px)`,
      }}
    >
      <span style={{ textDecoration: chip.kind === "broken" && m > 0.5 ? "line-through" : undefined }}>{chip.name}</span>
      {chip.kind && (
        <span style={{ fontFamily: "inherit", fontSize: 19, fontWeight: 600, opacity: m, maxWidth: m * 200, overflow: "hidden", whiteSpace: "nowrap" }}>
          {chip.kind === "broken" ? "broken" : chip.tag}
        </span>
      )}
    </div>
  );
}

export function Problem({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur), alignItems: "center" }}>
      <Caption size={72} style={{ marginTop: 92 }}>Every agent keeps its own skills folder.</Caption>
      <div
        style={{
          marginTop: 64,
          width: 1480,
          borderRadius: 24,
          background: C.card,
          boxShadow: SHADOW_CARD,
          overflow: "hidden",
          opacity: appear(f, 6, 16),
        }}
      >
        {ROWS.map((r, i) => {
          const t = appear(f, 12 + i * 6, 16);
          return (
            <div
              key={r.dir}
              style={{
                display: "flex",
                alignItems: "center",
                height: 92,
                padding: "0 36px",
                borderTop: i ? `1px solid ${C.line}` : undefined,
                opacity: t,
                transform: `translateX(${(1 - t) * -16}px)`,
              }}
            >
              <AgentAvatar name={r.agent} size={46} />
              <div style={{ width: 470, marginLeft: 22, fontFamily: MONO, fontSize: 27, color: C.ink, letterSpacing: "-0.01em" }}>{r.dir}</div>
              <div style={{ display: "flex", gap: 12, flex: 1, flexWrap: "nowrap" }}>
                {r.skills.length === 0 ? (
                  <div style={{ fontSize: 24, color: C.ink3, fontStyle: "italic", opacity: appear(f, 22 + i * 6, 14) }}>no skills</div>
                ) : (
                  r.skills.map((s, j) => <SkillChip key={j} chip={s} f={f} delay={20 + i * 6 + j * 4} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Caption start={MARK + 18} size={38} weight={520} color={C.ink2} style={{ marginTop: 52, letterSpacing: "-0.015em" }}>
        Skills get duplicated, drift apart, or stay stuck in one tool.
      </Caption>
    </AbsoluteFill>
  );
}

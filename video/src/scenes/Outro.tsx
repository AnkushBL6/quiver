import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Caption } from "../components/Caption";
import { appear, C, MONO, SHADOW_CARD, sceneFade } from "../theme";

export function Outro({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  const t = appear(f, 0, 22);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur, 12, 0), alignItems: "center", justifyContent: "center" }}>
      <div style={{ opacity: t, transform: `scale(${0.88 + t * 0.12})` }}>
        <Img src={staticFile("icon.png")} style={{ width: 200, height: 200 }} />
      </div>
      <Caption start={10} size={112} weight={720} style={{ marginTop: 10, letterSpacing: "-0.045em" }}>
        Quiver
      </Caption>
      <Caption start={18} size={50} weight={600} color={C.ink2} style={{ marginTop: 14 }}>
        Free and open source · macOS
      </Caption>
      <div style={{ marginTop: 44, opacity: appear(f, 28, 16), transform: `translateY(${(1 - appear(f, 28, 16)) * 12}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 38, color: C.ink, padding: "18px 34px", borderRadius: 999, background: "white", boxShadow: SHADOW_CARD }}>
          github.com/AnkushBL6/quiver
        </div>
      </div>
      <Caption start={36} size={28} weight={500} color={C.ink3} style={{ marginTop: 30, letterSpacing: "-0.005em" }}>
        MIT · about 7 MB · no telemetry
      </Caption>
    </AbsoluteFill>
  );
}
